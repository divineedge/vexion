import { useMemo, useState } from 'react';
import { ChevronRight, Trophy, AlertTriangle } from 'lucide-react';

export interface LeaderCrew {
  crewId: number;
  name: string;
  budgetMinutes: number;
  jobSeconds: number;
  budgetJobSeconds?: number;
  completedJobs: number;
  callbacks: number;
  callbackRatio: number;
  budgetEfficiency: number | null;
}

type SortKey = 'budget' | 'pace' | 'jobs' | 'quality';

function effColor(rate: number | null) {
  if (rate == null) return '#6B7280';
  return rate >= 100 ? '#10B981' : rate >= 80 ? '#F59E0B' : '#EF4444';
}

function fmtMin(m: number) {
  const h = Math.floor(m / 60);
  const min = Math.round(m % 60);
  return h > 0 ? `${h}h ${min}m` : `${min}m`;
}

/** Jobs completed per actual job-hour. */
function pace(c: LeaderCrew): number | null {
  return c.jobSeconds > 0 ? Math.round((c.completedJobs / (c.jobSeconds / 3600)) * 100) / 100 : null;
}

function cmpNullsLast(a: number | null, b: number | null, dir: 1 | -1) {
  if ((a == null) !== (b == null)) return a == null ? 1 : -1;
  return ((b ?? 0) - (a ?? 0)) * dir;
}

