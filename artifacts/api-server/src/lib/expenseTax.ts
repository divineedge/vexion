/** Purchase tax, not tax charged to the customer. Amount is always the cash total. */
export function expenseTax(input:{amount:number;subtotal?:number|null;salesTaxPct?:number;capitalizeSalesTax?:boolean;shippingAmount?:number;capitalizeShipping?:boolean}){
 const fail=(message:string):never=>{throw Object.assign(new Error(message),{status:400});};
 const shipping=input.shippingAmount??0;
 if(!Number.isFinite(shipping)||shipping<0)fail('Shipping / delivery must be a non-negative amount');
 if(input.capitalizeShipping!==undefined&&typeof input.capitalizeShipping!=='boolean')fail('Choose whether shipping is included in supply cost');
 const rate=input.salesTaxPct??0,base=input.subtotal??(input.amount-shipping);
 if(!Number.isFinite(base)||base<0||!Number.isFinite(rate)||rate<0||rate>100)fail('Enter a non-negative subtotal and a sales tax percentage from 0 to 100');
 if(input.capitalizeSalesTax!==undefined&&typeof input.capitalizeSalesTax!=='boolean')fail('Choose whether sales tax is included in supply cost');
 const round=(n:number)=>Math.round((n+Number.EPSILON)*100)/100;
 const tax=round(base*rate/100),total=round(base+tax+shipping);
 if(!Number.isFinite(input.amount)||input.amount<0||Math.abs(input.amount-total)>.005)fail('Expense total must equal the subtotal plus sales tax and shipping');
 return {amount:total,subtotal:round(base),salesTaxPct:rate,salesTaxAmount:tax,capitalizeSalesTax:input.capitalizeSalesTax??false,shippingAmount:round(shipping),capitalizeShipping:input.capitalizeShipping??false};
}
