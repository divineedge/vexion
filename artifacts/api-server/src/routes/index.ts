import { Router, type IRouter } from "express";
import kpisRouter from "./kpis";
import jobEconomicsRouter from "./jobEconomics";
import websiteIntakeRouter,{publicWebsiteIntakeRouter} from "./websiteIntake";
import type { Request, Response, NextFunction } from "express";
import { SchedulingPaymentError } from "../lib/paymentPolicy";
import { CrewCapacityError } from "../lib/crewCapacity";
import healthRouter from "./health";
import pricingReviewRouter from "./pricingReview";
import estimateRemindersRouter from "./estimateReminders";
import paymentPolicyRouter from "./paymentPolicy";
import acquisitionRouter from "./acquisition";
import jobFormsRouter from "./jobForms";
import formEvidenceRouter from "./formEvidence";
import hrRouter from "./hr";
import hiringRouter from "./hiring";
import careersRouter from "./careers";
import documentDeliveriesRouter from "./documentDeliveries";
import billingSafetyRouter from "./billingSafety";
import authRouter from "./auth";
import storageRouter from "./storage";
import mediaRouter from "./media";
import dashboardRouter from "./dashboard";
import customersRouter from "./customers";
import propertiesRouter from "./properties";
import jobsRouter from "./jobs";
import crewsRouter from "./crews";
import inventoryRouter from "./inventory";
import inventoryLocationsRouter from "./inventoryLocations";
import invoicesRouter from "./invoices";
import timeTrackingRouter from "./timeTracking";
import blueprintsRouter from "./blueprints";
import settingsRouter from "./settings";
import plansRouter from "./plans";
import servicePlansRouter from "./servicePlans";
import efficiencyRouter from "./efficiency";
import callbacksRouter from "./callbacks";
import marketingRouter from "./marketing";
import p4pRouter from "./p4p";
import servicesRouter from "./services";
import chemicalsRouter from "./chemicals";
import scheduleWeatherRouter from "./scheduleWeather";
import chemicalDocumentsRouter from "./chemicalDocuments";
import equipmentRouter from "./equipment";
import quotesRouter, { publicQuotesRouter } from "./quotes";
import guestDocumentPortalRouter from "./guestDocumentPortal";
import documentPaymentsRouter from "./documentPayments";
import widgetRouter from "./widget";
import portalRouter from "./portal";
import communicationsRouter from "./communications";
import estimatesRouter from "./estimates";
import documentSharingRouter from "./documentSharing";
import visitsRouter from "./visits";
import estimateTemplatesRouter from "./estimateTemplates";
import billingRouter from "./billing";
import reportsRouter from "./reports";
import vendorsRouter from "./vendors";
import expensesRouter from "./expenses";
import broadcastsRouter from "./broadcasts";
import campaignPreferencesRouter from "./campaignPreferences";
import integrationsRouter from "./integrations";
import devToolsRouter from "./devTools";
import reviewsRouter from "./reviews";
import stopServiceFlagsRouter from "./stopServiceFlags";
import internalTasksRouter from "./internalTasks";
import routingRouter from "./routing";
import taskBundlesRouter from "./taskBundles";
import followupQueueRouter from "./followupQueue";
import importBatchesRouter from "./importBatches";
import employeeHistoryRouter from "./employeeHistory";
import repairLogsRouter from "./repairLogs";
import planCancelRequestsRouter from "./planCancelRequests";
import tagsRouter from "./tags";
import skipReasonsRouter from "./skipReasons";
import portalMessagesRouter from "./portalMessages";
import staffNotesRouter from "./staffNotes";
import invoiceTemplatesRouter from "./invoiceTemplates";
import jobMessagesRouter from "./jobMessages";
import jobEquipmentUsesRouter from "./jobEquipmentUses";
import jobRequestsRouter from "./jobRequests";
import staffMessagesRouter from "./staffMessages";
import staffNotificationDevicesRouter from "./staffNotificationDevices";
import externalAccessRouter from "./externalAccess";
import externalRestRouter from "./externalRest";
import externalMcpRouter from "./externalMcp";
import externalWebhooksRouter from "./externalWebhooks";
import externalOAuthRouter from "./externalOAuth";
import { requireVerifiedStaff } from "../lib/verifiedStaff";

const router: IRouter = Router();
router.use(kpisRouter);
router.use(jobEconomicsRouter);

