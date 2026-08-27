import React from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { CalendarCheck } from 'lucide-react';
import {
  CheckupData, OVERHEAD_CATEGORIES, OverheadLineItems, compareCheckup,
} from '@/lib/budgetCalc';
import { NumField, $, pct } from './shared';

function VarianceBadge({ varianceAbs, variancePct, goodDirection }: {
  varianceAbs: number; variancePct: number; goodDirection: 'lower' | 'higher';
}) {
  if (varianceAbs === 0) return <Badge variant="outline" className="text-[10px] px-1.5 py-0">on budget</Badge>;
  const isOver = varianceAbs > 0;
  const isGood = goodDirection === 'lower' ? !isOver : isOver;
  return (
    <Badge
      variant="outline"
      className={`text-[10px] px-1.5 py-0 ${isGood ? 'text-emerald-600 border-emerald-200' : 'text-red-600 border-red-200'}`}
    >
      {isOver ? '+' : ''}{$(varianceAbs)} ({isOver ? '+' : ''}{pct(variancePct)})
    </Badge>
  );
}

export function CheckupPanel({
  title, description, checkup, onChange, budgeted, readOnlyActuals,
}: {
  title: string;
  description: string;
  checkup: CheckupData;
  onChange: (c: CheckupData) => void;
  budgeted: { revenue: number; laborCost: number; materialCost: number; overheadByCategory: { key: keyof OverheadLineItems; label: string; annual: number }[] };
  readOnlyActuals?: boolean;
}) {
  const setField = <K extends keyof CheckupData>(key: K, val: CheckupData[K]) =>
    onChange({ ...checkup, [key]: val });
  const setOverhead = (key: keyof OverheadLineItems, val: number) =>
    onChange({ ...checkup, actualOverhead: { ...checkup.actualOverhead, [key]: val } });

  const { totals, overheadLines } = compareCheckup(checkup, budgeted);

  return (
    <Card>
      <CardHeader className="pb-2 pt-4">
        <CardTitle className="text-sm flex items-center gap-2">
          <CalendarCheck className="w-4 h-4 text-muted-foreground" /> {title}
        </CardTitle>
        <CardDescription className="text-xs">{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!readOnlyActuals && (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <NumField label="Actual Revenue" value={checkup.actualRevenue} onChange={v => setField('actualRevenue', v)} />
              <NumField label="Actual Labor Cost" value={checkup.actualLaborCost} onChange={v => setField('actualLaborCost', v)} />
              <NumField label="Actual Material Cost" value={checkup.actualMaterialCost} onChange={v => setField('actualMaterialCost', v)} />
            </div>
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">Actual Overhead by Category</p>
              <div className="grid grid-cols-2 gap-3">
                {OVERHEAD_CATEGORIES.map(({ key, label }) => (
                  <NumField
                    key={key}
                    label={label}
                    value={checkup.actualOverhead[key] ?? 0}
                    onChange={v => setOverhead(key, v)}
                  />
                ))}
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Notes</label>
              <Textarea
                value={checkup.notes}
                onChange={e => setField('notes', e.target.value)}
                placeholder="What's different from plan? Any decisions to make for the rest of the year?"
                className="text-sm"
              />
            </div>
          </>
        )}

        <div className="pt-2 border-t space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground mb-1">Budget vs. Actual</p>
          {totals.map(row => (
            <div key={row.key} className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">{row.label}</span>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">{$(row.budgeted)} budgeted</span>
                <span className="font-medium">{$(row.actual)}</span>
                <VarianceBadge varianceAbs={row.varianceAbs} variancePct={row.variancePct} goodDirection="lower" />
              </div>
            </div>
          ))}
          <details className="pt-1">
            <summary className="text-xs text-muted-foreground cursor-pointer">Overhead line-item breakdown</summary>
            <div className="mt-2 space-y-1.5">
              {overheadLines.map(row => (
                <div key={row.key} className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">{row.label}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground">{$(row.budgeted)} → {$(row.actual)}</span>
                    <VarianceBadge varianceAbs={row.varianceAbs} variancePct={row.variancePct} goodDirection="lower" />
                  </div>
                </div>
              ))}
            </div>
          </details>
        </div>

        {checkup.completedAt && (
          <p className="text-[11px] text-muted-foreground">
            Last updated {new Date(checkup.completedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
