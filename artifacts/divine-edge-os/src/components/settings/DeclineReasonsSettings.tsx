import React, { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useGetTenantSettings, getGetTenantSettingsQueryKey, useUpdateTenantSettings } from '@workspace/api-client-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { useSettingsAutosave, useAutosaveFields } from '@/hooks/use-settings-autosave';
import { AutosaveIndicator } from '@/components/settings/AutosaveIndicator';
import { Plus, Trash2, ArrowUp, ArrowDown } from 'lucide-react';

const MAX_REASONS = 20;
const MAX_LEN = 100;

export default function DeclineReasonsSettings() {
  const qc = useQueryClient();
  const { data: settings, isLoading } = useGetTenantSettings({ query: { queryKey: getGetTenantSettingsQueryKey() } });
  const update = useUpdateTenantSettings();
  const [items, setItems] = useState<string[]>([]);
  const [draft, setDraft] = useState('');
  const [loadedOnce, setLoadedOnce] = useState(false);

  useEffect(() => {
    if (settings && !loadedOnce) {
      setItems(settings.estimateDeclineReasons ?? []);
      setLoadedOnce(true);
    }
  }, [settings, loadedOnce]);

  const add = () => {
    const v = draft.trim();
    if (!v) return;
    if (v.toLowerCase() === 'other') { toast.error('"Other" is always shown to customers automatically'); return; }
    if (items.some(i => i.toLowerCase() === v.toLowerCase())) { toast.error('That reason already exists'); return; }
    if (items.length >= MAX_REASONS) { toast.error(`Up to ${MAX_REASONS} reasons`); return; }
    setItems([...items, v.slice(0, MAX_LEN)]);
    setDraft('');
  };
  const move = (i: number, d: -1 | 1) => {
    const j = i + d; if (j < 0 || j >= items.length) return;
    const next = [...items]; [next[i], next[j]] = [next[j], next[i]]; setItems(next);
  };
  const mutateAsyncRef = useRef(update.mutateAsync); mutateAsyncRef.current = update.mutateAsync;
  const autosave = useSettingsAutosave(
    patch => mutateAsyncRef.current({ data: patch as { estimateDeclineReasons: string[] } }),
    { onSaved: () => qc.invalidateQueries({ queryKey: getGetTenantSettingsQueryKey() }) },
  );
  useAutosaveFields({ estimateDeclineReasons: items.map(i => i.trim()).filter(Boolean) }, loadedOnce, autosave.queue);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Estimate Decline Reasons</CardTitle>
        <CardDescription>Choices customers see when declining an estimate. "Other" with a written reason is always available. Renaming or removing a reason does not change reasons already recorded on past estimates.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading ? (
          <div className="space-y-2">{[0, 1, 2].map(i => <div key={i} className="h-9 rounded-md bg-muted animate-pulse" />)}</div>
        ) : (
          <>
            {items.length === 0 && <p className="text-sm text-muted-foreground">No custom reasons. Customers will only see "Other".</p>}
            {items.map((r, i) => (
              <div key={i} className="flex items-center gap-2">
                <Input value={r} maxLength={MAX_LEN} onChange={e => setItems(items.map((x, k) => k === i ? e.target.value : x))} />
                <Button variant="ghost" size="icon" title="Move up" disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp className="w-4 h-4" /></Button>
                <Button variant="ghost" size="icon" title="Move down" disabled={i === items.length - 1} onClick={() => move(i, 1)}><ArrowDown className="w-4 h-4" /></Button>
                <Button variant="ghost" size="icon" title="Remove reason" onClick={() => setItems(items.filter((_, k) => k !== i))}><Trash2 className="w-4 h-4" /></Button>
              </div>
            ))}
            <div className="flex items-center gap-2">
              <Input placeholder="Add a reason, e.g. Went with another company" value={draft} maxLength={MAX_LEN} onChange={e => setDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} />
              <Button variant="outline" className="gap-1.5" onClick={add} disabled={items.length >= MAX_REASONS}><Plus className="w-4 h-4" />Add</Button>
            </div>
            <div className="flex items-center justify-between pt-1">
              <span className="text-xs text-muted-foreground">{items.length}/{MAX_REASONS} reasons, plus Other</span>
              <AutosaveIndicator status={autosave.status} hasUnsaved={autosave.hasUnsaved} onRetry={() => { void autosave.retry(); }} />
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
