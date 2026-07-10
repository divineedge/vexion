import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Route, Switch, Router as WouterRouter } from 'wouter';
import { Toaster } from 'sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { AppShell } from '@/components/layout/app-shell';

import Login from '@/pages/login';
import Home from '@/pages/home';
import Jobs from '@/pages/jobs';
import Invoices from '@/pages/invoices';
import Properties from '@/pages/properties';
import Alerts from '@/pages/alerts';
import ServiceRequests from '@/pages/service-requests';

function NotFound() {
  return (
    <div className="min-h-[50vh] flex flex-col items-center justify-center text-center px-4">
      <div className="text-6xl font-bold text-muted mb-4">404</div>
      <h1 className="text-2xl font-bold text-foreground mb-2">Page not found</h1>
      <p className="text-muted-foreground">The page you are looking for doesn't exist or has been moved.</p>
    </div>
  );
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: false,
    },
  },
});

function Router() {
  return (
    <Switch>
      <Route path="/" component={Login} />
      
      {/* Protected Routes inside AppShell */}
      <Route path="/home">
        <AppShell><Home /></AppShell>
      </Route>
      <Route path="/jobs">
        <AppShell><Jobs /></AppShell>
      </Route>
      <Route path="/invoices">
        <AppShell><Invoices /></AppShell>
      </Route>
      <Route path="/properties">
        <AppShell><Properties /></AppShell>
      </Route>
      <Route path="/alerts">
        <AppShell><Alerts /></AppShell>
      </Route>
      <Route path="/service-requests">
        <AppShell><ServiceRequests /></AppShell>
      </Route>

      <Route>
        <AppShell><NotFound /></AppShell>
      </Route>
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <Router />
        </WouterRouter>
        <Toaster position="top-center" richColors />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
