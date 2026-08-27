import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { ChevronDown, ChevronRight, ArrowUp, ArrowDown, Minus } from 'lucide-react';

export const $ = (n: number, d = 0) =>
  `$${(n || 0).toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d })}`;
export const pct = (n: number) => `${(n || 0).toFixed(1)}%`;

export function NumField({
  label, value, onChange, prefix = '$', hint, min = 0,
}: {
  label: string; value: number; onChange: (v: number) => void;
  prefix?: string; hint?: string; min?: number;
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
          onChange={e => onChange(parseFloat(e.target.value) || 0)}
          className={prefix ? 'pl-7' : ''}
        />
      </div>
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
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

export function ResultCard({ label, value, sub, highlight, trend }: {
  label: string; value: string; sub?: string; highlight?: boolean; trend?: 'up' | 'down' | 'neutral';
}) {
  return (
    <div className={`rounded-xl border p-4 ${highlight ? 'bg-primary text-primary-foreground border-primary' : 'bg-card'}`}>
      <p className={`text-xs font-medium mb-1 ${highlight ? 'text-primary-foreground/70' : 'text-muted-foreground'}`}>{label}</p>
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
