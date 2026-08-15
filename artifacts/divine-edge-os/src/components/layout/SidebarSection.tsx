import React, { useState, useEffect } from 'react';
import { Link, useLocation } from 'wouter';
import { ChevronDown, Star } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { NavSection } from './navConfig';

interface SidebarSectionProps {
  section: NavSection;
  onNavClick?: () => void;
  badgeCounts?: Record<string, number>;
  /** Currently bookmarked hrefs */
  bookmarks?: string[];
  /** Toggle bookmark for an href */
  onToggleBookmark?: (href: string) => void;
}

export function SidebarSection({ section, onNavClick, badgeCounts, bookmarks = [], onToggleBookmark }: SidebarSectionProps) {
  const [location] = useLocation();

  const isActiveSectionItem = section.items.some(
    item => location === item.href || location.startsWith(item.href + '/')
  );

  const storageKey = `divine_edge_sidebar_${section.id}`;

  const [open, setOpen] = useState(() => {
    try {
      const stored = localStorage.getItem(storageKey);
      if (stored === null) return isActiveSectionItem;
      return stored === 'true';
    } catch {
      return isActiveSectionItem;
    }
  });

  useEffect(() => {
    if (isActiveSectionItem && !open) {
      setOpen(true);
      try { localStorage.setItem(storageKey, 'true'); } catch {}
    }
  }, [location]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = () => {
    const next = !open;
    setOpen(next);
    try { localStorage.setItem(storageKey, String(next)); } catch {}
  };

  return (
    <div className="mb-1">
      <button
        onClick={toggle}
        className={cn(
          'w-full flex items-center justify-between px-3 py-1.5 rounded-md text-xs font-semibold uppercase tracking-wider transition-colors',
          isActiveSectionItem
            ? 'text-sidebar-foreground/90'
            : 'text-sidebar-foreground/40 hover:text-sidebar-foreground/70'
        )}
      >
        <span className="truncate whitespace-nowrap">{section.label}</span>
        <ChevronDown className={cn('w-3.5 h-3.5 transition-transform duration-200', open ? 'rotate-0' : '-rotate-90')} />
      </button>

      <div className={cn('overflow-hidden transition-all duration-200', open ? 'max-h-[600px] opacity-100' : 'max-h-0 opacity-0')}>
        <div className="mt-0.5 space-y-0.5 pb-1">
          {section.items.map((item) => {
            const isActive = location === item.href || location.startsWith(item.href + '/');
            const isBookmarked = bookmarks.includes(item.href);
            return (
              <div key={item.href} className="group relative flex items-center">
                <Link
                  href={item.href}
                  onClick={onNavClick}
                  className={cn(
                    'flex-1 flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors',
                    isActive
                      ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                      : 'text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground'
                  )}
                >
                  <item.icon className={cn('w-4 h-4 shrink-0', isActive ? 'text-sidebar-primary' : 'text-sidebar-foreground/50 group-hover:text-sidebar-foreground/80')} />
                  <span className="flex-1">{item.name}</span>
                  {!!badgeCounts?.[item.href] && (
                    <span className="min-w-[1.1rem] h-[1.1rem] px-1 rounded-full bg-sidebar-primary text-white text-[10px] font-semibold flex items-center justify-center shrink-0">
                      {badgeCounts[item.href]}
                    </span>
                  )}
                </Link>
                {onToggleBookmark && (
                  <button
                    title={isBookmarked ? 'Remove bookmark' : 'Bookmark this page'}
                    onClick={e => { e.stopPropagation(); onToggleBookmark(item.href); }}
                    className="absolute right-1 opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded text-sidebar-foreground/40 hover:text-yellow-400"
                  >
                    {isBookmarked
                      ? <Star className="w-3 h-3 fill-yellow-400 text-yellow-400" />
                      : <Star className="w-3 h-3" />}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
