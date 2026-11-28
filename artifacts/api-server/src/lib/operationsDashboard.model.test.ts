import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ackCovers, joinSignature, scheduleDueParts } from "./equipmentMaintenance";
import { classifyInvoiceAttention, defaultLayout, normalizeLayout, timeframeRange } from "./operationsDashboard";

describe("operations dashboard layout", () => {
  it("keeps the default widget set and rejects an unknown filter", () => {
    const layout = defaultLayout();
    expect(layout.widgets.map(widget => widget.key)).toEqual([
      "jobs_completed", "invoices_revenue", "invoice_attention", "profit_and_loss",
      "payroll_summary", "schedule", "job_waitlist", "inventory_reorder", "report_snapshots", "alerts",
      "needs_action",
    ]);
    expect(layout.widgets.every(widget => widget.visible)).toBe(true);
    expect(layout.widgets.at(-1)).toMatchObject({ key: "needs_action", minimized: false });
    expect(layout.taskSources).toEqual(expect.arrayContaining(["invoice_to_send", "invoice_due"]));
    const saved = normalizeLayout({
      widgets: [{ key: "alerts", visible: false, timeframe: "today", filter: "weather" }],
      taskSources: ["followup", "followup"],
    });
    expect(saved?.widgets.find(widget => widget.key === "alerts")).toMatchObject({ visible: false, filter: "weather" });
    expect(saved?.widgets.find(widget => widget.key === "needs_action")?.visible).toBe(true);
    expect(saved?.widgets).toHaveLength(layout.widgets.length);
    expect(saved?.taskSources).toEqual(["followup"]);
    expect(saved?.widgets.at(-1)?.key).toBe("needs_action");
    const minimized = normalizeLayout({
      widgets: [
        { key: "needs_action", visible: true, timeframe: "today", filter: "all", minimized: true },
        { key: "alerts", visible: false, timeframe: "today", filter: "weather" },
      ],
      taskSources: ["followup"],
    });
    expect(minimized?.widgets.at(-1)).toMatchObject({ key: "needs_action", minimized: true });
    expect(minimized?.widgets[0].key).toBe("alerts");
    expect(normalizeLayout({
      widgets: [{ key: "alerts", visible: true, timeframe: "today", filter: "nope" }],
      taskSources: [],
    })).toBeNull();
  });

  it("keeps unsent invoices on the send list and due invoices on the due list", () => {
    const now = new Date("2026-11-21T15:00:00Z");
    const range = timeframeRange("month", "UTC", now);
    const base = { createdAt: now, handled: false, balance: 40 };
    expect(classifyInvoiceAttention({ ...base, status: "draft", dueAt: new Date("2026-11-20T00:00:00Z") }, range, now)).toBe("send");
    expect(classifyInvoiceAttention({ ...base, status: "sent", dueAt: new Date("2026-11-23T00:00:00Z") }, range, now)).toBe("due");
    expect(classifyInvoiceAttention({ ...base, status: "sent", dueAt: new Date("2026-12-20T00:00:00Z") }, range, now)).toBeNull();
    expect(classifyInvoiceAttention({ ...base, status: "sent", dueAt: new Date("2026-11-20T00:00:00Z"), handled: true }, range, now)).toBeNull();
    expect(classifyInvoiceAttention({ ...base, status: "paid", dueAt: now, balance: 0 }, range, now)).toBeNull();
  });

  it("applies the invoice attention columns during server startup", () => {
    const migration = readFileSync(new URL("../../../../lib/db/drizzle/0116_dashboard_widgets.sql", import.meta.url), "utf8");
    const startup = readFileSync(new URL("./schemaSafety.ts", import.meta.url), "utf8");
    const compact = (sql: string) => sql.replace(/\s+/g, " ").trim();
    const statements = migration.split(";").map(compact).filter(Boolean);
    expect(statements.length).toBeGreaterThan(0);
    for (const statement of statements) expect(compact(startup)).toContain(statement);
  });

  it("bounds a timeframe to the tenant calendar", () => {
    const range = timeframeRange("today", "UTC", new Date("2026-11-21T15:00:00Z"));
    expect(range.start.toISOString()).toBe("2026-11-21T00:00:00.000Z");
    expect(range.end.toISOString()).toBe("2026-11-22T00:00:00.000Z");
    const month = timeframeRange("month", "UTC", new Date("2026-11-21T15:00:00Z"));
    expect(month.start.toISOString()).toBe("2026-11-01T00:00:00.000Z");
  });

  it("clears only the maintenance signature that was acknowledged", () => {
    const parts = scheduleDueParts({
      currentHours: 40, currentMiles: null, nextServiceDueDate: "2026-01-01",
      nextServiceDueHours: 10, nextServiceDueMiles: null, today: "2026-11-21",
    });
    expect(parts).toEqual(["date:2026-01-01", "hours:10"]);
    const ack = joinSignature([...parts, "cat:warn:10"]);
    expect(ackCovers(ack, parts)).toBe(true);
    expect(ackCovers(ack, ["hours:80"])).toBe(false);
    expect(ackCovers(null, parts)).toBe(false);
  });
});
