import React, { useEffect, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { useAuth } from '@/contexts/AuthContext';
import { cn } from '@/lib/utils';
import { LogOut, Menu, X } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { adminNavSections, techNavItems } from './navConfig';
import { SidebarSection } from './SidebarSection';
import { Breadcrumb } from './Breadcrumb';
import { NotificationBell } from '@/components/tasks/NotificationBell';
import { useListTasks, getListTasksQueryKey, useListFollowupQueueItems, getListFollowupQueueItemsQueryKey } from '@workspace/api-client-react';

export function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, isAuthenticated, logout, isTechnician, isCrewManager, canManageOffice } = useAuth();
  const [location, setLocation] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);

  const { data: myTasks = [] } = useListTasks(
    { scope: 'mine' },
    { query: { enabled: isAuthenticated, refetchInterval: 60000, queryKey: getListTasksQueryKey({ scope: 'mine' }) } },
  );
  const myOpenTaskCount = myTasks.filter(t => t.status === 'open' || t.status === 'in_progress').length;

  const { data: openFollowups = [] } = useListFollowupQueueItems(
    { status: 'open' },
    { query: { enabled: isAuthenticated, refetchInterval: 60000, queryKey: getListFollowupQueueItemsQueryKey({ status: 'open' }) } },
  );
  const badgeCounts: Record<string, number> = { '/tasks': myOpenTaskCount, '/followup-queue': openFollowups.length };

  useEffect(() => {
    if (!isAuthenticated && location !== '/login') {
      setLocation('/login');
    }
  }, [isAuthenticated, location, setLocation]);

  if (!isAuthenticated) {
    return null;
  }

  // Role map used to filter sections
  const roleMap: Record<string, boolean> = {
    isCrewManager,
    canManageOffice,
    isOwner: canManageOffice,   // covered by canManageOffice
    isManager: canManageOffice,
    isDepartmentManager: canManageOffice,
    canManageJobs: isCrewManager || canManageOffice,
  };

  // Filter sections for current user's role
  const visibleSections = adminNavSections.filter(section => {
    if (!section.roles) return true;
    return section.roles.some(r => roleMap[r]);
  });

  const userInitials = user?.name.slice(0, 2).toUpperCase() ?? '??';

  /* ------------------------------------------------------------------ */
  /* Sidebar content — shared between desktop + mobile                   */
  /* ------------------------------------------------------------------ */
  function SidebarContent({ onNavClick }: { onNavClick?: () => void }) {
    return (
      <>
        {/* Logo */}
        <div className="p-6 shrink-0">
          <div className="flex items-center gap-2 font-bold text-xl tracking-tight text-white">
            <div className="w-8 h-8 rounded-md bg-sidebar-primary flex items-center justify-center">
              <span className="text-white text-lg">D</span>
            </div>
            Divine Edge OS
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 overflow-y-auto pb-4">
          {isTechnician ? (
            /* Flat technician nav — unchanged */
            <div className="space-y-0.5">
              {techNavItems.map((item) => {
                const isActive = location === item.href || location.startsWith(item.href + '/');
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={onNavClick}
                    className={cn(
                      'flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors group',
                      isActive
                        ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                        : 'text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground'
                    )}
                  >
                    <item.icon
                      className={cn(
                        'w-5 h-5',
                        isActive
                          ? 'text-sidebar-primary'
                          : 'text-sidebar-foreground/50 group-hover:text-sidebar-foreground/80'
                      )}
                    />
                    <span className="flex-1">{item.name}</span>
                    {!!badgeCounts[item.href] && (
                      <span className="min-w-[1.1rem] h-[1.1rem] px-1 rounded-full bg-sidebar-primary text-white text-[10px] font-semibold flex items-center justify-center shrink-0">
                        {badgeCounts[item.href]}
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>
          ) : (
            /* Sectioned admin/office nav */
            <div className="space-y-2">
              {visibleSections.map(section => (
                <SidebarSection
                  key={section.id}
                  section={section}
                  onNavClick={onNavClick}
                  badgeCounts={badgeCounts}
                />
              ))}
            </div>
          )}
        </nav>

        {/* User footer */}
        {user && (
          <div className="p-4 border-t border-sidebar-border shrink-0">
            <div className="flex items-center gap-3 w-full bg-sidebar-accent/30 p-3 rounded-lg border border-sidebar-border/50">
              <Avatar className="w-10 h-10 border border-sidebar-border shrink-0">
                <AvatarImage src={user.avatarUrl ?? undefined} />
                <AvatarFallback className="bg-sidebar-accent text-white">{userInitials}</AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-white truncate">{user.name}</p>
                <div className="flex items-center gap-2 mt-0.5">
                  <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4 bg-sidebar-primary text-white border-none uppercase tracking-wider">
                    {user.planTier}
                  </Badge>
                </div>
              </div>
              <button
                onClick={() => { logout(); setLocation('/login'); }}
                className="text-sidebar-foreground/50 hover:text-white transition-colors shrink-0"
                title="Logout"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  return (
    <div className="flex h-screen w-full bg-background overflow-hidden">
      {/* ── Desktop sidebar ─────────────────────────────────────────── */}
      <aside className="hidden md:flex w-64 bg-sidebar text-sidebar-foreground flex-col h-full shrink-0 border-r border-sidebar-border">
        <SidebarContent />
      </aside>

      {/* ── Mobile overlay sidebar ───────────────────────────────────── */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 md:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}
      <div
        className={cn(
          'fixed inset-y-0 left-0 z-50 w-72 bg-sidebar text-sidebar-foreground flex flex-col transition-transform duration-300 md:hidden',
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        <button
          onClick={() => setMobileOpen(false)}
          className="absolute top-4 right-4 text-sidebar-foreground/50 hover:text-white"
          aria-label="Close menu"
        >
          <X className="w-5 h-5" />
        </button>
        <SidebarContent onNavClick={() => setMobileOpen(false)} />
      </div>

      {/* ── Main content ─────────────────────────────────────────────── */}
      <main className="flex-1 flex flex-col h-full overflow-hidden bg-muted/30">
        {/* Mobile top bar */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border/50 md:hidden bg-background shrink-0">
          <button
            onClick={() => setMobileOpen(true)}
            className="text-muted-foreground hover:text-foreground"
            aria-label="Open menu"
          >
            <Menu className="w-5 h-5" />
          </button>
          <span className="font-semibold text-sm">Divine Edge OS</span>
          <div className="ml-auto"><NotificationBell /></div>
        </div>

        {/* Breadcrumb strip */}
        <div className="hidden md:flex items-center justify-end px-6 md:px-8 pt-3">
          <NotificationBell />
        </div>
        <Breadcrumb isTechnician={isTechnician} />

        <div className="flex-1 overflow-y-auto">
          <div className="max-w-7xl mx-auto p-6 md:p-8">
            {children}
          </div>
        </div>
      </main>
    </div>
  );
}
