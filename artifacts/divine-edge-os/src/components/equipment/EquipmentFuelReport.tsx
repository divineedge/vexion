import React, { useState } from 'react';
import {
  useGetEquipmentFuelUsage,
  getGetEquipmentFuelUsageQueryKey,
} from '@workspace/api-client-react';
import type { EquipmentFuelUsageRow } from '@workspace/api-client-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Droplet, BarChart3, TrendingUp, DollarSign } from 'lucide-react';

function fmt$(v: number | null | undefined) {
  if (v == null) return '—';
  return `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function EquipmentFuelReport({ equipmentId }: { equipmentId?: number }) {
  const [period, setPeriod] = useState<'week' | 'month' | 'year'>('month');
  const anchorDate = new Date().toISOString().slice(0, 10); // tenant today anchor

  const { data: report, isLoading, isError } = useGetEquipmentFuelUsage(
    { period, anchorDate, equipmentId },
    { query: { queryKey: getGetEquipmentFuelUsageQueryKey({ period, anchorDate, equipmentId }) } }
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">{equipmentId ? 'Fuel Consumption' : 'Fleet Fuel Usage'}</h3>
          {report && (
            <p className="text-sm text-muted-foreground mt-0.5">
              {new Date(report.from + 'T12:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })} — {new Date(report.to + 'T12:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
            </p>
          )}
        </div>
        <div className="w-[140px]">
          <Select value={period} onValueChange={(v: 'week' | 'month' | 'year') => setPeriod(v)}>
            <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="week">This Week</SelectItem>
              <SelectItem value="month">This Month</SelectItem>
              <SelectItem value="year">This Year</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {isLoading ? (
        <div className="py-12 text-center text-muted-foreground flex flex-col items-center border rounded-xl bg-muted/20">
          <BarChart3 className="w-8 h-8 text-muted/40 mb-3 animate-pulse" />
          Generating report...
        </div>
      ) : isError || !report ? (
        <div className="py-8 text-center text-destructive border border-destructive/20 rounded-xl bg-destructive/5">
          Failed to load fuel usage report.
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <Card>
              <CardHeader className="pb-2">
                <CardDescription className="text-xs font-semibold uppercase tracking-wider">Total Added</CardDescription>
                <CardTitle className="text-2xl font-mono">{report.totalGallons.toLocaleString(undefined, { maximumFractionDigits: 1 })} <span className="text-sm text-muted-foreground font-sans font-normal">gal</span></CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-xs text-muted-foreground space-y-1">
                  <div className="flex justify-between"><span>Bulk</span><span className="font-mono">{report.bulkGallons.toLocaleString(undefined, { maximumFractionDigits: 1 })}</span></div>
                  <div className="flex justify-between" title="Other / manually recorded fuel"><span>Other / manual</span><span className="font-mono">{report.purchasedGallons.toLocaleString(undefined, { maximumFractionDigits: 1 })}</span></div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription className="text-xs font-semibold uppercase tracking-wider">Total Cost</CardDescription>
                <CardTitle className="text-2xl font-mono">{fmt$(report.totalCost)}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-muted-foreground">Across {report.fillCount} fill event{report.fillCount !== 1 ? 's' : ''}</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription className="text-xs font-semibold uppercase tracking-wider">Blended Cost</CardDescription>
                <CardTitle className="text-2xl font-mono">{fmt$(report.averageCostPerGallon)}<span className="text-sm text-muted-foreground font-sans font-normal">/gal</span></CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-muted-foreground">Weighted average over {period}</p>
              </CardContent>
            </Card>
            {!equipmentId && (
              <Card>
                <CardHeader className="pb-2">
                  <CardDescription className="text-xs font-semibold uppercase tracking-wider">Equipment Fueled</CardDescription>
                  <CardTitle className="text-2xl font-mono">{report.equipment.length}</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-xs text-muted-foreground">Unique units</p>
                </CardContent>
              </Card>
            )}
          </div>

          {!equipmentId && report.equipment.length > 0 && (
            <div className="rounded-lg border overflow-hidden">
              <Table>
                <TableHeader className="bg-muted/50">
                  <TableRow>
                    <TableHead>Equipment</TableHead>
                    <TableHead className="text-right">Gallons</TableHead>
                    <TableHead className="text-right">Cost</TableHead>
                    <TableHead className="text-right">Avg $/Gal</TableHead>
                    <TableHead className="text-right">Fills</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {report.equipment.map((row: EquipmentFuelUsageRow) => (
                    <TableRow key={row.equipmentId}>
                      <TableCell className="font-medium">{row.equipmentName}</TableCell>
                      <TableCell className="text-right font-mono">
                        {row.totalGallons.toLocaleString(undefined, { maximumFractionDigits: 1 })}
                      </TableCell>
                      <TableCell className="text-right font-mono">{fmt$(row.totalCost)}</TableCell>
                      <TableCell className="text-right font-mono text-muted-foreground">{fmt$(row.averageCostPerGallon)}</TableCell>
                      <TableCell className="text-right text-muted-foreground">{row.fillCount}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          {!equipmentId && report.equipment.length === 0 && (
            <div className="text-center py-8 border rounded-lg bg-muted/10">
              <p className="text-sm text-muted-foreground">No fuel logged during this period.</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
