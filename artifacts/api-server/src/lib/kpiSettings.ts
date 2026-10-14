import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { z } from "zod";

export const kpiIds = ['revenue_hour','efficiency','margin','underpriced','unbilled','overdue','cash','acceptance','callbacks','retention','schedule','productive','customer_spend'] as const;
export const defaultKpiSettings = {
  mainKpis: ['revenue_hour','efficiency','margin','unbilled','overdue','acceptance','customer_spend'],
  detailKpis: [...kpiIds],
};
export const kpiSettingsInput = z.object({
  mainKpis: z.array(z.enum(kpiIds)).max(kpiIds.length),
  detailKpis: z.array(z.enum(kpiIds)).max(kpiIds.length),
}).strict().superRefine((value, context) => {
  if (new Set(value.mainKpis).size !== value.mainKpis.length || new Set(value.detailKpis).size !== value.detailKpis.length)
    context.addIssue({code:'custom',message:'Each KPI may be selected only once'});
  if (value.mainKpis.some(id => !value.detailKpis.includes(id)))
    context.addIssue({code:'custom',message:'Main dashboard KPIs must also be enabled for details'});
});
export async function installKpiSchema() {
  await db.execute(sql`CREATE TABLE IF NOT EXISTS tenant_kpi_settings (
    tenant_id integer PRIMARY KEY REFERENCES tenants(id),
    settings jsonb NOT NULL DEFAULT '{}'::jsonb,
    updated_at timestamptz NOT NULL DEFAULT now()
  )`);
}
