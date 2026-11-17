import React, { useEffect, useMemo, useState } from 'react';
import { customFetch, useListUsers, getListUsersQueryKey } from '@workspace/api-client-react';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Download, Printer, RefreshCw } from 'lucide-react';
import { downloadCsv } from '@/lib/csvExport';

interface ClockedRow {
  key: string;
  name: string;
  kind: 'service' | 'task';
  minutes: number;
  hoursLabel: string;
  decimalHours: number;
  percentOfTotal: number;
  budgetedHours: number | null;
  varianceHours: number | null;
  laborCost: number;
}

interface ClockedEmployee {
  userId: number;
  userName: string;
  hourlyRate: number | null;
  minutes: number;
  hoursLabel: string;
  decimalHours: number;
  percentOfTotal: number;
  laborCost: number;
  rows: ClockedRow[];
}

interface ClockedReport {
  start: string;
  end: string;
  generatedAt?: string;
  totalHoursLabel: string;
  totalDecimalHours: number;
  totalLaborCost: number;
  services: ClockedRow[];
  tasks: ClockedRow[];
  employees: ClockedEmployee[];
}

type Preset = 'today' | 'week' | 'month' | 'custom';

function localDate(date = new Date()): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

function rangeFor(preset: Preset): { start: string; end: string } {
  const today = new Date();
  const end = localDate(today);
  if (preset === 'week') {
    const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const delta = start.getDay() === 0 ? 6 : start.getDay() - 1;
    start.setDate(start.getDate() - delta);
    return { start: localDate(start), end };
  }
  if (preset === 'month') return { start: localDate(new Date(today.getFullYear(), today.getMonth(), 1)), end };
  return { start: end, end };
}