export function CrewLeaderboard({
  crews, cbThreshold, onOpen,
}: {
  crews: LeaderCrew[];
  cbThreshold: number;
  onOpen: (crew: LeaderCrew) => void;
}) {
  const [sort, setSort] = useState<SortKey>('budget');

  const ranked = useMemo(() => [...crews].sort((a, b) => {
    let r = 0;
    if (sort === 'budget') r = cmpNullsLast(a.budgetEfficiency, b.budgetEfficiency, 1);
    else if (sort === 'pace') r = cmpNullsLast(pace(a), pace(b), 1);
    else if (sort === 'jobs') r = b.completedJobs - a.completedJobs;
    else r = a.completedJobs === 0 !== (b.completedJobs === 0) ? (a.completedJobs === 0 ? 1 : -1) : a.callbackRatio - b.callbackRatio;
    if (r !== 0) return r;
    // tiebreakers: fewer callbacks, then more jobs
    return a.callbackRatio - b.callbackRatio || b.completedJobs - a.completedJobs;
  }), [crews, sort]);

  // Team-wide reference values (aggregate, not per-person)
  const teamBudget = crews.reduce((s, c) => s + c.budgetMinutes, 0);
  const teamActual = crews.reduce((s, c) => s + (c.budgetJobSeconds ?? c.jobSeconds), 0) / 60;
  const teamEff = teamBudget > 0 && teamActual > 0 ? Math.round((teamBudget / teamActual) * 100) : null;
  const teamJobs = crews.reduce((s, c) => s + c.completedJobs, 0);
  const teamCb = crews.reduce((s, c) => s + c.callbacks, 0);
  const teamCbRatio = teamJobs > 0 ? Math.round((teamCb / teamJobs) * 1000) / 10 : 0;
  const maxEff = Math.max(150, ...crews.map(c => c.budgetEfficiency ?? 0));

  const podium = ranked.slice(0, Math.min(3, ranked.length));

  const sorts: { key: SortKey; label: string }[] = [
    { key: 'budget', label: 'Budget Eff.' },
    { key: 'pace', label: 'Jobs / Hour' },
    { key: 'jobs', label: 'Jobs Done' },
    { key: 'quality', label: 'Fewest Slips' },
  ];

  const metricFor = (c: LeaderCrew) => {
    if (sort === 'pace') { const p = pace(c); return p != null ? `${p}/h` : '—'; }
    if (sort === 'jobs') return String(c.completedJobs);
    if (sort === 'quality') return `${c.callbackRatio}%`;
    return c.budgetEfficiency != null ? `${c.budgetEfficiency}%` : '—';
  };

  return (
    <div className="space-y-4">
      {/* Team strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-px rounded-xl overflow-hidden border bg-border">
        {[
          { l: 'Team budget eff.', v: teamEff != null ? `${teamEff}%` : '—', c: effColor(teamEff) },
          { l: 'Crews ranked', v: String(crews.length) },
          { l: 'Jobs completed', v: String(teamJobs) },
          { l: 'Team slip rate', v: `${teamCbRatio}%`, c: teamCbRatio > cbThreshold ? 'hsl(var(--destructive))' : undefined },
        ].map(s => (
          <div key={s.l} className="bg-card px-4 py-3">
            <p className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground font-semibold">{s.l}</p>
            <p className="text-xl font-bold tabular-nums mt-0.5" style={s.c ? { color: s.c } : undefined}>{s.v}</p>
          </div>
        ))}
      </div>

      {/* Sort */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-muted-foreground">Rank by:</span>
        {sorts.map(s => (
          <button
            key={s.key}
            onClick={() => setSort(s.key)}
            data-testid={`button-crew-sort-${s.key}`}
            className={`px-2.5 py-1 rounded-full border text-xs transition-colors ${sort === s.key ? 'bg-primary text-primary-foreground border-primary' : 'border-border hover:bg-muted'}`}
          >
            {s.label}
          </button>
        ))}
      </div>

      {/* Podium */}
      {podium.length > 1 && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
          {[podium[1], podium[0], podium[2]].map((c, slot) => {
            if (!c) return <div key={`empty-${slot}`} className="hidden sm:block" />;
            const rank = ranked.indexOf(c) + 1;
            const heights = { 1: 'sm:pt-8', 2: 'sm:pt-5', 3: 'sm:pt-3' } as Record<number, string>;
            const ring = rank === 1 ? 'border-amber-400/70 bg-amber-50/60 dark:bg-amber-950/20' : 'bg-card';
            return (
              <button
                key={c.crewId}
                onClick={() => onOpen(c)}
                data-testid={`button-podium-crew-${c.crewId}`}
                className={`text-left rounded-xl border p-4 ${heights[rank]} ${ring} hover:shadow-md transition-shadow ${rank === 1 ? 'order-first sm:order-none' : ''}`}
              >
                <div className="flex items-center justify-between">
                  <span className={`text-3xl font-black tabular-nums ${rank === 1 ? 'text-amber-500' : 'text-muted-foreground/60'}`}>{rank}</span>
                  {rank === 1 && <Trophy className="w-5 h-5 text-amber-500" />}
                </div>
                <p className="font-semibold text-sm mt-2 truncate">{c.name}</p>
                <p className="text-2xl font-bold tabular-nums mt-1" style={{ color: sort === 'budget' ? effColor(c.budgetEfficiency) : undefined }}>
                  {metricFor(c)}
                </p>
                <p className="text-[11px] text-muted-foreground mt-1">
                  {c.completedJobs} jobs · {c.callbacks} slips · {fmtMin(c.jobSeconds / 60)}
                </p>
              </button>
            );
          })}
        </div>
      )}

      {/* Full ranking */}
      <div className="rounded-xl border bg-card overflow-hidden">
        <div className="hidden md:grid grid-cols-[48px_1.4fr_2fr_80px_80px_96px_28px] gap-3 px-4 py-2.5 border-b text-[10px] uppercase tracking-[0.12em] text-muted-foreground font-semibold">
          <span>Rank</span><span>Crew</span><span>Budget efficiency vs team</span>
          <span className="text-right">Jobs</span><span className="text-right">Jobs/h</span><span className="text-right">Slip rate</span><span />
        </div>
        <div className="divide-y">
          {ranked.map((c, i) => {
            const eff = c.budgetEfficiency;
            const delta = eff != null && teamEff != null ? eff - teamEff : null;
            const p = pace(c);
            const cbBad = c.callbackRatio > cbThreshold;
            return (
              <button
                key={c.crewId}
                onClick={() => onOpen(c)}
                data-testid={`row-crew-rank-${c.crewId}`}
                className="w-full text-left grid grid-cols-[40px_1fr_28px] md:grid-cols-[48px_1.4fr_2fr_80px_80px_96px_28px] gap-3 items-center px-4 py-3 hover:bg-muted/40 transition-colors group"
              >
                <span className={`text-lg font-black tabular-nums ${i === 0 ? 'text-amber-500' : 'text-muted-foreground/70'}`}>{i + 1}</span>
                <div className="min-w-0">
                  <p className="font-semibold text-sm truncate">{c.name}</p>
                  <p className="text-[11px] text-muted-foreground md:hidden">
                    {eff != null ? `${eff}%` : '—'} · {c.completedJobs} jobs · {p != null ? `${p}/h` : '—'} · {c.callbackRatio}% slips
                  </p>
                  <p className="text-[11px] text-muted-foreground hidden md:block">
                    {fmtMin(c.budgetMinutes)} budget · {fmtMin(c.jobSeconds / 60)} actual
                  </p>
                </div>
                <div className="hidden md:flex items-center gap-2">
                  <div className="relative flex-1 h-2 bg-muted rounded-full">
                    <div className="absolute inset-y-0 left-0 rounded-full transition-all" style={{ width: `${Math.min(((eff ?? 0) / maxEff) * 100, 100)}%`, background: effColor(eff) }} />
                    <div className="absolute -top-1 -bottom-1 w-px bg-foreground/40" style={{ left: `${(100 / maxEff) * 100}%` }} title="100% on budget" />
                    {teamEff != null && (
                      <div className="absolute -top-1.5 -bottom-1.5 w-0.5 bg-primary rounded" style={{ left: `${Math.min((teamEff / maxEff) * 100, 100)}%` }} title={`Team ${teamEff}%`} />
                    )}
                  </div>
                  <span className="text-sm font-bold tabular-nums w-12 text-right" style={{ color: effColor(eff) }}>{eff != null ? `${eff}%` : '—'}</span>
                  <span className={`text-[11px] tabular-nums w-11 text-right ${delta == null ? 'text-muted-foreground' : delta >= 0 ? 'text-emerald-600' : 'text-destructive'}`}>
                    {delta == null ? '' : `${delta >= 0 ? '+' : ''}${delta}`}
                  </span>
                </div>
                <span className="hidden md:block text-right text-sm tabular-nums">{c.completedJobs}</span>
                <span className="hidden md:block text-right text-sm tabular-nums">{p != null ? p : '—'}</span>
                <span className={`hidden md:flex items-center justify-end gap-1 text-sm tabular-nums ${cbBad ? 'text-destructive font-medium' : ''}`}>
                  {cbBad && <AlertTriangle className="w-3 h-3" />}{c.callbackRatio}%
                </span>
                <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-primary justify-self-end" />
              </button>
            );
          })}
        </div>
      </div>
      <p className="text-[11px] text-muted-foreground">
        Ranked on crew totals only. Jobs/h = completed jobs per actual job-hour. Blue marker = team average, thin line = 100% on budget. Click a crew to see its jobs. No pay or payroll figures are shown.
      </p>
    </div>
  );
}
