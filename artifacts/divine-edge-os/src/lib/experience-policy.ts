/** Date inputs use calendar days; the API requires a full UTC timestamp. */
export function policyTrialInput(value:string|null|undefined):string{
  const day=typeof value==="string"?value.slice(0,10):"";
  return /^\d{4}-\d{2}-\d{2}$/.test(day)?day:"";
}
export function policyTrialUntil(value:string|null|undefined):string|null{
  if(!value)return null;
  const day=policyTrialInput(value);
  if(!day)throw new Error("Choose a valid trial end date.");
  const date=new Date(value===day?`${day}T23:59:59.999Z`:value);
  if(!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==day)throw new Error("Choose a valid trial end date.");
  return date.toISOString();
}
