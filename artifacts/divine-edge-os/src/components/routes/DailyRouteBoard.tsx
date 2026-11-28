import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, Lock, Navigation } from "lucide-react";
import { directionsUrl } from "@/lib/directions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  capabilitiesFor,
  completionLabel,
  effectiveHourly,
  elapsedMinutes,
  formatEta,
  formatHourly,
  formatMoney,
  projectedHourly,
  remainingWorkMinutes,
  routeMoney,
  visibleCrews,
  type BoardRole,
} from "@/lib/dailyRouteMetrics";
import {
  fetchDailyBoard,
  logRouteCallback,
  optimizeAllRoutes,
  optimizeRoute,
  updateRouteJob,
  type DailyBoard,
  type OptimizeResponse,
  type RouteCrew,
  type RouteJob,
  type RouteLeg,
} from "@/lib/dailyRouteApi";

const BOARD_KEY = ["daily-route-board"];

function stopPayload(job: RouteJob) {
  return {
    id: job.id,
    address: [job.address, job.city, job.state, job.zip].filter(Boolean).join(", "),
    status: job.status === "scheduled" ? "UPCOMING" : job.status,
    lockedTimeWindow: job.lockedTimeWindow,
    lat: job.lat,
    lng: job.lng,
  };
}

function errorText(error: unknown): string {
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") return error.message;
  return "Something went wrong";
}

function DrivePill({ leg, label, href }: { leg: RouteLeg; label: string; href: string | null }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-full border bg-muted/70 px-3 py-2 text-sm" data-testid={leg.toId == null ? "drive-return" : `drive-${leg.toId}`}>
      <span>{leg.durationMinutes} min • {leg.distanceMiles.toFixed(1)} mi<span className="sr-only"> {label}</span></span>
      {href && (
        <a className="inline-flex items-center gap-1 font-medium text-primary" href={href} target="_blank" rel="noreferrer">
          <Navigation className="h-3.5 w-3.5" /> Navigate
        </a>
      )}
    </div>
  );
}

function JobCard({
  job,
  now,
  mode,
  canReorder,
  canReassign,
  canLock,
  canWork,
  crews,
  onChange,
}: {
  job: RouteJob;
  now: Date;
  mode: "crew" | "dispatch";
  canReorder: boolean;
  canReassign: boolean;
  canLock: boolean;
  canWork: boolean;
  crews: RouteCrew[];
  onChange: (id: number, body: Record<string, unknown>) => Promise<void>;
}) {
  const done = completionLabel(job);
  const elapsed = elapsedMinutes(job.clockInAt, now);
  return (
    <article className="space-y-2 rounded-xl border bg-background p-4 shadow-sm" data-testid={`job-${job.id}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-semibold">{job.customerName}</p>
          <p className="text-sm text-muted-foreground">{[job.address, job.city, job.state].filter(Boolean).join(", ")}</p>
        </div>
        {job.lockedTimeWindow && <Lock className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-label="Locked time window" />}
      </div>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span>{job.service}</span>
        <span className="font-medium">{formatMoney(job.payout)}</span>
        <span className="text-muted-foreground">{job.estimatedMinutes}m</span>
        {job.isCallback && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">Callback / redo</span>}
        {job.isCallback && job.callbackDeduction > 0 && (
          <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800">{formatMoney(-job.callbackDeduction)} deduction</span>
        )}
      </div>
      {job.status === "in_progress" && (
        <p className="text-sm font-medium text-foreground">Elapsed: {elapsed}m / Est: {job.estimatedMinutes}m</p>
      )}
      {done && (
        <p className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${done.tone === "green" ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-700"}`}>
          {done.text}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {canReorder && job.status === "scheduled" && (
          <>
            <Button type="button" variant="outline" size="sm" className="h-10" onClick={() => onChange(job.id, { direction: "up" })} aria-label="Move up"><ArrowUp className="h-4 w-4" /></Button>
            <Button type="button" variant="outline" size="sm" className="h-10" onClick={() => onChange(job.id, { direction: "down" })} aria-label="Move down"><ArrowDown className="h-4 w-4" /></Button>
          </>
        )}
        {mode === "crew" && canWork && job.status === "scheduled" && (
          <Button type="button" variant="outline" className="h-10" onClick={() => onChange(job.id, { status: "in_progress" })}>Start Job</Button>
        )}
        {mode === "crew" && canWork && job.status === "in_progress" && (
          <Button type="button" className="h-11" data-testid={`complete-${job.id}`} onClick={() => onChange(job.id, { status: "completed", actualMinutes: elapsed })}>Complete Job</Button>
        )}
        {canLock && (
          <Button type="button" variant="outline" size="sm" className="h-10" onClick={() => onChange(job.id, { lockedTimeWindow: !job.lockedTimeWindow })}>
            {job.lockedTimeWindow ? "Unlock time" : "Lock time"}
          </Button>
        )}
      </div>
      {canReassign && (
        <label className="block text-sm">
          <span className="text-muted-foreground">Reassign</span>
          <select
            className="mt-1 h-10 w-full rounded-md border bg-background px-2"
            data-testid={`reassign-${job.id}`}
            value={job.crewId == null ? "unassigned" : String(job.crewId)}
            onChange={event => onChange(job.id, { crewId: event.target.value === "unassigned" ? null : Number(event.target.value) })}
          >
            <option value="unassigned">Unassigned</option>
            {crews.map(crew => <option key={crew.id} value={crew.id}>{crew.name}</option>)}
          </select>
        </label>
      )}
    </article>
  );
}

