import bcrypt from "bcryptjs";
import { and, asc, eq, isNull, notInArray, sql } from "drizzle-orm";
import {
  crewMembersTable,
  crewsTable,
  customersTable,
  db,
  driveLegsTable,
  jobsTable,
  propertiesTable,
  servicesTable,
  tenantsTable,
  usersTable,
} from "@workspace/db";
import { installDailyRouteSchema } from "./dailyRouteSchema";
import { measureOrder, optimizeRoute, type OptimizePoint, type OptimizeResult, type OptimizeStop } from "./routeOptimize";
import { todayInTimeZone, zonedDateTime } from "./dailyRouteTime";

export type BoardRole = "crew" | "manager" | "office" | "owner";

export function boardRoleFor(role: string): BoardRole {
  if (role === "company_owner") return "owner";
  if (role === "office_manager" || role === "department_manager") return "office";
  if (role === "crew_manager") return "manager";
  return "crew";
}

export function capabilitiesFor(role: BoardRole) {
  const office = role === "office" || role === "owner";
  const dispatchLead = office || role === "manager";
  return {
    switchViews: role !== "crew",
    dispatch: role !== "crew",
    reassign: office,
    logCallback: dispatchLead,
    optimizeAll: dispatchLead,
    optimizeRoute: true,
    lockToggle: role !== "crew",
    simulateRole: office,
  };
}

export class RouteActionError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

type BoardStatus = "scheduled" | "in_progress" | "completed" | "other";

export interface BoardJob {
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
  status: BoardStatus;
  lockedTimeWindow: boolean;
  sequenceOrder: number | null;
  clockInAt: string | null;
  completedAt: string | null;
}

export interface BoardLeg {
  fromId: number | null;
  toId: number | null;
  durationMinutes: number;
  distanceMiles: number;
}

export interface BoardCrew {
  id: number;
  name: string;
  managerId: number | null;
  managerName: string | null;
  shiftStartAt: string;
  memberIds: number[];
  memberNames: string[];
  jobs: BoardJob[];
  legs: BoardLeg[];
  netPayout: number;
  callbackDeduction: number;
  completedCount: number;
}

export interface DailyBoard {
  date: string;
  timezone: string;
  viewer: { userId: number; name: string; role: string; boardRole: BoardRole };
  capabilities: ReturnType<typeof capabilitiesFor>;
  shop: OptimizePoint;
  crews: BoardCrew[];
  unassigned: BoardJob[];
  unassignedLegs: BoardLeg[];
  myCrewIds: number[];
  managers: Array<{ id: number; name: string }>;
}

type Access = {
  role: BoardRole;
  userId: number;
  myCrewIds: Set<number>;
  managedCrewIds: Set<number>;
};

const round2 = (value: number) => Math.round(value * 100) / 100;

function boardStatus(status: string): BoardStatus {
  if (status === "completed") return "completed";
  if (status === "in_progress") return "in_progress";
  if (status === "scheduled" || status === "pending") return "scheduled";
  return "other";
}

function materialSell(parts: unknown): number {
  if (!Array.isArray(parts)) return 0;
  return parts.reduce<number>((sum, part) => sum + Number((part as { total?: unknown })?.total ?? 0), 0);
}

function displayPayout(job: typeof jobsTable.$inferSelect, pct: number): number {
  if (job.isCallback) return 0;
  if (job.routePayout != null) return round2(job.routePayout);
  const net = Math.max(0, Number(job.totalAmount ?? 0) - materialSell(job.jobParts));
  return round2(net * pct / 100);
}

function canSeeCrew(access: Access, crewId: number | null): boolean {
  if (access.role === "owner" || access.role === "office") return true;
  if (crewId == null) return access.role === "manager";
  if (access.role === "manager") return access.managedCrewIds.has(crewId) || access.myCrewIds.has(crewId);
  return access.myCrewIds.has(crewId);
}

function canSeeJob(access: Access, job: { crewId: number | null; assigneeId: number | null }): boolean {
  if (access.role === "crew" && access.myCrewIds.size === 0) return job.assigneeId === access.userId;
  return canSeeCrew(access, job.crewId);
}

function shopOf(tenant: typeof tenantsTable.$inferSelect): OptimizePoint {
  const address = [tenant.businessAddress, tenant.businessCity, tenant.businessState, tenant.businessZip].filter(Boolean).join(", ");
  return {
    address: address || "Shop",
    lat: tenant.businessLat,
    lng: tenant.businessLng,
  };
}

