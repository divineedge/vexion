import React, { useEffect, useState, useCallback } from 'react';
import { Link, useLocation } from 'wouter';
import { useAuth } from '@/contexts/AuthContext';
import { cn } from '@/lib/utils';
import { LogOut, Menu, X, LayoutDashboard, Settings, Bookmark, BookmarkCheck, Star } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { adminNavSections, pinnedNavItems, techNavItems as baseTechNavItems, hrNavItems, myRecordNavItem, type NavItem } from './navConfig';
import { useHrMeta } from '@/lib/hr';
import { SidebarSection } from './SidebarSection';
import { usePermissions } from '@/hooks/usePermissions';
import { Breadcrumb } from './Breadcrumb';
import { NotificationBell } from '@/components/tasks/NotificationBell';
import { QuickAddBar } from './QuickAddBar';
import { useListTasks, getListTasksQueryKey, useListFollowupQueueItems, getListFollowupQueueItemsQueryKey, useListStopServiceFlags, getListStopServiceFlagsQueryKey, useListEstimates, useGetStaffMessagesUnreadSummary, getGetStaffMessagesUnreadSummaryQueryKey } from '@workspace/api-client-react';
import { useQuery } from '@tanstack/react-query';
import { customFetch } from '@workspace/api-client-react';

// ── Bookmarks hook ────────────────────────────────────────────────────────
const BOOKMARKS_KEY = 'divine_edge_bookmarks';

