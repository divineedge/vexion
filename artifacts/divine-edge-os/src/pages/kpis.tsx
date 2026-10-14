import { Link } from 'wouter';
import { Lock } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { useAuth } from '@/contexts/AuthContext';
import { KpiDashboard } from '@/components/kpis/KpiDashboard';

export default function KpisPage() {
  const { isTechnician, canManageOffice, can } = useAuth();
  const allowed = !isTechnician && canManageOffice && can('pages.billing') && can('financials.costData') && can('financials.jobPrices') && can('financials.invoiceAmounts');
  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div>
        <h1 className="text-3xl font-bold tracking-tight" data-testid="text-page-title">KPI Dashboard</h1>
        <p className="text-muted-foreground mt-1">Company performance metrics for the selected date range.</p>
      </div>
      {allowed ? <KpiDashboard /> : (
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
