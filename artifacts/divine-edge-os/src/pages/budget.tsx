import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import {
  Save, Loader2, ShieldAlert, CheckCircle2, Plus, X, Pencil, Building2,
} from 'lucide-react';
import { customFetch } from '@workspace/api-client-react';
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
  const [loading, setLoading] = useState(true);
  const [renamingId, setRenamingId] = useState<string | null>(null);

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
        const fresh = defaultBudgetYear();
        setYears([fresh]);
        setCurrentYear(fresh.year);
        setActiveTab(fresh.divisions[0].id);
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

  const addDivision = () => {
    const name = `Division ${year.divisions.length + 1}`;
    const newDiv = defaultDivision(name);
    updateYear(y => ({ ...y, divisions: [...y.divisions, newDiv] }));
    setActiveTab(newDiv.id);
  };

  const removeDivision = (divisionId: string) => {
    if (year.divisions.length <= 1) {
      toast.error('You need at least one division');
      return;
    }
    updateYear(y => ({ ...y, divisions: y.divisions.filter(d => d.id !== divisionId) }));
    setActiveTab(COMPANY_TAB);
  };

  const renameDivision = (divisionId: string, name: string) => {
    updateYear(y => ({
      ...y,
      divisions: y.divisions.map(d => (d.id === divisionId ? { ...d, name: name || d.name } : d)),
    }));
  };

  const handleSave = async () => {
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

  const activeDivision = year.divisions.find(d => d.id === activeTab) ?? null;
  const previousDivision = previousYear?.divisions.find(d => d.name === activeDivision?.name) ?? null;

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
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
          <Button onClick={handleSave} disabled={saving} className="gap-2">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Save Budget
          </Button>
        </div>
      </div>

      {year.savedAt && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
          Last saved {new Date(year.savedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}
        </div>
      )}

      {/* Division tabs */}
      <div className="flex items-center gap-2 flex-wrap border-b pb-2">
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
                onBlur={e => { renameDivision(d.id, e.target.value.trim()); setRenamingId(null); }}
                onKeyDown={e => {
                  if (e.key === 'Enter') { renameDivision(d.id, (e.target as HTMLInputElement).value.trim()); setRenamingId(null); }
                  if (e.key === 'Escape') setRenamingId(null);
                }}
              />
            ) : (
              <button
                onClick={() => setActiveTab(d.id)}
                onDoubleClick={() => setRenamingId(d.id)}
                className={`group flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  activeTab === d.id ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'
                }`}
                title="Double-click to rename"
              >
                {d.name}
                <Pencil
                  className={`w-3 h-3 opacity-0 group-hover:opacity-60 ${activeTab === d.id ? 'text-primary-foreground' : ''}`}
                  onClick={e => { e.stopPropagation(); setRenamingId(d.id); }}
                />
                {year.divisions.length > 1 && (
                  <X
                    className={`w-3 h-3 opacity-0 group-hover:opacity-60 ${activeTab === d.id ? 'text-primary-foreground' : ''}`}
                    onClick={e => { e.stopPropagation(); removeDivision(d.id); }}
                  />
                )}
              </button>
            )}
          </div>
        ))}
        <Button variant="ghost" size="sm" className="gap-1 text-xs h-8" onClick={addDivision}>
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
        <DivisionPanel
          division={activeDivision}
          onChange={updated => updateDivision(activeDivision.id, updated)}
          previousResults={previousDivision ? computeDivision(previousDivision) : null}
          previousYear={previousDivision ? previousYear!.year : undefined}
        />
      ) : null}
    </div>
  );
}
