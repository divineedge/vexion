import { z } from "zod/v4";

export const weatherLocationsInput = z.object({
  locations: z.array(z.object({
    id: z.string().trim().min(1).max(160),
    label: z.string().trim().min(2).max(160),
    query: z.string().trim().min(2).max(160),
  }).strict()).max(30),
}).strict().superRefine(({locations},ctx)=>{
  if(new Set(locations.map(x=>x.id)).size!==locations.length || new Set(locations.map(x=>x.query.toLowerCase())).size!==locations.length)
    ctx.addIssue({code:"custom",path:["locations"],message:"List each forecast town or ZIP code only once."});
});
export type WeatherLocation = z.infer<typeof weatherLocationsInput>["locations"][number];
export function savedWeatherLocations(raw:unknown):WeatherLocation[] {
  const parsed=weatherLocationsInput.safeParse({locations:raw??[]});
  if(!parsed.success)throw new Error("Saved forecast locations need review in Settings.");
  return parsed.data.locations;
}

const cache=new Map<string,{lat:number;lng:number;expires:number}>();
let queue:Promise<unknown>=Promise.resolve();
let lastRequest=0;
/** Resolve towns/ZIPs only; never send customer addresses or device positions. */
export async function resolveWeatherTown(query:string,state?:string|null):Promise<{lat:number;lng:number}>{
  const zip=/^\d{5}(?:-\d{4})?$/.test(query);
  const search=!zip&&!query.includes(",")&&state?`${query}, ${state}`:query;
  const key=search.trim().toLowerCase();
  const cached=cache.get(key);
  if(cached && cached.expires>Date.now())return cached;
  const pending=queue.catch(()=>{}).then(async()=>{
    const again=cache.get(key);
    if(again && again.expires>Date.now())return again;
    const wait=1100-(Date.now()-lastRequest);
    if(wait>0)await new Promise(resolve=>setTimeout(resolve,wait));
    lastRequest=Date.now();
    const url=new URL("https://nominatim.openstreetmap.org/search");
    url.searchParams.set("format","json");url.searchParams.set("limit","1");
    if(zip){url.searchParams.set("postalcode",query.slice(0,5));url.searchParams.set("countrycodes","us");}
    else url.searchParams.set("q",search);
    const response=await fetch(url,{headers:{"User-Agent":"DivineEdgeOS/1.0 (business forecast town lookup)"},signal:AbortSignal.timeout(8000)});
    if(!response.ok)throw new Error("The town lookup provider is temporarily unavailable.");
    const rows=z.array(z.object({lat:z.coerce.number().min(-90).max(90),lon:z.coerce.number().min(-180).max(180)})).parse(await response.json());
    if(!rows[0])throw new Error("Town or ZIP code not found. Include the state with the town in Settings.");
    const value={lat:rows[0].lat,lng:rows[0].lon,expires:Date.now()+86400000};
    if(cache.size>=1000)cache.delete(cache.keys().next().value!);
    cache.set(key,value);
    return value;
  });
  queue=pending;
  return pending;
}
