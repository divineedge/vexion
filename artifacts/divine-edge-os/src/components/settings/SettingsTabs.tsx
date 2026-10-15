import { createContext, useContext, useState, type ComponentProps } from 'react';
import { Tabs, TabsContent } from '@/components/ui/tabs';

const VisitedTabs = createContext<ReadonlySet<string>>(new Set());

/** Lazily mount each tab once, then keep drafts, save queues and errors alive. */
export function SettingsTabs({ defaultValue, value, onValueChange, children, ...props }: ComponentProps<typeof Tabs>) {
  const [selected, setSelected] = useState(value ?? defaultValue ?? '');
  const [visited, setVisited] = useState(() => new Set([value ?? defaultValue ?? '']));
  const active = value ?? selected;
  return (
    <VisitedTabs.Provider value={visited}>
      <Tabs {...props} value={active} onValueChange={next => {
        setVisited(previous => new Set([...previous, next]));
        setSelected(next);
        onValueChange?.(next);
      }}>{children}</Tabs>
    </VisitedTabs.Provider>
  );
}

export function SettingsTabsContent({ value, className = '', ...props }: ComponentProps<typeof TabsContent>) {
  const visited = useContext(VisitedTabs);
  return <TabsContent {...props} value={value} forceMount={visited.has(value) ? true : undefined}
    className={`data-[state=inactive]:hidden ${className}`} />;
}