function ScheduleHeader({
  crew,
  now,
  optimizing,
  onOptimize,
}: {
  crew: RouteCrew;
  now: Date;
  optimizing: boolean;
  onOptimize: () => void;
}) {
  const money = routeMoney(crew.jobs);
  const drive = crew.legs.reduce((sum, leg) => sum + leg.durationMinutes, 0);
  const hourly = effectiveHourly({
    net: money.net,
    earned: money.earned,
    jobMinutes: money.jobMinutes,
    driveMinutes: drive,
    shiftStart: new Date(crew.shiftStartAt),
    now,
  });
  const finish = new Date(now.getTime() + remainingWorkMinutes(crew.jobs, crew.legs, now) * 60_000);
  return (
    <header className="sticky top-0 z-20 -mx-6 space-y-2 border-b bg-background/95 px-4 py-3 backdrop-blur md:-mx-8" data-testid="crew-header">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Net daily P4P</p>
          <p className="text-3xl font-semibold tracking-tight" data-testid="net-p4p">{formatMoney(money.net)}</p>
          {money.deduction > 0 && <p className="text-sm text-amber-800" data-testid="callback-sub">{formatMoney(-money.deduction)} callback deduction</p>}
        </div>
        <Button type="button" className="h-11 shrink-0" data-testid="optimize-route" disabled={optimizing || crew.jobs.length === 0} onClick={onOptimize}>
          Optimize Route
        </Button>
      </div>
      <div className="grid grid-cols-3 gap-2 text-sm">
        <div>
          <p className="font-medium" data-testid="est-finish">{formatEta(finish)}</p>
          <p className="text-xs text-muted-foreground">Incl. return to shop</p>
        </div>
        <div>
          <p className="font-medium" data-testid="effective-hourly">{formatHourly(hourly)}</p>
          <p className="text-xs text-muted-foreground">Effective hourly</p>
        </div>
        <div>
          <p className="font-medium" data-testid="stop-progress">{money.completed} of {money.total} stops completed</p>
        </div>
      </div>
    </header>
  );
}

