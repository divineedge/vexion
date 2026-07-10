import React from 'react';
import { useLocation } from 'wouter';
import { ChevronRight } from 'lucide-react';
import { adminNavSections, techNavItems, buildNavIndex } from './navConfig';

const adminIndex = buildNavIndex(adminNavSections);
const techIndex = buildNavIndex([{ id: 'tech', label: 'Navigation', items: techNavItems }]);

interface BreadcrumbProps {
  isTechnician: boolean;
}

export function Breadcrumb({ isTechnician }: BreadcrumbProps) {
  const [location] = useLocation();

  // Match by exact path or by longest prefix (for sub-pages like /customers/123)
  function resolve(index: Record<string, { sectionLabel: string; itemName: string }>) {
    // Exact match first
    if (index[location]) return index[location];
    // Prefix match — pick longest matching href
    let best: { sectionLabel: string; itemName: string } | null = null;
    let bestLen = 0;
    for (const [href, entry] of Object.entries(index)) {
      if (location.startsWith(href + '/') && href.length > bestLen) {
        best = entry;
        bestLen = href.length;
      }
    }
    return best;
  }

  const match = isTechnician ? resolve(techIndex) : resolve(adminIndex);
  if (!match) return null;

  return (
    <div className="flex items-center gap-1.5 text-xs text-muted-foreground px-6 md:px-8 py-2 border-b border-border/50 bg-background/80 backdrop-blur-sm sticky top-0 z-10">
      {!isTechnician && (
        <>
          <span className="font-medium text-muted-foreground/70">{match.sectionLabel}</span>
          <ChevronRight className="w-3 h-3 text-muted-foreground/40" />
        </>
      )}
      <span className="font-semibold text-foreground">{match.itemName}</span>
    </div>
  );
}
