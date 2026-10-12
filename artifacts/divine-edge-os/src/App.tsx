import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Route, Switch, Router as WouterRouter, Redirect } from 'wouter';
import { AuthProvider } from '@/contexts/AuthContext';
import { AppLayout } from '@/components/layout/AppLayout';

import LoginPage from '@/pages/login';
import SignupPage from '@/pages/signup';
import DashboardPage from '@/pages/dashboard';
import CustomersPage from '@/pages/customers';
import CustomerDetailPage from '@/pages/customer-detail';
import PropertiesPage from '@/pages/properties';
import PropertyDetailPage from '@/pages/property-detail';
import SchedulePage from '@/pages/schedule';
import InventoryPage from '@/pages/inventory';
import FinancialsPage from '@/pages/financials';
import ReportsPage from '@/pages/reports';
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
import QuotePublicPage from '@/pages/quote-public';
import QuoteWidgetPage from '@/pages/quote-widget';
import EstimatesPage from '@/pages/estimates';
import VisitsPage from '@/pages/visits';
import EstimatePublicPage from '@/pages/estimate-public';
import InvoicePublicPage from '@/pages/invoice-public';
import ReviewsPage from '@/pages/reviews';
import ReviewPublicPage from '@/pages/review-public';
import PlansDashboardPage from '@/pages/plans-dashboard';
import PlanDetailPage from '@/pages/plan-detail';
import TasksPage from '@/pages/tasks';
import FollowupQueuePage from '@/pages/followup-queue';
import CallsPage from '@/pages/calls';
import RoutesDashboardPage from '@/pages/routes';
import TaskBundlesPage from '@/pages/task-bundles';
import EmployeeDetailPage from '@/pages/employee-detail';
import PortalInboxPage from '@/pages/portal-inbox';
import BudgetPage from '@/pages/budget';
import StaffMessagesPage from '@/pages/staff-messages';
import OAuthConsentPage from '@/pages/oauth-consent';

import NotFound from '@/pages/not-found';
import OnboardingWalkthrough, { useOnboarding } from '@/components/onboarding/OnboardingWalkthrough';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      refetchOnWindowFocus: false,
    },
  },
});

function ProtectedRoutes() {
  const { show, dismiss } = useOnboarding();
  return (
    <AppLayout>
      {show && <OnboardingWalkthrough onDismiss={dismiss} />}
      <Switch>
        <Route path="/dashboard" component={DashboardPage} />
        <Route path="/customers/:id" component={CustomerDetailPage} />
        <Route path="/customers" component={CustomersPage} />
        <Route path="/properties/:id" component={PropertyDetailPage} />
        <Route path="/properties" component={PropertiesPage} />
        <Route path="/schedule" component={SchedulePage} />
        <Route path="/inventory" component={InventoryPage} />
        <Route path="/financials" component={FinancialsPage} />
        <Route path="/invoices" component={FinancialsPage} />
        <Route path="/reports" component={ReportsPage} />
        <Route path="/time-tracking" component={TimeTrackingPage} />
        <Route path="/blueprints/:id" component={BlueprintCanvasPage} />
        <Route path="/blueprints" component={BlueprintsPage} />
        <Route path="/settings" component={SettingsPage} />
        <Route path="/crews" component={CrewsPage} />
        <Route path="/routes" component={RoutesDashboardPage} />
        <Route path="/efficiency" component={EfficiencyPage} />
        <Route path="/callbacks" component={CallbacksPage} />
        <Route path="/tasks" component={TasksPage} />
        <Route path="/followup-queue" component={FollowupQueuePage} />
        <Route path="/calls" component={CallsPage} />
        <Route path="/daily-tasks" component={TaskBundlesPage} />
        <Route path="/marketing" component={MarketingPage} />
        <Route path="/payroll" component={PayrollPage} />
        <Route path="/services" component={ServicesPage} />
        <Route path="/chemicals" component={ChemicalsPage} />
        <Route path="/equipment" component={EquipmentPage} />
        <Route path="/estimates" component={EstimatesPage} />
        <Route path="/visits" component={VisitsPage} />
        <Route path="/reviews" component={ReviewsPage} />
        <Route path="/plans/:id" component={PlanDetailPage} />
        <Route path="/plans" component={PlansDashboardPage} />
        <Route path="/team/:id" component={EmployeeDetailPage} />
        <Route path="/portal-inbox/:customerId" component={PortalInboxPage} />
        <Route path="/portal-inbox" component={PortalInboxPage} />
        <Route path="/budget" component={BudgetPage} />
        <Route path="/staff-messages" component={StaffMessagesPage} />
        <Route component={NotFound} />
      </Switch>
    </AppLayout>
  );
}

function Router() {
  return (
    <Switch>
      {/* Public routes — no auth required */}
      <Route path="/quote/:token" component={QuotePublicPage} />
      <Route path="/widget/quote" component={QuoteWidgetPage} />
      <Route path="/estimate/:token" component={EstimatePublicPage} />
      <Route path="/invoice/:token" component={InvoicePublicPage} />
      <Route path="/review/:token" component={ReviewPublicPage} />
      <Route path="/login" component={LoginPage} />
      <Route path="/signup" component={SignupPage} />
      <Route path="/" component={HomeRoute} />
      <Route component={ProtectedRoutes} />
    </Switch>
  );
}

function HomeRoute() {
  const hasOAuthConsentRequest = new URLSearchParams(window.location.search).has('oauth_consent');
  return hasOAuthConsentRequest ? <OAuthConsentPage /> : <Redirect to="/dashboard" />;
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
