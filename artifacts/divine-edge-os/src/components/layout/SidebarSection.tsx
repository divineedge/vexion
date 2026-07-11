import React, { useState, useEffect } from 'react';
import { Link, useLocation } from 'wouter';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { NavSection } from './navConfig';

interface SidebarSectionProps {
  section: NavSection;
  /** Called when a nav item is clicked (e.g. to close mobile sheet) */
  onNavClick?: () => void;
  /** Optional per-href badge counts (e.g. open task count) */
  badgeCounts?: Record<string, number>;
}

export function SidebarSection({ section, onNavClick, badgeCounts }: SidebarSectionProps) {
  const [location] = useLocation();

  const isActiveSectionItem = section.items.some(
    item => location === item.href || location.startsWith(item.href + '/')
  );

  const storageKey = `divine_edge_sidebar_${section.id}`;

  const [open, setOpen] = useState(() => {
    try {
      const stored = localStorage.getItem(storageKey);
      // If no preference stored, default open if active item is in this section
      if (stored === null) return isActiveSectionItem;
      return stored === 'true';
    } catch {
      return isActiveSectionItem;
    }
  });

  // Auto-expand when user navigates to a page in this section
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
          'w-full flex items-center justify-between px-3 py-1.5 rounded-md text-xs font-semibold uppercase tracking-widest transition-colors',
          isActiveSectionItem
            ? 'text-sidebar-foreground/90'
            : 'text-sidebar-foreground/40 hover:text-sidebar-foreground/70'
        )}
      >
        <span>{section.label}</span>
        <ChevronDown
          className={cn(
            'w-3.5 h-3.5 transition-transform duration-200',
            open ? 'rotate-0' : '-rotate-90'
          )}
        />
      </button>

      <div
        className={cn(
          'overflow-hidden transition-all duration-200',
          open ? 'max-h-[600px] opacity-100' : 'max-h-0 opacity-0'
        )}
      >
        <div className="mt-0.5 space-y-0.5 pb-1">
          {section.items.map((item) => {
            const isActive = location === item.href || location.startsWith(item.href + '/');
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onNavClick}
                className={cn(
                  'flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors group',
                  isActive
                    ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                    : 'text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground'
                )}
              >
                <item.icon
                  className={cn(
                    'w-4 h-4 shrink-0',
                    isActive
                      ? 'text-sidebar-primary'
                      : 'text-sidebar-foreground/50 group-hover:text-sidebar-foreground/80'
                  )}
                />
                <span className="flex-1">{item.name}</span>
                {!!badgeCounts?.[item.href] && (
                  <span className="min-w-[1.1rem] h-[1.1rem] px-1 rounded-full bg-sidebar-primary text-white text-[10px] font-semibold flex items-center justify-center shrink-0">
                    {badgeCounts[item.href]}
                  </span>
                )}
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}
