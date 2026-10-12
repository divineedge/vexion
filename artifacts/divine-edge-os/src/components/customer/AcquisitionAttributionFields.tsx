import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useDoorHangers, EMPLOYEE_ACQUISITION_SOURCE, DOOR_HANGER_SOURCE } from '@/lib/acquisition';

/** Employee / door-hanger attribution selectors, scoped to the GET /door-hangers response. */
export function AcquisitionAttributionFields({ source, employeeId, visitId, onChange }: {
  source: string; employeeId: string; visitId: string;
  onChange: (p: { acquiredByEmployeeId?: string; doorHangerVisitId?: string }) => void;
}) {
  const active = source === EMPLOYEE_ACQUISITION_SOURCE || source === DOOR_HANGER_SOURCE;
  const { data, isLoading, isError } = useDoorHangers(null, active);
  if (!active) return null;
  const visits = data?.visits ?? [];
  return (
    <div className="space-y-3 rounded-md border p-3 bg-muted/30">
      <div className="space-y-1.5">
        <label className="text-sm font-medium">Acquired by employee</label>
        <Select value={employeeId || '__none__'} onValueChange={v => onChange({ acquiredByEmployeeId: v === '__none__' ? '' : v })}>
          <SelectTrigger data-testid="select-acquired-employee"><SelectValue placeholder={isLoading ? 'Loading…' : 'Select employee'} /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">None</SelectItem>
            {(data?.employees ?? []).map(e => <SelectItem key={e.id} value={String(e.id)}>{e.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      {source === DOOR_HANGER_SOURCE && (
        <div className="space-y-1.5">
          <label className="text-sm font-medium">Door hanger visit</label>
          <Select value={visitId || '__none__'} onValueChange={v => {
            const visit = visits.find(x => String(x.id) === v);
            onChange({ doorHangerVisitId: v === '__none__' ? '' : v, ...(visit?.employeeId && !employeeId ? { acquiredByEmployeeId: String(visit.employeeId) } : {}) });
          }}>
            <SelectTrigger data-testid="select-doorhanger-visit"><SelectValue placeholder="Select visit" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">None</SelectItem>
              {visits.map(v => <SelectItem key={v.id} value={String(v.id)}>#{v.id} · {v.address}{v.employeeName ? ` · ${v.employeeName}` : ''}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      )}
      {isError && <p className="text-xs text-destructive">Could not load employees / visits.</p>}
    </div>
  );
}
