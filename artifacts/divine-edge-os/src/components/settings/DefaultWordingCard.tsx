import React, { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useGetTenantSettings, getGetTenantSettingsQueryKey, useUpdateTenantSettings } from '@workspace/api-client-react';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

/**
 * Company-wide default terms + notes for invoices or estimates, with its own save.
 * Blank saves '' (prints nothing). New templates/forms start from these values.
 * Existing documents keep their snapshot and are not changed.
 */
export function DefaultWordingCard({ kind }: { kind: 'invoice' | 'estimate' }) {
  const qc = useQueryClient();
  const { data: settings } = useGetTenantSettings({ query: { queryKey: getGetTenantSettingsQueryKey() } });
  const update = useUpdateTenantSettings();
  const termsKey = kind === 'invoice' ? 'defaultInvoiceTerms' : 'defaultEstimateTerms';
  const notesKey = kind === 'invoice' ? 'defaultInvoiceNotes' : 'defaultEstimateNotes';
  const [terms, setTerms] = useState('');
  const [notes, setNotes] = useState('');
  const initialized = useRef(false);

  useEffect(() => {
    if (settings && !initialized.current) {
      initialized.current = true;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const s = settings as any;
      setTerms(s[termsKey] ?? '');
      setNotes(s[notesKey] ?? '');
    }
  }, [settings, termsKey, notesKey]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = (settings ?? {}) as any;
  const dirty = terms !== (s[termsKey] ?? '') || notes !== (s[notesKey] ?? '');
  const label = kind === 'invoice' ? 'invoice' : 'estimate';

  const save = () => {
    update.mutate(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { data: { [termsKey]: terms.trim() === '' ? '' : terms, [notesKey]: notes.trim() === '' ? '' : notes } as any },
      {
        onSuccess: () => { toast.success(`Default ${label} wording saved`); qc.invalidateQueries({ queryKey: getGetTenantSettingsQueryKey() }); },
        onError: () => toast.error(`Failed to save default ${label} wording`),
      },
    );
  };

  return (
    <div className="space-y-3 rounded-lg border p-4" data-testid={`default-wording-${kind}`}>
      <div>
        <p className="text-sm font-medium">Default {label} terms &amp; notes</p>
        <p className="text-xs text-muted-foreground">New {label} templates and new {label}s start with this wording; each can override or clear it. Already-issued {label}s keep the wording they were created with.</p>
      </div>
      <div className="space-y-1.5">
        <label className="text-sm font-medium" htmlFor={`def-${kind}-terms`}>Default terms</label>
        <Textarea id={`def-${kind}-terms`} rows={3} value={terms} onChange={e => setTerms(e.target.value)} placeholder="Leave blank for no default terms" />
      </div>
      <div className="space-y-1.5">
        <label className="text-sm font-medium" htmlFor={`def-${kind}-notes`}>Default notes</label>
        <Textarea id={`def-${kind}-notes`} rows={2} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Leave blank for no default notes" />
      </div>
      <div className="flex items-center gap-2">
        <Button size="sm" onClick={save} disabled={update.isPending || !dirty} data-testid={`button-save-default-wording-${kind}`}>
          {update.isPending ? 'Saving…' : 'Save wording'}
        </Button>
        {dirty && <span className="text-xs text-amber-700">Unsaved changes</span>}
      </div>
    </div>
  );
}
