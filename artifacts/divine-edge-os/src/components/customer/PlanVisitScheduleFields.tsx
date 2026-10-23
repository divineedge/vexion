import type { PlanVisitSchedule } from '@workspace/api-client-react';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { CalendarRange } from 'lucide-react';

export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Days between two YYYY-MM-DD keys, computed in UTC so device timezone never shifts it. */
export function daysBetweenKeys(a: string, b: string): number {
  const pa = a.split('-').map(Number); const pb = b.split('-').map(Number);
  return Math.round((Date.UTC(pb[0], pb[1] - 1, pb[2]) - Date.UTC(pa[0], pa[1] - 1, pa[2])) / 86400000);
}

export function addMonthsToKey(key: string, months: number): string {
  const [y, m, d] = key.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1 + months, d));
  return dt.toISOString().slice(0, 10);
}

/** Format a date key (or ISO timestamp) as a label without device-timezone shifting. */
export function formatDateKey(value: string, opts: Intl.DateTimeFormatOptions = { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }, timeZone?: string | null): string {
  // ISO timestamps: format the instant in the company time zone when provided.
  if (value.length > 10 && value.includes('T')) {
    const dt = new Date(value);
    if (!Number.isNaN(dt.getTime())) {
      try {
        return dt.toLocaleDateString(undefined, timeZone ? { ...opts, timeZone } : opts);
      } catch {
        return dt.toLocaleDateString(undefined, opts);
      }
    }
  }
  // YYYY-MM-DD keys: label in UTC so the day never shifts.
  const key = value.slice(0, 10);
  const [y, m, d] = key.split('-').map(Number);
  if (!y || !m || !d) return value;
  return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString(undefined, { ...opts, timeZone: 'UTC' });
}

export function weekdayOfKey(key: string): number {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

const fmt = (n: number) => (Math.round(n * 100) / 100).toString();

export function spacingSummary(s: PlanVisitSchedule): { text: string; interior: number } | null {
  if (!s.firstServiceDate || !s.lastServiceDate || !(s.totalVisits >= 2)) return null;
  const span = daysBetweenKeys(s.firstServiceDate, s.lastServiceDate);
  if (span <= 0) return null;
  const gaps = s.totalVisits - 1;
  const days = span / gaps;
  const weeks = days / 7;
  const text = s.spacingUnit === 'weeks'
    ? `${span} days / (${s.totalVisits} − 1) = ${fmt(weeks)} weeks (${fmt(days)} days) between visits`
    : `${span} days / (${s.totalVisits} − 1) = ${fmt(days)} days (${fmt(weeks)} weeks) between visits`;
  return { text, interior: Math.max(0, s.totalVisits - 2) };
}

export function PlanVisitScheduleFields({ value, onChange }: { value: PlanVisitSchedule; onChange: (v: PlanVisitSchedule) => void }) {
  const set = (patch: Partial<PlanVisitSchedule>) => onChange({ ...value, ...patch });
  const summary = spacingSummary(value);
  const span = value.firstServiceDate && value.lastServiceDate ? daysBetweenKeys(value.firstServiceDate, value.lastServiceDate) : 0;
  return (
    <div className="space-y-3 rounded-md border bg-muted/30 p-3" data-testid="panel-visit-schedule">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <label className="text-sm font-medium">First Service</label>
          <Input type="date" data-testid="input-first-service" value={value.firstServiceDate} onChange={e => set({ firstServiceDate: e.target.value })} />
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-medium">Last Service</label>
          <Input type="date" data-testid="input-last-service" value={value.lastServiceDate} min={value.firstServiceDate || undefined} onChange={e => set({ lastServiceDate: e.target.value })} />
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-medium">Total Services</label>
          <Input type="number" min={2} max={366} step={1} data-testid="input-total-visits" value={Number.isFinite(value.totalVisits) ? value.totalVisits : ''} onChange={e => set({ totalVisits: e.target.value === '' ? NaN : Math.trunc(Number(e.target.value)) })} />
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-medium">Preferred Weekday</label>
          <Select value={String(value.preferredWeekday)} onValueChange={v => set({ preferredWeekday: Number(v) })}>
            <SelectTrigger data-testid="select-preferred-weekday"><SelectValue /></SelectTrigger>
            <SelectContent>{WEEKDAYS.map((w, i) => <SelectItem key={w} value={String(i)}>{w}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <label className="text-sm font-medium">Show spacing in</label>
          <Select value={value.spacingUnit} onValueChange={v => set({ spacingUnit: v as PlanVisitSchedule['spacingUnit'] })}>
            <SelectTrigger data-testid="select-spacing-unit"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="weeks">Weeks</SelectItem>
              <SelectItem value="days">Days</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      {summary ? (
        <div className="flex items-start gap-2 text-xs text-muted-foreground" data-testid="text-spacing-summary">
          <CalendarRange className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <div className="space-y-1">
            <p className="font-medium text-foreground">{summary.text}</p>
            <p>First and last dates are fixed exactly. {summary.interior} interior visit{summary.interior === 1 ? '' : 's'} land at even points between them, each moved to the nearest {WEEKDAYS[value.preferredWeekday]} inside the range (ties go later). Services in the template take turns in order.</p>
          </div>
        </div>
      ) : (
        <p className="text-xs text-destructive">
          {span <= 0 && value.firstServiceDate && value.lastServiceDate ? 'Last service must be after first service.' : 'Enter first and last dates and at least 2 total services.'}
        </p>
      )}
      <p className="text-xs text-muted-foreground border-t pt-2">
        These visit dates do not change billing. Price, billing cycle and auto-renew stay as set, and the visit range does not restart when billing renews.
      </p>
    </div>
  );
}
