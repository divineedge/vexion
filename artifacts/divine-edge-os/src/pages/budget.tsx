import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import {
  Save, Loader2, ShieldAlert, CheckCircle2, Plus, X, Pencil, Building2, Printer,
} from 'lucide-react';
import { customFetch, useListServices, getListServicesQueryKey } from '@workspace/api-client-react';
import { Checkbox } from '@/components/ui/checkbox';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import {
  BudgetYear, DivisionBudget, defaultBudgetYear, defaultDivision,
  migrateBudgetPayload, computeDivision,
} from '@/lib/budgetCalc';
import { DivisionPanel } from '@/components/budget/DivisionPanel';
import { CompanyTotalPanel } from '@/components/budget/CompanyTotalPanel';

const COMPANY_TAB = '__company__';

export default function BudgetPage() {
  const { canManageOffice } = useAuth();
  const [years, setYears] = useState<BudgetYear[]>([]);
  const [currentYear, setCurrentYear] = useState<number>(new Date().getFullYear());
  const [activeTab, setActiveTab] = useState<string>(COMPANY_TAB);
  const [saving, setSaving] = useState(false);
  const [divisionSaving, setDivisionSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);
  const { data: serviceData, isLoading: servicesLoading, isError: servicesError, refetch: reloadServices } = useListServices(
    undefined, { query: { queryKey: getListServicesQueryKey(), enabled: canManageOffice } },
  );

  useEffect(() => {
    customFetch<{ budgetData: unknown }>('/api/settings/budget')
      .then((data: { budgetData: unknown } | null) => {
        const migrated = migrateBudgetPayload(data?.budgetData);
        if (migrated.length > 0) {
          setYears(migrated);
          const sorted = [...migrated].sort((a, b) => b.year - a.year);
          setCurrentYear(sorted[0].year);
          setActiveTab(sorted[0].divisions[0]?.id ?? COMPANY_TAB);
        } else {
          const fresh = defaultBudgetYear();
          setYears([fresh]);
          setCurrentYear(fresh.year);
          setActiveTab(fresh.divisions[0].id);
        }
      })
      .catch(() => {
        setLoadError(true);
      })
      .finally(() => setLoading(false));
  }, []);

  const year = useMemo(
    () => years.find(y => y.year === currentYear) ?? defaultBudgetYear(currentYear),
    [years, currentYear],
  );
  const previousYear = useMemo(() => {
    const candidates = years.filter(y => y.year < currentYear).sort((a, b) => b.year - a.year);
    return candidates[0] ?? null;
  }, [years, currentYear]);

  const updateYear = useCallback((updater: (y: BudgetYear) => BudgetYear) => {
    setYears(prev => {
      const exists = prev.some(y => y.year === currentYear);
      if (!exists) return [...prev, updater(defaultBudgetYear(currentYear))];
      return prev.map(y => (y.year === currentYear ? updater(y) : y));
    });
  }, [currentYear]);

  const updateDivision = (divisionId: string, updated: DivisionBudget) => {
    updateYear(y => ({ ...y, divisions: y.divisions.map(d => (d.id === divisionId ? updated : d)) }));
  };

  const addDivision = async () => {
    const name = `Division ${year.divisions.length + 1}`;
    const newDiv = defaultDivision(name);
    const nextYears = years.map(y => y.year === currentYear
      ? { ...y, divisions: [...y.divisions, newDiv] }
      : y);
    setYears(nextYears);
    setActiveTab(newDiv.id);
    setDivisionSaving(true);
    try {
      await customFetch('/api/settings/budget', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ budgetData: nextYears }),
      });
      setRenamingId(newDiv.id);
    } catch {
      setYears(prev => prev.map(y => y.year === currentYear
        ? { ...y, divisions: y.divisions.filter(d => d.id !== newDiv.id) }
        : y));
      setActiveTab(COMPANY_TAB);
      toast.error('Failed to add division');
    } finally {
      setDivisionSaving(false);
    }
  };

  const removeDivision = (divisionId: string) => {
    if (year.divisions.length <= 1) {
      toast.error('You need at least one division');
      return;
    }
    updateYear(y => ({ ...y, divisions: y.divisions.filter(d => d.id !== divisionId) }));
    setActiveTab(COMPANY_TAB);
  };

  const renameDivision = async (divisionId: string, name: string): Promise<boolean> => {
    const trimmed = name.trim();
    if (!trimmed) return false;
    const previousName = years
      .find(y => y.year === currentYear)
      ?.divisions.find(d => d.id === divisionId)?.name;
    if (!previousName || previousName === trimmed) return true;
    const nextYears = years.map(y => y.year === currentYear ? {
      ...y,
      divisions: y.divisions.map(d => (d.id === divisionId ? { ...d, name: trimmed } : d)),
    } : y);
    setYears(nextYears);
    setDivisionSaving(true);
    try {
      await customFetch(`/api/settings/budget/divisions/${encodeURIComponent(divisionId)}/name`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ year: currentYear, name: trimmed }),
      });
      toast.success('Division name saved');
      return true;
    } catch {
      setYears(prev => prev.map(y => y.year === currentYear ? {
        ...y,
        divisions: y.divisions.map(d => (
          d.id === divisionId && d.name === trimmed ? { ...d, name: previousName } : d
        )),
      } : y));
      toast.error('Failed to save division name');
      return false;
    } finally {
      setDivisionSaving(false);
    }
  };

  const handleSave = async () => {
    if (renamingId || divisionSaving) {
      toast.info('Finish editing the division name before saving the budget');
      return;
    }
    setSaving(true);
    const toSave = years.map(y => (y.year === currentYear ? { ...y, savedAt: new Date().toISOString() } : y));
    try {
      await customFetch('/api/settings/budget', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ budgetData: toSave }),
      });
      setYears(toSave);
      toast.success('Budget saved');
    } catch {
      toast.error('Failed to save budget');
    } finally {
      setSaving(false);
    }
  };

  const handlePrint = () => {
    window.print();
  };

  if (!canManageOffice) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center gap-3">
        <ShieldAlert className="w-10 h-10 text-muted-foreground" />
        <h2 className="text-xl font-semibold">Budget is restricted</h2>
        <p className="text-muted-foreground max-w-sm">Only owners and managers can access the budget calculator.</p>
      </div>
    );
  }

  if (loading) {
    return <div className="flex items-center justify-center py-24"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;
  }
  if (loadError) {
    return <Card><CardContent className="p-6 space-y-3">
      <p>Budget could not be loaded. Your saved budget has not been replaced.</p>
      <Button onClick={() => window.location.reload()}>Reload Budget</Button>
    </CardContent></Card>;
  }

  const activeDivision = year.divisions.find(d => d.id === activeTab) ?? null;
  const previousDivision = previousYear?.divisions.find(d => d.name === activeDivision?.name) ?? null;

  return (
    <div className="budget-print-area space-y-6 animate-in fade-in duration-500">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Budget Calculator</h1>
          <p className="text-muted-foreground mt-1">
            Enter your costs and goals to find out what hourly rate you need to hit your target profit margin.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <div className="flex items-center gap-2 border rounded-lg px-3 py-1.5">
            <span className="text-xs text-muted-foreground">Year</span>
            <input
              type="number"
              className="w-16 text-sm font-medium border-0 p-0 bg-transparent focus:outline-none"
              value={currentYear}
              onChange={e => setCurrentYear(parseInt(e.target.value) || new Date().getFullYear())}
            />
          </div>
          <div className="budget-print-controls flex items-center gap-2">
            <Button variant="outline" onClick={handlePrint} className="gap-2">
              <Printer className="w-4 h-4" />
              Print {activeTab === COMPANY_TAB ? 'Company Budget' : 'Division'}
            </Button>
            <Button onClick={handleSave} disabled={saving || divisionSaving} className="gap-2">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Save Budget
            </Button>
          </div>
        </div>
      </div>

      {year.savedAt && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
          Last saved {new Date(year.savedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}
        </div>
      )}

      {/* Division tabs */}
      <div className="budget-print-controls flex items-center gap-2 flex-wrap border-b pb-2">
        <button
          onClick={() => setActiveTab(COMPANY_TAB)}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
            activeTab === COMPANY_TAB ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'
          }`}
        >
          <Building2 className="w-3.5 h-3.5" /> Company Total
        </button>
        {year.divisions.map(d => (
          <div key={d.id} className="flex items-center">
            {renamingId === d.id ? (
              <Input
                autoFocus
                defaultValue={d.name}
                className="h-8 w-36 text-sm"
                onBlur={async e => {
                  const saved = await renameDivision(d.id, e.target.value);
                  if (saved) setRenamingId(current => current === d.id ? null : current);
                }}
                onKeyDown={e => {
                  if (e.key === 'Enter') e.currentTarget.blur();
                  if (e.key === 'Escape') setRenamingId(null);
                }}
              />
            ) : (
              <>
                <button
                  onClick={() => setActiveTab(d.id)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                    activeTab === d.id ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'
                  }`}
                >
                  {d.name}
                </button>
                <button
                  type="button"
                  onClick={() => setRenamingId(d.id)}
                  className="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted"
                  title={`Edit ${d.name} name`}
                  aria-label={`Edit ${d.name} name`}
                >
                  <Pencil className="w-3 h-3" />
                </button>
                {year.divisions.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeDivision(d.id)}
                    className="p-1.5 rounded text-muted-foreground hover:text-destructive hover:bg-muted"
                    title={`Remove ${d.name}`}
                    aria-label={`Remove ${d.name}`}
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </>
            )}
          </div>
        ))}
        <Button variant="ghost" size="sm" className="gap-1 text-xs h-8" onClick={addDivision} disabled={divisionSaving}>
          <Plus className="w-3.5 h-3.5" /> Add Division
        </Button>
      </div>

      {activeTab === COMPANY_TAB ? (
        <CompanyTotalPanel
          year={year}
          onOverrideChange={overrides => updateYear(y => ({ ...y, overheadOverrides: overrides }))}
          onCompanyCheckupChange={(which, c) => updateYear(y => ({ ...y, [which]: c }))}
        />
      ) : activeDivision ? (
        <>
        <Card data-testid="card-budget-services">
          <CardHeader>
            <CardTitle className="text-base">Services in {activeDivision.name}</CardTitle>
            <CardDescription>Pricing Review uses this division's hourly target and minimum for these services. Each service can belong to one division per year. Click Save Budget to save assignments.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {servicesLoading ? <p className="text-sm text-muted-foreground">Loading services…</p>
              : servicesError ? <Button variant="outline" onClick={() => reloadServices()}>Retry loading services</Button>
              : !serviceData?.length ? <p className="text-sm text-muted-foreground">No services yet. Add services in the service catalog first.</p>
              : <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {serviceData.map(service => {
                  const other = year.divisions.find(d => d.id !== activeDivision.id && d.serviceIds.includes(service.id));
                  const checked = activeDivision.serviceIds.includes(service.id);
                  return <label key={service.id} className={`flex items-start gap-2 text-sm ${other ? 'text-muted-foreground' : ''}`}>
                    <Checkbox data-testid={`checkbox-budget-service-${service.id}`} checked={checked} disabled={(!!other && !checked) || saving || divisionSaving}
                      onCheckedChange={value => updateDivision(activeDivision.id, {
                        ...activeDivision, serviceIds: value === true ? [...activeDivision.serviceIds, service.id]
                          : activeDivision.serviceIds.filter(id => id !== service.id),
                      })} />
                    <span>{service.name}{other && <span className="block text-xs">{checked ? `Also assigned to ${other.name}; unlink from one division.` : `Assigned to ${other.name}; unlink there first.`}</span>}</span>
                  </label>;
                })}
              </div>}
          </CardContent>
        </Card>
        <DivisionPanel
          division={activeDivision}
          onChange={updated => updateDivision(activeDivision.id, updated)}
          previousResults={previousDivision ? computeDivision(previousDivision) : null}
          previousYear={previousDivision ? previousYear!.year : undefined}
        />
        </>
      ) : null}
    </div>
  );
}
