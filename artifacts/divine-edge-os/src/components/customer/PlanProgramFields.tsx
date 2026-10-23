import type { ReactNode } from 'react';
import type { Crew, RouteTemplate, CustomerPlan, PlanTemplateServiceRule } from '@workspace/api-client-react';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Users, Route as RouteIcon, Layers, FlaskConical, Bell, Link2 } from 'lucide-react';
import { WEEKDAYS, formatDateKey } from './PlanVisitScheduleFields';

export interface ProgramConfig {
  crewId: string;
  perServiceCrews: boolean;
  serviceCrews: Record<number, string>;
  addToRoute: boolean;
  routeTemplateId: string;
  alignEnabled: boolean;
  alignPlanId: string;
  roundMode: 'cycle' | 'custom';
  visitServices: Record<number, number[]>;
  chemicalServiceIds: number[];
  emailReminder: boolean;
  smsReminder: boolean;
  pushReminder: boolean;
}

export const DEFAULT_PROGRAM: ProgramConfig = {
  crewId: '', perServiceCrews: false, serviceCrews: {}, addToRoute: false, routeTemplateId: '',
  alignEnabled: false, alignPlanId: '', roundMode: 'cycle', visitServices: {}, chemicalServiceIds: [],
  emailReminder: true, smsReminder: false, pushReminder: false,
};

const MAX_ROUND_ROWS = 52;

function Section({ icon: Icon, title, children }: { icon: typeof Users; title: string; children: ReactNode }) {
  return (
    <div className="space-y-2 rounded-md border p-3">
      <p className="text-sm font-medium flex items-center gap-1.5"><Icon className="w-3.5 h-3.5 text-muted-foreground" />{title}</p>
      {children}
    </div>
  );
}

function Check({ checked, onChange, label, testId, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; testId: string; hint?: string }) {
  return (
    <label className="flex items-start gap-2 text-sm cursor-pointer">
      <Checkbox checked={checked} onCheckedChange={v => onChange(v === true)} data-testid={testId} className="mt-0.5" />
      <span>{label}{hint && <span className="block text-xs text-muted-foreground">{hint}</span>}</span>
    </label>
  );
}

