import { customFetch } from "@workspace/api-client-react";
import type { BoardRole } from "./dailyRouteMetrics";

export interface RouteJob {
  id: number;
  crewId: number | null;
  assigneeId: number | null;
  customerName: string;
  service: string;
  address: string;
  city: string | null;
  state: string | null;
  zip: string | null;
  lat: number | null;
  lng: number | null;
  payout: number;
  callbackDeduction: number;
  isCallback: boolean;
  estimatedMinutes: number;
  actualMinutes: number | null;
  status: "scheduled" | "in_progress" | "completed" | "other";
  lockedTimeWindow: boolean;
  sequenceOrder: number | null;
  clockInAt: string | null;
  completedAt: string | null;
}

export interface RouteLeg {
  fromId: number | null;
  toId: number | null;
  durationMinutes: number;
  distanceMiles: number;
}

export interface RouteCrew {
  id: number;
  name: string;
  managerId: number | null;
  managerName: string | null;
  shiftStartAt: string;
  memberIds: number[];
  memberNames: string[];
  jobs: RouteJob[];
  legs: RouteLeg[];
  netPayout: number;
  callbackDeduction: number;
  completedCount: number;
}

export interface DailyBoard {
  date: string;
  timezone: string;
  viewer: { userId: number; name: string; role: string; boardRole: BoardRole };
  capabilities: {
    switchViews: boolean;
    dispatch: boolean;
    reassign: boolean;
    logCallback: boolean;
    optimizeAll: boolean;
    optimizeRoute: boolean;
    lockToggle: boolean;
    simulateRole: boolean;
  };
  shop: { address: string; lat?: number | null; lng?: number | null };
  crews: RouteCrew[];
  unassigned: RouteJob[];
  unassignedLegs: RouteLeg[];
  myCrewIds: number[];
  managers: Array<{ id: number; name: string }>;
}

export interface OptimizeResponse {
  order: number[];
  legs: RouteLeg[];
  totalDurationMinutes: number;
  previousDurationMinutes: number;
  source: "google" | "estimated";
}

const json = { "Content-Type": "application/json" };

export const fetchDailyBoard = () => customFetch<DailyBoard>("/api/routes/daily");

export const optimizeRoute = (body: unknown) => customFetch<OptimizeResponse>("/api/routes/optimize", {
  method: "POST", headers: json, body: JSON.stringify(body),
});

export const optimizeAllRoutes = () => customFetch<{ routes: Array<OptimizeResponse & { crewId: number }> }>("/api/routes/daily/optimize-all", {
  method: "POST", headers: json, body: "{}",
});

export const updateRouteJob = (id: number, body: unknown) => customFetch<{ ok: boolean }>(`/api/routes/daily/jobs/${id}`, {
  method: "PATCH", headers: json, body: JSON.stringify(body),
});

export const logRouteCallback = (body: unknown) => customFetch<{ jobId: number }>("/api/routes/daily/callbacks", {
  method: "POST", headers: json, body: JSON.stringify(body),
});
