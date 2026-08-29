import React from 'react';
import type { RecurrenceRule } from '@workspace/api-client-react';
import { useListTags, getListTagsQueryKey } from '@workspace/api-client-react';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Separator } from '@/components/ui/separator';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { RefreshCw, MessageSquare, Tag, X, Snowflake } from 'lucide-react';

export type NewJobForm = {
  title: string;
  description: string;
  scheduledAt: string;
  estimatedDuration: string;
  /** Which unit the number in estimatedDuration is expressed in. Always stored as minutes in the DB. */
  estimatedDurationUnit: 'minutes' | 'hours';
  priority: string;
  customerId: string;
  propertyId: string;
  assigneeId: string;
  tags: string[];
  recurring: boolean;
  recurrencePattern: string;
  recurrenceInterval: string;
  recurrenceDaysOfWeek: number[];
  recurrenceDayOfMonth: string;
  recurrenceWeekOfMonth: string;
  recurrenceDayOfWeek: string;
  recurrenceEndCondition: string;
  recurrenceEndAfter: string;
  recurrenceEndDate: string;
  smsReminderEnabled: boolean;
  offSeasonEnabled: boolean;
  offSeasonStart: string;
  offSeasonEnd: string;
};

export const EMPTY_JOB: NewJobForm = {
  title: '',
  description: '',
  scheduledAt: '',
  estimatedDuration: '',
  estimatedDurationUnit: 'minutes',
  priority: 'normal',
  customerId: '',
  propertyId: '',
  assigneeId: '',
  tags: [],
  recurring: false,
  recurrencePattern: 'weekly',
  recurrenceInterval: '1',
  recurrenceDaysOfWeek: [],
  recurrenceDayOfMonth: '1',
  recurrenceWeekOfMonth: '1',
  recurrenceDayOfWeek: '1',
  recurrenceEndCondition: 'never',
  recurrenceEndAfter: '12',
  recurrenceEndDate: '',
  smsReminderEnabled: false,
  offSeasonEnabled: false,
  offSeasonStart: '',
  offSeasonEnd: '',
};

