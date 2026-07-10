import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Route, Switch, Router as WouterRouter } from 'wouter';
import { AuthProvider } from '@/contexts/AuthContext';
import { AppLayout } from '@/components/layout/AppLayout';

import LoginPage from '@/pages/login';
import DashboardPage from '@/pages/dashboard';
import CustomersPage from '@/pages/customers';
import CustomerDetailPage from '@/pages/customer-detail';
import PropertiesPage from '@/pages/properties';
import PropertyDetailPage from '@/pages/property-detail';
import SchedulePage from '@/pages/schedule';
import InventoryPage from '@/pages/inventory';
import FinancialsPage from '@/pages/financials';
import DailyRoutinesPage from '@/pages/daily-routines';
import TimeTrackingPage from '@/pages/time-tracking';
import BlueprintsPage from '@/pages/blueprints';
import BlueprintCanvasPage from '@/pages/blueprint-canvas';
import SettingsPage from '@/pages/settings';
import CrewsPage from '@/pages/crews';
import EfficiencyPage from '@/pages/efficiency';
import CallbacksPage from '@/pages/callbacks';
import MarketingPage from '@/pages/marketing';
import PayrollPage from '@/pages/payroll';
import ServicesPage from '@/pages/services';
import ChemicalsPage from '@/pages/chemicals';
import EquipmentPage from '@/pages/equipment';

import NotFound from '@/pages/not-found';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      refetchOnWindowFocus: false,
    },
  },
});

function ProtectedRoutes() {
  return (
    <AppLayout>
      <Switch>
        <Route path="/dashboard" component={DashboardPage} />
        <Route path="/customers/:id" component={CustomerDetailPage} />
        <Route path="/customers" component={CustomersPage} />
        <Route path="/properties/:id" component={PropertyDetailPage} />
        <Route path="/properties" component={PropertiesPage} />
        <Route path="/schedule" component={SchedulePage} />
        <Route path="/inventory" component={InventoryPage} />
        <Route path="/financials" component={FinancialsPage} />
        <Route path="/daily-routines" component={DailyRoutinesPage} />
        <Route path="/time-tracking" component={TimeTrackingPage} />
        <Route path="/blueprints/:id" component={BlueprintCanvasPage} />
        <Route path="/blueprints" component={BlueprintsPage} />
        <Route path="/settings" component={SettingsPage} />
        <Route path="/crews" component={CrewsPage} />
        <Route path="/efficiency" component={EfficiencyPage} />
        <Route path="/callbacks" component={CallbacksPage} />
        <Route path="/marketing" component={MarketingPage} />
        <Route path="/payroll" component={PayrollPage} />
        <Route path="/services" component={ServicesPage} />
        <Route path="/chemicals" component={ChemicalsPage} />
        <Route path="/equipment" component={EquipmentPage} />
        <Route component={NotFound} />
      </Switch>
    </AppLayout>
  );
}

function Router() {
  return (
    <Switch>
      <Route path="/login" component={LoginPage} />
      <Route component={ProtectedRoutes} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AuthProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
            <Router />
          </WouterRouter>
          <Toaster />
        </AuthProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
