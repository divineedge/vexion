import React from 'react';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';

/**
 * Editable wording with three explicit states:
 *  - null  -> inherits the default (shown read-only, labelled with its source)
 *  - ''    -> explicitly suppressed (nothing printed)
 *  - text  -> override
 */
export function WordingField({ label, value, onChange, defaultText, defaultSource, rows = 3, disabled, id }: {
  label: string;
  value: string | null;
  onChange: (v: string | null) => void;
  defaultText?: string | null;
  defaultSource: string;
  rows?: number;
  disabled?: boolean;
  id?: string;
}) {
  const state = value === null ? 'inherit' : value === '' ? 'none' : 'override';
  const fieldId = id ?? `wording-${label.toLowerCase().replace(/\W+/g, '-')}`;
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label htmlFor={fieldId} className="text-sm font-medium">{label}</label>
        <div className="flex rounded-md border p-0.5 text-xs" role="radiogroup" aria-label={`${label} source`}>
          {([['inherit', 'Use default'], ['override', 'Custom'], ['none', 'None']] as const).map(([k, l]) => (
            <Button
              key={k}
              type="button"
              size="sm"
              variant={state === k ? 'secondary' : 'ghost'}
              className="h-6 px-2 text-xs"
              role="radio"
              aria-checked={state === k}
              disabled={disabled}
              onClick={() => onChange(k === 'inherit' ? null : k === 'none' ? '' : (value || defaultText || ' ').trimStart() || ' ')}
            >
              {l}
            </Button>
          ))}
        </div>
      </div>
      {state === 'inherit' && (
        <div className="rounded-md border border-dashed bg-muted/30 p-2.5 text-sm text-muted-foreground whitespace-pre-wrap">
          <span className="block text-[11px] uppercase tracking-wide font-semibold mb-1">From {defaultSource}</span>
          {defaultText?.trim() ? defaultText : <em>No default set.</em>}
        </div>
      )}
      {state === 'override' && (
        <>
          <Textarea id={fieldId} rows={rows} value={value ?? ''} onChange={e => onChange(e.target.value === '' ? ' ' : e.target.value)} disabled={disabled} />
          <p className="text-xs text-muted-foreground">Overrides the {defaultSource}.</p>
        </>
      )}
      {state === 'none' && <p className="text-xs text-muted-foreground rounded-md border border-dashed p-2.5">No {label.toLowerCase()} will be printed.</p>}
    </div>
  );
}
