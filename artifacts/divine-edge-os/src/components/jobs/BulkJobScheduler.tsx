import React from 'react';
import {
  getListCustomersQueryKey,
  getListPropertiesQueryKey,
  useCreateJob,
  useListCustomers,
  useListProperties,
  useUpdateJobRoute,
} from '@workspace/api-client-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useDebounce } from '@/hooks/use-debounce';
import { cn } from '@/lib/utils';
import { Check, ChevronLeft, ChevronsUpDown, Plus, Trash2 } from 'lucide-react';

type BulkRow = {
  key: number;
  customerId: string;
  customerName: string;
  propertyId: string;
  duration: string;
};

type AssignmentUser = { id: number; name: string; role: string };
type AssignmentCrew = { id: number; name: string };

interface BulkJobSchedulerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  routeTemplateId?: number;
  routeName?: string;
  routeDate?: string;
  durationUnit: 'minutes' | 'hours';
  users: AssignmentUser[];
  crews: AssignmentCrew[];
  ownersSchedulable: boolean;
  onComplete: () => void;
}

let nextRowKey = 1;
const newRow = (): BulkRow => ({ key: nextRowKey++, customerId: '', customerName: '', propertyId: '', duration: '' });

function CustomerJobRow({
  row,
  index,
  durationUnit,
  disabled,
  onChange,
  onRemove,
}: {
  row: BulkRow;
  index: number;
  durationUnit: 'minutes' | 'hours';
  disabled: boolean;
  onChange: (changes: Partial<BulkRow>) => void;
  onRemove: () => void;
}) {
  const [pickerOpen, setPickerOpen] = React.useState(false);
  const [search, setSearch] = React.useState('');
  const debouncedSearch = useDebounce(search, 250);
  const customerParams = { q: debouncedSearch || undefined, limit: 50 };
  const { data: customers, isFetching } = useListCustomers(customerParams, {
    query: { enabled: pickerOpen, queryKey: getListCustomersQueryKey(customerParams) },
  });
  const customerId = row.customerId ? Number(row.customerId) : undefined;
  const { data: properties = [] } = useListProperties(
    { customerId },
    { query: { enabled: !!customerId, queryKey: getListPropertiesQueryKey({ customerId }) } },
  );

  React.useEffect(() => {
    if (properties.length === 1 && row.propertyId !== String(properties[0].id)) {
      onChange({ propertyId: String(properties[0].id) });
    }
  }, [properties, row.propertyId, onChange]);

  return (
    <div className="grid grid-cols-12 gap-3 items-end rounded-lg border p-3" data-testid={`bulk-job-row-${index}`}>
      <div className="col-span-12 md:col-span-4 space-y-1.5">
        <label className="text-xs font-medium">Customer {index + 1}</label>
        <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
          <PopoverTrigger asChild>
            <Button type="button" variant="outline" role="combobox" className="w-full justify-between font-normal" disabled={disabled}>
              <span className={cn('truncate', !row.customerId && 'text-muted-foreground')}>
                {row.customerName || 'Search customer name...'}
              </span>
              <ChevronsUpDown className="w-4 h-4 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0 z-[1300]" align="start">
            <Command shouldFilter={false}>
              <CommandInput value={search} onValueChange={setSearch} placeholder="Type a customer name..." />
              <CommandList>
                <CommandEmpty>{isFetching ? 'Searching...' : 'No customers found.'}</CommandEmpty>
                <CommandGroup>
                  {(customers?.items ?? []).map(customer => (
                    <CommandItem
                      key={customer.id}
                      value={`${customer.name} ${customer.id}`}
                      onSelect={() => {
                        onChange({ customerId: String(customer.id), customerName: customer.name, propertyId: '' });
                        setSearch('');
                        setPickerOpen(false);
                      }}
                    >
                      <Check className={cn('w-4 h-4', row.customerId === String(customer.id) ? 'opacity-100' : 'opacity-0')} />
                      {customer.name}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      </div>

      <div className="col-span-12 md:col-span-4 space-y-1.5">
        <label className="text-xs font-medium">Property</label>
        <Select value={row.propertyId} onValueChange={propertyId => onChange({ propertyId })} disabled={!row.customerId || disabled}>
          <SelectTrigger><SelectValue placeholder={row.customerId ? 'Select property...' : 'Choose customer first'} /></SelectTrigger>
          <SelectContent>
            {properties.map(property => <SelectItem key={property.id} value={String(property.id)}>{property.address}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <div className="col-span-10 md:col-span-3 space-y-1.5">
        <label className="text-xs font-medium">Duration ({durationUnit === 'hours' ? 'hours' : 'minutes'})</label>
        <Input
          type="number"
          min={durationUnit === 'hours' ? 0.25 : 1}
          step={durationUnit === 'hours' ? 0.25 : 5}
          value={row.duration}
          onChange={event => onChange({ duration: event.target.value })}
          placeholder={durationUnit === 'hours' ? '1.5' : '90'}
          disabled={disabled}
        />
      </div>

      <div className="col-span-2 md:col-span-1 flex justify-end">
        <Button type="button" variant="ghost" size="icon" title="Remove this customer" onClick={onRemove} disabled={disabled}>
          <Trash2 className="w-4 h-4 text-destructive" />
        </Button>
      </div>
    </div>
  );
}

export function BulkJobScheduler({
  open,
  onOpenChange,
  routeTemplateId,
  routeName,
  routeDate,
  durationUnit,
  users,
  crews,
  ownersSchedulable,
  onComplete,
}: BulkJobSchedulerProps) {
  const [step, setStep] = React.useState<'edit' | 'review' | 'result'>('edit');
  const [destination, setDestination] = React.useState<'route' | 'unassigned'>(routeTemplateId ? 'route' : 'unassigned');
  const [title, setTitle] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [priority, setPriority] = React.useState<'low' | 'normal' | 'high' | 'urgent'>('normal');
  const [scheduledDate, setScheduledDate] = React.useState(routeDate ?? '');
  const [scheduledTime, setScheduledTime] = React.useState('09:00');
  const [assigneeId, setAssigneeId] = React.useState('');
  const [crewId, setCrewId] = React.useState('');
  const [rows, setRows] = React.useState<BulkRow[]>([newRow(), newRow()]);
  const [submitting, setSubmitting] = React.useState(false);
  const [result, setResult] = React.useState<{ created: number; routed: number; routeFailed: string[]; failed: string[] } | null>(null);
  const createJob = useCreateJob();
  const updateJobRoute = useUpdateJobRoute();

  const reset = React.useCallback(() => {
    setStep('edit');
    setDestination(routeTemplateId ? 'route' : 'unassigned');
    setTitle('');
    setDescription('');
    setPriority('normal');
    setScheduledDate(routeDate ?? '');
    setScheduledTime('09:00');
    setAssigneeId('');
    setCrewId('');
    setRows([newRow(), newRow()]);
    setSubmitting(false);
    setResult(null);
  }, [routeDate, routeTemplateId]);

  React.useEffect(() => {
    if (open) reset();
  }, [open, reset]);

  const updateRow = (key: number, changes: Partial<BulkRow>) => {
    setRows(current => current.map(row => row.key === key ? { ...row, ...changes } : row));
  };

  const validationError = React.useMemo(() => {
    if (!title.trim()) return 'Enter the shared service or job title.';
    if (!scheduledDate || !scheduledTime) return 'Choose the scheduled date and time.';
    if (destination === 'route' && !routeTemplateId) return 'Open a route and date before choosing direct route assignment.';
    const activeRows = rows.filter(row => row.customerId || row.duration);
    if (activeRows.length === 0) return 'Add at least one customer.';
    if (activeRows.some(row => !row.customerId)) return 'Choose a customer for every row.';
    if (activeRows.some(row => !Number.isFinite(Number(row.duration)) || Number(row.duration) <= 0)) return 'Enter a positive duration for every customer.';
    const keys = activeRows.map(row => `${row.customerId}:${row.propertyId || 'none'}`);
    if (new Set(keys).size !== keys.length) return 'The same customer and property is listed more than once.';
    return null;
  }, [destination, routeTemplateId, rows, scheduledDate, scheduledTime, title]);

  const activeRows = rows.filter(row => row.customerId || row.duration);
  const scheduledAt = scheduledDate && scheduledTime ? new Date(`${scheduledDate}T${scheduledTime}:00`).toISOString() : '';

  const submit = async () => {
    if (validationError || submitting) return;
    setSubmitting(true);
    const summary = { created: 0, routed: 0, routeFailed: [] as string[], failed: [] as string[] };
    for (const row of activeRows) {
      const label = row.customerName || `Customer #${row.customerId}`;
      const estimatedDuration = durationUnit === 'hours'
        ? Math.round(Number(row.duration) * 60)
        : Math.round(Number(row.duration));
      try {
        const job = await createJob.mutateAsync({
          data: {
            title: title.trim(),
            description: description.trim() || undefined,
            scheduledAt,
            priority,
            customerId: Number(row.customerId),
            propertyId: row.propertyId ? Number(row.propertyId) : undefined,
            estimatedDuration,
            assigneeId: assigneeId ? Number(assigneeId) : undefined,
            crewId: crewId ? Number(crewId) : undefined,
          },
        });
        summary.created++;
        if (destination === 'route' && routeTemplateId) {
          try {
            await updateJobRoute.mutateAsync({ id: job.id, data: { routeTemplateId, scheduledAt } });
            summary.routed++;
          } catch {
            summary.routeFailed.push(label);
          }
        }
      } catch {
        summary.failed.push(label);
      }
    }
    setResult(summary);
    setStep('result');
    setSubmitting(false);
    onComplete();
  };

  const eligibleUsers = users.filter(user =>
    user.role === 'technician'
    || user.role === 'crew_manager'
    || (ownersSchedulable && user.role === 'company_owner')
  );
  const assignmentValue = crewId ? `crew:${crewId}` : assigneeId ? `user:${assigneeId}` : 'unassigned';

  return (
    <Dialog open={open} onOpenChange={value => { if (!submitting) onOpenChange(value); }}>
      <DialogContent className="max-w-5xl max-h-[92vh] overflow-y-auto" data-testid="dialog-bulk-job-scheduler">
        <DialogHeader>
          <DialogTitle>{step === 'result' ? 'Bulk scheduling complete' : step === 'review' ? 'Review jobs' : 'Schedule multiple jobs'}</DialogTitle>
          <DialogDescription>
            {step === 'edit' && 'Enter shared job details once, then choose each customer, property, and duration.'}
            {step === 'review' && `Review the ${activeRows.length} separate jobs before creating them.`}
            {step === 'result' && 'Each customer was processed separately. Any unsuccessful rows are listed below.'}
          </DialogDescription>
        </DialogHeader>

        {step === 'edit' && (
          <div className="space-y-5">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 rounded-lg border p-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Destination</label>
                <Select value={destination} onValueChange={value => setDestination(value as 'route' | 'unassigned')}>
                  <SelectTrigger data-testid="select-bulk-job-destination"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {routeTemplateId && <SelectItem value="route">Add to {routeName || 'selected route'}</SelectItem>}
                    <SelectItem value="unassigned">Create without a route</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Service / Job Title</label>
                <Input value={title} onChange={event => setTitle(event.target.value)} placeholder="e.g. Weekly lawn service" data-testid="input-bulk-job-title" />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Scheduled Date</label>
                <Input type="date" value={scheduledDate} onChange={event => setScheduledDate(event.target.value)} />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Start Time</label>
                <Input type="time" value={scheduledTime} onChange={event => setScheduledTime(event.target.value)} />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Priority</label>
                <Select value={priority} onValueChange={value => setPriority(value as typeof priority)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">Low</SelectItem>
                    <SelectItem value="normal">Normal</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                    <SelectItem value="urgent">Urgent</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Assign To</label>
                <Select value={assignmentValue} onValueChange={value => {
                  if (value === 'unassigned') { setAssigneeId(''); setCrewId(''); }
                  else if (value.startsWith('crew:')) { setCrewId(value.slice(5)); setAssigneeId(''); }
                  else { setAssigneeId(value.slice(5)); setCrewId(''); }
                }}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="unassigned">Unassigned</SelectItem>
                    {eligibleUsers.map(user => <SelectItem key={`user-${user.id}`} value={`user:${user.id}`}>{user.name} ({user.role === 'company_owner' ? 'owner' : user.role.replace(/_/g, ' ')})</SelectItem>)}
                    {crews.map(crew => <SelectItem key={`crew-${crew.id}`} value={`crew:${crew.id}`}>{crew.name} (crew)</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="md:col-span-2 space-y-1.5">
                <label className="text-sm font-medium">Shared Instructions</label>
                <Textarea rows={2} value={description} onChange={event => setDescription(event.target.value)} placeholder="Optional instructions applied to every job" />
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-semibold">Customers and durations</h3>
                  <p className="text-xs text-muted-foreground">Each row becomes its own job.</p>
                </div>
                <Button type="button" variant="outline" size="sm" className="gap-2" onClick={() => setRows(current => [...current, newRow()])}>
                  <Plus className="w-4 h-4" /> Add customer
                </Button>
              </div>
              {rows.map((row, index) => (
                <CustomerJobRow
                  key={row.key}
                  row={row}
                  index={index}
                  durationUnit={durationUnit}
                  disabled={submitting}
                  onChange={changes => updateRow(row.key, changes)}
                  onRemove={() => setRows(current => current.length === 1 ? current : current.filter(item => item.key !== row.key))}
                />
              ))}
            </div>
            {validationError && <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">{validationError}</p>}
          </div>
        )}

        {step === 'review' && (
          <div className="space-y-4">
            <div className="rounded-lg border p-4 grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
              <div><span className="text-muted-foreground block text-xs">Title</span>{title}</div>
              <div><span className="text-muted-foreground block text-xs">Destination</span>{destination === 'route' ? routeName : 'No route'}</div>
              <div><span className="text-muted-foreground block text-xs">Date</span>{scheduledDate} at {scheduledTime}</div>
              <div><span className="text-muted-foreground block text-xs">Jobs</span>{activeRows.length}</div>
            </div>
            <div className="rounded-lg border divide-y">
              {activeRows.map(row => (
                <div key={row.key} className="grid grid-cols-3 gap-3 px-4 py-3 text-sm">
                  <span className="font-medium">{row.customerName}</span>
                  <span className="text-muted-foreground">Property {row.propertyId || 'not selected'}</span>
                  <span className="text-right">{row.duration} {durationUnit}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {step === 'result' && result && (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <Badge variant="secondary">{result.created} job{result.created === 1 ? '' : 's'} created</Badge>
              {destination === 'route' && <Badge variant="secondary">{result.routed} added to route</Badge>}
              {result.failed.length > 0 && <Badge variant="destructive">{result.failed.length} failed</Badge>}
              {result.routeFailed.length > 0 && <Badge variant="destructive">{result.routeFailed.length} created but not routed</Badge>}
            </div>
            {result.failed.length > 0 && <p className="text-sm"><strong>Not created:</strong> {result.failed.join(', ')}</p>}
            {result.routeFailed.length > 0 && <p className="text-sm"><strong>Created without route assignment:</strong> {result.routeFailed.join(', ')}</p>}
          </div>
        )}

        <DialogFooter>
          {step === 'edit' && (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button onClick={() => setStep('review')} disabled={!!validationError}>Review {activeRows.length || ''} Jobs</Button>
            </>
          )}
          {step === 'review' && (
            <>
              <Button variant="outline" className="gap-2" onClick={() => setStep('edit')} disabled={submitting}><ChevronLeft className="w-4 h-4" /> Back</Button>
              <Button onClick={submit} disabled={submitting}>{submitting ? 'Creating jobs…' : `Create ${activeRows.length} Jobs`}</Button>
            </>
          )}
          {step === 'result' && <Button onClick={() => onOpenChange(false)}>Done</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}