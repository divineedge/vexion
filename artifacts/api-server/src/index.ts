import app from "./app";
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

// drizzle push handles tables but not rate-capture/immutability triggers.
// Install the idempotent migration before this build begins serving requests.
const payrollMigration = await readFile(new URL("./payroll-schema.sql", import.meta.url), "utf8");
const migrationClient = await pool.connect();
try {
  await migrationClient.query(payrollMigration);
} finally {
  migrationClient.release();
}

const rawPort = process.env["PORT"];
await installDocumentReminderSchema();
await installKpiSchema();
await installWebsiteIntakeSchema();
await installVendorCategoriesSchema();
await installInventoryCostSchema();
await installCustomerMergeSchema();
await installP4pDamageSchema();
await installJobEconomicsSchema();
startEstimateReminderScheduler();

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
  // The scan must start after payroll trigger installation releases schema locks.
  startCredentialReminderScheduler();
});
