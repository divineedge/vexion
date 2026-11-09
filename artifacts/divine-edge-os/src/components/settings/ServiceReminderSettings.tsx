import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { customFetch, getGetTenantSettingsQueryKey, useListServices, getListServicesQueryKey } from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AutosaveIndicator } from '@/components/settings/AutosaveIndicator';
import { useAutosaveFields, useSettingsAutosave } from '@/hooks/use-settings-autosave';

export type ServiceReminderMode = 'enabled' | 'disabled' | 'selective';

type ServiceReminderSettingsProps = {
  mode: ServiceReminderMode;
  excludedServiceIds: number[];
  canEdit: boolean;
  loaded: boolean;
};

export function ServiceReminderSettings({ mode, excludedServiceIds, canEdit, loaded }: ServiceReminderSettingsProps) {
  const qc = useQueryClient();
  const { data: servicesRaw, isLoading } = useListServices(
    { activeOnly: true },
    { query: { queryKey: getListServicesQueryKey({ activeOnly: true }) } },
  );
  const services = (Array.isArray(servicesRaw) ? servicesRaw : [])
    .filter(service => service.isActive !== false)
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name));
  const [draftMode, setDraftMode] = useState<ServiceReminderMode>(mode);
  const [excluded, setExcluded] = useState<number[]>(excludedServiceIds);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!loaded || ready) return;
    setDraftMode(mode);
    setExcluded(excludedServiceIds);
    setReady(true);
  }, [loaded, mode, excludedServiceIds, ready]);

  const save = useMutation({
    mutationFn: (body: { serviceRemindersMode: ServiceReminderMode; excludedReminderServiceIds: number[] }) =>
      customFetch('/api/settings', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: getGetTenantSettingsQueryKey() }); },
  });
  const saveRef = useRef(save.mutateAsync);
  saveRef.current = save.mutateAsync;
  const autosave = useSettingsAutosave(patch => saveRef.current(patch as { serviceRemindersMode: ServiceReminderMode; excludedReminderServiceIds: number[] }));
  useAutosaveFields(
    { serviceRemindersMode: draftMode, excludedReminderServiceIds: [...excluded].sort((a, b) => a - b) },
    ready,
    autosave.queue,
    canEdit,
  );

  const excludedSet = new Set(excluded);
  const toggle = (id: number, enabled: boolean) => {
    setExcluded(current => enabled ? current.filter(item => item !== id) : [...new Set([...current, id])]);
  };

  return (
    <div className="space-y-3" data-testid="service-reminder-settings">
      <div className="space-y-1.5">
        <label className="text-sm font-medium" htmlFor="select-service-reminder-mode">Automated reminders</label>
        <Select value={draftMode} onValueChange={value => setDraftMode(value as ServiceReminderMode)} disabled={!canEdit}>
          <SelectTrigger id="select-service-reminder-mode" className="w-80" data-testid="select-service-reminder-mode"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="enabled">Enabled</SelectItem>
            <SelectItem value="disabled">Disabled (Never send)</SelectItem>
            <SelectItem value="selective">Selective Services</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          {draftMode === 'disabled'
            ? 'No automated SMS, email, or push service reminders are queued. A manual reminder from a job can still be sent.'
            : draftMode === 'selective'
              ? 'Only checked services receive the 7-day and 24-hour reminders. Jobs for an unchecked service are skipped.'
              : 'Every scheduled job can receive the 7-day and 24-hour reminders, subject to the customer’s opt-out.'}
        </p>
      </div>
      {draftMode === 'selective' && (
        <div className="rounded-lg border" data-testid="service-reminder-checklist">
          <div className="flex items-center justify-between gap-3 border-b px-3 py-2">
            <p className="text-sm font-medium">Services that send reminders</p>
            <div className="flex gap-2">
              <Button type="button" size="sm" variant="ghost" className="h-7" disabled={!canEdit} onClick={() => setExcluded(current => current.filter(id => !services.some(service => service.id === id)))}>Select all</Button>
              <Button type="button" size="sm" variant="ghost" className="h-7" disabled={!canEdit} onClick={() => setExcluded(current => [...new Set([...current, ...services.map(service => service.id)])])}>Clear</Button>
            </div>
          </div>
          {isLoading ? <p className="p-3 text-sm text-muted-foreground">Loading services…</p> : services.length === 0 ? (
            <p className="p-3 text-sm text-muted-foreground">No active services yet. Add a service before choosing which reminders to send.</p>
          ) : (
            <ul className="max-h-64 overflow-y-auto divide-y">
              {services.map(service => {
                const checked = !excludedSet.has(service.id);
                return (
                  <li key={service.id} className="flex items-center gap-3 px-3 py-2">
                    <Checkbox
                      id={`service-reminder-${service.id}`}
                      checked={checked}
                      disabled={!canEdit}
                      onCheckedChange={value => toggle(service.id, value === true)}
                    />
                    <label htmlFor={`service-reminder-${service.id}`} className="text-sm">{service.name}</label>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
      <AutosaveIndicator label="Service reminders" status={autosave.status} hasUnsaved={autosave.hasUnsaved} onRetry={() => { void autosave.retry(); }} />
    </div>
  );
}