function useBookmarks() {
  const [bookmarks, setBookmarks] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem(BOOKMARKS_KEY) ?? '[]'); } catch { return []; }
  });
  const toggleBookmark = useCallback((href: string) => {
    setBookmarks(prev => {
      const next = prev.includes(href) ? prev.filter(h => h !== href) : [...prev, href];
      try { localStorage.setItem(BOOKMARKS_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  }, []);
  return { bookmarks, toggleBookmark };
}

// ── Standalone nav link (Dashboard top / Settings bottom) ─────────────────
function StandaloneLink({
  item, location, badgeCount, bookmarked, onToggleBookmark, onNavClick,
}: {
  item: NavItem; location: string; badgeCount?: number;
  bookmarked: boolean; onToggleBookmark: (href: string) => void; onNavClick?: () => void;
}) {
  const isActive = [item.href, ...(item.aliases ?? [])].some(h => location === h || location.startsWith(h + '/'));
  return (
    <div className="group relative flex items-center">
      <Link
        href={item.href}
        onClick={onNavClick}
        className={cn(
          'flex-1 flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors',
          isActive
            ? 'bg-sidebar-accent text-sidebar-accent-foreground'
            : 'text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground'
        )}
      >
        <item.icon className={cn('w-5 h-5', isActive ? 'text-sidebar-primary' : 'text-sidebar-foreground/50 group-hover:text-sidebar-foreground/80')} />
        <span className="flex-1">{item.name}</span>
        {!!badgeCount && (
          <span className="min-w-[1.1rem] h-[1.1rem] px-1 rounded-full bg-sidebar-primary text-white text-[10px] font-semibold flex items-center justify-center shrink-0">
            {badgeCount}
          </span>
        )}
      </Link>
      <button
        title={bookmarked ? 'Remove bookmark' : 'Bookmark this page'}
        onClick={e => { e.stopPropagation(); onToggleBookmark(item.href); }}
        className="absolute right-1 opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded text-sidebar-foreground/40 hover:text-yellow-400"
      >
        {bookmarked ? <Star className="w-3 h-3 fill-yellow-400 text-yellow-400" /> : <Star className="w-3 h-3" />}
      </button>
    </div>
  );
}

export function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, isAuthenticated, logout, isTechnician, isCrewManager, canManageOffice } = useAuth();
  const hrMeta = useHrMeta();
  const hasHrAccess = !!hrMeta.data?.hasHrAccess;
  const techNavItems: NavItem[] = [...baseTechNavItems, ...(hasHrAccess ? hrNavItems : hrMeta.data ? [myRecordNavItem] : [])];
  const [location, setLocation] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const { bookmarks, toggleBookmark } = useBookmarks();

  const { data: myTasks = [] } = useListTasks(
    { scope: 'mine' },
    { query: { enabled: isAuthenticated, refetchInterval: 60000, queryKey: getListTasksQueryKey({ scope: 'mine' }) } },
  );
  const myOpenTaskCount = myTasks.filter(t => t.status === 'open' || t.status === 'in_progress').length;

  const { data: openFollowups = [] } = useListFollowupQueueItems(
    { status: 'open' },
    { query: { enabled: isAuthenticated, refetchInterval: 60000, queryKey: getListFollowupQueueItemsQueryKey({ status: 'open' }) } },
  );

  const { data: pendingStopFlags = [] } = useListStopServiceFlags(
    { status: 'pending' },
    { query: { enabled: isAuthenticated && canManageOffice, refetchInterval: 60000, queryKey: getListStopServiceFlagsQueryKey({ status: 'pending' }) } },
  );

  const { data: sentEstimates = [] } = useListEstimates(
    { status: 'sent' },
    { query: { enabled: isAuthenticated && canManageOffice, refetchInterval: 120000, queryKey: ['estimates', 'sent-badge'] } },
  );

  const { data: inventorySummary } = useQuery<{ lowStockCount: number }>({
    queryKey: ['inventory-summary-badge'],
    queryFn: () => customFetch<{ lowStockCount: number }>('/api/inventory/summary'),
    enabled: isAuthenticated && canManageOffice,
    refetchInterval: 300000,
  });

  const { data: openCallbacksData } = useQuery<unknown[]>({
    queryKey: ['callbacks-open-badge'],
    queryFn: () => customFetch<unknown[]>('/api/callbacks?status=open'),
    enabled: isAuthenticated && canManageOffice,
    refetchInterval: 120000,
  });
  const openCallbackCount = Array.isArray(openCallbacksData) ? openCallbacksData.length : 0;

  const { data: staffMessageUnread } = useGetStaffMessagesUnreadSummary({
    query: {
      enabled: isAuthenticated,
      queryKey: getGetStaffMessagesUnreadSummaryQueryKey(),
      refetchInterval: 30000,
    },
  });

  const badgeCounts: Record<string, number> = {
    '/tasks': myOpenTaskCount,
    '/followup-queue': openFollowups.length,
    '/financials': pendingStopFlags.length,
    '/invoices': pendingStopFlags.length,
    ...(sentEstimates.length > 0 ? { '/estimates': sentEstimates.length } : {}),
    ...(openCallbackCount > 0 ? { '/callbacks': openCallbackCount } : {}),
    ...((inventorySummary?.lowStockCount ?? 0) > 0 ? { '/inventory': inventorySummary!.lowStockCount } : {}),
    ...((staffMessageUnread?.total ?? 0) > 0 ? { '/staff-messages': staffMessageUnread!.total } : {}),
  };

  useEffect(() => {
    if (!isAuthenticated && location !== '/login') {
      setLocation('/login');
    }
  }, [isAuthenticated, location, setLocation]);

  if (!isAuthenticated) return null;

  const { can } = usePermissions();

  const roleMap: Record<string, boolean> = {
    isCrewManager,
    canManageOffice,
    hasHrAccess,
    isOwner: canManageOffice,
    isManager: canManageOffice,
    isDepartmentManager: canManageOffice,
    canManageJobs: isCrewManager || canManageOffice,
  };

  const visibleSections = adminNavSections
    .filter(section => {
      if (!section.roles) return true;
      return section.roles.some(r => roleMap[r]);
    })
    .map(section => ({
      ...section,
      items: section.items.filter(item => !item.permissionKey || can(item.permissionKey as any)),
    }))
    .filter(section => section.items.length > 0);
  // Non-HR office staff get a direct link to their own record (no directory fallback).
  if (!hasHrAccess && hrMeta.data) {
    const admin = visibleSections.find(s => s.id === 'admin') ?? visibleSections[visibleSections.length - 1];
    if (admin) admin.items = [...admin.items, myRecordNavItem];
  }

  const visiblePinned = pinnedNavItems.filter(item =>
    item.roles.some(r => roleMap[r]) && (!item.permissionKey || can(item.permissionKey as any)),
  );

  // All nav items flat (for bookmark lookup)
  const allNavItems: NavItem[] = [
    { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
    { name: 'Settings',  href: '/settings',  icon: Settings },
    ...visiblePinned,
    ...visibleSections.flatMap(s => s.items),
    ...techNavItems,
  ];

  // Build bookmarked item objects from hrefs
  const bookmarkedItems = bookmarks
    .map(href => allNavItems.find(i => i.href === href))
    .filter((i): i is NavItem => !!i)
    .filter(i => !visiblePinned.some(p => p.href === i.href));

  const userInitials = user?.name.slice(0, 2).toUpperCase() ?? '??';

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
        <nav className="flex-1 px-3 overflow-y-auto pb-2">
          {isTechnician ? (
            <div className="space-y-0.5">
              {techNavItems.map((item) => {
                const isActive = location === item.href || location.startsWith(item.href + '/');
                return (
                  <div key={item.href} className="group relative flex items-center">
                    <Link
                      href={item.href}
                      onClick={onNavClick}
                      className={cn(
                        'flex-1 flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors',
                        isActive
                          ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                          : 'text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground'
                      )}
                    >
                      <item.icon className={cn('w-5 h-5', isActive ? 'text-sidebar-primary' : 'text-sidebar-foreground/50 group-hover:text-sidebar-foreground/80')} />
                      <span className="flex-1">{item.name}</span>
                      {!!badgeCounts[item.href] && (
                        <span className="min-w-[1.1rem] h-[1.1rem] px-1 rounded-full bg-sidebar-primary text-white text-[10px] font-semibold flex items-center justify-center shrink-0">
                          {badgeCounts[item.href]}
                        </span>
                      )}
                    </Link>
                    <button
                      title={bookmarks.includes(item.href) ? 'Remove bookmark' : 'Bookmark'}
                      onClick={e => { e.stopPropagation(); toggleBookmark(item.href); }}
                      className="absolute right-1 opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded text-sidebar-foreground/40 hover:text-yellow-400"
                    >
                      {bookmarks.includes(item.href)
                        ? <Star className="w-3 h-3 fill-yellow-400 text-yellow-400" />
                        : <Star className="w-3 h-3" />}
                    </button>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="space-y-1">
              {/* ── Standalone Dashboard link ── */}
              <StandaloneLink
                item={{ name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard }}
                location={location}
                bookmarked={bookmarks.includes('/dashboard')}
                onToggleBookmark={toggleBookmark}
                onNavClick={onNavClick}
              />

              {/* ── Pinned one-click links ── */}
              {visiblePinned.length > 0 && (
                <div className="space-y-0.5" data-testid="nav-pinned">
                  {visiblePinned.map(item => (
                    <StandaloneLink
                      key={item.href}
                      item={item}
                      location={location}
                      badgeCount={badgeCounts[item.href]}
                      bookmarked={bookmarks.includes(item.href)}
                      onToggleBookmark={toggleBookmark}
                      onNavClick={onNavClick}
                    />
                  ))}
                </div>
              )}

              {/* ── Bookmarks (below Dashboard, no label) ── */}
              {bookmarkedItems.length > 0 && (
                <div className="space-y-0.5">
                  {bookmarkedItems.map(item => (
                    <StandaloneLink
                      key={item.href}
                      item={item}
                      location={location}
                      badgeCount={badgeCounts[item.href]}
                      bookmarked
                      onToggleBookmark={toggleBookmark}
                      onNavClick={onNavClick}
                    />
                  ))}
                </div>
              )}

              <div className="my-1 border-t border-sidebar-border/20" />

              {/* ── Collapsible sections ── */}
              {visibleSections.map(section => (
                <SidebarSection
                  key={section.id}
                  section={section}
                  onNavClick={onNavClick}
                  badgeCounts={badgeCounts}
                  bookmarks={bookmarks}
                  onToggleBookmark={toggleBookmark}
                />
              ))}
            </div>
          )}
        </nav>

        {/* ── Standalone Settings link (bottom of nav, above user footer) ── */}
        {!isTechnician && (
          <div className="px-3 pb-2 shrink-0 border-t border-sidebar-border/30 pt-2">
            <StandaloneLink
              item={{ name: 'Settings', href: '/settings', icon: Settings }}
              location={location}
              bookmarked={bookmarks.includes('/settings')}
              onToggleBookmark={toggleBookmark}
              onNavClick={onNavClick}
            />
          </div>
        )}

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
        <div className="fixed inset-0 z-40 bg-black/60 md:hidden" onClick={() => setMobileOpen(false)} />
      )}
      <div className={cn(
        'fixed inset-y-0 left-0 z-50 w-72 bg-sidebar text-sidebar-foreground flex flex-col transition-transform duration-300 md:hidden',
        mobileOpen ? 'translate-x-0' : '-translate-x-full'
      )}>
        <button onClick={() => setMobileOpen(false)} className="absolute top-4 right-4 text-sidebar-foreground/50 hover:text-white" aria-label="Close menu">
          <X className="w-5 h-5" />
        </button>
        <SidebarContent onNavClick={() => setMobileOpen(false)} />
      </div>

      {/* ── Main content ─────────────────────────────────────────────── */}
      <main className="flex-1 flex flex-col h-full overflow-hidden bg-muted/30">
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border/50 md:hidden bg-background shrink-0">
          <button onClick={() => setMobileOpen(true)} className="text-muted-foreground hover:text-foreground" aria-label="Open menu">
            <Menu className="w-5 h-5" />
          </button>
          <span className="font-semibold text-sm">Divine Edge OS</span>
          <div className="ml-auto"><NotificationBell /></div>
        </div>
        <div className="hidden md:flex items-center justify-end gap-2 px-6 md:px-8 pt-3">
          <QuickAddBar canCustomize={canManageOffice} />
          <div className="h-4 w-px bg-border" aria-hidden />
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
