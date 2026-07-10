import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import dashboardRouter from "./dashboard";
import customersRouter from "./customers";
import propertiesRouter from "./properties";
import jobsRouter from "./jobs";
import crewsRouter from "./crews";
import inventoryRouter from "./inventory";
import invoicesRouter from "./invoices";
import routinesRouter from "./routines";
import timeTrackingRouter from "./timeTracking";
import blueprintsRouter from "./blueprints";
import settingsRouter from "./settings";
import plansRouter from "./plans";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(dashboardRouter);
router.use(customersRouter);
router.use(propertiesRouter);
router.use(jobsRouter);
router.use(crewsRouter);
router.use(inventoryRouter);
router.use(invoicesRouter);
router.use(routinesRouter);
router.use(timeTrackingRouter);
router.use(blueprintsRouter);
router.use(settingsRouter);
router.use(plansRouter);

export default router;
