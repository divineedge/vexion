import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { startReminderScheduler } from "./lib/reminderScheduler";
import { startRecurrenceScheduler } from "./lib/recurrenceScheduler";
import { startBillingScheduler } from "./lib/billingScheduler";
import { startPaymentReminderScheduler } from "./lib/paymentReminderScheduler";
import { startPlanScheduler } from "./lib/planScheduler";
import { startFollowupScheduler } from "./lib/followupScheduler";
import { startClockOutScheduler } from "./lib/clockOutScheduler";
import { startBroadcastScheduler } from "./lib/broadcastScheduler";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());

// Capture raw request body bytes before JSON parsing so webhook signature
// verification can compare against the exact bytes the provider signed.
app.use(
  express.json({
    verify: (req: express.Request & { rawBody?: Buffer }, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

// Start automated reminder scheduler
startReminderScheduler();

// Start recurring job generation scheduler
startRecurrenceScheduler();

// Start recurring invoice & email billing scheduler
startBillingScheduler();

// Start payment reminder & stop-service flagging scheduler
startPaymentReminderScheduler();

// Start service plan job-generation & auto-renewal scheduler
startPlanScheduler();

// Start Smart Follow-Up Queue trigger scheduler
startFollowupScheduler();

// Start hard clock-out enforcement scheduler
startClockOutScheduler();

// Start scheduled broadcast dispatcher
startBroadcastScheduler();

export default app;