function toStop(job: BoardJob): OptimizeStop {
  return {
    id: job.id,
    address: [job.address, job.city, job.state, job.zip].filter(Boolean).join(", "),
    lat: job.lat,
    lng: job.lng,
    status: job.status === "scheduled" ? "UPCOMING" : job.status,
    lockedTimeWindow: job.lockedTimeWindow,
  };
}

function asLegs(result: OptimizeResult): BoardLeg[] {
  return result.legs.map(leg => ({
    fromId: typeof leg.fromId === "number" ? leg.fromId : null,
    toId: typeof leg.toId === "number" ? leg.toId : null,
    durationMinutes: leg.durationMinutes,
    distanceMiles: leg.distanceMiles,
  }));
}

async function replaceLegs(tenantId: number, crewId: number | null, date: string, legs: BoardLeg[]) {
  await db.delete(driveLegsTable).where(and(
    eq(driveLegsTable.tenantId, tenantId),
    crewId == null ? isNull(driveLegsTable.crewId) : eq(driveLegsTable.crewId, crewId),
    eq(driveLegsTable.routeDate, date),
  ));
  if (legs.length === 0) return;
  await db.insert(driveLegsTable).values(legs.map((leg, sequence) => ({
    tenantId,
    crewId,
    routeDate: date,
    sequence,
    fromJobId: leg.fromId,
    toJobId: leg.toId,
    durationMinutes: leg.durationMinutes,
    distanceMiles: leg.distanceMiles,
  })));
}

const SAMPLE_SHOP = {
  businessAddress: "4100 Brighton Blvd",
  businessCity: "Denver",
  businessState: "CO",
  businessZip: "80216",
  businessLat: 39.75,
  businessLng: -104.99,
};

type SampleJob = {
  crew: "north" | "south" | "west" | null;
  customer: string;
  address: string;
  lat: number;
  lng: number;
  service: string;
  payout: number;
  minutes: number;
  status: "scheduled" | "in_progress" | "completed";
  actual?: number;
  callback?: boolean;
  deduction?: number;
  locked?: boolean;
  clockInMinutesAgo?: number;
};

const SAMPLE_JOBS: SampleJob[] = [
  { crew: "north", customer: "Helen Henderson", address: "1201 Elm St", lat: 39.754, lng: -104.985, service: "Weekly mow", payout: 55, minutes: 45, status: "completed", actual: 36 },
  { crew: "north", customer: "Luis Alvarez", address: "88 Ash St", lat: 39.76, lng: -104.98, service: "Hedge trim", payout: 48, minutes: 45, status: "in_progress", clockInMinutesAgo: 22 },
  { crew: "north", customer: "Nina Nguyen", address: "900 Pine Rd", lat: 39.772, lng: -104.97, service: "Bed cleanup", payout: 42, minutes: 40, status: "scheduled" },
  { crew: "north", customer: "Brooks Family", address: "14 Birch Ave", lat: 39.768, lng: -104.975, service: "Callback / redo", payout: 0, minutes: 30, status: "scheduled", callback: true, deduction: 35 },
  { crew: "south", customer: "Diego Diaz", address: "55 Maple Dr", lat: 39.74, lng: -105.01, service: "Weekly mow", payout: 36, minutes: 40, status: "completed", actual: 52 },
  { crew: "south", customer: "Priya Patel", address: "400 Cedar Ct", lat: 39.735, lng: -105.02, service: "Leaf cleanup", payout: 60, minutes: 55, status: "scheduled" },
  { crew: "west", customer: "Kim Park", address: "12 Oak Ln", lat: 39.755, lng: -105.03, service: "Weekly mow", payout: 70, minutes: 50, status: "scheduled" },
  { crew: "west", customer: "Asha Singh", address: "77 Spruce Way", lat: 39.748, lng: -105.04, service: "Irrigation check", payout: 44, minutes: 35, status: "scheduled", locked: true },
  { crew: null, customer: "Rosa Garcia", address: "300 Willow St", lat: 39.73, lng: -104.97, service: "Weekly mow", payout: 38, minutes: 30, status: "scheduled" },
  { crew: null, customer: "Omar Ortiz", address: "18 Juniper Pl", lat: 39.725, lng: -104.96, service: "Aeration", payout: 52, minutes: 45, status: "scheduled" },
];

