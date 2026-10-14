import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { z } from "zod";

export const kpiIds = ['revenue_hour','efficiency','margin','underpriced','unbilled','overdue','cash','acceptance','callbacks','retention','schedule','productive','customer_spend'] as const;
export const defaultKpiSettings = {
  mainKpis: ['revenue_hour','efficiency','margin','unbilled','overdue','acceptance','customer_spend'],
  detailKpis: [...kpiIds],
  defaultDateRange: 'year_to_date',
};
const validDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().slice(0,10)===s;
export const kpiSettingsInput = z.object({
  mainKpis: z.array(z.enum(kpiIds)).max(kpiIds.length),
  detailKpis: z.array(z.enum(kpiIds)).max(kpiIds.length),
  defaultDateRange: z.enum(['today','week_to_date','month_to_date','year_to_date','last_30_days','previous_year','custom']).default('year_to_date'),
  customFrom: z.string().refine(validDate,'Choose a valid start date').nullable().optional(),
  customTo: z.string().refine(validDate,'Choose a valid end date').nullable().optional(),
}).strict().superRefine((value, context) => {
  if (new Set(value.mainKpis).size !== value.mainKpis.length || new Set(value.detailKpis).size !== value.detailKpis.length)
    context.addIssue({code:'custom',message:'Each KPI may be selected only once'});
  if (value.mainKpis.some(id => !value.detailKpis.includes(id)))
    context.addIssue({code:'custom',message:'KPI dashboard selections must also be enabled for details'});
  if(value.defaultDateRange==='custom' && (!value.customFrom || !value.customTo || value.customFrom>value.customTo || Date.parse(value.customTo)-Date.parse(value.customFrom)>3660*86400000))
    context.addIssue({code:'custom',message:'Choose a custom start and end date, in order and at most ten years apart'});
});
export async function installKpiSchema() {
  await db.execute(sql`CREATE TABLE IF NOT EXISTS tenant_kpi_settings (
    tenant_id integer PRIMARY KEY REFERENCES tenants(id),
    settings jsonb NOT NULL DEFAULT '{}'::jsonb,
    updated_at timestamptz NOT NULL DEFAULT now()
  )`);
}
