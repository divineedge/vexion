import { AlertTriangle, X } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import type { FeatureDef } from '@/lib/softwareBilling';

/**
 * Plan feature picker driven entirely by the server feature catalog.
 * Unknown legacy strings are preserved in `value` and shown as unmapped until a human removes them.
 */
export function FeatureChecklist({ catalog, value, onChange }: { catalog: FeatureDef[]; value: string[]; onChange: (next: string[]) => void }) {
  const known = new Set(catalog.map(f => f.key));
  const unmapped = value.filter(v => !known.has(v));
  const toggle = (key: string, on: boolean) => onChange(on ? (value.includes(key) ? value : [...value, key]) : value.filter(v => v !== key));
  const selectedCount = value.filter(v => known.has(v)).length;

  return (
    <div className="space-y-2" data-testid="feature-checklist">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{selectedCount} of {catalog.length} modules included</span>
        {catalog.length > 0 && (
          <span className="flex gap-2">
            <button type="button" className="underline-offset-2 hover:underline" onClick={() => onChange([...unmapped, ...catalog.map(f => f.key)])} data-testid="button-features-all">Select all</button>
            <button type="button" className="underline-offset-2 hover:underline" onClick={() => onChange(unmapped)} data-testid="button-features-none">Clear</button>
          </span>
        )}
      </div>
      {catalog.length === 0 ? (
        <p className="rounded-md border border-dashed p-3 text-xs text-muted-foreground" data-testid="empty-feature-catalog">The server did not return a feature catalog. Features cannot be selected until it is available.</p>
      ) : (
        <div className="grid sm:grid-cols-2 gap-1.5 max-h-64 overflow-y-auto rounded-md border p-2">
          {catalog.map(f => {
            const checked = value.includes(f.key);
            return (
              <label key={f.key} className={`flex items-start gap-2 rounded-md p-2 cursor-pointer transition-colors ${checked ? 'bg-primary/5' : 'hover:bg-muted/60'}`} data-testid={`feature-option-${f.key}`}>
                <Checkbox checked={checked} onCheckedChange={v => toggle(f.key, v === true)} className="mt-0.5" data-testid={`checkbox-feature-${f.key}`} />
                <span className="min-w-0">
                  <span className="block text-sm font-medium leading-tight">{f.label}</span>
                  <span className="block text-[11px] text-muted-foreground leading-snug">{f.description}</span>
                </span>
              </label>
            );
          })}
        </div>
      )}
      {unmapped.length > 0 && (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 space-y-2" data-testid="warning-unmapped-features">
          <div className="flex gap-2"><AlertTriangle className="w-4 h-4 shrink-0" />
            <p><b>{unmapped.length} legacy feature{unmapped.length === 1 ? '' : 's'} not in the catalog.</b> These are kept as-is and grant nothing. Map each one by checking the matching module above, then remove it. Publishing is rejected while unmapped features remain.</p>
          </div>
          <ul className="flex flex-wrap gap-1.5">
            {unmapped.map(u => (
              <li key={u} className="flex items-center gap-1 rounded border border-amber-300 bg-background/70 pl-2 pr-0.5 py-0.5">
                <span className="font-mono">{u}</span>
                <Button type="button" size="icon" variant="ghost" className="h-5 w-5" aria-label={`Remove unmapped feature ${u}`} onClick={() => onChange(value.filter(v => v !== u))} data-testid={`button-remove-unmapped-${u}`}><X className="w-3 h-3" /></Button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
