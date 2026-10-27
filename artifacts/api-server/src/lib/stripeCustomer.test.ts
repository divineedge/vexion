import { beforeEach,afterEach,describe,it,expect,vi } from "vitest";
const state=vi.hoisted(()=>({row:{id:42,tenantId:7,name:"QA customer",email:"qa@example.invalid",stripeCustomerId:null as string|null},create:vi.fn(),lock:Promise.resolve()}));
vi.mock("stripe",()=>({default:class{customers={create:state.create};}}));
vi.mock("@workspace/db",async original=>{
  const m=await original<typeof import("@workspace/db")>();
  const tx={
    select:()=>({from:()=>({where:()=>({for:async()=>[{...state.row}]})})}),
    update:()=>({set:(values:object)=>({where:async()=>{Object.assign(state.row,values);}})}),
  };
  return {...m,db:{transaction:async(fn:(tx:any)=>Promise<unknown>)=>{
    const previous=state.lock;let release!:()=>void;
    state.lock=new Promise<void>(resolve=>{release=resolve;});await previous;
    try{return await fn(tx);}finally{release();}
  }}};
});
import { ensureStripeCustomer } from "./stripe";
describe("one Stripe profile per linked CRM customer",()=>{
  beforeEach(()=>{vi.stubEnv("STRIPE_SECRET_KEY","sk_test_fake_never_sent");state.row.stripeCustomerId=null;state.lock=Promise.resolve();state.create.mockReset().mockResolvedValue({id:"cus_once"});});
  afterEach(()=>vi.unstubAllEnvs());
  it("uses the current saved link even when the caller has a stale snapshot",async()=>{
    state.row.stripeCustomerId="cus_existing";
    expect(await ensureStripeCustomer(42,"QA","qa@example.invalid",null)).toBe("cus_existing");
    expect(state.create).not.toHaveBeenCalled();
  });
  it("serializes overlapping setup requests and uses a stable provider idempotency key",async()=>{
    const results=await Promise.all([ensureStripeCustomer(42,"QA","qa@example.invalid",null),ensureStripeCustomer(42,"QA","qa@example.invalid",null)]);
    expect(results).toEqual(["cus_once","cus_once"]);expect(state.create).toHaveBeenCalledTimes(1);
    expect(state.create).toHaveBeenCalledWith(expect.objectContaining({metadata:{internalCustomerId:"42",tenantId:"7"}}),{idempotencyKey:"crm-customer-7-42"});
  });
  it("reuses the same idempotency key when an uncertain creation is retried",async()=>{
    state.create.mockRejectedValueOnce(new Error("uncertain response"));
    await expect(ensureStripeCustomer(42,"QA","qa@example.invalid",null)).rejects.toThrow("uncertain");
    expect(await ensureStripeCustomer(42,"QA","qa@example.invalid",null)).toBe("cus_once");
    expect(state.create.mock.calls.map(call=>call[1].idempotencyKey)).toEqual(["crm-customer-7-42","crm-customer-7-42"]);
  });
});
