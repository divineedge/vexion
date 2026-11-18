import React, { useState } from 'react';
import { clampAnnualWorkingWeeks, annualizedExpense, monthlyExpense, type ExpenseFrequency } from '@/lib/budgetCalc';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { ChevronDown, ChevronRight, ArrowUp, ArrowDown, Minus } from 'lucide-react';

export const $ = (n: number, d = 0) =>
  `$${(n || 0).toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d })}`;
export const pct = (n: number) => `${(n || 0).toFixed(1)}%`;

/** Text while focused so a partial entry such as "4" is not replaced by the saved number. */
export function AnnualWorkingWeeksField({
  value, onCommit, onDraft,
}: {
  value: number;
  onCommit: (weeks: number) => void;
  onDraft?: (text: string) => void;
}) {
  const [text, setText] = React.useState(String(value));
  const focused = React.useRef(false);
  React.useEffect(() => {
    if (!focused.current) setText(String(value));
  }, [value]);
  return (
    <div className="space-y-1">
      <label className="text-xs font-medium text-muted-foreground" htmlFor="annual-working-weeks">Annual Working Weeks</label>
      <Input
        id="annual-working-weeks"
        data-testid="input-annual-working-weeks"
        inputMode="numeric"
        value={text}
        onFocus={() => { focused.current = true; }}
        onChange={e => {
          const next = e.target.value.replace(/[^\d]/g, '').slice(0, 2);
          setText(next);
          onDraft?.(next);
        }}
        onBlur={() => {
          focused.current = false;
          const next = clampAnnualWorkingWeeks(text, value);
          setText(String(next));
          onDraft?.(String(next));
          if (next !== value) onCommit(next);
        }}
        className="w-24"
      />
      <p className="text-[11px] text-muted-foreground">1–52. Checked when you leave the field or save.</p>
    </div>
  );
}

export function NumField({
  label, value, onChange, prefix = '$', hint, min = 0, testId,
}: {
  label: string; value: number; onChange: (v: number) => void;
  prefix?: string; hint?: string; min?: number; testId?: string;
}) {
  return (
    <div className="space-y-1">
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      <div className="relative">
        {prefix && (
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground pointer-events-none">
            {prefix}
          </span>
        )}
        <Input
          type="number"
          min={min}
          value={value}
          data-testid={testId}
          onChange={e => onChange(parseFloat(e.target.value) || 0)}
          className={prefix ? 'pl-7' : ''}
        />
      </div>
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function FrequencySelect({
  value, onChange, testId,
}: {
  value: ExpenseFrequency;
  onChange: (frequency: ExpenseFrequency) => void;
  testId?: string;
}) {
  return (
    <select
      aria-label="Expense frequency"
      data-testid={testId}
      className="h-9 rounded-md border bg-background px-2 text-sm"
      value={value}
      onChange={e => onChange(e.target.value === 'annual' ? 'annual' : 'monthly')}
    >
      <option value="monthly">Monthly</option>
      <option value="annual">Annual</option>
    </select>
  );
}

export function ExpenseLineEditor({
  label, amount, frequency, onAmount, onFrequency, testId, amountTestId, note, noteTestId,
}: {
  label: string;
  amount: number;
  frequency: ExpenseFrequency;
  onAmount: (amount: number) => void;
  onFrequency: (frequency: ExpenseFrequency) => void;
  testId?: string;
  amountTestId?: string;
  note?: string | null;
  noteTestId?: string;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <NumField label={label} value={amount} onChange={onAmount} testId={amountTestId} />
        </div>
        <FrequencySelect value={frequency} onChange={onFrequency} testId={testId} />
      </div>
      <p className="text-[11px] text-muted-foreground">
        {$(monthlyExpense(amount, frequency))}/mo · {$(annualizedExpense(amount, frequency))}/yr
      </p>
      {note ? <p className="text-[11px] text-muted-foreground" data-testid={noteTestId}>{note}</p> : null}
    </div>
  );
}

/** Prior-year price shown on a calculation, not on an input. */
export function PriorYearPrice({ year, text, testId, inverse = false }: {
  year: number; text: string; testId: string; inverse?: boolean;
}) {
  return (
    <p className={`text-xs mt-1 ${inverse ? 'text-primary-foreground/80' : 'text-muted-foreground'}`} data-testid={testId}>
      {year}: {text}
    </p>
  );
}

export function Section({ title, icon: Icon, children, defaultOpen = true }: {
  title: string; icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode; defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Card>
      <button className="w-full text-left" onClick={() => setOpen(!open)}>
        <CardHeader className="pb-2 pt-4 px-4">
          <CardTitle className="text-sm font-semibold flex items-center justify-between gap-2">
            <span className="flex items-center gap-2">
              <Icon className="w-4 h-4 text-muted-foreground" /> {title}
            </span>
            {open ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
          </CardTitle>
        </CardHeader>
      </button>
      {open && (
        <CardContent className="pt-0 pb-4 px-4">
          {children}
        </CardContent>
      )}
    </Card>
  );
}

export function ResultCard({ label, value, sub, highlight, trend, info }: {
  label: string; value: string; sub?: string; highlight?: boolean; trend?: 'up' | 'down' | 'neutral';
  info?: React.ReactNode;
}) {
  return (
    <div className={`rounded-xl border p-4 ${highlight ? 'bg-primary text-primary-foreground border-primary' : 'bg-card'}`}>
      <div className="flex items-start justify-between gap-1 mb-1">
        <p className={`text-xs font-medium ${highlight ? 'text-primary-foreground/70' : 'text-muted-foreground'}`}>{label}</p>
        {info}
      </div>
      <div className="flex items-end gap-1">
        <p className={`text-2xl font-bold leading-none ${highlight ? 'text-primary-foreground' : ''}`}>{value}</p>
        {trend === 'up' && <ArrowUp className="w-3.5 h-3.5 text-emerald-500 mb-0.5" />}
        {trend === 'down' && <ArrowDown className="w-3.5 h-3.5 text-red-500 mb-0.5" />}
        {trend === 'neutral' && <Minus className="w-3.5 h-3.5 text-muted-foreground mb-0.5" />}
      </div>
      {sub && <p className={`text-xs mt-1 ${highlight ? 'text-primary-foreground/60' : 'text-muted-foreground'}`}>{sub}</p>}
    </div>
  );
}