/** Sample route only when this company has no crews. Existing people, jobs, and payouts stay. */
export async function seedDailyRouteIfEmpty(tenantId: number): Promise<void> {
  const [existing] = await db.select({ id: crewsTable.id }).from(crewsTable).where(eq(crewsTable.tenantId, tenantId)).limit(1);
  if (existing) return;
  const passwordHash = await bcrypt.hash("RouteSample1", 10);
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${tenantId})`);
    const [again] = await tx.select({ id: crewsTable.id }).from(crewsTable).where(eq(crewsTable.tenantId, tenantId)).limit(1);
    if (again) return;
    const [tenant] = await tx.select().from(tenantsTable).where(eq(tenantsTable.id, tenantId));
    if (!tenant) return;
    if (!tenant.businessAddress) {
      await tx.update(tenantsTable).set(SAMPLE_SHOP).where(eq(tenantsTable.id, tenantId));
    }
    const email = (local: string) => `route-sample-${local}-${tenantId}@route-sample.invalid`;
    const [owner] = await tx.select({ id: usersTable.id }).from(usersTable).where(and(eq(usersTable.tenantId, tenantId), eq(usersTable.role, "company_owner"))).limit(1);
    if (!owner) {
      await tx.insert(usersTable).values({
        tenantId, name: "Jordan Ellis", email: email("owner"), role: "company_owner", passwordHash,
      });
    }
    const [managerA] = await tx.insert(usersTable).values({
      tenantId, name: "Morgan Hale", email: email("manager-a"), role: "crew_manager", passwordHash,
    }).returning();
    const [managerB] = await tx.insert(usersTable).values({
      tenantId, name: "Riley Brooks", email: email("manager-b"), role: "crew_manager", passwordHash,
    }).returning();
    const [techNorth] = await tx.insert(usersTable).values({
      tenantId, name: "Alex Rivera", email: email("tech-north"), role: "technician", passwordHash, managerId: managerA.id,
    }).returning();
    const [techSouth] = await tx.insert(usersTable).values({
      tenantId, name: "Blake Chen", email: email("tech-south"), role: "technician", passwordHash, managerId: managerA.id,
    }).returning();
    const [techWest] = await tx.insert(usersTable).values({
      tenantId, name: "Casey Nguyen", email: email("tech-west"), role: "technician", passwordHash, managerId: managerB.id,
    }).returning();
    const [north] = await tx.insert(crewsTable).values({ tenantId, name: "North Route", managerId: managerA.id, shiftStartMinutes: 420 }).returning();
    const [south] = await tx.insert(crewsTable).values({ tenantId, name: "South Route", managerId: managerA.id, shiftStartMinutes: 420 }).returning();
    const [west] = await tx.insert(crewsTable).values({ tenantId, name: "West Route", managerId: managerB.id, shiftStartMinutes: 420 }).returning();
    await tx.insert(crewMembersTable).values([
      { tenantId, crewId: north.id, userId: techNorth.id },
      { tenantId, crewId: south.id, userId: techSouth.id },
      { tenantId, crewId: west.id, userId: techWest.id },
    ]);
    const crewId = { north: north.id, south: south.id, west: west.id, "": null } as const;
    const assignee = { north: techNorth.id, south: techSouth.id, west: techWest.id, "": null } as const;
    const date = todayInTimeZone(tenant.timezone || "America/Denver");
    const zone = tenant.timezone || "America/Denver";
    let sequence = { north: 0, south: 0, west: 0, "": 0 };
    for (const [index, sample] of SAMPLE_JOBS.entries()) {
      const key = sample.crew ?? "";
      const [customer] = await tx.insert(customersTable).values({
        tenantId,
        name: sample.customer,
        email: email(`customer-${index}`),
        phone: "555-0100",
      }).returning();
      const [property] = await tx.insert(propertiesTable).values({
        tenantId,
        customerId: customer.id,
        address: sample.address,
        city: "Denver",
        state: "CO",
        zip: "80205",
        lat: sample.lat,
        lng: sample.lng,
      }).returning();
      const now = Date.now();
      await tx.insert(jobsTable).values({
        tenantId,
        title: sample.service,
        status: sample.status,
        customerId: customer.id,
        propertyId: property.id,
        assigneeId: assignee[key],
        crewId: crewId[key],
        scheduledAt: zonedDateTime(date, 8 * 60 + index * 20, zone),
        estimatedDuration: sample.minutes,
        totalAmount: 0,
        routePayout: sample.payout,
        isCallback: sample.callback === true,
        callbackDeduction: sample.deduction ?? 0,
        lockedTimeWindow: sample.locked === true,
        sequenceOrder: sequence[key]++,
        actualMinutes: sample.actual ?? null,
        clockInAt: sample.clockInMinutesAgo != null ? new Date(now - sample.clockInMinutesAgo * 60_000) : null,
        completedAt: sample.status === "completed" ? new Date(now - 60 * 60_000) : null,
        source: "staff",
      });
    }
  });
}

async function accessFor(tenantId: number, userId: number): Promise<{ access: Access; user: typeof usersTable.$inferSelect }> {
  const [user] = await db.select().from(usersTable).where(and(eq(usersTable.id, userId), eq(usersTable.tenantId, tenantId)));
  if (!user) throw new RouteActionError("User not found", 404);
  const role = boardRoleFor(user.role);
  const memberships = await db.select({ crewId: crewMembersTable.crewId }).from(crewMembersTable)
    .where(and(eq(crewMembersTable.tenantId, tenantId), eq(crewMembersTable.userId, userId)))
    .orderBy(asc(crewMembersTable.crewId));
  const managed = await db.select({ id: crewsTable.id }).from(crewsTable)
    .where(and(eq(crewsTable.tenantId, tenantId), eq(crewsTable.managerId, userId)));
  const myCrewIds = role === "crew" ? memberships.slice(0, 1).map(row => row.crewId) : memberships.map(row => row.crewId);
  return {
    user,
    access: {
      role,
      userId,
      myCrewIds: new Set(myCrewIds),
      managedCrewIds: new Set(managed.map(row => row.id)),
    },
  };
}

function summarize(jobs: BoardJob[]) {
  const callbackDeduction = round2(jobs.reduce((sum, job) => sum + (job.isCallback ? job.callbackDeduction : 0), 0));
  const netPayout = round2(jobs.reduce((sum, job) => sum + job.payout, 0) - callbackDeduction);
  return { netPayout, callbackDeduction, completedCount: jobs.filter(job => job.status === "completed").length };
}

export async function loadDailyBoard(tenantId: number, userId: number, requestedDate?: string): Promise<DailyBoard> {
  await installDailyRouteSchema();
  await seedDailyRouteIfEmpty(tenantId);
  const { access, user } = await accessFor(tenantId, userId);
  const [tenant] = await db.select().from(tenantsTable).where(eq(tenantsTable.id, tenantId));
  if (!tenant) throw new RouteActionError("Business not found", 404);
  const timezone = tenant.timezone || "America/Denver";
  const date = requestedDate && /^\d{4}-\d{2}-\d{2}$/.test(requestedDate) ? requestedDate : todayInTimeZone(timezone);
  const globalPct = tenant.p4pMasterPercentage ?? 0;
  const shop = shopOf(tenant);
  const rows = await db.select({
    job: jobsTable,
    customerName: customersTable.name,
    address: propertiesTable.address,
    city: propertiesTable.city,
    state: propertiesTable.state,
    zip: propertiesTable.zip,
    lat: propertiesTable.lat,
    lng: propertiesTable.lng,
    serviceName: servicesTable.name,
    servicePct: servicesTable.p4pPercentage,
  }).from(jobsTable)
    .leftJoin(propertiesTable, and(eq(jobsTable.propertyId, propertiesTable.id), eq(propertiesTable.tenantId, tenantId)))
    .leftJoin(customersTable, and(eq(jobsTable.customerId, customersTable.id), eq(customersTable.tenantId, tenantId)))
    .leftJoin(servicesTable, and(eq(jobsTable.serviceId, servicesTable.id), eq(servicesTable.tenantId, tenantId)))
    .where(and(
      eq(jobsTable.tenantId, tenantId),
      isNull(jobsTable.archivedAt),
      notInArray(jobsTable.status, ["cancelled", "canceled"]),
      sql`(${jobsTable.scheduledAt} AT TIME ZONE ${timezone})::date = ${date}::date`,
    ));

  let jobs: BoardJob[] = rows.map(row => {
    const pct = row.servicePct != null ? Number(row.servicePct) : globalPct;
    return {
      id: row.job.id,
      crewId: row.job.crewId,
      assigneeId: row.job.assigneeId,
      customerName: row.customerName ?? "Customer",
      service: row.serviceName ?? row.job.title,
      address: row.address ?? "",
      city: row.city,
      state: row.state,
      zip: row.zip,
      lat: row.lat,
      lng: row.lng,
      payout: displayPayout(row.job, pct),
      callbackDeduction: round2(row.job.callbackDeduction ?? 0),
      isCallback: row.job.isCallback,
      estimatedMinutes: row.job.estimatedDuration ?? 0,
      actualMinutes: row.job.actualMinutes,
      status: boardStatus(row.job.status),
      lockedTimeWindow: row.job.lockedTimeWindow,
      sequenceOrder: row.job.sequenceOrder,
      clockInAt: row.job.clockInAt?.toISOString() ?? null,
      completedAt: row.job.completedAt?.toISOString() ?? null,
    };
  }).sort((a, b) => (a.sequenceOrder ?? 1_000_000) - (b.sequenceOrder ?? 1_000_000) || a.id - b.id);

  if (access.role === "crew") {
    jobs = access.myCrewIds.size > 0
      ? jobs.filter(job => job.crewId != null && access.myCrewIds.has(job.crewId))
      : jobs.filter(job => job.assigneeId === access.userId);
  }

  const crews = await db.select().from(crewsTable).where(eq(crewsTable.tenantId, tenantId)).orderBy(asc(crewsTable.id));
  const members = await db.select({
    crewId: crewMembersTable.crewId,
    userId: crewMembersTable.userId,
    name: usersTable.name,
  }).from(crewMembersTable)
    .innerJoin(usersTable, eq(crewMembersTable.userId, usersTable.id))
    .where(eq(crewMembersTable.tenantId, tenantId));
  const people = await db.select({ id: usersTable.id, name: usersTable.name, role: usersTable.role }).from(usersTable).where(eq(usersTable.tenantId, tenantId));
  const nameById = new Map(people.map(person => [person.id, person.name]));
  const storedLegs = await db.select().from(driveLegsTable).where(and(eq(driveLegsTable.tenantId, tenantId), eq(driveLegsTable.routeDate, date))).orderBy(asc(driveLegsTable.sequence));

  async function legsFor(crewId: number | null, crewJobs: BoardJob[]): Promise<BoardLeg[]> {
    const stored = storedLegs.filter(leg => leg.crewId === crewId);
    if (stored.length > 0) {
      return stored.map(leg => ({ fromId: leg.fromJobId, toId: leg.toJobId, durationMinutes: leg.durationMinutes, distanceMiles: leg.distanceMiles }));
    }
    if (crewJobs.length === 0) return [];
    const measured = asLegs(measureOrder(crewJobs.map(toStop), shop, shop));
    await replaceLegs(tenantId, crewId, date, measured);
    return measured;
  }

  const visibleCrews: BoardCrew[] = [];
  for (const crew of crews) {
    if (!canSeeCrew(access, crew.id)) continue;
    if (access.role === "crew" && !access.myCrewIds.has(crew.id)) continue;
    const crewJobs = jobs.filter(job => job.crewId === crew.id);
    const crewMembers = members.filter(member => member.crewId === crew.id);
    const summary = summarize(crewJobs);
    visibleCrews.push({
      id: crew.id,
      name: crew.name,
      managerId: crew.managerId,
      managerName: crew.managerId == null ? null : nameById.get(crew.managerId) || null,
      shiftStartAt: zonedDateTime(date, crew.shiftStartMinutes ?? 420, timezone).toISOString(),
      memberIds: crewMembers.map(member => member.userId),
      memberNames: crewMembers.map(member => member.name),
      jobs: crewJobs,
      legs: await legsFor(crew.id, crewJobs),
      ...summary,
    });
  }

  if (access.role === "crew" && visibleCrews.length === 0) {
    const summary = summarize(jobs);
    visibleCrews.push({
      id: 0,
      name: "My route",
      managerId: null,
      managerName: null,
      shiftStartAt: zonedDateTime(date, 420, timezone).toISOString(),
      memberIds: [userId],
      memberNames: [user.name],
      jobs,
      legs: await legsFor(null, jobs),
      ...summary,
    });
  }

  const unassigned = access.role === "crew" ? [] : jobs.filter(job => job.crewId == null);
  const managers = access.role === "office" || access.role === "owner"
    ? people.filter(person => person.role === "crew_manager").map(person => ({ id: person.id, name: person.name }))
    : [];

  return {
    date,
    timezone,
    viewer: { userId: user.id, name: user.name, role: user.role, boardRole: access.role },
    capabilities: capabilitiesFor(access.role),
    shop,
    crews: visibleCrews,
    unassigned,
    unassignedLegs: access.role === "crew" ? [] : await legsFor(null, unassigned),
    myCrewIds: [...access.myCrewIds],
    managers,
  };
}

function parseStop(raw: unknown): OptimizeStop | null {
  if (!raw || typeof raw !== "object") return null;
  const stop = raw as Record<string, unknown>;
  const id = typeof stop.id === "number" || typeof stop.id === "string" ? stop.id : null;
  if (id == null || typeof stop.address !== "string" || typeof stop.status !== "string") return null;
  return {
    id,
    address: stop.address,
    status: stop.status,
    lockedTimeWindow: stop.lockedTimeWindow === true,
    lat: typeof stop.lat === "number" ? stop.lat : null,
    lng: typeof stop.lng === "number" ? stop.lng : null,
  };
}

function parsePoint(raw: unknown): OptimizePoint | null {
  if (typeof raw === "string") return { address: raw };
  if (!raw || typeof raw !== "object") return null;
  const point = raw as Record<string, unknown>;
  if (typeof point.address !== "string") return null;
  return {
    address: point.address,
    lat: typeof point.lat === "number" ? point.lat : null,
    lng: typeof point.lng === "number" ? point.lng : null,
  };
}

async function jobsForCrew(tenantId: number, crewId: number, date: string, timezone: string) {
  return db.select().from(jobsTable).where(and(
    eq(jobsTable.tenantId, tenantId),
    eq(jobsTable.crewId, crewId),
    isNull(jobsTable.archivedAt),
    notInArray(jobsTable.status, ["cancelled", "canceled"]),
    sql`(${jobsTable.scheduledAt} AT TIME ZONE ${timezone})::date = ${date}::date`,
  ));
}

export async function optimizeDailyRoute(tenantId: number, userId: number, body: unknown): Promise<OptimizeResult & { previousDurationMinutes: number }> {
  await installDailyRouteSchema();
  const payload = body as Record<string, unknown>;
  const origin = parsePoint(payload?.origin);
  const destination = parsePoint(payload?.destination);
  const stops = Array.isArray(payload?.stops) ? payload.stops.map(parseStop) : [];
  if (!origin || !destination || stops.some(stop => !stop)) throw new RouteActionError("origin, destination, and stops are required", 400);
  const cleanStops = stops as OptimizeStop[];
  const { access } = await accessFor(tenantId, userId);
  const [tenant] = await db.select().from(tenantsTable).where(eq(tenantsTable.id, tenantId));
  if (!tenant) throw new RouteActionError("Business not found", 404);
  const timezone = tenant.timezone || "America/Denver";
  const date = typeof payload.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(payload.date) ? payload.date : todayInTimeZone(timezone);
  const crewId = payload.crewId == null ? null : Number(payload.crewId);
  if (crewId != null && !Number.isInteger(crewId)) throw new RouteActionError("crewId is invalid", 400);
  if (crewId != null && !canSeeCrew(access, crewId)) throw new RouteActionError("You cannot optimize that route", 403);
  if (crewId != null) {
    const rows = await jobsForCrew(tenantId, crewId, date, timezone);
    const expected = new Set(rows.map(row => row.id));
    const got = cleanStops.map(stop => Number(stop.id));
    if (got.some(id => !expected.has(id)) || expected.size !== new Set(got).size) {
      throw new RouteActionError("Stops must match that crew's route for the day", 400);
    }
  }
  const result = await optimizeRoute({ origin, destination, stops: cleanStops });
  let previousDurationMinutes = result.totalDurationMinutes;
  if (crewId != null) {
    const existing = await db.select({ durationMinutes: driveLegsTable.durationMinutes }).from(driveLegsTable).where(and(
      eq(driveLegsTable.tenantId, tenantId),
      eq(driveLegsTable.crewId, crewId),
      eq(driveLegsTable.routeDate, date),
    ));
    if (existing.length > 0) previousDurationMinutes = existing.reduce((sum, leg) => sum + leg.durationMinutes, 0);
    await Promise.all(result.order.map((id, sequence) => db.update(jobsTable).set({ sequenceOrder: sequence }).where(and(
      eq(jobsTable.id, Number(id)),
      eq(jobsTable.tenantId, tenantId),
      eq(jobsTable.crewId, crewId),
    ))));
    await replaceLegs(tenantId, crewId, date, asLegs(result));
  }
  return { ...result, previousDurationMinutes };
}

export async function optimizeVisibleRoutes(tenantId: number, userId: number): Promise<Array<OptimizeResult & { crewId: number; previousDurationMinutes: number }>> {
  const board = await loadDailyBoard(tenantId, userId);
  if (!board.capabilities.optimizeAll) throw new RouteActionError("You cannot optimize these routes", 403);
  const results = [];
  for (const crew of board.crews) {
    if (crew.jobs.length === 0) continue;
    const optimized = await optimizeDailyRoute(tenantId, userId, {
      origin: board.shop,
      destination: board.shop,
      stops: crew.jobs.map(toStop),
      crewId: crew.id,
      date: board.date,
    });
    results.push({ crewId: crew.id, ...optimized });
  }
  return results;
}

export async function updateDailyJob(tenantId: number, userId: number, jobId: number, body: Record<string, unknown>): Promise<void> {
  await installDailyRouteSchema();
  const { access } = await accessFor(tenantId, userId);
  const caps = capabilitiesFor(access.role);
  const [job] = await db.select().from(jobsTable).where(and(eq(jobsTable.id, jobId), eq(jobsTable.tenantId, tenantId), isNull(jobsTable.archivedAt)));
  if (!job) throw new RouteActionError("Job not found", 404);
  if (!canSeeJob(access, job)) throw new RouteActionError("You cannot change that job", 403);
  const [tenant] = await db.select().from(tenantsTable).where(eq(tenantsTable.id, tenantId));
  const timezone = tenant?.timezone || "America/Denver";
  const date = todayInTimeZone(timezone);

  if ("crewId" in body) {
    if (!caps.reassign) throw new RouteActionError("You cannot reassign jobs", 403);
    const nextCrew = body.crewId == null ? null : Number(body.crewId);
    if (nextCrew != null) {
      if (!Number.isInteger(nextCrew)) throw new RouteActionError("crewId is invalid", 400);
      const [crew] = await db.select({ id: crewsTable.id }).from(crewsTable).where(and(eq(crewsTable.id, nextCrew), eq(crewsTable.tenantId, tenantId)));
      if (!crew) throw new RouteActionError("Crew not found", 404);
    }
    const siblings = await db.select({ id: jobsTable.id }).from(jobsTable).where(and(
      eq(jobsTable.tenantId, tenantId),
      nextCrew == null ? isNull(jobsTable.crewId) : eq(jobsTable.crewId, nextCrew),
      sql`(${jobsTable.scheduledAt} AT TIME ZONE ${timezone})::date = ${date}::date`,
    ));
    await db.update(jobsTable).set({ crewId: nextCrew, sequenceOrder: siblings.length }).where(and(eq(jobsTable.id, jobId), eq(jobsTable.tenantId, tenantId)));
  }

  if (body.direction === "up" || body.direction === "down") {
    if (boardStatus(job.status) !== "scheduled") throw new RouteActionError("Only upcoming stops can be reordered", 409);
    const siblings = await db.select().from(jobsTable).where(and(
      eq(jobsTable.tenantId, tenantId),
      job.crewId == null ? isNull(jobsTable.crewId) : eq(jobsTable.crewId, job.crewId),
      isNull(jobsTable.archivedAt),
      notInArray(jobsTable.status, ["cancelled", "canceled"]),
      sql`(${jobsTable.scheduledAt} AT TIME ZONE ${timezone})::date = ${date}::date`,
    ));
    siblings.sort((a, b) => (a.sequenceOrder ?? 1_000_000) - (b.sequenceOrder ?? 1_000_000) || a.id - b.id);
    const index = siblings.findIndex(row => row.id === jobId);
    const neighbor = index + (body.direction === "up" ? -1 : 1);
    if (index < 0 || neighbor < 0 || neighbor >= siblings.length) throw new RouteActionError("That stop cannot move further", 409);
    if (boardStatus(siblings[neighbor].status) !== "scheduled") throw new RouteActionError("Only upcoming stops can be reordered", 409);
    const order = siblings.map(row => row.id);
    const [moved] = order.splice(index, 1);
    order.splice(neighbor, 0, moved);
    await Promise.all(order.map((id, sequence) => db.update(jobsTable).set({ sequenceOrder: sequence }).where(and(eq(jobsTable.id, id), eq(jobsTable.tenantId, tenantId)))));
  }

  if (typeof body.lockedTimeWindow === "boolean") {
    if (!caps.lockToggle) throw new RouteActionError("You cannot change time windows", 403);
    await db.update(jobsTable).set({ lockedTimeWindow: body.lockedTimeWindow }).where(and(eq(jobsTable.id, jobId), eq(jobsTable.tenantId, tenantId)));
  }

  if (body.status === "in_progress") {
    await db.update(jobsTable).set({
      status: "in_progress",
      clockInAt: job.clockInAt ?? new Date(),
    }).where(and(eq(jobsTable.id, jobId), eq(jobsTable.tenantId, tenantId)));
  }

  if (body.status === "completed") {
    const started = job.clockInAt ?? new Date();
    const elapsed = Math.max(0, Math.round((Date.now() - started.getTime()) / 60_000));
    const requested = typeof body.actualMinutes === "number" ? Math.max(0, Math.round(body.actualMinutes)) : elapsed;
    await db.update(jobsTable).set({
      status: "completed",
      completedAt: new Date(),
      actualMinutes: requested,
      clockInAt: job.clockInAt ?? started,
    }).where(and(eq(jobsTable.id, jobId), eq(jobsTable.tenantId, tenantId)));
  }
}

export async function logDailyCallback(tenantId: number, userId: number, body: Record<string, unknown>): Promise<{ jobId: number }> {
  await installDailyRouteSchema();
  const { access } = await accessFor(tenantId, userId);
  if (!capabilitiesFor(access.role).logCallback) throw new RouteActionError("You cannot log a callback", 403);
  const crewId = Number(body.crewId);
  const deduction = Number(body.deductionAmount);
  if (!Number.isInteger(crewId) || !Number.isFinite(deduction) || deduction < 0) {
    throw new RouteActionError("crewId and deductionAmount are required", 400);
  }
  const [crew] = await db.select().from(crewsTable).where(and(eq(crewsTable.id, crewId), eq(crewsTable.tenantId, tenantId)));
  if (!crew || !canSeeCrew(access, crewId)) throw new RouteActionError("Crew not found", 404);
  const [tenant] = await db.select().from(tenantsTable).where(eq(tenantsTable.id, tenantId));
  const timezone = tenant?.timezone || "America/Denver";
  const date = todayInTimeZone(timezone);
  const name = typeof body.customerName === "string" && body.customerName.trim() ? body.customerName.trim() : "Callback";
  const address = typeof body.address === "string" && body.address.trim() ? body.address.trim() : "Callback stop";
  const minutes = typeof body.estimatedMinutes === "number" ? Math.min(480, Math.max(5, Math.round(body.estimatedMinutes))) : 30;
  const [customer] = await db.insert(customersTable).values({
    tenantId,
    name,
    email: `route-callback-${tenantId}-${Date.now()}@route-sample.invalid`,
    phone: "555-0100",
  }).returning();
  const [property] = await db.insert(propertiesTable).values({
    tenantId, customerId: customer.id, address, city: tenant?.businessCity ?? null, state: tenant?.businessState ?? null, zip: tenant?.businessZip ?? null,
  }).returning();
  const siblings = await jobsForCrew(tenantId, crewId, date, timezone);
  const [member] = await db.select({ userId: crewMembersTable.userId }).from(crewMembersTable).where(and(eq(crewMembersTable.crewId, crewId), eq(crewMembersTable.tenantId, tenantId))).limit(1);
  const [job] = await db.insert(jobsTable).values({
    tenantId,
    title: "Callback / redo",
    status: "scheduled",
    customerId: customer.id,
    propertyId: property.id,
    crewId,
    assigneeId: member?.userId ?? null,
    scheduledAt: zonedDateTime(date, (crew.shiftStartMinutes ?? 420) + siblings.length * 30, timezone),
    estimatedDuration: minutes,
    totalAmount: 0,
    routePayout: 0,
    isCallback: true,
    callbackDeduction: round2(deduction),
    sequenceOrder: siblings.length,
    source: "staff",
  }).returning();
  return { jobId: job.id };
}
