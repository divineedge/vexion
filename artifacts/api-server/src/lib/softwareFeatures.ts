import type { RequestHandler } from "express";
import { db, softwareBillingAccountsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { getTenantId } from "./tenantHelper";

/** Only real, enforceable product modules belong in the subscription picker. */
export const SOFTWARE_FEATURE_CATALOG = [
  { key: "scheduling", label: "Job scheduling and crew calendar", description: "Create, assign, reschedule, and track work jobs.", appPaths: ["/schedule", "/jobs"], apiPaths: ["/jobs", "/schedule"] },
  { key: "visits", label: "Scheduled site visits", description: "Book and track customer site visits.", appPaths: ["/visits"], apiPaths: ["/visits"] },
  { key: "estimates", label: "Estimates and estimate templates", description: "Write, share, and manage estimates and reusable templates.", appPaths: ["/estimates"], apiPaths: ["/estimates", "/estimate-templates"] },
  { key: "invoices", label: "Invoices and recurring billing", description: "Invoice work, manage recurring billing and invoice templates.", appPaths: ["/financials", "/invoices", "/invoice-templates"], apiPaths: ["/invoices", "/invoice-templates", "/billing"] },
  { key: "service_plans", label: "Service plans", description: "Sell and schedule multi-visit service programs.", appPaths: ["/service-plans", "/plans"], apiPaths: ["/service-plans", "/plan-templates", "/customer-plans"] },
  { key: "routing", label: "Crew routes", description: "Plan, assign, and optimize daily routes.", appPaths: ["/routes"], apiPaths: ["/routes", "/routing"] },
  { key: "inventory", label: "Inventory and supplies", description: "Track stock, receiving, parts, and job supplies.", appPaths: ["/inventory"], apiPaths: ["/inventory"] },
  { key: "equipment", label: "Equipment and fuel tracking", description: "Manage equipment, inspections, maintenance, and bulk fuel.", appPaths: ["/equipment"], apiPaths: ["/equipment", "/bulk-fuel", "/pretrip"] },
  { key: "employee_records", label: "Employee records and hiring", description: "Manage private HR documentation, employee history, job openings, and applications. Basic staff accounts remain available.", appPaths: ["/hiring"], apiPaths: ["/employee-records", "/employee-history", "/employee-form-templates", "/users/:userId/history", "/hr"] },
  { key: "payroll", label: "Payroll and P4P", description: "Review payroll and performance pay. Basic job clocking remains available.", appPaths: ["/payroll", "/p4p", "/efficiency"], apiPaths: ["/payroll", "/p4p", "/efficiency"] },
  { key: "budget", label: "Business budget and pricing review", description: "Plan company and division budgets and review prices.", appPaths: ["/budget", "/pricing-review"], apiPaths: ["/settings/budget", "/pricing-review", "/reports/pricing-review"] },
  { key: "reports", label: "KPI dashboard and reports", description: "Analyze customer value, job profitability, and service performance.", appPaths: ["/kpis", "/reports"], apiPaths: ["/kpis", "/reports"] },
  { key: "marketing", label: "Marketing and growth programs", description: "Manage campaigns, referrals, and door-hanger programs.", appPaths: ["/marketing"], apiPaths: ["/marketing", "/acquisition"] },
  { key: "website_quotes", label: "Website forms and quote intake", description: "Customize website intake forms and review quote inquiries.", appPaths: ["/website-forms"], apiPaths: ["/website-intake"] },
  { key: "forms", label: "Custom job forms", description: "Build job forms, templates, and required checklists.", appPaths: ["/forms"], apiPaths: ["/job-forms", "/form-templates", "/jobs/:id/forms"] },
  { key: "blueprints", label: "Property blueprints", description: "Create and estimate from property plans.", appPaths: ["/blueprints"], apiPaths: ["/blueprints"] },
  { key: "portal_messages", label: "Customer portal messages", description: "Manage customer portal conversations and requests.", appPaths: ["/portal-inbox"], apiPaths: ["/portal-inbox"] },
] as const;

export const featureCatalogDto = () => SOFTWARE_FEATURE_CATALOG.map(({ apiPaths: _private, ...feature }) => feature);
export function validateFeatureKeys(keys: string[]) {
  const known = new Set<string>(SOFTWARE_FEATURE_CATALOG.map(feature => feature.key));
  if (keys.some(key => !known.has(key))) throw new Error("Choose the included features from the feature checklist before publishing this plan.");
  return [...new Set(keys)];
}
export async function businessFeatureKeys(tenantId: number): Promise<string[] | null> {
  const [account] = await db.select({ policy: softwareBillingAccountsTable.planPolicy }).from(softwareBillingAccountsTable)
    .where(eq(softwareBillingAccountsTable.tenantId, tenantId));
  // Grandfather existing accounts and published legacy price versions. Never
  // reinterpret descriptive marketing text as a restrictive entitlement list.
  if (account?.policy == null) return null;
  const keys = (account.policy as { featureKeys?: unknown }).featureKeys;
  if(keys===null)return null;
  if (!Array.isArray(keys) || keys.some(key => typeof key !== "string")) throw new Error("This business's plan feature policy needs software-owner review.");
  return validateFeatureKeys(keys);
}
// Nested module routes (job forms, pricing review, employee history) win over
// their general parent. Compile constant route patterns once, never user input.
const apiRules=SOFTWARE_FEATURE_CATALOG.flatMap(feature=>feature.apiPaths.map(prefix=>({
  feature,
  specificity:prefix.split("/").length*1000+prefix.length,
  pattern:new RegExp("^"+prefix.split("/").map(part=>part.startsWith(":")?"[^/]+":part.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")).join("/")+"(?:/|$)"),
}))).sort((a,b)=>b.specificity-a.specificity);
export const featureForApiPath=(path:string)=>apiRules.find(rule=>rule.pattern.test(path))?.feature;
export const enforceSoftwareFeatures: RequestHandler = async (req, res, next) => {
  if (!(req as typeof req & { verifiedUserId?: number }).verifiedUserId) { next(); return; }
  const feature = featureForApiPath(req.path);
  if (!feature) { next(); return; }
  try {
    const keys = await businessFeatureKeys(getTenantId(req));
    if (keys !== null && !keys.includes(feature.key)) {
      res.status(403).json({ code: "software_feature_not_included", feature: feature.key,
        error: `${feature.label} is not included in this business's software plan. Contact the business owner to change plans.` }); return;
    }
    next();
  } catch (error) { next(error); }
};
