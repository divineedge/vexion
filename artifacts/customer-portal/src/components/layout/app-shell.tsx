import * as React from "react";
import { Link, useLocation } from "wouter";
import { usePortalGetMe, usePortalGetSummary } from "@workspace/api-client-react";
import { MapPin, Briefcase, FileText, Bell, LayoutDashboard, Menu, X, LogOut, Loader2, CalendarDays } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

const navItems = [
  { name: "Overview", path: "/home", icon: LayoutDashboard },
  { name: "Jobs", path: "/jobs", icon: Briefcase },
  { name: "Invoices", path: "/invoices", icon: FileText },
  { name: "Properties", path: "/properties", icon: MapPin },
  { name: "Plans", path: "/plans", icon: CalendarDays },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const [location, setLocation] = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = React.useState(false);
  
  const token = localStorage.getItem("portal_token");
  
  const { data: me, isLoading: isLoadingMe } = usePortalGetMe({
    query: {
      enabled: !!token,
      queryKey: ["usePortalGetMe"]
    }
  });

  const { data: summary } = usePortalGetSummary({
    query: {
      enabled: !!token,
      queryKey: ["usePortalGetSummary"]
    }
  });

  React.useEffect(() => {
    if (!token && location !== "/") {
      setLocation("/");
    }
  }, [token, location, setLocation]);

  const handleLogout = () => {
    localStorage.removeItem("portal_token");
    // Navigate to the portal login page (within this app's base path)
    setLocation("/");
  };

  if (!token) return <>{children}</>;

  if (isLoadingMe) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Top Navbar */}
      <header className="sticky top-0 z-50 w-full border-b bg-card shadow-sm">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex h-16 items-center justify-between">
            <div className="flex items-center gap-4">
              <Link href="/home" className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
                  <span className="text-primary-foreground font-bold text-lg">D</span>
                </div>
                <span className="font-bold text-xl text-foreground tracking-tight hidden sm:block">
                  Divine Edge
                </span>
              </Link>
            </div>

            {/* Desktop Nav */}
            <nav className="hidden md:flex items-center space-x-1">
              {navItems.map((item) => {
                const isActive = location === item.path || location.startsWith(`${item.path}/`);
                return (
                  <Link
                    key={item.path}
                    href={item.path}
                    className={cn(
                      "flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors",
                      isActive 
                        ? "bg-secondary text-secondary-foreground" 
                        : "text-muted-foreground hover:bg-muted hover:text-foreground"
                    )}
                  >
                    <item.icon className="h-4 w-4" />
                    {item.name}
                  </Link>
                );
              })}
              
              <Link
                href="/alerts"
                className={cn(
                  "flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors relative",
                  location === "/alerts" 
                    ? "bg-secondary text-secondary-foreground" 
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
              >
                <Bell className="h-4 w-4" />
                Alerts
                {summary?.unreadAlertCount ? (
                  <span className="absolute top-1.5 right-1.5 flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-destructive opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-destructive"></span>
                  </span>
                ) : null}
              </Link>
            </nav>

            {/* User Menu & Mobile Toggle */}
            <div className="flex items-center gap-4">
              <div className="hidden md:flex items-center gap-3">
                <div className="text-right">
                  <div className="text-sm font-medium text-foreground">{me?.name}</div>
                  <div className="text-xs text-muted-foreground">{me?.email}</div>
                </div>
                <div className="h-8 w-8 rounded-full bg-secondary text-secondary-foreground flex items-center justify-center font-bold">
                  {me?.name?.charAt(0).toUpperCase()}
                </div>
                <Button variant="ghost" size="icon" onClick={handleLogout} className="text-muted-foreground hover:text-destructive">
                  <LogOut className="h-4 w-4" />
                </Button>
              </div>
              
              <Button 
                variant="ghost" 
                size="icon" 
                className="md:hidden"
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              >
                {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
              </Button>
            </div>
          </div>
        </div>
      </header>

      {/* Mobile Nav */}
      {mobileMenuOpen && (
        <div className="md:hidden border-b bg-card animate-in slide-in-from-top-2">
          <div className="space-y-1 px-4 pb-4 pt-2">
            {navItems.map((item) => {
              const isActive = location === item.path || location.startsWith(`${item.path}/`);
              return (
                <Link
                  key={item.path}
                  href={item.path}
                  onClick={() => setMobileMenuOpen(false)}
                  className={cn(
                    "flex items-center gap-3 px-3 py-3 rounded-md text-base font-medium transition-colors",
                    isActive 
                      ? "bg-secondary text-secondary-foreground" 
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  )}
                >
                  <item.icon className="h-5 w-5" />
                  {item.name}
                </Link>
              );
            })}
            
            <Link
              href="/alerts"
              onClick={() => setMobileMenuOpen(false)}
              className={cn(
                "flex items-center justify-between px-3 py-3 rounded-md text-base font-medium transition-colors",
                location === "/alerts" 
                  ? "bg-secondary text-secondary-foreground" 
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
            >
              <div className="flex items-center gap-3">
                <Bell className="h-5 w-5" />
                Alerts
              </div>
              {summary?.unreadAlertCount ? (
                <span className="bg-destructive text-destructive-foreground text-xs font-bold px-2 py-0.5 rounded-full">
                  {summary.unreadAlertCount}
                </span>
              ) : null}
            </Link>
            
            <div className="pt-4 mt-2 border-t flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-full bg-secondary text-secondary-foreground flex items-center justify-center font-bold text-lg">
                  {me?.name?.charAt(0).toUpperCase()}
                </div>
                <div>
                  <div className="text-sm font-medium text-foreground">{me?.name}</div>
                  <div className="text-xs text-muted-foreground">{me?.email}</div>
                </div>
              </div>
              <Button variant="ghost" size="icon" onClick={handleLogout} className="text-muted-foreground hover:text-destructive">
                <LogOut className="h-5 w-5" />
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Main Content */}
      <main className="flex-1 container mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {children}
      </main>
      
      {/* Footer */}
      <footer className="border-t bg-card py-8 mt-auto">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8 text-center text-sm text-muted-foreground">
          &copy; {new Date().getFullYear()} Divine Edge OS. All rights reserved.
        </div>
      </footer>
    </div>
  );
}