export const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Inline tag chip picker used inside the job form. Fetches canonical tags itself. */
function JobTagsPicker({ form, setForm }: { form: NewJobForm; setForm: React.Dispatch<React.SetStateAction<NewJobForm>> }) {
  const { data: bizTags = [] } = useListTags({ query: { queryKey: getListTagsQueryKey() } });
  const tags = bizTags as Array<{ id: number; name: string; color: string }>;
  if (!tags.length) return null;
  return (
    <div className="space-y-1.5">
      <label className="text-sm font-medium flex items-center gap-1.5"><Tag className="w-3.5 h-3.5" /> Tags</label>
      <div className="flex flex-wrap gap-1.5">
        {tags.map(bt => {
          const selected = (form.tags ?? []).includes(bt.name);
          return (
            <button
              key={bt.id}
              type="button"
              title={selected ? `Remove tag "${bt.name}"` : `Add tag "${bt.name}"`}
              onClick={() => setForm(f => ({ ...f, tags: selected ? (f.tags ?? []).filter(t => t !== bt.name) : [...(f.tags ?? []), bt.name] }))}
              className={`px-2.5 py-0.5 rounded-full text-xs font-medium border transition-all ${selected ? 'text-white border-transparent shadow-sm' : 'bg-transparent text-muted-foreground border-border hover:border-primary/50'}`}
              style={selected ? { backgroundColor: bt.color, borderColor: bt.color } : {}}
            >
              {bt.name}
            </button>
          );
        })}
      </div>
      {(form.tags ?? []).length > 0 && (
        <div className="flex flex-wrap gap-1 mt-1">
          {(form.tags ?? []).map(tag => {
            const bt = tags.find(b => b.name === tag);
            return (
              <Badge key={tag} variant="secondary" className="gap-1 pr-1 text-xs text-white" style={bt ? { backgroundColor: bt.color } : {}}>
                {tag}
                <button type="button" onClick={() => setForm(f => ({ ...f, tags: (f.tags ?? []).filter(t => t !== tag) }))} className="ml-0.5 hover:opacity-70"><X className="w-2.5 h-2.5" /></button>
              </Badge>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function buildRecurrenceRule(form: NewJobForm): RecurrenceRule | undefined {
  if (!form.recurring) return undefined;
  const rule: RecurrenceRule = {
    pattern: form.recurrencePattern as RecurrenceRule['pattern'],
    endCondition: form.recurrenceEndCondition as RecurrenceRule['endCondition'],
  };
  if (['weekly', 'biweekly'].includes(form.recurrencePattern)) {
    rule.daysOfWeek = form.recurrenceDaysOfWeek;
  }
  if (form.recurrencePattern === 'biweekly') {
    rule.interval = parseInt(form.recurrenceInterval, 10) || 2;
  }
  if (form.recurrencePattern === 'custom') {
    rule.interval = parseInt(form.recurrenceInterval, 10) || 1;
  }
  if (form.recurrencePattern === 'monthly_date') {
    rule.dayOfMonth = parseInt(form.recurrenceDayOfMonth, 10) || 1;
  }
  if (form.recurrencePattern === 'monthly_weekday') {
    rule.weekOfMonth = parseInt(form.recurrenceWeekOfMonth, 10) || 1;
    rule.dayOfWeek = parseInt(form.recurrenceDayOfWeek, 10);
  }
  if (form.recurrenceEndCondition === 'after') {
    rule.endAfter = parseInt(form.recurrenceEndAfter, 10) || 12;
  }
  if (form.recurrenceEndCondition === 'on_date') {
    rule.endDate = form.recurrenceEndDate;
  }
  return rule;
}

export interface JobFormFieldsProps {
  form: NewJobForm;
  setForm: React.Dispatch<React.SetStateAction<NewJobForm>>;
  customers: { id: number; name: string }[];
  /** Properties for the selected customer. Pass an empty array when none are loaded yet. */
  properties: { id: number; address: string }[];
  users: { id: number; name: string; role: string }[];
  durationUnit: string;
  /** Show the "Make Recurring" section. Defaults to true. */
  showRecurrence?: boolean;
  /** Tenant defaults used when an office enables this series' annual pause. */
  defaultOffSeasonStart?: string | null;
  defaultOffSeasonEnd?: string | null;
}

/**
 * The customer/property/service/time/etc. job-creation fields shared between the Schedule
 * page's "New Job" sheet and any other entry point (e.g. Routes' "New Job" action) that needs
 * to create a job with the same details.
 */
export function JobFormFields({ form, setForm, customers, properties, users, durationUnit, showRecurrence = true, defaultOffSeasonStart, defaultOffSeasonEnd }: JobFormFieldsProps) {
  return (
    <>
      <div className="space-y-1.5">
        <label className="text-sm font-medium">Title <span className="text-destructive">*</span></label>
        <Input title="Enter a descriptive job title" placeholder="e.g. Irrigation system repair" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} />
      </div>

      <div className="space-y-1.5">
        <label className="text-sm font-medium">Scheduled Date & Time <span className="text-destructive">*</span></label>
        <Input type="datetime-local" title="When this job is scheduled to start" value={form.scheduledAt} onChange={e => setForm(f => ({ ...f, scheduledAt: e.target.value }))} />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <label className="text-sm font-medium">Duration</label>
          <div className="flex gap-1.5">
            <Input
              type="number"
              min={0}
              step={form.estimatedDurationUnit === 'hours' ? 0.5 : 15}
              title={`Estimated job duration in ${form.estimatedDurationUnit}`}
              placeholder={form.estimatedDurationUnit === 'hours' ? '1.5' : '90'}
              value={form.estimatedDuration}
              onChange={e => setForm(f => ({ ...f, estimatedDuration: e.target.value }))}
              className="flex-1"
            />
            <Select
              value={form.estimatedDurationUnit}
              onValueChange={v => setForm(f => ({ ...f, estimatedDurationUnit: v as 'minutes' | 'hours' }))}
            >
              <SelectTrigger className="w-24" title="Duration unit">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="minutes">min</SelectItem>
                <SelectItem value="hours">hrs</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-medium">Priority</label>
          <Select value={form.priority} onValueChange={v => setForm(f => ({ ...f, priority: v }))}>
            <SelectTrigger title="Set job priority"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="low">Low</SelectItem>
              <SelectItem value="normal">Normal</SelectItem>
              <SelectItem value="high">High</SelectItem>
              <SelectItem value="urgent">Urgent</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-1.5">
        <label className="text-sm font-medium">Customer</label>
        <Select
          value={form.customerId}
          onValueChange={v => setForm(f => ({ ...f, customerId: v, propertyId: '' }))}
        >
          <SelectTrigger title="Select the customer for this job"><SelectValue placeholder="Select customer..." /></SelectTrigger>
          <SelectContent>
            {customers.map(c => (
              <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {form.customerId && properties.length > 0 && (
        <div className="space-y-1.5">
          <label className="text-sm font-medium">Property</label>
          <Select value={form.propertyId} onValueChange={v => setForm(f => ({ ...f, propertyId: v }))}>
            <SelectTrigger title="Select the property where work will be done"><SelectValue placeholder="Select property..." /></SelectTrigger>
            <SelectContent>
              {properties.map(p => (
                <SelectItem key={p.id} value={String(p.id)}>{p.address}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <div className="space-y-1.5">
        <label className="text-sm font-medium">Assign To</label>
        <Select value={form.assigneeId} onValueChange={v => setForm(f => ({ ...f, assigneeId: v }))}>
          <SelectTrigger title="Assign this job to a technician or crew manager"><SelectValue placeholder="Select technician..." /></SelectTrigger>
          <SelectContent>
            {users
              .filter(u => u.role === 'technician' || u.role === 'crew_manager')
              .map(u => (
                <SelectItem key={u.id} value={String(u.id)}>{u.name} ({u.role.replace(/_/g, ' ')})</SelectItem>
              ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <label className="text-sm font-medium">Description</label>
        <Textarea
          title="Additional details or special instructions for the technician"
          placeholder="Job details, special instructions..."
          rows={3}
          value={form.description}
          onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
        />
      </div>

      <JobTagsPicker form={form} setForm={setForm} />

      <Separator />
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <label className="text-sm font-medium flex items-center gap-1.5">
              <MessageSquare className="w-3.5 h-3.5 text-primary" /> SMS Reminder
            </label>
            <p className="text-xs text-muted-foreground">Send customer an SMS before this job (respects their opt-out).</p>
          </div>
          <button
            type="button"
            title={form.smsReminderEnabled ? 'SMS reminder is on — click to disable' : 'SMS reminder is off — click to enable'}
            onClick={() => setForm(f => ({ ...f, smsReminderEnabled: !f.smsReminderEnabled }))}
            className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${form.smsReminderEnabled ? 'bg-primary' : 'bg-muted-foreground/30'}`}
          >
            <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${form.smsReminderEnabled ? 'translate-x-4' : 'translate-x-0.5'}`} />
          </button>
        </div>
      </div>

      {showRecurrence && (
        <>
          <Separator />
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <label className="text-sm font-medium flex items-center gap-1.5"><RefreshCw className="w-3.5 h-3.5 text-primary" /> Make Recurring</label>
                <p className="text-xs text-muted-foreground">Auto-generate future job instances on a schedule.</p>
              </div>
              <button
                type="button"
                title={form.recurring ? 'Recurring is on — click to make this a one-time job' : 'Recurring is off — click to auto-generate future instances'}
                onClick={() => setForm(f => ({ ...f, recurring: !f.recurring }))}
                className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${form.recurring ? 'bg-primary' : 'bg-muted-foreground/30'}`}
              >
                <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${form.recurring ? 'translate-x-4' : 'translate-x-0.5'}`} />
              </button>
            </div>

            {form.recurring && (
              <div className="rounded-lg border p-3 space-y-3 bg-muted/20">
                {/* Pattern */}
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Pattern</label>
                  <Select value={form.recurrencePattern} onValueChange={v => setForm(f => ({ ...f, recurrencePattern: v }))}>
                    <SelectTrigger className="h-8 text-sm" title="How often this job repeats"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="daily">Daily</SelectItem>
                      <SelectItem value="weekly">Weekly (pick days)</SelectItem>
                      <SelectItem value="biweekly">Every 2 weeks</SelectItem>
                      <SelectItem value="monthly_date">Monthly by date</SelectItem>
                      <SelectItem value="monthly_weekday">Monthly by weekday</SelectItem>
                      <SelectItem value="custom">Custom interval (every N days)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Days of week (weekly / biweekly) */}
                {['weekly', 'biweekly'].includes(form.recurrencePattern) && (
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Days of Week</label>
                    <div className="flex gap-1.5 flex-wrap">
                      {DAY_LABELS.map((d, i) => (
                        <button
                          key={i}
                          type="button"
                          title={`${form.recurrenceDaysOfWeek.includes(i) ? 'Remove' : 'Add'} ${['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][i]} as a recurrence day`}
                          onClick={() => setForm(f => {
                            const cur = f.recurrenceDaysOfWeek;
                            return { ...f, recurrenceDaysOfWeek: cur.includes(i) ? cur.filter(x => x !== i) : [...cur, i] };
                          })}
                          className={`w-9 h-9 rounded-md text-xs font-medium border transition-colors ${form.recurrenceDaysOfWeek.includes(i) ? 'bg-primary text-primary-foreground border-primary' : 'bg-background hover:bg-muted border-border'}`}
                        >{d}</button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Monthly by date */}
                {form.recurrencePattern === 'monthly_date' && (
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Day of Month</label>
                    <Input type="number" min={1} max={31} title="Day of the month the job repeats on (1–31)" className="h-8 text-sm" value={form.recurrenceDayOfMonth} onChange={e => setForm(f => ({ ...f, recurrenceDayOfMonth: e.target.value }))} />
                  </div>
                )}

                {/* Monthly by weekday */}
                {form.recurrencePattern === 'monthly_weekday' && (
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Week</label>
                      <Select value={form.recurrenceWeekOfMonth} onValueChange={v => setForm(f => ({ ...f, recurrenceWeekOfMonth: v }))}>
                        <SelectTrigger className="h-8 text-sm" title="Which week of the month the job repeats on"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="1">First</SelectItem>
                          <SelectItem value="2">Second</SelectItem>
                          <SelectItem value="3">Third</SelectItem>
                          <SelectItem value="4">Fourth</SelectItem>
                          <SelectItem value="5">Last</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Day</label>
                      <Select value={form.recurrenceDayOfWeek} onValueChange={v => setForm(f => ({ ...f, recurrenceDayOfWeek: v }))}>
                        <SelectTrigger className="h-8 text-sm" title="Which day of the week the job repeats on"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {DAY_LABELS.map((d, i) => <SelectItem key={i} value={String(i)}>{d}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                )}

                {/* Custom interval */}
                {form.recurrencePattern === 'custom' && (
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Every N Days</label>
                    <Input type="number" min={1} title="Custom interval in days between each job occurrence" className="h-8 text-sm" value={form.recurrenceInterval} onChange={e => setForm(f => ({ ...f, recurrenceInterval: e.target.value }))} />
                  </div>
                )}

                {/* End condition */}
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Ends</label>
                  <Select value={form.recurrenceEndCondition} onValueChange={v => setForm(f => ({ ...f, recurrenceEndCondition: v }))}>
                    <SelectTrigger className="h-8 text-sm" title="When this recurring job series ends"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="never">Never</SelectItem>
                      <SelectItem value="after">After N occurrences</SelectItem>
                      <SelectItem value="on_date">On a date</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {form.recurrenceEndCondition === 'after' && (
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Number of Occurrences</label>
                    <Input type="number" min={1} title="Stop generating jobs after this many occurrences" className="h-8 text-sm" value={form.recurrenceEndAfter} onChange={e => setForm(f => ({ ...f, recurrenceEndAfter: e.target.value }))} />
                  </div>
                )}
                {form.recurrenceEndCondition === 'on_date' && (
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">End Date</label>
                    <Input type="date" title="Last date a job will be generated for this series" className="h-8 text-sm" value={form.recurrenceEndDate} onChange={e => setForm(f => ({ ...f, recurrenceEndDate: e.target.value }))} />
                  </div>
                )}
              </div>
            )}

            {/* Off-season window belongs to recurring series only. */}
            {form.recurring && <div className="pt-1">
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                  <Snowflake className="w-3.5 h-3.5" /> Off-Season Pause
                </label>
                <button
                  type="button"
                  title={form.offSeasonEnabled ? 'Off-season pause is on — click to disable' : 'Enable annual off-season pause'}
                  onClick={() => setForm(f => {
                    const enabled = !f.offSeasonEnabled;
                    return {
                      ...f,
                      offSeasonEnabled: enabled,
                      offSeasonStart: enabled ? (f.offSeasonStart || defaultOffSeasonStart || '11-15') : '',
                      offSeasonEnd: enabled ? (f.offSeasonEnd || defaultOffSeasonEnd || '03-14') : '',
                    };
                  })}
                  className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${form.offSeasonEnabled ? 'bg-primary' : 'bg-muted-foreground/30'}`}
                >
                  <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${form.offSeasonEnabled ? 'translate-x-4' : 'translate-x-0.5'}`} />
                </button>
              </div>
              {form.offSeasonEnabled && <><p className="text-[11px] text-muted-foreground mb-2">
                Jobs falling in this window are skipped automatically and resume after it ends.
              </p>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <label className="text-[11px] text-muted-foreground">Pause from (MM-DD)</label>
                  <Input
                    type="text"
                    placeholder="e.g. 12-01"
                    maxLength={5}
                    pattern="\d{2}-\d{2}"
                    className="h-8 text-xs font-mono"
                    title="Off-season start date in MM-DD format (month-day, e.g. 12-01 for Dec 1)"
                    value={form.offSeasonStart}
                    onChange={e => setForm(f => ({ ...f, offSeasonStart: e.target.value }))}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] text-muted-foreground">Resume on (MM-DD)</label>
                  <Input
                    type="text"
                    placeholder="e.g. 03-01"
                    maxLength={5}
                    pattern="\d{2}-\d{2}"
                    className="h-8 text-xs font-mono"
                    title="Off-season end date in MM-DD format (month-day, e.g. 03-01 for Mar 1)"
                    value={form.offSeasonEnd}
                    onChange={e => setForm(f => ({ ...f, offSeasonEnd: e.target.value }))}
                  />
                </div>
              </div>
              {form.offSeasonStart && form.offSeasonEnd && (
                <p className="text-[11px] text-primary mt-1.5">
                  ❄️ Series will pause {form.offSeasonStart} → {form.offSeasonEnd} each year
                </p>
              )}
              </>}
            </div>}
          </div>
        </>
      )}
    </>
  );
}
