import { useState } from 'react';
import { Link } from 'wouter';
import { Lock } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { useAuth } from '@/contexts/AuthContext';
import { KpiDashboard } from '@/components/kpis/KpiDashboard';
import { JobEconomicsReports, type EconomicsState } from '@/components/kpis/JobEconomicsReports';

type View = 'dashboard' | 'service' | 'jobs';
const VIEWS: { id: View; label: string; desc: string }[] = [
  { id: 'dashboard', label: 'KPI dashboard', desc: 'Company performance metrics for the selected date range.' },
  { id: 'service', label: 'Service performance', desc: 'Time, revenue and recorded-cost contribution by service or pricing tier.' },
  { id: 'jobs', label: 'Job profitability', desc: 'Each completed job against its saved budget, with recorded costs and gaps.' },
];

export default function KpisPage() {
  const { isTechnician, canManageOffice, can } = useAuth();
  const allowed = !isTechnician && canManageOffice && can('pages.billing') && can('financials.costData') && can('financials.jobPrices') && can('financials.invoiceAmounts');
  const [view, setView] = useState<View>('dashboard');
  const [econ, setEcon] = useState<EconomicsState>({ from: '', to: '', customer: 'all', service: 'all' });
  const cur = VIEWS.find(v => v.id === view)!;
  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div>
        <h1 className="text-3xl font-bold tracking-tight" data-testid="text-page-title">KPI Dashboard</h1>
        <p className="text-muted-foreground mt-1">{cur.desc}</p>
      </div>
      {allowed ? (
        <>
          <div role="tablist" aria-label="KPI reports" className="flex gap-1 border-b overflow-x-auto">
            {VIEWS.map(v => (
              <button key={v.id} type="button" role="tab" id={`tab-${v.id}`} aria-selected={view === v.id} aria-controls="kpi-report-panel"
                onClick={() => setView(v.id)} data-testid={`tab-kpi-${v.id}`}
                className={`px-3 py-2 text-sm font-medium whitespace-nowrap border-b-2 -mb-px transition-colors ${view === v.id ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`}>{v.label}</button>
            ))}
          </div>
          <div id="kpi-report-panel" role="tabpanel" aria-labelledby={`tab-${view}`}>
            {view === 'dashboard' ? <KpiDashboard /> : <JobEconomicsReports view={view} state={econ} setState={setEcon} />}
          </div>
        </>
      ) : (
        <Card><CardContent className="p-8 text-center space-y-2">
          <Lock className="w-6 h-6 mx-auto text-muted-foreground" />
          <p className="font-medium">You don't have access to company KPIs.</p>
          <p className="text-sm text-muted-foreground">KPIs are available to office staff with financial-report access.</p>
          <Link href="/dashboard" className="text-sm text-primary hover:underline" data-testid="link-back-dashboard">Back to Dashboard</Link>
        </CardContent></Card>
      )}
    </div>
  );
}
