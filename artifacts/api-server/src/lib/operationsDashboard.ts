import { randomBytes } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import {
  billingEmailQueueTable,
  customersTable,
  db,
  equipmentTable,
  estimatesTable,
  followupQueueItemsTable,
  invoicesTable,
  jobsTable,
  portalMessageReadsTable,
  portalMessagesTable,
  tenantsTable,
  userDashboardLayoutsTable,
} from "@workspace/db";
import { customLineSum } from "./customLineItems";
import { invoiceBalance } from "./customerCredit";
import { ackCovers, joinSignature, maintenanceDue, scheduleDueParts, thresholdFor, type CategoryThreshold } from "./equipmentMaintenance";
import { logger } from "./logger";
import { stockNeedsReorder } from "./reorderPoint";
import { buildEffectivePermissions, type PermissionKey } from "./rolePermissions";
import { getCallerRole, isAdminRole } from "./roles";
import { checkRainBeforeWindow } from "./weatherCheck";

export const WIDGET_KEYS = [
  "jobs_completed",
  "invoices_revenue",
  "invoice_attention",
  "profit_and_loss",
  "payroll_summary",
  "schedule",
  "job_waitlist",
  "inventory_reorder",
  "report_snapshots",
  "alerts",
  "needs_action",
] as const;
export const TIMEFRAMES = ["today", "week", "month", "quarter", "year"] as const;
export const TASK_SOURCES = [
  "portal_message",
  "estimate_response",
  "equipment_maintenance",
  "rain_warning",
  "followup",
  "invoice_to_send",
  "invoice_due",
] as const;
/** Invoices due inside this window count as close to overdue. It matches the default reminder of 3 days before the due date. */
export const DUE_SOON_DAYS = 3;

export type WidgetKey = (typeof WIDGET_KEYS)[number];
export type Timeframe = (typeof TIMEFRAMES)[number];
export type TaskSource = (typeof TASK_SOURCES)[number];
export type WidgetConfig = { key: WidgetKey; visible: boolean; timeframe: Timeframe; filter: string | null; minimized?: boolean };
export type DashboardLayout = { widgets: WidgetConfig[]; taskSources: TaskSource[] };

const FILTERS: Record<WidgetKey, string[]> = {
  needs_action: ["all"],
  jobs_completed: ["all", "mine"],
  invoices_revenue: ["outstanding", "activity"],
  invoice_attention: ["all", "to_send", "due"],
  profit_and_loss: ["all"],
  payroll_summary: ["all", "mine"],
  schedule: ["all", "mine"],
  job_waitlist: ["all", "mine"],
  inventory_reorder: ["all"],
  report_snapshots: ["all"],
  alerts: ["all", "system", "weather", "equipment"],
};

const DEFAULT_TIMEFRAME: Record<WidgetKey, Timeframe> = {
  needs_action: "today",
  jobs_completed: "month",
  invoices_revenue: "month",
  invoice_attention: "month",
  profit_and_loss: "month",
  payroll_summary: "week",
  schedule: "week",
  job_waitlist: "year",
  inventory_reorder: "today",
  report_snapshots: "month",
  alerts: "today",
};

const DEFAULT_FILTER: Record<WidgetKey, string> = {
  needs_action: "all",
  jobs_completed: "all",
  invoices_revenue: "outstanding",
  invoice_attention: "all",
  profit_and_loss: "all",
  payroll_summary: "all",
  schedule: "all",
  job_waitlist: "all",
  inventory_reorder: "all",
  report_snapshots: "all",
  alerts: "all",
};

export function classifyInvoiceAttention(
  invoice: { status: string; createdAt: Date; dueAt: Date | null; handled: boolean; balance: number },
  range: { start: Date; end: Date },
  now = new Date(),
): "send" | "due" | null {
  if (invoice.status === "draft" && invoice.createdAt >= range.start && invoice.createdAt < range.end) return "send";
  if (invoice.handled || invoice.balance <= 0) return null;
  if ((invoice.status === "sent" || invoice.status === "overdue") && invoice.dueAt && invoice.dueAt.getTime() < now.getTime() + DUE_SOON_DAYS * 86400000) {
    return "due";
  }
  return null;
}

function widgetConfig(key: WidgetKey, visible: boolean, timeframe: Timeframe, filter: string, minimized?: boolean): WidgetConfig {
  const config: WidgetConfig = { key, visible, timeframe, filter };
  if (key === "needs_action") config.minimized = minimized === true;
  return config;
}

export function defaultLayout(): DashboardLayout {
  return {
    widgets: WIDGET_KEYS.map(key => widgetConfig(key, true, DEFAULT_TIMEFRAME[key], DEFAULT_FILTER[key], false)),
    taskSources: [...TASK_SOURCES],
  };
}

export function normalizeLayout(input: unknown): DashboardLayout | null {
  if (!input || typeof input !== "object") return null;
  const body = input as { widgets?: unknown; taskSources?: unknown };
  if (!Array.isArray(body.widgets) || !Array.isArray(body.taskSources)) return null;
  const seen = new Set<WidgetKey>();
  const widgets: WidgetConfig[] = [];
  for (const raw of body.widgets) {
    if (!raw || typeof raw !== "object") return null;
    const item = raw as { key?: unknown; visible?: unknown; timeframe?: unknown; filter?: unknown; minimized?: unknown };
    if (typeof item.key !== "string" || !WIDGET_KEYS.includes(item.key as WidgetKey)) return null;
    const key = item.key as WidgetKey;
    if (seen.has(key)) continue;
    if (typeof item.visible !== "boolean") return null;
    if (typeof item.timeframe !== "string" || !TIMEFRAMES.includes(item.timeframe as Timeframe)) return null;
    const filter = item.filter == null ? FILTERS[key][0] : String(item.filter);
    if (!FILTERS[key].includes(filter)) return null;
    seen.add(key);
    widgets.push(widgetConfig(key, item.visible, item.timeframe as Timeframe, filter, item.minimized === true));
  }
  for (const key of WIDGET_KEYS) {
    if (!seen.has(key)) widgets.push(widgetConfig(key, true, DEFAULT_TIMEFRAME[key], DEFAULT_FILTER[key], false));
  }
  const taskSources: TaskSource[] = [];
  for (const source of body.taskSources) {
    if (typeof source !== "string" || !TASK_SOURCES.includes(source as TaskSource)) return null;
    if (!taskSources.includes(source as TaskSource)) taskSources.push(source as TaskSource);
  }
  const needsAction = widgets.findIndex(widget => widget.key === "needs_action");
  if (needsAction >= 0 && needsAction < widgets.length - 1) {
    const [pinned] = widgets.splice(needsAction, 1);
    widgets.push(pinned);
  }
  return { widgets, taskSources };
}

function zonedParts(now: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, hour12: false, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(now);
  const read = (type: string) => Number(parts.find(part => part.type === type)?.value ?? "0");
  return { year: read("year"), month: read("month"), day: read("day"), hour: read("hour") % 24, minute: read("minute"), second: read("second") };
}

function zonedStart(year: number, month: number, day: number, timeZone: string): Date {
  const guess = new Date(Date.UTC(year, month - 1, day));
  const offsetAt = (date: Date) => {
    const parts = zonedParts(date, timeZone);
    return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second) - date.getTime();
  };
  return new Date(guess.getTime() - offsetAt(new Date(guess.getTime() - offsetAt(guess))));
}