router.use(healthRouter);
router.use(pricingReviewRouter);
router.use(estimateRemindersRouter);
router.use(authRouter);
router.use(publicQuotesRouter);
router.use(guestDocumentPortalRouter);
router.use(widgetRouter);
router.use(publicWebsiteIntakeRouter);
router.use(careersRouter);
router.use(documentDeliveriesRouter);
router.use(portalRouter);
// These routes define their own opaque-token/provider authentication. They must
// remain outside the staff-session boundary and never inherit staff identity.
router.use(externalRestRouter);
router.use(externalMcpRouter);
router.use(externalWebhooksRouter);
router.use(externalOAuthRouter);

/**
 * Server-wide staff boundary. The narrowly enumerated paths below implement
 * their own public token, portal-session, or webhook verification. Everything
 * else mounted after this point must present a valid active staff session.
 */
router.use((req, res, next) => {
  const publicCustomerPath =
    req.path.startsWith("/public/") ||
    req.path.startsWith("/storage/public-objects/") ||
    req.path.startsWith("/storage/objects/") ||
    req.path === "/storage/read-url" ||
    (req.path === "/communications/webhook" && req.method === "POST");
  if (publicCustomerPath) {
    next();
    return;
  }
  void requireVerifiedStaff(req, res, next);
});

router.use(storageRouter);
router.use(websiteIntakeRouter);
router.use(mediaRouter);
router.use(dashboardRouter);
router.use(customersRouter);
router.use(propertiesRouter);
router.use(paymentPolicyRouter);
router.use(acquisitionRouter);
router.use(jobFormsRouter);
router.use(formEvidenceRouter);
router.use(hrRouter);
router.use(hiringRouter);
router.use(jobsRouter);
router.use(jobRequestsRouter);
router.use(crewsRouter);
router.use(inventoryRouter);
router.use(inventoryLocationsRouter);
router.use(invoicesRouter);
router.use(documentPaymentsRouter);
router.use(timeTrackingRouter);
router.use(blueprintsRouter);
router.use(settingsRouter);
router.use(plansRouter);
router.use(servicePlansRouter);
router.use(efficiencyRouter);
router.use(callbacksRouter);
router.use(marketingRouter);
router.use(p4pRouter);
router.use(servicesRouter);
router.use(chemicalsRouter);
router.use(scheduleWeatherRouter);
router.use(chemicalDocumentsRouter);
// These mixed routers contain explicit public token/webhook handlers. Mount
// them before equipment's defense-in-depth router middleware so those public
// handlers remain reachable; the server-wide boundary above still protects
// all of their staff handlers.
router.use(communicationsRouter);
router.use(estimatesRouter);
router.use(documentSharingRouter);
router.use(reviewsRouter);
router.use(equipmentRouter);
router.use(quotesRouter);
router.use(visitsRouter);
router.use(estimateTemplatesRouter);
router.use(billingRouter);
router.use(reportsRouter);
router.use(vendorsRouter);
router.use(expensesRouter);
router.use(broadcastsRouter);
router.use(campaignPreferencesRouter);
router.use(integrationsRouter);
router.use(devToolsRouter);
router.use(stopServiceFlagsRouter);
router.use(internalTasksRouter);
router.use(routingRouter);
router.use(taskBundlesRouter);
router.use(followupQueueRouter);
router.use(importBatchesRouter);
router.use(employeeHistoryRouter);
router.use(repairLogsRouter);
router.use(planCancelRequestsRouter);
router.use(billingSafetyRouter);
router.use(tagsRouter);
router.use(skipReasonsRouter);
router.use(portalMessagesRouter);
router.use(staffNotesRouter);
router.use(invoiceTemplatesRouter);
router.use(jobMessagesRouter);
router.use(staffMessagesRouter);
router.use(staffNotificationDevicesRouter);
router.use(jobEquipmentUsesRouter);
router.use(externalAccessRouter);

router.use((error: unknown, _req: Request, res: Response, next: NextFunction) => {
  if (error instanceof CrewCapacityError) { res.status(409).json({code:"crew_capacity_exceeded",error:error.message,capacityWarnings:[error.message]});return; }
  if (error instanceof SchedulingPaymentError) { res.status(422).json({ error: error.message }); return; }
  next(error);
});
export default router;