export default function DailyRouteBoard({ initialView = "crew" }: { initialView?: "crew" | "dispatch" }) {
  const queryClient = useQueryClient();
  const boardQuery = useQuery({ queryKey: BOARD_KEY, queryFn: fetchDailyBoard });
  const [now, setNow] = useState(() => new Date());
  const [view, setView] = useState<"crew" | "dispatch">(initialView);
  const [preview, setPreview] = useState<BoardRole | null>(null);
  const [selectedCrewId, setSelectedCrewId] = useState<number | null>(null);
  const [optimizing, setOptimizing] = useState(false);
  const [callbackOpen, setCallbackOpen] = useState(false);
  const [callbackCrewId, setCallbackCrewId] = useState<string>("");
  const [deduction, setDeduction] = useState("35");
  const [callbackName, setCallbackName] = useState("");
  const [callbackAddress, setCallbackAddress] = useState("");

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 15_000);
    return () => clearInterval(timer);
  }, []);

  const board = boardQuery.data;
  const role: BoardRole = board && board.capabilities.simulateRole && preview ? preview : board?.viewer.boardRole ?? "crew";
  const caps = capabilitiesFor(role);
  const shownCrews = useMemo((): RouteCrew[] => board ? visibleCrews({
    role,
    viewerId: board.viewer.userId,
    realRole: board.viewer.boardRole,
    crews: board.crews,
    myCrewIds: board.myCrewIds,
    managers: board.managers,
  }) : [], [board, role]);
  const unassigned = role === "crew" || !board ? [] : board.unassigned;
  const viewShown = caps.switchViews ? view : "crew";

  useEffect(() => {
    if (!shownCrews.some(crew => crew.id === selectedCrewId)) setSelectedCrewId(shownCrews[0]?.id ?? null);
  }, [shownCrews, selectedCrewId]);

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: BOARD_KEY });
  }

  async function changeJob(id: number, body: Record<string, unknown>) {
    try {
      await updateRouteJob(id, body);
      await refresh();
    } catch (error) {
      toast.error(errorText(error));
    }
  }

  async function runOptimize(crew: RouteCrew, shop: DailyBoard["shop"], date: string) {
    setOptimizing(true);
    try {
      const result = await optimizeRoute({
        origin: shop,
        destination: shop,
        crewId: crew.id,
        date,
        stops: crew.jobs.map(stopPayload),
      });
      const saved = Math.max(0, Math.round(result.previousDurationMinutes - result.totalDurationMinutes));
      const finish = new Date(Date.now() + remainingWorkMinutes(crew.jobs, result.legs, new Date()) * 60_000);
      toast.success(`Route optimized • Saved ${saved} mins — New ETA: ${formatEta(finish)}`);
      await refresh();
    } catch (error) {
      toast.error(errorText(error));
    } finally {
      setOptimizing(false);
    }
  }

  async function runOptimizeAll(current: DailyBoard) {
    setOptimizing(true);
    try {
      const { routes } = await optimizeAllRoutes();
      const saved = Math.round(routes.reduce((sum: number, route: OptimizeResponse) => sum + Math.max(0, route.previousDurationMinutes - route.totalDurationMinutes), 0));
      const first = routes[0];
      const crew = current.crews.find(item => item.id === first?.crewId) ?? shownCrews[0];
      const finish = crew && first
        ? new Date(Date.now() + remainingWorkMinutes(crew.jobs, first.legs, new Date()) * 60_000)
        : new Date();
      toast.success(`Route optimized • Saved ${saved} mins — New ETA: ${formatEta(finish)}`);
      await refresh();
    } catch (error) {
      toast.error(errorText(error));
    } finally {
      setOptimizing(false);
    }
  }

  if (boardQuery.isLoading) return <p className="text-muted-foreground">Loading today’s route…</p>;
  if (boardQuery.isError || !board) return <p className="text-destructive">{errorText(boardQuery.error)}</p>;

  const selected = shownCrews.find(crew => crew.id === selectedCrewId) ?? shownCrews[0] ?? null;
  const dispatchCrews = shownCrews.filter(crew => crew.id !== 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{viewShown === "dispatch" ? "Dispatch" : "Crew schedule"}</h1>
          <p className="text-sm text-muted-foreground">{board.date}</p>
        </div>
        {board.capabilities.simulateRole && (
          <label className="text-sm">
            <span className="mr-2 text-muted-foreground">Preview as</span>
            <select
              className="h-10 rounded-md border bg-background px-2"
              data-testid="role-simulator"
              value={preview ?? board.viewer.boardRole}
              onChange={event => {
                const next = event.target.value as BoardRole;
                setPreview(next === board.viewer.boardRole ? null : next);
                if (next === "crew") setView("crew");
              }}
            >
              <option value="crew">Crew</option>
              <option value="manager">Manager</option>
              <option value="office">Office admin</option>
              <option value="owner">Owner</option>
            </select>
          </label>
        )}
      </div>

      {caps.switchViews && (
        <div className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1" data-testid="view-switcher">
          <button type="button" className={`h-10 rounded-md text-sm font-medium ${viewShown === "crew" ? "bg-background shadow-sm" : ""}`} data-testid="view-crew" onClick={() => setView("crew")}>Crew Schedule View</button>
          <button type="button" className={`h-10 rounded-md text-sm font-medium ${viewShown === "dispatch" ? "bg-background shadow-sm" : ""}`} data-testid="view-dispatch" onClick={() => setView("dispatch")}>Office / Dispatch View</button>
        </div>
      )}

      {viewShown === "crew" && selected && (
        <div className="mx-auto w-full max-w-md space-y-3" data-testid="crew-schedule">
          {caps.switchViews && shownCrews.length > 0 && (
            <label className="block text-sm">
              <span className="text-muted-foreground">Crew</span>
              <select className="mt-1 h-11 w-full rounded-md border bg-background px-2" data-testid="crew-selector" value={selected.id} onChange={event => setSelectedCrewId(Number(event.target.value))}>
                {shownCrews.map(crew => (
                  <option key={crew.id} value={crew.id}>
                    {(crew.memberNames[0] ?? crew.name)} · {crew.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <ScheduleHeader crew={selected} now={now} optimizing={optimizing} onOptimize={() => runOptimize(selected, board.shop, board.date)} />
          {selected.jobs.length === 0 && <p className="text-sm text-muted-foreground">No stops on this route today.</p>}
          {selected.jobs.map(job => {
            const leg = selected.legs.find(item => item.toId === job.id);
            const href = directionsUrl({ address: job.address, city: job.city, state: job.state, zip: job.zip, lat: job.lat, lng: job.lng });
            return (
              <div key={job.id} className="space-y-2">
                {leg && <DrivePill leg={leg} label="Drive to stop" href={href} />}
                <JobCard
                  job={job}
                  now={now}
                  mode="crew"
                  canReorder
                  canReassign={caps.reassign}
                  canLock={caps.lockToggle}
                  canWork
                  crews={dispatchCrews}
                  onChange={changeJob}
                />
              </div>
            );
          })}
          {selected.legs.filter(leg => leg.toId == null).map((leg, index) => (
            <div key={`return-${index}`} className="space-y-1">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Return to shop</p>
              <DrivePill leg={leg} label="Return to shop" href={directionsUrl({ address: board.shop.address, lat: board.shop.lat, lng: board.shop.lng })} />
            </div>
          ))}
        </div>
      )}

      {viewShown === "dispatch" && (
        <div className="space-y-3" data-testid="dispatch-board">
          <div className="flex flex-wrap gap-2">
            {caps.optimizeAll && (
              <Button type="button" data-testid="optimize-all" disabled={optimizing} onClick={() => runOptimizeAll(board)}>Optimize All Visible Routes</Button>
            )}
            {caps.logCallback && (
              <Button type="button" variant="outline" data-testid="log-callback" onClick={() => { setCallbackCrewId(String(dispatchCrews[0]?.id ?? "")); setCallbackOpen(true); }}>Log Callback / Redo</Button>
            )}
          </div>
          <div className="flex gap-3 overflow-x-auto pb-4">
            <DispatchColumn
              title="Unassigned"
              subtitle="No crew"
              jobs={unassigned}
              legs={board.unassignedLegs}
              now={now}
              shop={board.shop}
              crews={dispatchCrews}
              caps={caps}
              testId="unassigned-column"
              onChange={changeJob}
            />
            {dispatchCrews.map(crew => {
              const money = routeMoney(crew.jobs);
              const drive = crew.legs.reduce((sum, leg) => sum + leg.durationMinutes, 0);
              const finish = new Date(now.getTime() + remainingWorkMinutes(crew.jobs, crew.legs, now) * 60_000);
              return (
                <DispatchColumn
                  key={crew.id}
                  title={crew.name}
                  subtitle={`${crew.memberNames[0] ?? "No technician"} · ${crew.managerName ?? "No manager"}`}
                  meta={`${crew.jobs.length} jobs · Back at shop ${formatEta(finish)} · ${formatMoney(money.net)} · ${formatHourly(projectedHourly(money.net, money.jobMinutes, drive))}`}
                  jobs={crew.jobs}
                  legs={crew.legs}
                  now={now}
                  shop={board.shop}
                  crews={dispatchCrews}
                  caps={caps}
                  testId={`crew-column-${crew.id}`}
                  onChange={changeJob}
                />
              );
            })}
          </div>
        </div>
      )}

      <Dialog open={callbackOpen} onOpenChange={setCallbackOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Log Callback / Redo</DialogTitle></DialogHeader>
          <form className="space-y-3" onSubmit={async event => {
            event.preventDefault();
            try {
              await logRouteCallback({
                crewId: Number(callbackCrewId),
                deductionAmount: Number(deduction),
                customerName: callbackName,
                address: callbackAddress,
              });
              setCallbackOpen(false);
              toast.success("Callback added to the route");
              await refresh();
            } catch (error) {
              toast.error(errorText(error));
            }
          }}>
            <label className="block text-sm">Crew
              <select className="mt-1 h-10 w-full rounded-md border bg-background px-2" data-testid="callback-crew" value={callbackCrewId} onChange={event => setCallbackCrewId(event.target.value)}>
                {dispatchCrews.map(crew => <option key={crew.id} value={crew.id}>{crew.name}</option>)}
              </select>
            </label>
            <label className="block text-sm">Deduction amount
              <input className="mt-1 h-10 w-full rounded-md border bg-background px-2" data-testid="callback-deduction" inputMode="decimal" value={deduction} onChange={event => setDeduction(event.target.value)} />
            </label>
            <label className="block text-sm">Customer
              <input className="mt-1 h-10 w-full rounded-md border bg-background px-2" value={callbackName} onChange={event => setCallbackName(event.target.value)} />
            </label>
            <label className="block text-sm">Address
              <input className="mt-1 h-10 w-full rounded-md border bg-background px-2" value={callbackAddress} onChange={event => setCallbackAddress(event.target.value)} />
            </label>
            <Button type="submit" data-testid="callback-save">Add to route</Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function DispatchColumn({
  title,
  subtitle,
  meta,
  jobs,
  legs,
  now,
  shop,
  crews,
  caps,
  testId,
  onChange,
}: {
  title: string;
  subtitle: string;
  meta?: string;
  jobs: RouteJob[];
  legs: RouteLeg[];
  now: Date;
  shop: DailyBoard["shop"];
  crews: RouteCrew[];
  caps: ReturnType<typeof capabilitiesFor>;
  testId: string;
  onChange: (id: number, body: Record<string, unknown>) => Promise<void>;
}) {
  return (
    <section className="w-72 shrink-0 space-y-2" data-testid={testId}>
      <div className="rounded-xl border bg-muted/40 p-3">
        <p className="font-semibold">{title}</p>
        <p className="text-xs text-muted-foreground">{subtitle}</p>
        {meta && <p className="mt-1 text-xs">{meta}</p>}
      </div>
      {jobs.map(job => {
        const leg = legs.find(item => item.toId === job.id);
        return (
          <div key={job.id} className="space-y-2">
            {leg && <DrivePill leg={leg} label="Drive to stop" href={directionsUrl({ address: job.address, city: job.city, state: job.state, zip: job.zip, lat: job.lat, lng: job.lng })} />}
            <JobCard job={job} now={now} mode="dispatch" canReorder canReassign={caps.reassign} canLock={caps.lockToggle} canWork={false} crews={crews} onChange={onChange} />
          </div>
        );
      })}
      {legs.filter(leg => leg.toId == null).map((leg, index) => (
        <div key={`return-${index}`} className="space-y-1">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Return to shop</p>
          <DrivePill leg={leg} label="Return to shop" href={directionsUrl({ address: shop.address, lat: shop.lat, lng: shop.lng })} />
        </div>
      ))}
    </section>
  );
}
