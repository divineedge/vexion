import { and, eq } from "drizzle-orm";
import { db, userScheduleForecastViewsTable } from "@workspace/db";

export type ScheduleForecastView = {
  startHour: number;
  endHour: number;
  hourlyMinimized: boolean;
  minimizedDays: string[];
};

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DAYS = 400;

export function defaultForecastView(): ScheduleForecastView {
  return { startHour: 0, endHour: 23, hourlyMinimized: false, minimizedDays: [] };
}

export function normalizeForecastView(input: unknown): ScheduleForecastView | null {
  if (!input || typeof input !== "object") return null;
  const body = input as { startHour?: unknown; endHour?: unknown; hourlyMinimized?: unknown; minimizedDays?: unknown };
  if (!Number.isInteger(body.startHour) || (body.startHour as number) < 0 || (body.startHour as number) > 23) return null;
  if (!Number.isInteger(body.endHour) || (body.endHour as number) < 0 || (body.endHour as number) > 23) return null;
  if ((body.startHour as number) > (body.endHour as number)) return null;
  if (typeof body.hourlyMinimized !== "boolean") return null;
  if (!Array.isArray(body.minimizedDays)) return null;
  const minimizedDays: string[] = [];
  for (const day of body.minimizedDays) {
    if (typeof day !== "string" || !DATE_KEY.test(day)) return null;
    if (!minimizedDays.includes(day)) minimizedDays.push(day);
  }
  if (body.minimizedDays.length > MAX_DAYS) return null;
  return {
    startHour: body.startHour as number,
    endHour: body.endHour as number,
    hourlyMinimized: body.hourlyMinimized,
    minimizedDays,
  };
}

export async function readForecastView(tenantId: number, userId: number): Promise<ScheduleForecastView> {
  const [row] = await db.select({
    startHour: userScheduleForecastViewsTable.startHour,
    endHour: userScheduleForecastViewsTable.endHour,
    hourlyMinimized: userScheduleForecastViewsTable.hourlyMinimized,
    minimizedDays: userScheduleForecastViewsTable.minimizedDays,
  }).from(userScheduleForecastViewsTable).where(and(
    eq(userScheduleForecastViewsTable.userId, userId),
    eq(userScheduleForecastViewsTable.tenantId, tenantId),
  ));
  if (!row) return defaultForecastView();
  return normalizeForecastView(row) ?? defaultForecastView();
}

export async function writeForecastView(tenantId: number, userId: number, view: ScheduleForecastView): Promise<ScheduleForecastView> {
  await db.insert(userScheduleForecastViewsTable).values({
    userId,
    tenantId,
    startHour: view.startHour,
    endHour: view.endHour,
    hourlyMinimized: view.hourlyMinimized,
    minimizedDays: view.minimizedDays,
    updatedAt: new Date(),
  }).onConflictDoUpdate({
    target: userScheduleForecastViewsTable.userId,
    set: {
      tenantId,
      startHour: view.startHour,
      endHour: view.endHour,
      hourlyMinimized: view.hourlyMinimized,
      minimizedDays: view.minimizedDays,
      updatedAt: new Date(),
    },
  });
  return view;
}
