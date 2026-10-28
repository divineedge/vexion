import type { RequestHandler } from "express";
import { db, softwareBillingAccountsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { getTenantId } from "./tenantHelper";

/** Only real, enforceable product modules belong in the subscription picker. */
export const SOFTWARE_FEATURE_CATALOG = [
  { key: "scheduling", label: "Job scheduling, crew calendar and forecast", description: "Create, assign, drag to reschedule and track jobs; use scheduler weather forecasts for planning.", appPaths: ["/schedule", "/jobs"], apiPaths: ["/jobs", "/schedule"] },
  { key: "visits", label: "Scheduled site visits", description: "Book and track customer site visits.", appPaths: ["/visits"], apiPaths: ["/visits"] },
  { key: "estimates", label: "Estimates and estimate templates", description: "Write, share, and manage estimates and reusable templates.", appPaths: ["/estimates"], apiPaths: ["/estimates", "/estimate-templates"] },
  { key: "invoices", label: "Invoices and recurring billing", description: "Invoice work, manage recurring billing and invoice templates.", appPaths: ["/financials", "/invoices", "/invoice-templates"], apiPaths: ["/invoices", "/invoice-templates", "/billing"] },
  { key: "service_plans", label: "Service plans", description: "Sell and schedule multi-visit service programs.", appPaths: ["/service-plans", "/plans"], apiPaths: ["/service-plans", "/plan-templates", "/customer-plans"] },
  { key: "routing", label: "Crew routes", description: "Plan, assign, and optimize daily routes.", appPaths: ["/routes"], apiPaths: ["/routes", "/routing"] },
  { key: "inventory", label: "Inventory and supplies", description: "Track stock, receiving, parts, and job supplies.", appPaths: ["/inventory"], apiPaths: ["/inventory"] },
  { key: "equipment", label: "Equipment, pre-trip checks and fuel", description: "Manage equipment, morning/pre-trip inspections, maintenance, bulk tanks and fuel costs.", appPaths: ["/equipment"], apiPaths: ["/equipment", "/bulk-fuel", "/pretrip"] },
  { key: "employee_records", label: "Employee records and hiring", description: "Manage private HR documentation, employee history, job openings, and applications. Basic staff accounts remain available.", appPaths: ["/hiring"], apiPaths: ["/employee-records", "/employee-history", "/employee-form-templates", "/users/:userId/history", "/hr"] },
  { key: "payroll", label: "Payroll, P4P and crew efficiency", description: "Review payroll, performance pay, employee and crew efficiency. Basic job clocking remains available.", appPaths: ["/payroll", "/p4p", "/efficiency"], apiPaths: ["/payroll", "/p4p", "/efficiency"] },
  { key: "budget", label: "Business budget, pricing floor and review", description: "Plan company and division budgets, calculate job break-even prices and review pricing.", appPaths: ["/budget", "/pricing-review"], apiPaths: ["/settings/budget", "/pricing-review", "/reports/pricing-review"] },
  { key: "reports", label: "KPI dashboard and reports", description: "Analyze customer value, job profitability, and service performance.", appPaths: ["/kpis", "/reports"], apiPaths: ["/kpis", "/reports"] },
  { key: "marketing", label: "Marketing and growth programs", description: "Manage campaigns, referrals, and door-hanger programs.", appPaths: ["/marketing"], apiPaths: ["/marketing", "/acquisition"] },
  { key: "website_quotes", label: "Website forms and instant quote intake", description: "Customize conditional website forms, property-measurement quote intake and staff review.", appPaths: ["/website-forms"], apiPaths: ["/website-intake"] },
  { key: "forms", label: "Custom job forms", description: "Build job forms, templates, and required checklists.", appPaths: ["/forms"], apiPaths: ["/job-forms", "/form-templates", "/jobs/:id/forms"] },
  { key: "blueprints", label: "Property blueprints", description: "Create and estimate from property plans.", appPaths: ["/blueprints"], apiPaths: ["/blueprints"] },
  { key: "portal_messages", label: "Customer portal messages", description: "Manage customer portal conversations and requests.", appPaths: ["/portal-inbox"], apiPaths: ["/portal-inbox"] },
  { key: "vendors", label: "Vendors and expenses", description: "Manage vendors, expense categories, tax, delivery and recorded expenses.", appPaths: ["/vendors"], apiPaths: ["/vendors", "/expenses", "/expense-categories"] },
  { key: "chemicals", label: "Chemical applications", description: "Track chemical products, mixtures, application records and actual application weather.", appPaths: ["/chemicals"], apiPaths: ["/chemical-products", "/chemical-mixtures", "/chemical-applications", "/jobs/:id/chemical-applications", "/jobs/:id/chemical-weather"] },
  { key: "callbacks", label: "Callbacks and quality control", description: "Record service callbacks and track corrective work.", appPaths: ["/callbacks"], apiPaths: ["/callbacks"] },
  { key: "tasks", label: "Tasks and daily task bundles", description: "Assign internal tasks and reusable daily task bundles.", appPaths: ["/tasks", "/daily-tasks"], apiPaths: ["/tasks", "/task-bundles", "/task-bundle-items", "/task-bundle-completions"] },
  { key: "calls", label: "Calls and follow-up queue", description: "Track customer calls and manage staff follow-up assignments.", appPaths: ["/calls", "/followup-queue"], apiPaths: ["/communications/quo/calls", "/followup-queue"] },
  { key: "reviews", label: "Customer reviews", description: "Request reviews and track customer ratings and feedback.", appPaths: ["/reviews"], apiPaths: ["/reviews"] },
  { key: "phone_integration", label: "Phone integration — Quo / OpenPhone", description: "Connect supported business-phone providers for phone records and messaging. Provider accounts and their charges are separate.", appPaths: [], apiPaths: ["/communications/quo"] },
  { key: "quickbooks_sync", label: "QuickBooks Online — one-way sync", description: "Push supported customer, invoice and payment data to QuickBooks Online. Not a two-way accounting sync; a QuickBooks account is required.", appPaths: [], apiPaths: ["/integrations/quickbooks"] },
  { key: "bank_feed", label: "Bank feed integration", description: "Connect supported bank feeds, review imported transactions and record expenses.", appPaths: [], apiPaths: ["/integrations/bank", "/bank-transactions"] },
  { key: "mailchimp_integration", label: "Mailchimp audience sync", description: "Sync customer audience/contact information to a configured Mailchimp account. Mailchimp charges are separate.", appPaths: [], apiPaths: ["/integrations/mailchimp"] },
  { key: "lob_integration", label: "Lob print and mail integration", description: "Send supported physical documents through a configured Lob account. Postage and provider charges are separate.", appPaths: [], apiPaths: ["/integrations/lob"] },
  { key: "api_access", label: "External REST API access", description: "Owner-approved service credentials and resource permissions for external software, with expiry, revocation and access auditing.", appPaths: [], apiPaths: ["/external/v1"] },
  { key: "mcp_access", label: "MCP access for AI agents", description: "Owner-approved MCP connections and supported OAuth registrations for AI assistants. Explicit permissions still apply; not a promise of compatibility with every agent.", appPaths: [], apiPaths: ["/external/mcp"] },
  { key: "external_webhooks", label: "External phone and service webhooks", description: "Receive supported signed provider events through owner-approved connections, with scoped permissions and auditing.", appPaths: [], apiPaths: ["/external/webhooks"] },
] as const;

const NEW_OPTIONAL_KEYS = ["vendors", "chemicals", "callbacks", "tasks", "calls", "reviews"];
const INTEGRATION_KEYS = ["phone_integration", "quickbooks_sync", "bank_feed", "mailchimp_integration", "lob_integration", "api_access", "mcp_access", "external_webhooks"];
export const SOFTWARE_POLICY_VERSION = 3;
export const CORE_SOFTWARE_FEATURES = [
  { key: "core_customers", label: "Customers and properties", description: "Customer records, active/archive views, duplicate merge, customer import/export, billing/property addresses, saved map pins and satellite measurements." },
  { key: "core_services", label: "Service catalog and pricing matrices", description: "Manage service definitions and measurement-based pricing." },
  { key: "core_team", label: "Staff accounts and crews", description: "Basic employee accounts, roles and crew membership. Private HR is a separate module." },
  { key: "core_clock", label: "Basic time tracking and Field App access", description: "Staff sign-in and time clocks. Payroll, P4P and other Field App modules depend on the selected modules." },
  { key: "core_messages", label: "Internal staff messages", description: "Staff-to-staff work communication." },
  { key: "core_portal", label: "Customer portal access", description: "Customers can access documents and payments enabled by the selected modules. Portal messages are separate." },
  { key: "core_settings", label: "Company settings, security and support", description: "Business preferences, account security, audit/history tools, onboarding, software support and feedback. Email-provider configuration is included; the separately listed external integrations are optional modules. Provider charges are not included." },
] as const;
const FEATURE_DETAILS: Record<string,string> = {
  scheduling:"Includes drag-and-drop rescheduling, rescheduling-fee choices, staff/crew capacity checks and saved forecast locations.",
  estimates:"Includes service bundles, optional line items, estimate templates, reminders, customer accept/decline feedback, deposit rules and document previews.",
  invoices:"Includes recurring automation, invoice templates, reminders, credits/prepayments, delivery verification and supported Stripe card/ACH payments. A configured payment provider is required.",
  service_plans:"Includes seasonal rounds, multiple services per visit, crew assignments, capacity review, advance visit notices and manager overrides.",
  inventory:"Includes vendor receiving, tax/shipping allocation and highest-cost-first job supply costing.",
  equipment:"Includes morning/pre-trip checklists, inspection evidence, maintenance, bulk-tank meter readings and fuel allocation.",
  employee_records:"Includes private HR documents, licenses/certificates, expiry alerts, employee correction evidence, hiring/application forms and job openings.",
  payroll:"Includes time-sheet review, employee and crew comparisons, performance pay and approved damage allocations.",
  reports:"Includes annual customer spend, service time/measurement analysis, matrix groups, customer filters and job labor/material profitability.",
  marketing:"Includes email campaigns, not-now follow-up routing, referrals, door hangers and acquisition rewards.",
  website_quotes:"Includes conditional questions, required/optional fields, file uploads, optional property measuring and staff approval before CRM entry.",
};
export const featureCatalogDto = () => [
  ...SOFTWARE_FEATURE_CATALOG.map(({ apiPaths: _private, ...feature }) => ({...feature,description:[feature.description,FEATURE_DETAILS[feature.key]].filter(Boolean).join(" ")})),
  ...CORE_SOFTWARE_FEATURES.map(feature => ({ ...feature, appPaths: [], alwaysIncluded: true })),
];
export function resolvePolicyFeatureKeys(policy: { version?: unknown; featureKeys?: unknown }): string[] | null {
  const keys = policy.featureKeys;
  if (keys === null) return null;
  if (!Array.isArray(keys) || keys.some(key => typeof key !== "string")) throw new Error("This business's plan feature policy needs software-owner review.");
  const validated = validateFeatureKeys(keys);
  // Newly cataloged integrations were previously unrestricted. Do not revoke
  // purchased access when adding a new checkbox to the catalog.
  if (policy.version === SOFTWARE_POLICY_VERSION) return validated;
  if (policy.version === 2) return [...new Set([...validated, ...INTEGRATION_KEYS])];
  if (policy.version != null && policy.version !== 1) throw new Error("Unsupported software plan policy version; contact the software owner.");
  return [...new Set([...validated, ...NEW_OPTIONAL_KEYS, ...INTEGRATION_KEYS])];
}
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
  return resolvePolicyFeatureKeys(account.policy as { version?: unknown; featureKeys?: unknown });
}
export async function hasSoftwareFeature(tenantId: number, key: string) {
  const keys = await businessFeatureKeys(tenantId);
  return keys === null || keys.includes(key);
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
    if (keys !== null && (!keys.includes(feature.key) || (req.path.startsWith("/communications/quo") && !keys.includes("phone_integration")))) {
      res.status(403).json({ code: "software_feature_not_included", feature: feature.key,
        error: `${feature.label} is not included in this business's software plan. Contact the business owner to change plans.` }); return;
    }
    next();
  } catch (error) { next(error); }
};