function money(n: number) {
  return `$${(n ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function hours(n: number) {
  return `${n.toFixed(2)} hrs`;
}

function variance(n: number | null) {
  if (n == null) return '—';
  const sign = n > 0 ? '+' : '';
  return `${sign}${n.toFixed(2)} hrs`;
}

function ClockedTable({ rows, empty }: { rows: ClockedRow[]; empty: string }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Service / task</TableHead>
          <TableHead className="text-right">Clocked</TableHead>
          <TableHead className="text-right">Decimal</TableHead>
          <TableHead className="text-right">% of time</TableHead>
          <TableHead className="text-right">Budgeted</TableHead>
          <TableHead className="text-right">Variance</TableHead>
          <TableHead className="text-right">Labor cost</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.length === 0 ? (
          <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">{empty}</TableCell></TableRow>
        ) : rows.map(row => (
          <TableRow key={row.key}>
            <TableCell className="font-medium">{row.name}</TableCell>
            <TableCell className="text-right tabular-nums">{row.hoursLabel}</TableCell>
            <TableCell className="text-right tabular-nums">{hours(row.decimalHours)}</TableCell>
            <TableCell className="text-right tabular-nums">{row.percentOfTotal.toFixed(1)}%</TableCell>
            <TableCell className="text-right tabular-nums">{row.budgetedHours == null ? '—' : hours(row.budgetedHours)}</TableCell>
            <TableCell className={`text-right tabular-nums ${row.varianceHours != null && row.varianceHours > 0 ? 'text-amber-700' : ''}`}>{variance(row.varianceHours)}</TableCell>
            <TableCell className="text-right tabular-nums">{money(row.laborCost)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function csvRows(rows: ClockedRow[], employee = '') {
  return rows.map(row => ({
    employee,
    name: row.name,
    kind: row.kind,
    clocked: row.hoursLabel,
    decimalHours: row.decimalHours.toFixed(2),
    percentOfTotal: row.percentOfTotal.toFixed(1),
    budgetedHours: row.budgetedHours == null ? '' : row.budgetedHours.toFixed(2),
    varianceHours: row.varianceHours == null ? '' : row.varianceHours.toFixed(2),
    laborCost: row.laborCost.toFixed(2),
  }));
}

export default function ClockedTimeReport() {
  const [preset, setPreset] = useState<Preset>('today');
  const [range, setRange] = useState(rangeFor('today'));
  const [view, setView] = useState<'company' | 'employee'>('company');
  const [employeeId, setEmployeeId] = useState('all');
  const [data, setData] = useState<ClockedReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const { data: staff = [] } = useListUsers({ query: { queryKey: getListUsersQueryKey() } });

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    customFetch<ClockedReport>(`/api/reports/clocked-time?start=${range.start}&end=${range.end}`)
      .then(report => { if (!cancelled) setData(report); })
      .catch(() => {
        if (!cancelled) {
          setData(null);
          setError('Could not load clocked time for this range.');
          toast.error('Could not load the Clocked Time report');
        }
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [range.start, range.end]);

  const choosePreset = (next: Preset) => {
    setPreset(next);
    if (next !== 'custom') setRange(rangeFor(next));
  };

  const employees = useMemo(() => {
    const fromReport = data?.employees ?? [];
    const known = new Map<number, string>();
    for (const user of staff) known.set(user.id, user.name);
    for (const employee of fromReport) known.set(employee.userId, employee.userName);
    return [...known.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [data, staff]);

  const selected = employeeId === 'all' ? null : data?.employees.find(employee => String(employee.userId) === employeeId) ?? null;
  const companyRows = [...(data?.services ?? []), ...(data?.tasks ?? [])];
  const hasTime = (data?.totalDecimalHours ?? 0) > 0;
  const emptyLabel = error || 'No clocked time in this range.';

  const exportCsv = () => {
    if (!data) return;
    if (view === 'company') {
      downloadCsv(`clocked-time-${data.start}-${data.end}.csv`, csvRows(companyRows));
      return;
    }
    const people = employeeId === 'all' ? data.employees : data.employees.filter(employee => String(employee.userId) === employeeId);
    const rows = people.flatMap(employee => csvRows(employee.rows, employee.userName));
    downloadCsv(`clocked-time-${data.start}-${data.end}.csv`, rows.length ? rows : [{ employee: selected?.userName ?? '', name: 'No clocked time', kind: '', clocked: '0:00', decimalHours: '0.00', percentOfTotal: '0.0', budgetedHours: '', varianceHours: '', laborCost: '0.00' }]);
  };

  return (
    <Card data-testid="clocked-time-report">
      <CardHeader className="flex flex-row items-start justify-between flex-wrap gap-2">
        <div>
          <CardTitle>Clocked Time</CardTitle>
          <CardDescription>
            Job clock-ins and shop tasks for {range.start} to {range.end}. Adjusted times are used when a correction was saved. Labor cost is hours times the employee pay rate. Variance is actual hours minus the scheduled job estimate.
          </CardDescription>
        </div>
        <div className="flex items-center gap-2 print:hidden">
          <Button size="sm" variant="outline" className="gap-2" data-testid="clocked-time-export-csv" title="Download as CSV" onClick={exportCsv} disabled={!data}><Download className="w-4 h-4" /> CSV</Button>
          <Button size="sm" variant="outline" className="gap-2" data-testid="clocked-time-print" title="Print" onClick={() => window.print()} disabled={!data}><Printer className="w-4 h-4" /> Print</Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-end gap-3 print:hidden">
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Range</label>
            <Select value={preset} onValueChange={value => choosePreset(value as Preset)}>
              <SelectTrigger className="w-40" data-testid="clocked-time-preset"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="today">Today</SelectItem>
                <SelectItem value="week">This Week</SelectItem>
                <SelectItem value="month">This Month</SelectItem>
                <SelectItem value="custom">Custom range</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">From</label>
            <Input type="date" className="h-8 w-36" data-testid="clocked-time-start" value={range.start} onChange={event => { setPreset('custom'); setRange(current => ({ ...current, start: event.target.value })); }} />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">To</label>
            <Input type="date" className="h-8 w-36" data-testid="clocked-time-end" value={range.end} onChange={event => { setPreset('custom'); setRange(current => ({ ...current, end: event.target.value })); }} />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">View</label>
            <Select value={view} onValueChange={value => setView(value as 'company' | 'employee')}>
              <SelectTrigger className="w-40" data-testid="clocked-time-view"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="company">Company-wide</SelectItem>
                <SelectItem value="employee">By employee</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {view === 'employee' && (
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Employee</label>
              <Select value={employeeId} onValueChange={setEmployeeId}>
                <SelectTrigger className="w-48" data-testid="clocked-time-employee"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All employees</SelectItem>
                  {employees.map(employee => <SelectItem key={employee.id} value={String(employee.id)}>{employee.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
          {loading && <RefreshCw className="w-4 h-4 animate-spin text-muted-foreground" />}
        </div>

        <div className="hidden print:block text-sm">
          <p className="font-semibold">Clocked Time · {range.start} to {range.end}</p>
        </div>

        {data && (
          <div className="grid grid-cols-3 gap-4">
            <div className="rounded-xl border p-4">
              <p className="text-xs font-medium text-muted-foreground mb-1">Clocked hours</p>
              <p className="text-2xl font-bold" data-testid="clocked-time-total">{data.totalHoursLabel}</p>
              <p className="text-xs text-muted-foreground">{hours(data.totalDecimalHours)}</p>
            </div>
            <div className="rounded-xl border p-4">
              <p className="text-xs font-medium text-muted-foreground mb-1">Labor cost</p>
              <p className="text-2xl font-bold">{money(data.totalLaborCost)}</p>
            </div>
            <div className="rounded-xl border p-4">
              <p className="text-xs font-medium text-muted-foreground mb-1">Employees</p>
              <p className="text-2xl font-bold">{data.employees.length}</p>
            </div>
          </div>
        )}

        {error && <p className="text-sm text-destructive" data-testid="clocked-time-error">{error}</p>}

        {view === 'company' && data && (
          <div className="space-y-4">
            {!hasTime && <p className="text-sm text-muted-foreground" data-testid="clocked-time-empty">No clocked time in this range.</p>}
            <div>
              <p className="text-sm font-medium mb-2">Services</p>
              <div className="rounded-lg border overflow-hidden">
                <ClockedTable rows={data.services} empty="No service time in this range." />
              </div>
            </div>
            <div>
              <p className="text-sm font-medium mb-2">Non-job / shop tasks</p>
              <div className="rounded-lg border overflow-hidden">
                <ClockedTable rows={data.tasks} empty={emptyLabel} />
              </div>
            </div>
          </div>
        )}

        {view === 'employee' && data && (
          <div className="space-y-4" data-testid="clocked-time-by-employee">
            {(employeeId === 'all' ? data.employees : (selected ? [selected] : [])).length === 0 ? (
              <p className="text-sm text-muted-foreground" data-testid="clocked-time-empty">
                {employeeId === 'all' ? 'No clocked time in this range.' : 'This employee has no clocked time in this range.'}
              </p>
            ) : (employeeId === 'all' ? data.employees : [selected!]).map(employee => (
              <div key={employee.userId} className="rounded-lg border overflow-hidden">
                <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 bg-muted/40 text-sm">
                  <span className="font-semibold">{employee.userName}</span>
                  <span className="text-muted-foreground">{employee.hoursLabel} · {hours(employee.decimalHours)} · {employee.percentOfTotal.toFixed(1)}% of company · {money(employee.laborCost)}{employee.hourlyRate != null ? ` · ${money(employee.hourlyRate)}/hr` : ''}</span>
                </div>
                <ClockedTable rows={employee.rows} empty="No clocked time in this range." />
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
