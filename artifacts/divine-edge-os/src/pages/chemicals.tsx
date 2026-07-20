import React, { useState } from 'react';
import { useListChemicalApplications, useListUsers, getListChemicalApplicationsQueryKey } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { format } from 'date-fns';
import { FlaskConical, Download, Filter, ChevronDown, ChevronRight } from 'lucide-react';

export default function ChemicalsReportPage() {
  const { isAuthenticated } = useAuth();
  const qc = useQueryClient();

  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [applicatorId, setApplicatorId] = useState('');
  const [expandedId, setExpandedId] = useState<number | null>(null);

  // Build query params
  const params: Record<string, string | number | undefined> = {};
  if (startDate) params.startDate = startDate;
  if (endDate) params.endDate = endDate;
  if (applicatorId && applicatorId !== 'all') params.applicatorId = parseInt(applicatorId, 10);

  const { data: applications, isLoading } = useListChemicalApplications(
    Object.keys(params).length ? params : undefined,
    { query: { queryKey: getListChemicalApplicationsQueryKey(Object.keys(params).length ? params : undefined) } }
  );

  const { data: users } = useListUsers();

  const handleExportPDF = () => {
    window.print();
  };

  const handleExportCSV = () => {
    const base = `${window.location.origin}/api/chemical-applications/export`;
    const qs = new URLSearchParams();
    if (startDate) qs.set('startDate', startDate);
    if (endDate) qs.set('endDate', endDate);
    if (applicatorId && applicatorId !== 'all') qs.set('applicatorId', applicatorId);
    const url = qs.toString() ? `${base}?${qs}` : base;
    const a = document.createElement('a');
    a.href = url;
    a.download = '';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const SIGNAL_COLORS: Record<string, string> = {
    CAUTION: 'bg-yellow-100 text-yellow-800 border-yellow-200',
    WARNING: 'bg-orange-100 text-orange-800 border-orange-200',
    DANGER: 'bg-red-100 text-red-800 border-red-200',
  };

  return (
    <div className="space-y-6 max-w-6xl mx-auto animate-in fade-in duration-500">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <FlaskConical className="w-8 h-8 text-primary" />
            Chemical Applications Report
          </h1>
          <p className="text-muted-foreground mt-1">Complete application history for state compliance reporting.</p>
        </div>
        <div className="flex gap-2 print:hidden">
          <Button variant="outline" onClick={handleExportCSV} className="gap-2">
            <Download className="w-4 h-4" /> Export CSV
          </Button>
          <Button variant="outline" onClick={handleExportPDF} className="gap-2">
            <Download className="w-4 h-4" /> Export PDF
          </Button>
        </div>
      </div>

      {/* Filters */}
      <Card className="print:hidden">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2"><Filter className="w-4 h-4" /> Filters</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Start Date</label>
              <Input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">End Date</label>
              <Input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Applicator</label>
              <Select value={applicatorId} onValueChange={setApplicatorId}>
                <SelectTrigger><SelectValue placeholder="All applicators" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All applicators</SelectItem>
                  {(users ?? []).map(u => (
                    <SelectItem key={u.id} value={String(u.id)}>{u.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end">
              <Button variant="outline" onClick={() => { setStartDate(''); setEndDate(''); setApplicatorId(''); }} className="w-full">
                Clear Filters
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Results */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Application Records</CardTitle>
            <span className="text-sm text-muted-foreground">
              {applications?.length ?? 0} record{(applications?.length ?? 0) !== 1 ? 's' : ''}
            </span>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-8 text-center text-muted-foreground">Loading records…</div>
          ) : !applications?.length ? (
            <div className="p-8 text-center text-muted-foreground">
              <FlaskConical className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p>No application records found for the selected filters.</p>
            </div>
          ) : (
            <div className="divide-y">
              {applications.map(app => (
                <div key={app.id}>
                  {/* Summary row */}
                  <div
                    className="flex items-center gap-4 px-6 py-4 cursor-pointer hover:bg-muted/30 transition-colors"
                    onClick={() => setExpandedId(expandedId === app.id ? null : app.id)}
                  >
                    <div className="shrink-0 text-muted-foreground">
                      {expandedId === app.id ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                    </div>
                    <div className="flex-1 min-w-0 grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                      <div>
                        <p className="font-medium">{app.mixtureName ?? app.productName ?? 'Unknown'}</p>
                        <p className="text-muted-foreground text-xs">{app.jobTitle ?? `Job #${app.jobId}`}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground text-xs uppercase tracking-wide">Volume</p>
                        <p className="font-medium">{app.volumeApplied} {app.volumeUnit}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground text-xs uppercase tracking-wide">Applied</p>
                        <p className="font-medium">{format(new Date(app.appliedAt), 'MMM d, yyyy')}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground text-xs uppercase tracking-wide">Applicator</p>
                        <p className="font-medium truncate">{app.applicatorName ?? '—'}</p>
                      </div>
                    </div>
                    {app.applicationMethod && (
                      <Badge variant="outline" className="shrink-0 capitalize">{app.applicationMethod}</Badge>
                    )}
                  </div>

                  {/* Expanded detail */}
                  {expandedId === app.id && (
                    <div className="bg-muted/20 border-t px-6 py-4 space-y-4">
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                        {app.targetPest && (
                          <div>
                            <p className="text-xs text-muted-foreground uppercase tracking-wide">Target Pest</p>
                            <p>{app.targetPest}</p>
                          </div>
                        )}
                        {app.propertyAddress && (
                          <div>
                            <p className="text-xs text-muted-foreground uppercase tracking-wide">Property</p>
                            <p>{app.propertyAddress}</p>
                          </div>
                        )}
                        {app.temperature != null && (
                          <div>
                            <p className="text-xs text-muted-foreground uppercase tracking-wide">Temperature</p>
                            <p>{app.temperature}°F</p>
                          </div>
                        )}
                        {app.windSpeed != null && (
                          <div>
                            <p className="text-xs text-muted-foreground uppercase tracking-wide">Wind</p>
                            <p>{app.windSpeed} mph {app.windDirection ?? ''}</p>
                          </div>
                        )}
                        {app.applicatorLicenseNumber && (
                          <div>
                            <p className="text-xs text-muted-foreground uppercase tracking-wide">License #</p>
                            <p className="font-mono text-xs">{app.applicatorLicenseNumber}</p>
                          </div>
                        )}
                      </div>

                      {/* Per-ingredient breakdown */}
                      {Array.isArray(app.breakdown) && app.breakdown.length > 0 && (
                        <div>
                          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Active Ingredient Breakdown</p>
                          <div className="rounded-lg border overflow-hidden">
                            <Table>
                              <TableHeader>
                                <TableRow>
                                  <TableHead>Product</TableHead>
                                  <TableHead>Active Ingredients</TableHead>
                                  <TableHead>EPA Reg #</TableHead>
                                  <TableHead>Amount Applied</TableHead>
                                  <TableHead>Rate / Acre</TableHead>
                                  <TableHead>Rate / 1000 sqft</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {(app.breakdown as Array<{
                                  productName?: string | null;
                                  activeIngredients?: string | null;
                                  epaRegNumber?: string | null;
                                  amountApplied: number;
                                  unit: string;
                                  ratePerAcre?: number | null;
                                  ratePer1000Sqft?: number | null;
                                }>).map((b, i) => (
                                  <TableRow key={i}>
                                    <TableCell className="font-medium">{b.productName ?? '—'}</TableCell>
                                    <TableCell className="text-sm">{b.activeIngredients ?? '—'}</TableCell>
                                    <TableCell className="font-mono text-xs">{b.epaRegNumber ?? '—'}</TableCell>
                                    <TableCell>{b.amountApplied?.toFixed(2)} {b.unit}</TableCell>
                                    <TableCell>{b.ratePerAcre != null ? `${b.ratePerAcre.toFixed(3)}` : '—'}</TableCell>
                                    <TableCell>{b.ratePer1000Sqft != null ? `${b.ratePer1000Sqft.toFixed(3)}` : '—'}</TableCell>
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                          </div>
                        </div>
                      )}

                      {app.notes && (
                        <div>
                          <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Notes</p>
                          <p className="text-sm">{app.notes}</p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