export function timeframeRange(timeframe: Timeframe, timeZone: string, now = new Date()): { start: Date; end: Date } {
  const today = zonedParts(now, timeZone);
  const end = zonedStart(today.year, today.month, today.day + 1, timeZone);
  if (timeframe === "today") return { start: zonedStart(today.year, today.month, today.day, timeZone), end };
  if (timeframe === "week") return { start: new Date(zonedStart(today.year, today.month, today.day, timeZone).getTime() - 6 * 86400000), end };
  if (timeframe === "month") return { start: zonedStart(today.year, today.month, 1, timeZone), end };
  if (timeframe === "quarter") return { start: zonedStart(today.year, Math.floor((today.month - 1) / 3) * 3 + 1, 1, timeZone), end };
  return { start: zonedStart(today.year, 1, 1, timeZone), end };
}

function calendarDay(now: Date, timeZone: string): string {
  const parts = zonedParts(now, timeZone);
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function money(value: number): number {
  return Math.round(value * 100) / 100;
}

function num(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function tenantContext(tenantId: number) {
  const [tenant] = await db.select({
    timezone: tenantsTable.timezone,
    thresholds: tenantsTable.equipmentCategoryThresholds,
    rainThreshold: tenantsTable.rainfastRainThresholdPct,
    rolePermissions: tenantsTable.rolePermissions,
    p4p: tenantsTable.p4pMasterPercentage,
  }).from(tenantsTable).where(eq(tenantsTable.id, tenantId));
  return {
    timeZone: tenant?.timezone || "America/Denver",
    thresholds: (Array.isArray(tenant?.thresholds) ? tenant.thresholds : []) as CategoryThreshold[],
    rainThreshold: tenant?.rainThreshold ?? 50,
    rolePermissions: (tenant?.rolePermissions ?? null) as Record<string, Record<string, boolean>> | null,
    p4p: tenant?.p4p ?? 0,
  };
}

function storedWidgetKeys(widgets: unknown): string[] {
  if (!Array.isArray(widgets)) return [];
  return widgets.flatMap(item => (
    item && typeof item === "object" && typeof (item as { key?: unknown }).key === "string" ? [(item as { key: string }).key] : []
  ));
}

export async function readLayout(tenantId: number, userId: number): Promise<DashboardLayout> {
  const [row] = await db.select({ widgets: userDashboardLayoutsTable.widgets, taskSources: userDashboardLayoutsTable.taskSources })
    .from(userDashboardLayoutsTable)
    .where(and(eq(userDashboardLayoutsTable.userId, userId), eq(userDashboardLayoutsTable.tenantId, tenantId)));
  if (!row) return defaultLayout();
  const layout = normalizeLayout({ widgets: row.widgets, taskSources: row.taskSources }) ?? defaultLayout();
  const stored = storedWidgetKeys(row.widgets);
  if (!stored.includes("invoice_attention")) {
    for (const source of ["invoice_to_send", "invoice_due"] as const) {
      if (!layout.taskSources.includes(source)) layout.taskSources.push(source);
    }
  }
  return layout;
}

export async function writeLayout(tenantId: number, userId: number, layout: DashboardLayout): Promise<DashboardLayout> {
  await db.insert(userDashboardLayoutsTable).values({
    userId, tenantId, widgets: layout.widgets, taskSources: layout.taskSources, updatedAt: new Date(),
  }).onConflictDoUpdate({
    target: userDashboardLayoutsTable.userId,
    set: { tenantId, widgets: layout.widgets, taskSources: layout.taskSources, updatedAt: new Date() },
  });
  return layout;
}

export async function resetLayout(tenantId: number, userId: number): Promise<DashboardLayout> {
  await db.delete(userDashboardLayoutsTable).where(and(
    eq(userDashboardLayoutsTable.userId, userId),
    eq(userDashboardLayoutsTable.tenantId, tenantId),
  ));
  return defaultLayout();
}

type TaskItem = {
  source: TaskSource;
  sourceId: number;
  title: string;
  detail: string;
  href: string;
  createdAt: string;
  date?: string;
};

type EquipmentDue = {
  id: number;
  name: string;
  parts: string[];
  labels: string[];
};

async function equipmentDue(tenantId: number, thresholds: CategoryThreshold[]): Promise<EquipmentDue[]> {
  const assets = await db.select({
    id: equipmentTable.id,
    name: equipmentTable.name,
    type: equipmentTable.type,
    currentHours: equipmentTable.currentHours,
    currentMiles: equipmentTable.currentMiles,
    ack: equipmentTable.maintenanceAlertAck,
  }).from(equipmentTable).where(and(eq(equipmentTable.tenantId, tenantId), sql`${equipmentTable.archivedAt} IS NULL`, eq(equipmentTable.isActive, true)));
  const schedules = await db.execute(sql`
    SELECT DISTINCT ON (equipment_id) equipment_id, next_service_due_date, next_service_due_hours, next_service_due_miles
    FROM equipment_maintenance WHERE tenant_id = ${tenantId}
    ORDER BY equipment_id, date DESC, id DESC
  `);
  const byEquipment = new Map<number, { date: string | null; hours: number | null; miles: number | null }>();
  for (const row of schedules.rows) {
    byEquipment.set(Number(row.equipment_id), {
      date: row.next_service_due_date == null ? null : String(row.next_service_due_date),
      hours: row.next_service_due_hours == null ? null : num(row.next_service_due_hours),
      miles: row.next_service_due_miles == null ? null : num(row.next_service_due_miles),
    });
  }
  const due: EquipmentDue[] = [];
  for (const asset of assets) {
    const schedule = byEquipment.get(asset.id);
    const scheduleParts = scheduleDueParts({
      currentHours: asset.currentHours,
      currentMiles: asset.currentMiles,
      nextServiceDueDate: schedule?.date ?? null,
      nextServiceDueHours: schedule?.hours ?? null,
      nextServiceDueMiles: schedule?.miles ?? null,
    });
    const category = maintenanceDue(asset.currentHours, thresholdFor(asset.type, thresholds))
      .filter(item => !ackCovers(asset.ack, [`cat:${item.bucket}`]));
    const openSchedule = scheduleParts.filter(part => !ackCovers(asset.ack, [part]));
    const parts = [...openSchedule, ...category.map(item => `cat:${item.bucket}`)];
    if (parts.length === 0) continue;
    const labels = [
      ...openSchedule.map(part => part.startsWith("date:") ? `Service date ${part.slice(5)}` : part.startsWith("hours:") ? `Service due at ${part.slice(6)} hours` : `Service due at ${part.slice(6)} miles`),
      ...category.map(item => item.label),
    ];
    due.push({ id: asset.id, name: asset.name, parts, labels });
  }
  return due;
}

const rainCache = new Map<string, { at: number; value: { probability: number; forecastTime: string } | null }>();

export async function rainWarnings(tenantId: number, timeZone: string, threshold: number, now: Date): Promise<TaskItem[]> {
  const day = calendarDay(now, timeZone);
  const start = zonedStart(...day.split("-").map(Number) as [number, number, number], timeZone);
  const end = new Date(start.getTime() + 86400000);
  if (end <= now) return [];
  const jobs = await db.execute(sql`
    SELECT j.id, j.title, j.scheduled_at, p.lat, p.lng
    FROM jobs j
    LEFT JOIN properties p ON p.id = j.property_id
    LEFT JOIN services s ON s.id = j.service_id
    WHERE j.tenant_id = ${tenantId}
      AND j.archived_at IS NULL
      AND j.status IN ('scheduled', 'in_progress')
      AND j.scheduled_at >= ${start.toISOString()}::timestamptz
      AND j.scheduled_at < ${end.toISOString()}::timestamptz
      AND (j.rain_warning_cleared_on IS NULL OR j.rain_warning_cleared_on <> ${day})
      AND p.lat IS NOT NULL AND p.lng IS NOT NULL
      AND (
        coalesce(s.field_requirements->>'requiresChemicalApplication', '') = 'true'
        OR EXISTS (SELECT 1 FROM chemical_applications ca WHERE ca.job_id = j.id AND ca.tenant_id = ${tenantId})
      )
    ORDER BY j.scheduled_at
    LIMIT 6
  `);
  const tasks: TaskItem[] = [];
  for (const job of jobs.rows) {
    const key = `${tenantId}:${day}:${job.id}:${job.lat}:${job.lng}:${threshold}`;
    const cached = rainCache.get(key);
    let forecast = cached && Date.now() - cached.at < 5 * 60 * 1000 ? cached.value : undefined;
    if (forecast === undefined) {
      try {
        forecast = await Promise.race([
          checkRainBeforeWindow(num(job.lat), num(job.lng), end, threshold),
          new Promise<null>(resolve => setTimeout(() => resolve(null), 1500)),
        ]);
      } catch (error) {
        logger.warn({ err: error, jobId: job.id }, "Rain warning lookup failed");
        forecast = null;
      }
      rainCache.set(key, { at: Date.now(), value: forecast });
    }
    if (!forecast) continue;
    tasks.push({
      source: "rain_warning",
      sourceId: Number(job.id),
      title: String(job.title),
      detail: `${forecast.probability}% chance of rain`,
      href: `/schedule?jobId=${job.id}`,
      createdAt: job.scheduled_at ? new Date(String(job.scheduled_at)).toISOString() : now.toISOString(),
      date: day,
    });
  }
  return tasks;
}

async function actionTasks(tenantId: number, sources: TaskSource[], context: Awaited<ReturnType<typeof tenantContext>>, now: Date): Promise<{ tasks: TaskItem[]; equipment: EquipmentDue[] }> {
  const tasks: TaskItem[] = [];
  let equipment: EquipmentDue[] = [];
  if (sources.includes("portal_message")) {
    const rows = await db.execute(sql`
      SELECT m.id, m.body, m.created_at, m.customer_id, c.name AS customer_name
      FROM portal_messages m
      JOIN customers c ON c.id = m.customer_id AND c.tenant_id = m.tenant_id
      WHERE m.tenant_id = ${tenantId} AND m.direction = 'inbound' AND m.handled_at IS NULL AND c.archived_at IS NULL
      ORDER BY m.created_at DESC LIMIT 25
    `);
    for (const row of rows.rows) {
      tasks.push({
        source: "portal_message",
        sourceId: Number(row.id),
        title: `${row.customer_name ?? "Customer"} sent a portal message`,
        detail: String(row.body ?? "").slice(0, 180),
        href: `/portal-inbox/${row.customer_id}`,
        createdAt: new Date(String(row.created_at)).toISOString(),
      });
    }
  }
  if (sources.includes("estimate_response")) {
    const rows = await db.execute(sql`
      SELECT e.id, e.status, e.total, e.approved_at, e.declined_at, e.updated_at, c.name AS customer_name
      FROM estimates e
      LEFT JOIN customers c ON c.id = e.customer_id AND c.tenant_id = e.tenant_id
      WHERE e.tenant_id = ${tenantId} AND e.is_archived = false AND e.response_handled_at IS NULL
        AND e.status IN ('approved', 'declined')
      ORDER BY COALESCE(e.approved_at, e.declined_at, e.updated_at) DESC LIMIT 25
    `);
    for (const row of rows.rows) {
      const when = row.approved_at ?? row.declined_at ?? row.updated_at;
      tasks.push({
        source: "estimate_response",
        sourceId: Number(row.id),
        title: `${row.customer_name ?? "Customer"} ${row.status} an estimate`,
        detail: `Estimate #${row.id} · $${money(num(row.total)).toFixed(2)}`,
        href: `/estimates?estimateId=${row.id}`,
        createdAt: when ? new Date(String(when)).toISOString() : now.toISOString(),
      });
    }
  }
  equipment = await equipmentDue(tenantId, context.thresholds);
  if (sources.includes("equipment_maintenance")) {
    for (const asset of equipment) {
      tasks.push({
        source: "equipment_maintenance",
        sourceId: asset.id,
        title: `${asset.name} reached a maintenance threshold`,
        detail: asset.labels.join(" · "),
        href: `/equipment?equipmentId=${asset.id}`,
        createdAt: now.toISOString(),
      });
    }
  }
  if (sources.includes("rain_warning")) {
    tasks.push(...await rainWarnings(tenantId, context.timeZone, context.rainThreshold, now));
  }
  if (sources.includes("followup")) {
    const rows = await db.execute(sql`
      SELECT f.id, f.reason, f.trigger_type, f.created_at, c.name AS customer_name
      FROM followup_queue_items f
      JOIN customers c ON c.id = f.customer_id AND c.tenant_id = f.tenant_id
      WHERE f.tenant_id = ${tenantId} AND f.status = 'open' AND c.archived_at IS NULL
      ORDER BY f.created_at ASC LIMIT 25
    `);
    for (const row of rows.rows) {
      tasks.push({
        source: "followup",
        sourceId: Number(row.id),
        title: `Follow up with ${row.customer_name ?? "a customer"}`,
        detail: String(row.reason ?? row.trigger_type ?? ""),
        href: "/followup-queue",
        createdAt: new Date(String(row.created_at)).toISOString(),
      });
    }
  }
  return { tasks, equipment };
}

function widget(layout: DashboardLayout, key: WidgetKey): WidgetConfig {
  return layout.widgets.find(item => item.key === key) ?? defaultLayout().widgets.find(item => item.key === key)!;
}

async function jobsCompleted(tenantId: number, userId: number, config: WidgetConfig, timeZone: string, canSeeValue: boolean) {
  const range = timeframeRange(config.timeframe, timeZone);
  const mine = config.filter === "mine" ? sql`AND j.assignee_id = ${userId}` : sql``;
  const [row] = (await db.execute(sql`
    SELECT count(*)::int AS count, COALESCE(sum(j.total_amount), 0)::float AS value
    FROM jobs j
    LEFT JOIN customers c ON c.id = j.customer_id AND c.tenant_id = j.tenant_id
    WHERE j.tenant_id = ${tenantId} AND j.archived_at IS NULL AND j.status = 'completed'
      AND j.completed_at >= ${range.start.toISOString()}::timestamptz
      AND j.completed_at < ${range.end.toISOString()}::timestamptz
      AND (j.customer_id IS NULL OR (c.id IS NOT NULL AND c.archived_at IS NULL))
      ${mine}
  `)).rows;
  const count = num(row?.count);
  return { count, value: canSeeValue ? money(num(row?.value)) : null, restricted: !canSeeValue, empty: count === 0, timeframe: config.timeframe, filter: config.filter };
}

async function invoicesRevenue(tenantId: number, config: WidgetConfig, timeZone: string, canSeeMoney: boolean) {
  const range = timeframeRange(config.timeframe, timeZone);
  const activity = config.filter === "activity";
  const [row] = (await db.execute(sql`
    SELECT
      count(*) FILTER (WHERE i.status IN ('draft', 'sent') AND (i.due_date IS NULL OR i.due_date >= now()) AND (${activity} = false OR i.created_at >= ${range.start.toISOString()}::timestamptz))::int AS open_count,
      COALESCE(sum(i.total) FILTER (WHERE i.status IN ('draft', 'sent') AND (i.due_date IS NULL OR i.due_date >= now()) AND (${activity} = false OR i.created_at >= ${range.start.toISOString()}::timestamptz)), 0)::float AS open_total,
      count(*) FILTER (WHERE i.status IN ('draft', 'sent') AND i.due_date < now() AND (${activity} = false OR i.due_date >= ${range.start.toISOString()}::timestamptz))::int AS overdue_count,
      COALESCE(sum(i.total) FILTER (WHERE i.status IN ('draft', 'sent') AND i.due_date < now() AND (${activity} = false OR i.due_date >= ${range.start.toISOString()}::timestamptz)), 0)::float AS overdue_total,
      count(*) FILTER (WHERE i.status = 'paid' AND i.paid_at >= ${range.start.toISOString()}::timestamptz AND i.paid_at < ${range.end.toISOString()}::timestamptz)::int AS collected_count,
      COALESCE(sum(i.total) FILTER (WHERE i.status = 'paid' AND i.paid_at >= ${range.start.toISOString()}::timestamptz AND i.paid_at < ${range.end.toISOString()}::timestamptz), 0)::float AS collected_total
    FROM invoices i
    JOIN customers c ON c.id = i.customer_id AND c.tenant_id = i.tenant_id
    WHERE i.tenant_id = ${tenantId} AND i.archived_at IS NULL AND c.archived_at IS NULL
  `)).rows;
  const openCount = num(row?.open_count);
  const overdueCount = num(row?.overdue_count);
  const collectedCount = num(row?.collected_count);
  return {
    openCount, overdueCount, collectedCount,
    openTotal: canSeeMoney ? money(num(row?.open_total)) : null,
    overdueTotal: canSeeMoney ? money(num(row?.overdue_total)) : null,
    collectedTotal: canSeeMoney ? money(num(row?.collected_total)) : null,
    restricted: !canSeeMoney,
    empty: openCount + overdueCount + collectedCount === 0,
    timeframe: config.timeframe,
    filter: config.filter,
  };
}

async function payrollSummary(tenantId: number, userId: number, config: WidgetConfig, timeZone: string, canSeePay: boolean) {
  const range = timeframeRange(config.timeframe, timeZone);
  const mine = config.filter === "mine" ? sql`AND te.user_id = ${userId}` : sql``;
  const [row] = (await db.execute(sql`
    SELECT
      count(*)::int AS entries,
      count(DISTINCT te.user_id)::int AS people,
      count(*) FILTER (WHERE COALESCE(te.adjusted_clocked_out_at, te.clocked_out_at) IS NULL)::int AS open_clocks,
      COALESCE(sum(EXTRACT(EPOCH FROM (COALESCE(te.adjusted_clocked_out_at, te.clocked_out_at) - COALESCE(te.adjusted_clocked_in_at, te.clocked_in_at))) / 60)
        FILTER (WHERE COALESCE(te.adjusted_clocked_out_at, te.clocked_out_at) IS NOT NULL), 0)::float AS minutes,
      COALESCE(sum((EXTRACT(EPOCH FROM (COALESCE(te.adjusted_clocked_out_at, te.clocked_out_at) - COALESCE(te.adjusted_clocked_in_at, te.clocked_in_at))) / 3600) * u.hourly_rate)
        FILTER (WHERE u.hourly_rate IS NOT NULL AND COALESCE(te.adjusted_clocked_out_at, te.clocked_out_at) IS NOT NULL), 0)::float AS pay
    FROM time_entries te
    JOIN users u ON u.id = te.user_id
    WHERE te.tenant_id = ${tenantId}
      AND COALESCE(te.adjusted_clocked_in_at, te.clocked_in_at) >= ${range.start.toISOString()}::timestamptz
      AND COALESCE(te.adjusted_clocked_in_at, te.clocked_in_at) < ${range.end.toISOString()}::timestamptz
      ${mine}
  `)).rows;
  const [periods] = (await db.execute(sql`
    SELECT count(*)::int AS count FROM payroll_periods
    WHERE tenant_id = ${tenantId} AND range_start < ${range.end.toISOString()}::timestamptz AND range_end >= ${range.start.toISOString()}::timestamptz
  `)).rows;
  const entries = num(row?.entries);
  const periodCount = num(periods?.count);
  const minutes = Math.round(num(row?.minutes));
  return {
    entries,
    people: num(row?.people),
    openClocks: num(row?.open_clocks),
    minutes,
    estimatedPay: canSeePay && num(row?.pay) > 0 ? money(num(row?.pay)) : null,
    periodCount,
    restricted: !canSeePay,
    empty: entries === 0 && periodCount === 0,
    timeframe: config.timeframe,
    filter: config.filter,
  };
}

async function scheduleWidget(tenantId: number, userId: number, config: WidgetConfig, timeZone: string, now: Date) {
  const today = timeframeRange("today", timeZone, now);
  const days = config.timeframe === "today" ? 1 : config.timeframe === "week" ? 7 : config.timeframe === "month" ? 31 : config.timeframe === "quarter" ? 92 : 366;
  const windowEnd = new Date(today.start.getTime() + days * 86400000);
  const mine = config.filter === "mine" ? sql`AND j.assignee_id = ${userId}` : sql``;
  const rows = (await db.execute(sql`
    SELECT j.id, j.title, j.status, j.scheduled_at, c.name AS customer_name
    FROM jobs j
    LEFT JOIN customers c ON c.id = j.customer_id AND c.tenant_id = j.tenant_id
    WHERE j.tenant_id = ${tenantId} AND j.archived_at IS NULL AND j.status NOT IN ('cancelled', 'waitlist')
      AND j.scheduled_at >= ${today.start.toISOString()}::timestamptz
      AND j.scheduled_at < ${windowEnd.toISOString()}::timestamptz
      AND (j.customer_id IS NULL OR c.archived_at IS NULL)
      ${mine}
    ORDER BY j.scheduled_at
    LIMIT 12
  `)).rows;
  const items = rows.map(row => ({
    id: Number(row.id),
    title: String(row.title),
    status: String(row.status),
    customerName: row.customer_name == null ? null : String(row.customer_name),
    scheduledAt: new Date(String(row.scheduled_at)).toISOString(),
    href: `/schedule?jobId=${row.id}`,
  }));
  const todayJobs = items.filter(item => item.scheduledAt < today.end.toISOString());
  const upcoming = items.filter(item => item.scheduledAt >= today.end.toISOString());
  return { today: todayJobs, upcoming, empty: items.length === 0, timeframe: config.timeframe, filter: config.filter };
}

async function reportSnapshots(tenantId: number, config: WidgetConfig, timeZone: string, canSeeJobValue: boolean, canSeeInvoiceValue: boolean) {
  const range = timeframeRange(config.timeframe, timeZone);
  const [row] = (await db.execute(sql`
    SELECT
      (SELECT count(*)::int FROM jobs j WHERE j.tenant_id = ${tenantId} AND j.archived_at IS NULL AND j.status = 'completed' AND j.invoice_id IS NULL
        AND j.completed_at >= ${range.start.toISOString()}::timestamptz AND j.completed_at < ${range.end.toISOString()}::timestamptz) AS unbilled_count,
      (SELECT COALESCE(sum(j.total_amount), 0)::float FROM jobs j WHERE j.tenant_id = ${tenantId} AND j.archived_at IS NULL AND j.status = 'completed' AND j.invoice_id IS NULL
        AND j.completed_at >= ${range.start.toISOString()}::timestamptz AND j.completed_at < ${range.end.toISOString()}::timestamptz) AS unbilled_value,
      (SELECT count(*)::int FROM invoices i JOIN customers c ON c.id = i.customer_id AND c.tenant_id = i.tenant_id
        WHERE i.tenant_id = ${tenantId} AND i.archived_at IS NULL AND c.archived_at IS NULL AND i.status IN ('draft', 'sent') AND i.due_date < now()) AS overdue_count,
      (SELECT COALESCE(sum(i.total), 0)::float FROM invoices i JOIN customers c ON c.id = i.customer_id AND c.tenant_id = i.tenant_id
        WHERE i.tenant_id = ${tenantId} AND i.archived_at IS NULL AND c.archived_at IS NULL AND i.status IN ('draft', 'sent') AND i.due_date < now()) AS overdue_value,
      (SELECT count(*)::int FROM estimates e WHERE e.tenant_id = ${tenantId} AND e.is_archived = false AND e.status = 'sent'
        AND e.sent_at >= ${range.start.toISOString()}::timestamptz AND e.sent_at < ${range.end.toISOString()}::timestamptz) AS sent_estimates,
      (SELECT count(*)::int FROM followup_queue_items f WHERE f.tenant_id = ${tenantId} AND f.status = 'open') AS open_followups
  `)).rows;
  const snapshots = [
    { key: "unbilled", label: "Unbilled completed jobs", count: num(row?.unbilled_count), value: canSeeJobValue ? money(num(row?.unbilled_value)) : null, href: "/reports" },
    { key: "overdue", label: "Overdue invoices", count: num(row?.overdue_count), value: canSeeInvoiceValue ? money(num(row?.overdue_value)) : null, href: "/financials" },
    { key: "estimates", label: "Estimates sent", count: num(row?.sent_estimates), value: null, href: "/estimates" },
    { key: "followups", label: "Open follow-ups", count: num(row?.open_followups), value: null, href: "/followup-queue" },
  ];
  return {
    snapshots,
    empty: snapshots.every(item => item.count === 0),
    timeframe: config.timeframe,
    filter: config.filter,
  };
}

async function alertsWidget(tenantId: number, config: WidgetConfig, timeZone: string, equipment: EquipmentDue[], rain: TaskItem[]) {
  const range = timeframeRange(config.timeframe, timeZone);
  const show = (kind: "system" | "weather" | "equipment") => config.filter === "all" || config.filter === kind;
  const system = show("system") ? (await db.execute(sql`
    SELECT id, source, severity, message, created_at FROM operations_alerts
    WHERE tenant_id = ${tenantId} AND resolved = false AND created_at >= ${range.start.toISOString()}::timestamptz
    ORDER BY created_at DESC LIMIT 8
  `)).rows.map(row => ({
    id: String(row.id),
    source: String(row.source),
    severity: String(row.severity),
    message: String(row.message),
    createdAt: new Date(String(row.created_at)).toISOString(),
  })) : [];
  const weather = show("weather") ? rain.map(item => ({ id: item.sourceId, title: item.title, detail: item.detail, href: item.href })) : [];
  const equipmentAlerts = show("equipment") ? equipment.map(item => ({ id: item.id, name: item.name, detail: item.labels.join(" · "), href: `/equipment?equipmentId=${item.id}` })) : [];
  return {
    system, weather, equipment: equipmentAlerts,
    empty: system.length + weather.length + equipmentAlerts.length === 0,
    timeframe: config.timeframe,
    filter: config.filter,
  };
}

type AttentionInvoice = {
  id: number;
  invoiceNumber: string;
  customerName: string | null;
  total: number | null;
  dueAt: string | null;
  createdAt: string;
  href: string;
  overdue: boolean;
};

async function attentionInvoices(tenantId: number, config: WidgetConfig, timeZone: string, canSeeMoney: boolean, now: Date) {
  const range = timeframeRange(config.timeframe, timeZone, now);
  const soon = new Date(now.getTime() + DUE_SOON_DAYS * 86400000).toISOString();
  const wantSend = config.filter !== "due";
  const wantDue = config.filter !== "to_send";
  const toSendRows = wantSend ? (await db.execute(sql`
    SELECT i.id, i.invoice_number, i.total, i.due_date, i.created_at, c.name AS customer_name
    FROM invoices i
    JOIN customers c ON c.id = i.customer_id AND c.tenant_id = i.tenant_id
    WHERE i.tenant_id = ${tenantId} AND i.archived_at IS NULL AND c.archived_at IS NULL
      AND i.status = 'draft'
      AND i.created_at >= ${range.start.toISOString()}::timestamptz
      AND i.created_at < ${range.end.toISOString()}::timestamptz
    ORDER BY i.created_at DESC
    LIMIT 20
  `)).rows : [];
  const dueRows = wantDue ? (await db.execute(sql`
    SELECT i.id, i.invoice_number, i.total, i.credit_applied, i.deposit_applied, i.due_date, i.created_at, c.name AS customer_name
    FROM invoices i
    JOIN customers c ON c.id = i.customer_id AND c.tenant_id = i.tenant_id
    WHERE i.tenant_id = ${tenantId} AND i.archived_at IS NULL AND c.archived_at IS NULL
      AND i.status IN ('sent', 'overdue')
      AND i.due_attention_handled_at IS NULL
      AND i.due_date IS NOT NULL
      AND i.due_date < ${soon}::timestamptz
      AND (i.total - COALESCE(i.credit_applied, 0) - COALESCE(i.deposit_applied, 0)) > 0
    ORDER BY i.due_date ASC
    LIMIT 20
  `)).rows : [];
  const present = (row: Record<string, unknown>, overdue: boolean): AttentionInvoice => ({
    id: Number(row.id),
    invoiceNumber: String(row.invoice_number),
    customerName: row.customer_name == null ? null : String(row.customer_name),
    total: canSeeMoney ? money(num(row.total)) : null,
    dueAt: row.due_date == null ? null : new Date(String(row.due_date)).toISOString(),
    createdAt: new Date(String(row.created_at)).toISOString(),
    href: `/financials?invoiceId=${row.id}`,
    overdue,
  });
  const toSend = toSendRows.map(row => present(row, false));
  const due = dueRows.map(row => present(row, row.due_date != null && new Date(String(row.due_date)).getTime() < now.getTime()));
  return {
    toSend,
    due,
    restricted: !canSeeMoney,
    empty: toSend.length + due.length === 0,
    timeframe: config.timeframe,
    filter: config.filter,
  };
}

async function invoiceTasks(tenantId: number, sources: TaskSource[], timeZone: string, now: Date, timeframe: Timeframe, canSeeMoney: boolean): Promise<TaskItem[]> {
  const tasks: TaskItem[] = [];
  const range = timeframeRange(timeframe, timeZone, now);
  if (sources.includes("invoice_to_send")) {
    const rows = (await db.execute(sql`
      SELECT i.id, i.invoice_number, i.total, i.created_at, c.name AS customer_name
      FROM invoices i
      JOIN customers c ON c.id = i.customer_id AND c.tenant_id = i.tenant_id
      WHERE i.tenant_id = ${tenantId} AND i.archived_at IS NULL AND c.archived_at IS NULL
        AND i.status = 'draft'
        AND i.created_at >= ${range.start.toISOString()}::timestamptz
        AND i.created_at < ${range.end.toISOString()}::timestamptz
      ORDER BY i.created_at DESC
      LIMIT 25
    `)).rows;
    for (const row of rows) {
      tasks.push({
        source: "invoice_to_send",
        sourceId: Number(row.id),
        title: `Send invoice ${row.invoice_number}`,
        detail: canSeeMoney ? `${row.customer_name ?? "Customer"} · $${money(num(row.total)).toFixed(2)}` : String(row.customer_name ?? "Customer"),
        href: `/financials?invoiceId=${row.id}`,
        createdAt: new Date(String(row.created_at)).toISOString(),
      });
    }
  }
  if (sources.includes("invoice_due")) {
    const soon = new Date(now.getTime() + DUE_SOON_DAYS * 86400000).toISOString();
    const rows = (await db.execute(sql`
      SELECT i.id, i.invoice_number, i.total, i.due_date, i.created_at, c.name AS customer_name
      FROM invoices i
      JOIN customers c ON c.id = i.customer_id AND c.tenant_id = i.tenant_id
      WHERE i.tenant_id = ${tenantId} AND i.archived_at IS NULL AND c.archived_at IS NULL
        AND i.status IN ('sent', 'overdue')
        AND i.due_attention_handled_at IS NULL
        AND i.due_date IS NOT NULL
        AND i.due_date < ${soon}::timestamptz
        AND (i.total - COALESCE(i.credit_applied, 0) - COALESCE(i.deposit_applied, 0)) > 0
      ORDER BY i.due_date ASC
      LIMIT 25
    `)).rows;
    for (const row of rows) {
      const overdue = new Date(String(row.due_date)).getTime() < now.getTime();
      tasks.push({
        source: "invoice_due",
        sourceId: Number(row.id),
        title: overdue ? `Invoice ${row.invoice_number} is overdue` : `Invoice ${row.invoice_number} is close to overdue`,
        detail: canSeeMoney ? `${row.customer_name ?? "Customer"} · $${money(num(row.total)).toFixed(2)}` : String(row.customer_name ?? "Customer"),
        href: `/financials?invoiceId=${row.id}`,
        createdAt: row.due_date ? new Date(String(row.due_date)).toISOString() : now.toISOString(),
      });
    }
  }
  return tasks;
}

async function profitAndLoss(tenantId: number, config: WidgetConfig, timeZone: string, p4pPct: number, canSeeMoney: boolean) {
  const range = timeframeRange(config.timeframe, timeZone);
  const hidden = {
    revenue: null, costOfGoodsSold: null, grossProfit: null, operatingExpenses: null, netIncome: null,
    restricted: true, empty: false, timeframe: config.timeframe, filter: config.filter, href: "/reports",
  };
  if (!canSeeMoney) return hidden;
  const rows = (await db.execute(sql`
    SELECT
      i.total AS invoice_total,
      COALESCE((SELECT SUM((part->>'total')::numeric) FROM jsonb_array_elements(COALESCE(j.job_parts, '[]'::jsonb)) AS part), 0) AS parts_cost,
      ${customLineSum(sql`i.line_items`, "sell")} AS custom_sell,
      ${customLineSum(sql`i.line_items`, "cost")} AS custom_cost,
      b.p4p_percentage AS blueprint_p4p_pct
    FROM invoices i
    LEFT JOIN jobs j ON j.id = i.job_id AND j.tenant_id = i.tenant_id
    LEFT JOIN blueprints b ON b.id = j.blueprint_id AND b.tenant_id = j.tenant_id
    INNER JOIN customers c ON c.id = i.customer_id AND c.tenant_id = i.tenant_id
    WHERE i.tenant_id = ${tenantId}
      AND i.status = 'paid'
      AND i.archived_at IS NULL
      AND c.archived_at IS NULL
      AND (i.job_id IS NULL OR j.archived_at IS NULL)
      AND i.paid_at >= ${range.start.toISOString()}::timestamptz
      AND i.paid_at < ${range.end.toISOString()}::timestamptz
  `)).rows;
  let revenue = 0;
  let partsCost = 0;
  let passThroughCost = 0;
  let laborCost = 0;
  for (const row of rows) {
    const total = num(row.invoice_total);
    revenue += total;
    const parts = num(row.parts_cost);
    const customSell = num(row.custom_sell);
    const customCost = num(row.custom_cost);
    partsCost += parts;
    passThroughCost += customCost;
    const pct = row.blueprint_p4p_pct == null ? p4pPct : num(row.blueprint_p4p_pct);
    laborCost += Math.max(0, total - parts - customSell) * pct / 100;
  }
  const fromDay = calendarDay(range.start, timeZone);
  const toDay = calendarDay(new Date(range.end.getTime() - 1), timeZone);
  const fuelCost = num((await db.execute(sql`
    SELECT COALESCE(SUM(f.cost), 0)::float AS total FROM equipment_fuel_logs f
    LEFT JOIN jobs j ON j.id = f.job_id AND j.tenant_id = f.tenant_id
    LEFT JOIN customers c ON c.id = j.customer_id AND c.tenant_id = j.tenant_id
    WHERE f.tenant_id = ${tenantId}
      AND (f.job_id IS NULL OR (j.archived_at IS NULL AND c.archived_at IS NULL))
      AND f.date >= ${fromDay} AND f.date <= ${toDay}
  `)).rows[0]?.total);
  const operatingExpenses = num((await db.execute(sql`
    SELECT COALESCE(SUM(GREATEST(0, amount - COALESCE((SELECT SUM((r->>'quantity')::numeric * (r->>'costPrice')::numeric)
      FROM jsonb_array_elements(COALESCE(inventory_receipts, '[]'::jsonb)) r), 0))), 0)::float AS total
    FROM expense_entries
    WHERE tenant_id = ${tenantId} AND date >= ${fromDay} AND date <= ${toDay}
  `)).rows[0]?.total);
  const costOfGoodsSold = money(partsCost + passThroughCost + laborCost + fuelCost);
  const grossProfit = money(revenue - costOfGoodsSold);
  const netIncome = money(grossProfit - operatingExpenses);
  return {
    revenue: money(revenue),
    costOfGoodsSold,
    grossProfit,
    operatingExpenses: money(operatingExpenses),
    netIncome,
    restricted: false,
    empty: revenue === 0 && costOfGoodsSold === 0 && operatingExpenses === 0,
    timeframe: config.timeframe,
    filter: config.filter,
    href: "/reports",
  };
}

async function inventoryReorder(tenantId: number, config: WidgetConfig) {
  const rows = (await db.execute(sql`
    SELECT i.id, i.name, i.sku, i.unit, i.reorder_point, i.stock_alerts, i.stock_item_id,
      CASE WHEN i.stock_item_id IS NULL THEN i.quantity ELSE COALESCE(owner.quantity, 0) END AS on_hand
    FROM inventory_items i
    LEFT JOIN inventory_items owner ON owner.id = i.stock_item_id AND owner.tenant_id = i.tenant_id
    WHERE i.tenant_id = ${tenantId}
    ORDER BY i.name
  `)).rows;
  const matched = rows.flatMap(row => {
    const onHand = num(row.on_hand);
    const reorderPoint = num(row.reorder_point);
    const alertsOn = row.stock_alerts !== false && row.stock_alerts !== "false";
    if (!stockNeedsReorder(onHand, reorderPoint, alertsOn)) return [];
    return [{
      id: Number(row.id),
      name: String(row.name),
      sku: String(row.sku),
      quantity: onHand,
      reorderPoint,
      unit: String(row.unit ?? "each"),
      href: "/inventory",
    }];
  });
  const items = matched.slice(0, 20);
  return { items, count: matched.length, empty: matched.length === 0, timeframe: config.timeframe, filter: config.filter };
}

async function jobWaitlist(tenantId: number, userId: number, config: WidgetConfig) {
  const mine = config.filter === "mine" ? sql`AND j.assignee_id = ${userId}` : sql``;
  const where = sql`
    j.tenant_id = ${tenantId} AND j.archived_at IS NULL AND j.status = 'waitlist'
    AND (j.customer_id IS NULL OR c.archived_at IS NULL)
    ${mine}
  `;
  const count = num((await db.execute(sql`
    SELECT count(*)::int AS count
    FROM jobs j
    LEFT JOIN customers c ON c.id = j.customer_id AND c.tenant_id = j.tenant_id
    WHERE ${where}
  `)).rows[0]?.count);
  const rows = (await db.execute(sql`
    SELECT j.id, j.title, COALESCE(j.created_at, j.scheduled_at) AS created_at, c.name AS customer_name
    FROM jobs j
    LEFT JOIN customers c ON c.id = j.customer_id AND c.tenant_id = j.tenant_id
    WHERE ${where}
    ORDER BY COALESCE(j.created_at, j.scheduled_at) DESC
    LIMIT 20
  `)).rows;
  const jobs = rows.map(row => ({
    id: Number(row.id),
    title: String(row.title),
    customerName: row.customer_name == null ? null : String(row.customer_name),
    createdAt: new Date(String(row.created_at)).toISOString(),
    href: `/schedule?jobId=${row.id}`,
  }));
  return { jobs, count, empty: count === 0, timeframe: config.timeframe, filter: config.filter };
}

async function markInvoiceSent(tenantId: number, userId: number, invoiceId: number) {
  if (!(await isAdminRole(tenantId, userId))) return { error: "Restricted to owner/admin/office roles", status: 403 };
  const result = await db.transaction(async tx => {
    const [existing] = await tx.select().from(invoicesTable).where(and(
      eq(invoicesTable.id, invoiceId), eq(invoicesTable.tenantId, tenantId),
    )).for("update");
    if (!existing || existing.archivedAt) return { error: "Invoice not found", status: 404 };
    if (existing.status !== "draft") return { ok: true as const, alreadyComplete: true };
    if (!(existing.total > 0)) return { error: "Add a positive price before sending.", status: 422 };
    const [customer] = await tx.select({ email: customersTable.email, archivedAt: customersTable.archivedAt }).from(customersTable).where(and(
      eq(customersTable.id, existing.customerId), eq(customersTable.tenantId, tenantId),
    ));
    if (!customer?.email || customer.archivedAt) return { error: "An active customer with an email address is required.", status: 422 };
    const covered = existing.creditApplied + existing.depositApplied > 0 && invoiceBalance(existing) === 0;
    await tx.update(invoicesTable).set({
      status: covered ? "paid" : "sent",
      paidAt: covered ? new Date() : existing.paidAt,
      paymentMethod: covered ? (existing.creditApplied > 0 ? "prepaid_credit" : "estimate_deposit") : existing.paymentMethod,
      publicToken: existing.publicToken ?? randomBytes(32).toString("hex"),
    }).where(and(eq(invoicesTable.id, invoiceId), eq(invoicesTable.tenantId, tenantId)));
    await tx.insert(billingEmailQueueTable).values({ tenantId, invoiceId, status: "pending", attempts: 0 });
    return { ok: true as const, alreadyComplete: false };
  });
  if ("ok" in result && !result.alreadyComplete) {
    await import("./billingScheduler").then(module => module.processEmailQueue(tenantId)).catch(error => {
      logger.warn({ err: error, invoiceId }, "Invoice email delivery failed");
    });
    await import("./invoiceCardPayments").then(module => module.chargeInvoiceCard(tenantId, invoiceId, "when_sent")).catch(error => {
      logger.warn({ err: error, invoiceId }, "Invoice charge on send failed");
    });
  }
  return result;
}

async function markInvoiceDueHandled(tenantId: number, userId: number, invoiceId: number) {
  if (!(await isAdminRole(tenantId, userId))) return { error: "Restricted to owner/admin/office roles", status: 403 };
  const [existing] = await db.select({
    id: invoicesTable.id,
    status: invoicesTable.status,
    handledAt: invoicesTable.dueAttentionHandledAt,
    archivedAt: invoicesTable.archivedAt,
  }).from(invoicesTable).where(and(eq(invoicesTable.id, invoiceId), eq(invoicesTable.tenantId, tenantId)));
  if (!existing || existing.archivedAt) return { error: "Invoice not found", status: 404 };
  if (existing.handledAt || existing.status === "paid" || existing.status === "cancelled") return { ok: true as const, alreadyComplete: true };
  if (existing.status !== "sent" && existing.status !== "overdue") return { error: "That invoice is not waiting on a due date", status: 409 };
  const [updated] = await db.update(invoicesTable).set({
    dueAttentionHandledAt: new Date(),
    dueAttentionHandledByUserId: userId,
  }).where(and(
    eq(invoicesTable.id, invoiceId),
    eq(invoicesTable.tenantId, tenantId),
    sql`${invoicesTable.dueAttentionHandledAt} IS NULL`,
  )).returning({ id: invoicesTable.id });
  return updated ? { ok: true as const, alreadyComplete: false } : { ok: true as const, alreadyComplete: true };
}

export async function loadOperations(tenantId: number, userId: number) {
  const layout = await readLayout(tenantId, userId);
  const context = await tenantContext(tenantId);
  const role = await getCallerRole(tenantId, userId);
  const permissions = buildEffectivePermissions(role, context.rolePermissions);
  const allowed = (key: PermissionKey) => permissions[key];
  const now = new Date();
  const { tasks: sourceTasks, equipment } = await actionTasks(tenantId, layout.taskSources, context, now);
  const canSeeInvoices = allowed("financials.invoiceAmounts");
  const tasks = [...sourceTasks, ...await invoiceTasks(tenantId, layout.taskSources, context.timeZone, now, widget(layout, "invoice_attention").timeframe, canSeeInvoices)];
  const alertConfig = widget(layout, "alerts");
  const wantWeather = alertConfig.visible && (alertConfig.filter === "all" || alertConfig.filter === "weather");
  const rain = wantWeather && !layout.taskSources.includes("rain_warning")
    ? await rainWarnings(tenantId, context.timeZone, context.rainThreshold, now)
    : tasks.filter(task => task.source === "rain_warning");
  const visible = new Set(layout.widgets.filter(item => item.visible).map(item => item.key));
  const widgets = {
    needsAction: visible.has("needs_action") ? { empty: tasks.length === 0, timeframe: widget(layout, "needs_action").timeframe, filter: widget(layout, "needs_action").filter } : null,
    jobsCompleted: visible.has("jobs_completed") ? await jobsCompleted(tenantId, userId, widget(layout, "jobs_completed"), context.timeZone, allowed("financials.jobPrices")) : null,
    invoicesRevenue: visible.has("invoices_revenue") ? await invoicesRevenue(tenantId, widget(layout, "invoices_revenue"), context.timeZone, canSeeInvoices) : null,
    invoiceAttention: visible.has("invoice_attention") ? await attentionInvoices(tenantId, widget(layout, "invoice_attention"), context.timeZone, canSeeInvoices, now) : null,
    profitAndLoss: visible.has("profit_and_loss") ? await profitAndLoss(tenantId, widget(layout, "profit_and_loss"), context.timeZone, context.p4p, allowed("pages.reports") && canSeeInvoices) : null,
    payrollSummary: visible.has("payroll_summary") ? await payrollSummary(tenantId, userId, widget(layout, "payroll_summary"), context.timeZone, allowed("pages.billing")) : null,
    schedule: visible.has("schedule") ? await scheduleWidget(tenantId, userId, widget(layout, "schedule"), context.timeZone, now) : null,
    jobWaitlist: visible.has("job_waitlist") ? await jobWaitlist(tenantId, userId, widget(layout, "job_waitlist")) : null,
    inventoryReorder: visible.has("inventory_reorder") ? await inventoryReorder(tenantId, widget(layout, "inventory_reorder")) : null,
    reportSnapshots: visible.has("report_snapshots") ? await reportSnapshots(tenantId, widget(layout, "report_snapshots"), context.timeZone, allowed("financials.jobPrices"), canSeeInvoices) : null,
    alerts: visible.has("alerts") ? await alertsWidget(tenantId, widget(layout, "alerts"), context.timeZone, equipment, rain) : null,
  };
  return { layout, widgets, tasks };
}

export async function completeActionTask(tenantId: number, userId: number, source: TaskSource, sourceId: number, date?: string): Promise<{ ok: true; alreadyComplete: boolean } | { error: string; status: number }> {
  if (!Number.isInteger(sourceId) || sourceId <= 0) return { error: "Choose a task to complete", status: 400 };
  if (source === "portal_message") {
    const [existing] = await db.select({
      id: portalMessagesTable.id, handledAt: portalMessagesTable.handledAt, readAt: portalMessagesTable.readAt, direction: portalMessagesTable.direction,
    }).from(portalMessagesTable).where(and(eq(portalMessagesTable.id, sourceId), eq(portalMessagesTable.tenantId, tenantId)));
    if (!existing || existing.direction !== "inbound") return { error: "Portal message not found", status: 404 };
    if (existing.handledAt) return { ok: true, alreadyComplete: true };
    await db.update(portalMessagesTable).set({
      handledAt: new Date(), handledByUserId: userId, readAt: existing.readAt ?? new Date(),
    }).where(and(eq(portalMessagesTable.id, sourceId), eq(portalMessagesTable.tenantId, tenantId), sql`${portalMessagesTable.handledAt} IS NULL`));
    await db.insert(portalMessageReadsTable).values({ tenantId, messageId: sourceId, userId }).onConflictDoNothing();
    return { ok: true, alreadyComplete: false };
  }
  if (source === "estimate_response") {
    const [updated] = await db.update(estimatesTable).set({ responseHandledAt: new Date(), responseHandledByUserId: userId }).where(and(
      eq(estimatesTable.id, sourceId),
      eq(estimatesTable.tenantId, tenantId),
      sql`${estimatesTable.status} IN ('approved', 'declined')`,
      sql`${estimatesTable.responseHandledAt} IS NULL`,
    )).returning({ id: estimatesTable.id });
    if (updated) return { ok: true, alreadyComplete: false };
    const [existing] = await db.select({ id: estimatesTable.id }).from(estimatesTable).where(and(eq(estimatesTable.id, sourceId), eq(estimatesTable.tenantId, tenantId)));
    if (!existing) return { error: "Estimate not found", status: 404 };
    return { ok: true, alreadyComplete: true };
  }
  if (source === "equipment_maintenance") {
    const context = await tenantContext(tenantId);
    const due = (await equipmentDue(tenantId, context.thresholds)).find(item => item.id === sourceId);
    const [asset] = await db.select({ id: equipmentTable.id, ack: equipmentTable.maintenanceAlertAck }).from(equipmentTable).where(and(
      eq(equipmentTable.id, sourceId), eq(equipmentTable.tenantId, tenantId),
    ));
    if (!asset) return { error: "Equipment not found", status: 404 };
    if (!due) return { ok: true, alreadyComplete: true };
    const tokens = new Set([...(asset.ack ? asset.ack.split("|") : []), ...due.parts]);
    await db.update(equipmentTable).set({ maintenanceAlertAck: joinSignature([...tokens]) }).where(and(
      eq(equipmentTable.id, sourceId), eq(equipmentTable.tenantId, tenantId),
    ));
    return { ok: true, alreadyComplete: false };
  }
  if (source === "rain_warning") {
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: "Choose the warning date", status: 400 };
    const [updated] = await db.update(jobsTable).set({ rainWarningClearedOn: date }).where(and(
      eq(jobsTable.id, sourceId), eq(jobsTable.tenantId, tenantId),
    )).returning({ id: jobsTable.id });
    if (!updated) return { error: "Job not found", status: 404 };
    return { ok: true, alreadyComplete: false };
  }
  if (source === "invoice_to_send") return markInvoiceSent(tenantId, userId, sourceId);
  if (source === "invoice_due") return markInvoiceDueHandled(tenantId, userId, sourceId);
  const [existing] = await db.select({
    id: followupQueueItemsTable.id, status: followupQueueItemsTable.status, note: followupQueueItemsTable.communicationNote,
  }).from(followupQueueItemsTable).where(and(
    eq(followupQueueItemsTable.id, sourceId), eq(followupQueueItemsTable.tenantId, tenantId),
  ));
  if (!existing) return { error: "Follow-up not found", status: 404 };
  if (existing.status !== "open") return { ok: true, alreadyComplete: true };
  await db.update(followupQueueItemsTable).set({
    status: "resolved",
    resolvedAt: new Date(),
    resolvedByUserId: userId,
    communicationNote: existing.note ?? "Completed from the Dashboard",
  }).where(and(
    eq(followupQueueItemsTable.id, sourceId),
    eq(followupQueueItemsTable.tenantId, tenantId),
    eq(followupQueueItemsTable.status, "open"),
  ));
  return { ok: true, alreadyComplete: false };
}