export function PlanProgramFields({ value, onChange, services, crews, routes, alignCandidates, totalVisits }: {
  value: ProgramConfig;
  onChange: (v: ProgramConfig) => void;
  services: PlanTemplateServiceRule[];
  crews: Crew[];
  routes: RouteTemplate[];
  alignCandidates: CustomerPlan[];
  totalVisits: number;
}) {
  const set = (patch: Partial<ProgramConfig>) => onChange({ ...value, ...patch });
  const rounds = Math.min(Number.isFinite(totalVisits) ? totalVisits : 0, MAX_ROUND_ROWS);
  const selectedRoute = routes.find(r => String(r.id) === value.routeTemplateId);

  const toggleRoundService = (round: number, serviceId: number) => {
    const cur = value.visitServices[round] ?? services.map(s => s.serviceId);
    const next = cur.includes(serviceId) ? cur.filter(id => id !== serviceId) : [...cur, serviceId];
    set({ visitServices: { ...value.visitServices, [round]: next } });
  };

  return (
    <div className="space-y-3" data-testid="panel-program-config">
      <Section icon={Link2} title="Existing program">
        <Check
          checked={value.alignEnabled}
          onChange={v => set({ alignEnabled: v, alignPlanId: v ? value.alignPlanId : '' })}
          label="Join the remaining rounds of an existing plan"
          hint="Leave unchecked to keep this plan's own dates."
          testId="checkbox-align-plan"
        />
        {value.alignEnabled && (
          alignCandidates.length === 0 ? (
            <p className="text-xs text-muted-foreground">No other active plans use this template yet.</p>
          ) : (
            <>
              <Select value={value.alignPlanId} onValueChange={v => set({ alignPlanId: v })}>
                <SelectTrigger data-testid="select-align-plan"><SelectValue placeholder="Choose a plan to align with" /></SelectTrigger>
                <SelectContent>
                  {alignCandidates.map(p => (
                    <SelectItem key={p.id} value={String(p.id)}>
                      {p.customerName ?? `Customer #${p.customerId}`} — {p.propertyAddress ?? `Property #${p.propertyId}`}
                      {p.visitSchedule ? ` (${formatDateKey(p.visitSchedule.firstServiceDate, { month: 'short', day: 'numeric' })}–${formatDateKey(p.visitSchedule.lastServiceDate, { month: 'short', day: 'numeric' })})` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">Only rounds still ahead are booked. Past rounds are skipped, nothing is prorated, and the preview shows how many rounds remain.</p>
            </>
          )
        )}
      </Section>

      <Section icon={Users} title="Crew">
        <Select value={value.crewId || 'none'} onValueChange={v => set({ crewId: v === 'none' ? '' : v })}>
          <SelectTrigger data-testid="select-plan-crew"><SelectValue placeholder="No crew" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="none">No default crew</SelectItem>
            {crews.map(c => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">One crew handles the whole plan by default.</p>
        {services.length > 1 && (
          <Check checked={value.perServiceCrews} onChange={v => set({ perServiceCrews: v })} label="Assign different crews to specific services" testId="checkbox-service-crews"
            hint="Services on the same crew share one job per round. Different crews get separate jobs on the same date." />
        )}
        {value.perServiceCrews && services.length > 1 && (
          <div className="space-y-1.5">
            {services.map(s => (
              <div key={s.serviceId} className="grid grid-cols-2 gap-2 items-center text-sm">
                <span className="truncate" title={s.serviceName}>{s.serviceName}</span>
                <Select value={value.serviceCrews[s.serviceId] || 'default'} onValueChange={v => set({ serviceCrews: { ...value.serviceCrews, [s.serviceId]: v === 'default' ? '' : v } })}>
                  <SelectTrigger className="h-8" data-testid={`select-service-crew-${s.serviceId}`}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="default">Plan crew</SelectItem>
                    {crews.map(c => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section icon={RouteIcon} title="Route">
        <Check checked={value.addToRoute} onChange={v => set({ addToRoute: v, routeTemplateId: v ? value.routeTemplateId : '' })} label="Add these visits to an existing plan route?" testId="checkbox-add-route" />
        {value.addToRoute && (
          <>
            <Select value={value.routeTemplateId} onValueChange={v => set({ routeTemplateId: v })}>
              <SelectTrigger data-testid="select-route-template"><SelectValue placeholder="Choose a route" /></SelectTrigger>
              <SelectContent>
                {routes.map(r => <SelectItem key={r.id} value={String(r.id)}>{r.name}</SelectItem>)}
              </SelectContent>
            </Select>
            {selectedRoute && (
              <div className="flex flex-wrap gap-1.5 text-xs" data-testid="text-route-meta">
                <Badge variant="outline">{WEEKDAYS[selectedRoute.dayOfWeek]}</Badge>
                <Badge variant="outline" className="capitalize">{selectedRoute.frequency.replace(/_/g, ' ')}</Badge>
                {selectedRoute.divisionName && <Badge variant="outline">{selectedRoute.divisionName}</Badge>}
                {selectedRoute.offSeasonStart && selectedRoute.offSeasonEnd && <Badge variant="outline">Off-season {selectedRoute.offSeasonStart} – {selectedRoute.offSeasonEnd}</Badge>}
              </div>
            )}
            <p className="text-xs text-muted-foreground">Stops are appended; reorder or optimize on the Routes screen.</p>
          </>
        )}
      </Section>

      {services.length > 1 && (
        <Section icon={Layers} title="Services per round">
          <div className="grid grid-cols-2 gap-2">
            {([['cycle', 'Take turns', 'One service per round, in order'], ['custom', 'Choose per round', 'Tick services for each round']] as const).map(([v, t, sub]) => (
              <button key={v} type="button" onClick={() => set({ roundMode: v })} data-testid={`button-round-mode-${v}`}
                className={`text-left rounded-md border px-3 py-2 transition-colors ${value.roundMode === v ? 'border-primary bg-primary/5' : 'hover:border-primary/40'}`}>
                <p className="text-sm font-medium">{t}</p>
                <p className="text-xs text-muted-foreground">{sub}</p>
              </button>
            ))}
          </div>
          {value.roundMode === 'custom' && (
            <div className="max-h-56 overflow-y-auto rounded border divide-y">
              {Array.from({ length: rounds }, (_, i) => i + 1).map(round => {
                const chosen = value.visitServices[round] ?? services.map(s => s.serviceId);
                return (
                  <div key={round} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-2 py-1.5 text-xs">
                    <span className="w-14 font-medium text-muted-foreground">Round {round}</span>
                    {services.map(s => (
                      <label key={s.serviceId} className="flex items-center gap-1 cursor-pointer">
                        <Checkbox checked={chosen.includes(s.serviceId)} onCheckedChange={() => toggleRoundService(round, s.serviceId)} data-testid={`checkbox-round-${round}-service-${s.serviceId}`} />
                        {s.serviceName}
                      </label>
                    ))}
                  </div>
                );
              })}
            </div>
          )}
          {value.roundMode === 'custom' && totalVisits > MAX_ROUND_ROWS && <p className="text-xs text-muted-foreground">Rounds after {MAX_ROUND_ROWS} include every service.</p>}
        </Section>
      )}

      {services.length > 0 && (
        <Section icon={FlaskConical} title="Required chemical application">
          {services.map(s => (
            <Check key={s.serviceId} checked={value.chemicalServiceIds.includes(s.serviceId)}
              onChange={v => set({ chemicalServiceIds: v ? [...value.chemicalServiceIds, s.serviceId] : value.chemicalServiceIds.filter(id => id !== s.serviceId) })}
              label={`Require a chemical application record for ${s.serviceName}`} testId={`checkbox-chemical-${s.serviceId}`} />
          ))}
          <p className="text-xs text-muted-foreground">Each visit with a ticked service cannot be completed until a separate chemical application record is logged for that service.</p>
        </Section>
      )}

      <Section icon={Bell} title="Visit reminders">
        <div className="flex flex-wrap gap-4">
          <Check checked={value.emailReminder} onChange={v => set({ emailReminder: v })} label="Email" testId="checkbox-reminder-email" />
          <Check checked={value.smsReminder} onChange={v => set({ smsReminder: v })} label="SMS" testId="checkbox-reminder-sms" />
          <Check checked={value.pushReminder} onChange={v => set({ pushReminder: v })} label="Push" testId="checkbox-reminder-push" />
        </div>
        <p className="text-xs text-muted-foreground">Sent 7 days and 24 hours before each visit. Customer opt-outs always win; push only reaches customers who enabled it on a device in the portal.</p>
      </Section>
    </div>
  );
}

/** Build the optional visitSchedule fields for the API from the form. */
export function programToSchedule(p: ProgramConfig, services: PlanTemplateServiceRule[], totalVisits: number) {
  const out: {
    alignToPlanId?: number; defaultCrewId?: number; routeTemplateId?: number;
    visitServices?: { visitNumber: number; serviceIds: number[] }[];
    serviceCrews?: { serviceId: number; crewId: number }[];
    chemicalServiceIds?: number[]; emailReminder: boolean; smsReminder: boolean; pushReminder: boolean;
  } = { emailReminder: p.emailReminder, smsReminder: p.smsReminder, pushReminder: p.pushReminder };
  if (p.alignEnabled && p.alignPlanId) out.alignToPlanId = Number(p.alignPlanId);
  if (p.crewId) out.defaultCrewId = Number(p.crewId);
  if (p.addToRoute && p.routeTemplateId) out.routeTemplateId = Number(p.routeTemplateId);
  if (p.perServiceCrews) {
    const sc = services.filter(s => p.serviceCrews[s.serviceId]).map(s => ({ serviceId: s.serviceId, crewId: Number(p.serviceCrews[s.serviceId]) }));
    if (sc.length) out.serviceCrews = sc;
  }
  if (p.roundMode === 'custom' && services.length > 1) {
    const n = Math.max(0, Math.min(Number.isFinite(totalVisits) ? totalVisits : 0, 366));
    out.visitServices = Array.from({ length: n }, (_, i) => ({ visitNumber: i + 1, serviceIds: p.visitServices[i + 1] ?? services.map(s => s.serviceId) }));
  }
  const chem = p.chemicalServiceIds.filter(id => services.some(s => s.serviceId === id));
  if (chem.length) out.chemicalServiceIds = chem;
  return out;
}

/** Problems that block preview. */
export function programProblems(p: ProgramConfig, totalVisits: number): string | null {
  if (p.alignEnabled && !p.alignPlanId) return 'Choose the plan to align with, or untick it.';
  if (p.addToRoute && !p.routeTemplateId) return 'Choose a route, or untick "Add these visits to an existing plan route?".';
  if (p.roundMode === 'custom') {
    const n = Math.min(Number.isFinite(totalVisits) ? totalVisits : 0, MAX_ROUND_ROWS);
    for (let r = 1; r <= n; r++) if (p.visitServices[r] && p.visitServices[r].length === 0) return `Round ${r} has no services ticked.`;
  }
  return null;
}
