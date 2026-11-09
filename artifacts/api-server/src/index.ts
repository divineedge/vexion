import app, { startBackgroundSchedulers } from "./app";
import { startDueInvoicePayments } from "./lib/dueInvoicePayments";
import { startPlatformPayouts } from "./lib/platformPayouts";
import { startExperienceMonitoring } from "./lib/experienceCore";
import { logger } from "./lib/logger";
import { pool } from "@workspace/db";
import { readFile } from "node:fs/promises";
import { startCredentialReminderScheduler } from "./lib/hrCredentials";
import {installDocumentReminderSchema} from "./lib/documentReminderActions";
import {startEstimateReminderScheduler} from "./lib/estimateReminderScheduler";
import { installKpiSchema } from "./lib/kpiSettings";
import { installWebsiteIntakeSchema } from "./lib/websiteFlow";
import {installVendorCategoriesSchema} from './lib/vendorCategories';
import {installCustomerMergeSchema} from './lib/customerMerge';
import {installInventoryCostSchema} from './lib/inventoryCosting';
import { installP4pDamageSchema } from "./lib/p4pDamage";
import { installJobEconomicsSchema } from "./lib/jobEconomicsSchema";
import { installAdditiveSettingsSchema, runStartupSchemaStep } from "./lib/schemaSafety";

// drizzle push handles tables but not rate-capture/immutability triggers.
// Install the idempotent migration before this build begins serving requests.
const payrollMigration = await readFile(new URL("./payroll-schema.sql", import.meta.url), "utf8");
const migrationClient = await pool.connect();
try {
  await migrationClient.query(payrollMigration);
} catch (error) {
  logger.error({ err: error }, "Payroll schema step failed. Existing tenant rows were not rewritten by a later step in this startup.");
} finally {
  migrationClient.release();
}

const PORT = process.env.PORT || 4000;
await installAdditiveSettingsSchema();
await runStartupSchemaStep("document reminders", installDocumentReminderSchema);
await runStartupSchemaStep("kpi", installKpiSchema);
await runStartupSchemaStep("website intake", installWebsiteIntakeSchema);
await runStartupSchemaStep("vendor categories", installVendorCategoriesSchema);
await runStartupSchemaStep("inventory cost", installInventoryCostSchema);
await runStartupSchemaStep("customer merge", installCustomerMergeSchema);
await runStartupSchemaStep("p4p damage", installP4pDamageSchema);
await runStartupSchemaStep("job economics", installJobEconomicsSchema);
startEstimateReminderScheduler();

const port = Number(PORT);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${PORT}"`);
}

async function testDb() {
  try {
    await pool.query("select id from tenants limit 1");
    console.log("Database connected successfully.");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Database connection failed on startup:", message);
  }
}
await testDb();

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  console.log(`Server running on port ${port}`);
  logger.info({ port }, "Server listening");
  startBackgroundSchedulers();
  startDueInvoicePayments();
  startPlatformPayouts();
  startExperienceMonitoring();
  // The scan must start after payroll trigger installation releases schema locks.
  startCredentialReminderScheduler();
});
