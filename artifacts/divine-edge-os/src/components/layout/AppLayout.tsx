import React from 'react';
import { Link, useLocation } from 'wouter';
import { useAuth } from '@/contexts/AuthContext';
import { cn } from '@/lib/utils';
import { LayoutDashboard, Users, Building, CalendarDays, PackageSearch, DollarSign, CheckSquare, Clock, DraftingCompass, Settings, LogOut, UserCheck, Gauge, PhoneCall, Megaphone, Banknote, Briefcase } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';

export function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, isAuthenticated, logout, isTechnician } = useAuth();
  const [location, setLocation] = useLocation();

  if (!isAuthenticated) {
    if (location !== '/login') {
      setLocation('/login');
      return null;
    }
    return <>{children}</>;
  }

  const allNavItems = [
    { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard, hidden: isTechnician },
    { name: 'Customers', href: '/customers', icon: Users, hidden: isTechnician },
    { name: 'Properties', href: '/properties', icon: Building, hidden: isTechnician },
    { name: 'Schedule', href: '/schedule', icon: CalendarDays },
    { name: 'Crews', href: '/crews', icon: UserCheck, hidden: isTechnician },
    { name: 'Inventory', href: '/inventory', icon: PackageSearch, hidden: isTechnician },
    { name: 'Financials', href: '/financials', icon: DollarSign, hidden: isTechnician },
    { name: 'Daily Routines', href: '/daily-routines', icon: CheckSquare },
    { name: 'Time Tracking', href: '/time-tracking', icon: Clock },
    { name: 'Efficiency', href: '/efficiency', icon: Gauge },
    { name: 'P4P Payroll', href: '/payroll', icon: Banknote },
    { name: 'Services', href: '/services', icon: Briefcase, hidden: isTechnician },
    { name: 'Callbacks', href: '/callbacks', icon: PhoneCall, hidden: isTechnician },
    { name: 'Marketing', href: '/marketing', icon: Megaphone, hidden: isTechnician },
    { name: 'Blueprints', href: '/blueprints', icon: DraftingCompass, hidden: isTechnician },
    { name: 'Settings', href: '/settings', icon: Settings, hidden: isTechnician },
  ];

  const navItems = allNavItems.filter(item => !item.hidden);

  return (
    <div className="flex h-screen w-full bg-background overflow-hidden">
      {/* Sidebar */}
      <aside className="w-64 bg-sidebar text-sidebar-foreground flex flex-col h-full shrink-0 border-r border-sidebar-border">
        <div className="p-6">
          <div className="flex items-center gap-2 font-bold text-xl tracking-tight text-white">
            <div className="w-8 h-8 rounded-md bg-sidebar-primary flex items-center justify-center">
              <span className="text-white text-lg">D</span>
            </div>
            Divine Edge OS
          </div>
        </div>

        <nav className="flex-1 px-4 space-y-1 overflow-y-auto">
          {navItems.map((item) => {
            const isActive = location === item.href || location.startsWith(item.href + '/');
            return (
              <Link key={item.name} href={item.href} className={cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors group",
                isActive 
                  ? "bg-sidebar-accent text-sidebar-accent-foreground" 
                  : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
              )}>
                <item.icon className={cn("w-5 h-5", isActive ? "text-sidebar-primary" : "text-sidebar-foreground/50 group-hover:text-sidebar-foreground/80")} />
                {item.name}
              </Link>
            )
          })}
        </nav>

        {user && (
          <div className="p-4 border-t border-sidebar-border mt-auto">
            <div className="flex items-center gap-3 w-full bg-sidebar-accent/30 p-3 rounded-lg border border-sidebar-border/50">
              <Avatar className="w-10 h-10 border border-sidebar-border">
                <AvatarImage src={user.avatarUrl} />
                <AvatarFallback className="bg-sidebar-accent text-white">{user.name.slice(0, 2).toUpperCase()}</AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-white truncate">{user.name}</p>
                <div className="flex items-center gap-2 mt-0.5">
                  <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4 bg-sidebar-primary text-white border-none uppercase tracking-wider">
                    {user.planTier}
                  </Badge>
                </div>
              </div>
              <button onClick={() => { logout(); setLocation('/login'); }} className="text-sidebar-foreground/50 hover:text-white transition-colors" title="Logout">
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col h-full overflow-hidden bg-muted/30">
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-7xl mx-auto p-6 md:p-8">
            {children}
          </div>
        </div>
      </main>
    </div>
  );
}
