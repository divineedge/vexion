import { Check, Loader2, AlertTriangle, CloudUpload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { AutosaveStatus } from '@/lib/settingsAutosave';

export function AutosaveIndicator({ status, hasUnsaved, onRetry, label }: { status: AutosaveStatus; hasUnsaved?: boolean; onRetry: () => void; label?: string }) {
  if (status === 'error') {
    return (
      <div className="flex items-center gap-2 text-sm text-destructive" role="alert" data-testid="autosave-error">
        <AlertTriangle className="w-4 h-4" /> Could not save{label ? ` ${label}` : ''}. Your edits are kept.
        <Button size="sm" variant="outline" className="h-7" onClick={onRetry} data-testid="button-autosave-retry">Retry</Button>
      </div>
    );
  }
  const map = {
    idle: null,
    pending: <><CloudUpload className="w-4 h-4" /> Unsaved changes…</>,
    saving: <><Loader2 className="w-4 h-4 animate-spin" /> Saving…</>,
    saved: <><Check className="w-4 h-4 text-emerald-600" /> {label ? `${label} saved` : 'Changes saved'}</>,
  } as const;
  const content = map[status];
  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground" aria-live="polite" data-testid={`autosave-${status}`}>
      {content}
      {status === 'pending' && hasUnsaved && <Button size="sm" variant="ghost" className="h-7" onClick={onRetry}>Save now</Button>}
    </div>
  );
}
