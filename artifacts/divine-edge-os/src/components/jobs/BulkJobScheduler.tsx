import React from 'react';
import {
  getListCustomersQueryKey,
  getListPropertiesQueryKey,
  getListServicesQueryKey,
  useCreateJob,
  useListCustomers,
  useListProperties,
  useListServices,
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
import { buildRecurrenceRule, DAY_LABELS, EMPTY_JOB, type NewJobForm } from '@/components/jobs/JobFormFields';
import { useDebounce } from '@/hooks/use-debounce';
import { cn } from '@/lib/utils';
import { Check, ChevronLeft, ChevronsUpDown, Plus, RefreshCw, Trash2 } from 'lucide-react';

type BulkRow = {
  key: number;
  customerId: string;
  customerName: string;
  propertyId: string;
  duration: string;
};

type AssignmentUser = { id: number; name: string; role: string };
type AssignmentCrew = { id: number; name: string };
type BulkRecurrence = Pick<
  NewJobForm,
  | 'recurring'
  | 'recurrencePattern'
  | 'recurrenceInterval'
  | 'recurrenceDaysOfWeek'
  | 'recurrenceDayOfMonth'
  | 'recurrenceWeekOfMonth'
  | 'recurrenceDayOfWeek'
  | 'recurrenceEndCondition'
  | 'recurrenceEndAfter'
  | 'recurrenceEndDate'
>;

const EMPTY_BULK_RECURRENCE: BulkRecurrence = {
  recurring: EMPTY_JOB.recurring,
  recurrencePattern: EMPTY_JOB.recurrencePattern,
  recurrenceInterval: EMPTY_JOB.recurrenceInterval,
  recurrenceDaysOfWeek: EMPTY_JOB.recurrenceDaysOfWeek,
  recurrenceDayOfMonth: EMPTY_JOB.recurrenceDayOfMonth,
  recurrenceWeekOfMonth: EMPTY_JOB.recurrenceWeekOfMonth,
  recurrenceDayOfWeek: EMPTY_JOB.recurrenceDayOfWeek,
  recurrenceEndCondition: EMPTY_JOB.recurrenceEndCondition,
  recurrenceEndAfter: EMPTY_JOB.recurrenceEndAfter,
  recurrenceEndDate: EMPTY_JOB.recurrenceEndDate,
};

const WEEK_OF_MONTH_LABELS: Record<string, string> = {
  '1': 'First',
  '2': 'Second',
  '3': 'Third',
  '4': 'Fourth',
  '5': 'Last',
};

function describeRecurrence(recurrence: BulkRecurrence) {
  if (!recurrence.recurring) return 'One-time';
  let schedule = '';
  if (recurrence.recurrencePattern === 'weekly' || recurrence.recurrencePattern === 'biweekly') {
    const days = recurrence.recurrenceDaysOfWeek.map(day => DAY_LABELS[day]).join(', ');
    schedule = `${recurrence.recurrencePattern === 'biweekly' ? 'Every 2 weeks' : 'Weekly'} on ${days}`;
  } else if (recurrence.recurrencePattern === 'monthly_date') {
    schedule = `Monthly on day ${recurrence.recurrenceDayOfMonth}`;
  } else {
    schedule = `Monthly on the ${WEEK_OF_MONTH_LABELS[recurrence.recurrenceWeekOfMonth].toLowerCase()} ${DAY_LABELS[Number(recurrence.recurrenceDayOfWeek)]}`;
  }
  if (recurrence.recurrenceEndCondition === 'after') return `${schedule}, ${recurrence.recurrenceEndAfter} occurrences`;
  if (recurrence.recurrenceEndCondition === 'on_date') return `${schedule}, through ${recurrence.recurrenceEndDate}`;
  return `${schedule}, no end date`;
}

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
    if (properties.length > 0 && !row.propertyId) {
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
                      <span className="min-w-0">
                        <span className="block truncate">{customer.name}</span>
                        {(customer.physicalAddress || customer.primaryPropertyAddress) && (
                          <span className="block truncate text-xs text-muted-foreground">{customer.physicalAddress || customer.primaryPropertyAddress}</span>
                        )}
                      </span>
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
  const [serviceId, setServiceId] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [priority, setPriority] = React.useState<'low' | 'normal' | 'high' | 'urgent'>('normal');
  const [scheduledDate, setScheduledDate] = React.useState(routeDate ?? '');
  const [scheduledTime, setScheduledTime] = React.useState('09:00');
  const [assigneeId, setAssigneeId] = React.useState('');
  const [crewId, setCrewId] = React.useState('');
  const [recurrence, setRecurrence] = React.useState<BulkRecurrence>({ ...EMPTY_BULK_RECURRENCE });
  const [rows, setRows] = React.useState<BulkRow[]>([newRow(), newRow()]);
  const [submitting, setSubmitting] = React.useState(false);
  const [result, setResult] = React.useState<{ created: number; routed: number; routeFailed: string[]; failed: string[] } | null>(null);
  const createJob = useCreateJob();
  const updateJobRoute = useUpdateJobRoute();
  const { data: services = [] } = useListServices(
    { activeOnly: true },
    { query: { queryKey: getListServicesQueryKey({ activeOnly: true }) } },
  );
  const selectedService = services.find(service => String(service.id) === serviceId);

  const reset = React.useCallback(() => {
    setStep('edit');
    setDestination(routeTemplateId ? 'route' : 'unassigned');
    setTitle('');
    setServiceId('');
    setDescription('');
    setPriority('normal');
    setScheduledDate(routeDate ?? '');
    setScheduledTime('09:00');
    setAssigneeId('');
    setCrewId('');
    setRecurrence({ ...EMPTY_BULK_RECURRENCE, recurrenceDaysOfWeek: [] });
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
    if (recurrence.recurring && ['weekly', 'biweekly'].includes(recurrence.recurrencePattern) && recurrence.recurrenceDaysOfWeek.length === 0) {
      return 'Choose at least one recurrence day.';
    }
    if (recurrence.recurring && recurrence.recurrencePattern === 'monthly_date'
      && (!Number.isInteger(Number(recurrence.recurrenceDayOfMonth)) || Number(recurrence.recurrenceDayOfMonth) < 1 || Number(recurrence.recurrenceDayOfMonth) > 31)) {
      return 'Enter a monthly day from 1 through 31.';
    }
    if (recurrence.recurring && recurrence.recurrenceEndCondition === 'after'
      && (!Number.isInteger(Number(recurrence.recurrenceEndAfter)) || Number(recurrence.recurrenceEndAfter) < 1)) {
      return 'Enter at least one occurrence.';
    }
    if (recurrence.recurring && recurrence.recurrenceEndCondition === 'on_date' && !recurrence.recurrenceEndDate) {
      return 'Choose an end date for the recurrence.';
    }
    if (recurrence.recurring && recurrence.recurrenceEndCondition === 'on_date' && recurrence.recurrenceEndDate < scheduledDate) {
      return 'Choose a recurrence end date on or after the scheduled date.';
    }
    if (destination === 'route' && !routeTemplateId) return 'Open a route and date before choosing direct route assignment.';
    const activeRows = rows.filter(row => row.customerId || row.duration);
    if (activeRows.length === 0) return 'Add at least one customer.';
    if (activeRows.some(row => !row.customerId)) return 'Choose a customer for every row.';
    if (activeRows.some(row => row.duration && (!Number.isFinite(Number(row.duration)) || Number(row.duration) <= 0))) return 'Enter a positive duration for every customer.';
    if (!serviceId && activeRows.some(row => !row.duration)) return 'Enter a duration for every customer, or select a service that calculates it.';
    const keys = activeRows.map(row => `${row.customerId}:${row.propertyId || 'none'}`);
    if (new Set(keys).size !== keys.length) return 'The same customer and property is listed more than once.';
    return null;
  }, [destination, recurrence, routeTemplateId, rows, scheduledDate, scheduledTime, serviceId, title]);

  const activeRows = rows.filter(row => row.customerId || row.duration);
  const scheduledAt = scheduledDate && scheduledTime ? new Date(`${scheduledDate}T${scheduledTime}:00`).toISOString() : '';

  const submit = async () => {
    if (validationError || submitting) return;
    setSubmitting(true);
    const recurrenceRule = buildRecurrenceRule({ ...EMPTY_JOB, ...recurrence });
    const summary = { created: 0, routed: 0, routeFailed: [] as string[], failed: [] as string[] };
    for (const row of activeRows) {
      const label = row.customerName || `Customer #${row.customerId}`;
      const estimatedDuration = row.duration
        ? durationUnit === 'hours'
          ? Math.round(Number(row.duration) * 60)
          : Math.round(Number(row.duration))
        : undefined;
      try {
        const job = await createJob.mutateAsync({
          data: {
            title: title.trim(),
            serviceId: serviceId ? Number(serviceId) : undefined,
            description: description.trim() || undefined,
            scheduledAt,
            priority,
            customerId: Number(row.customerId),
            propertyId: row.propertyId ? Number(row.propertyId) : undefined,
            estimatedDuration,
            assigneeId: assigneeId ? Number(assigneeId) : undefined,
            crewId: crewId ? Number(crewId) : undefined,
            recurrenceRule,
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
                <label className="text-sm font-medium">Service</label>
                <Select
                  value={serviceId || 'none'}
                  onValueChange={value => {
                    if (value === 'none') {
                      setServiceId('');
                      return;
                    }
                    const service = services.find(item => String(item.id) === value);
                    if (!service) return;
                    setServiceId(value);
                    setTitle(service.name);
                    const defaultDuration = service.pricingMode === 'matrix' ? '' : service.estimatedDuration != null
                      ? String(durationUnit === 'hours' ? service.estimatedDuration / 60 : service.estimatedDuration)
                      : '';
                    setRows(current => current.map(row => row.duration ? row : { ...row, duration: defaultDuration }));
                  }}
                >
                  <SelectTrigger data-testid="select-bulk-job-service"><SelectValue placeholder="Optional catalog service..." /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No catalog service</SelectItem>
                    {services.map(service => (
                      <SelectItem key={service.id} value={String(service.id)}>
                        {service.name}{service.pricingMode === 'matrix' ? ' (matrix)' : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {selectedService?.pricingMode === 'matrix'
                    ? 'Price and estimated time are calculated from each selected property’s measurements.'
                    : 'The selected service supplies invoice pricing and a default duration.'}
                </p>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Job Title</label>
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

            <div className="rounded-lg border p-4 space-y-4">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <label className="text-sm font-medium flex items-center gap-1.5">
                    <RefreshCw className="w-3.5 h-3.5 text-primary" /> Make Recurring
                  </label>
                  <p className="text-xs text-muted-foreground">Each customer row starts its own independent series using this shared schedule.</p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={recurrence.recurring}
                  title={recurrence.recurring ? 'Make these one-time jobs' : 'Make every customer job recurring'}
                  onClick={() => setRecurrence(current => {
                    const recurring = !current.recurring;
                    if (!recurring || current.recurrenceDaysOfWeek.length > 0 || !scheduledDate) return { ...current, recurring };
                    const date = new Date(`${scheduledDate}T00:00:00`);
                    return {
                      ...current,
                      recurring,
                      recurrenceDaysOfWeek: [date.getDay()],
                      recurrenceDayOfMonth: String(date.getDate()),
                      recurrenceDayOfWeek: String(date.getDay()),
                    };
                  })}
                  className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${recurrence.recurring ? 'bg-primary' : 'bg-muted-foreground/30'}`}
                  data-testid="toggle-bulk-job-recurrence"
                >
                  <span className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${recurrence.recurring ? 'translate-x-5' : 'translate-x-0.5'}`} />
                </button>
              </div>

              {recurrence.recurring && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 rounded-lg bg-muted/20 border p-3">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Repeats</label>
                    <Select value={recurrence.recurrencePattern} onValueChange={recurrencePattern => setRecurrence(current => ({
                      ...current,
                      recurrencePattern,
                      recurrenceInterval: recurrencePattern === 'biweekly' ? '2' : current.recurrenceInterval,
                    }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="weekly">Weekly</SelectItem>
                        <SelectItem value="biweekly">Every 2 weeks</SelectItem>
                        <SelectItem value="monthly_date">Monthly by date</SelectItem>
                        <SelectItem value="monthly_weekday">Monthly by weekday</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {recurrence.recurrencePattern === 'monthly_date' && (
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Day of Month</label>
                      <Input type="number" min={1} max={31} value={recurrence.recurrenceDayOfMonth} onChange={event => setRecurrence(current => ({ ...current, recurrenceDayOfMonth: event.target.value }))} />
                    </div>
                  )}

                  {recurrence.recurrencePattern === 'monthly_weekday' && (
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1.5">
                        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Week</label>
                        <Select value={recurrence.recurrenceWeekOfMonth} onValueChange={recurrenceWeekOfMonth => setRecurrence(current => ({ ...current, recurrenceWeekOfMonth }))}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {Object.entries(WEEK_OF_MONTH_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Day</label>
                        <Select value={recurrence.recurrenceDayOfWeek} onValueChange={recurrenceDayOfWeek => setRecurrence(current => ({ ...current, recurrenceDayOfWeek }))}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {DAY_LABELS.map((label, day) => <SelectItem key={day} value={String(day)}>{label}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  )}

                  {['weekly', 'biweekly'].includes(recurrence.recurrencePattern) && (
                    <div className="md:col-span-2 space-y-1.5">
                      <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Days of Week</label>
                      <div className="flex gap-1.5 flex-wrap">
                        {DAY_LABELS.map((label, day) => (
                          <button
                            key={day}
                            type="button"
                            aria-pressed={recurrence.recurrenceDaysOfWeek.includes(day)}
                            onClick={() => setRecurrence(current => ({
                              ...current,
                              recurrenceDaysOfWeek: current.recurrenceDaysOfWeek.includes(day)
                                ? current.recurrenceDaysOfWeek.filter(value => value !== day)
                                : [...current.recurrenceDaysOfWeek, day],
                            }))}
                            className={`w-10 h-9 rounded-md text-xs font-medium border transition-colors ${recurrence.recurrenceDaysOfWeek.includes(day) ? 'bg-primary text-primary-foreground border-primary' : 'bg-background hover:bg-muted border-border'}`}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Ends</label>
                    <Select value={recurrence.recurrenceEndCondition} onValueChange={recurrenceEndCondition => setRecurrence(current => ({ ...current, recurrenceEndCondition }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="never">Never</SelectItem>
                        <SelectItem value="after">After a number of occurrences</SelectItem>
                        <SelectItem value="on_date">On a date</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  {recurrence.recurrenceEndCondition === 'after' && (
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Occurrences</label>
                      <Input type="number" min={1} value={recurrence.recurrenceEndAfter} onChange={event => setRecurrence(current => ({ ...current, recurrenceEndAfter: event.target.value }))} />
                    </div>
                  )}
                  {recurrence.recurrenceEndCondition === 'on_date' && (
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">End Date</label>
                      <Input type="date" min={scheduledDate || undefined} value={recurrence.recurrenceEndDate} onChange={event => setRecurrence(current => ({ ...current, recurrenceEndDate: event.target.value }))} />
                    </div>
                  )}
                </div>
              )}
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
              <div className="rounded-lg border p-4 grid grid-cols-2 md:grid-cols-6 gap-3 text-sm">
              <div><span className="text-muted-foreground block text-xs">Service</span>{selectedService?.name ?? 'No catalog service'}</div>
              <div><span className="text-muted-foreground block text-xs">Title</span>{title}</div>
              <div><span className="text-muted-foreground block text-xs">Destination</span>{destination === 'route' ? routeName : 'No route'}</div>
              <div><span className="text-muted-foreground block text-xs">Date</span>{scheduledDate} at {scheduledTime}</div>
              <div><span className="text-muted-foreground block text-xs">Recurrence</span>{describeRecurrence(recurrence)}</div>
              <div><span className="text-muted-foreground block text-xs">Jobs</span>{activeRows.length}</div>
            </div>
            <div className="rounded-lg border divide-y">
              {activeRows.map(row => (
                <div key={row.key} className="grid grid-cols-3 gap-3 px-4 py-3 text-sm">
                  <span className="font-medium">{row.customerName}</span>
                  <span className="text-muted-foreground">Property {row.propertyId || 'not selected'}</span>
                  <span className="text-right">{row.duration ? `${row.duration} ${durationUnit}` : 'Auto from service matrix'}</span>
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