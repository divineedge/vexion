import { useEffect, useState } from 'react';
import { loadDemoSandbox, subscribeDemoSandbox, type DemoSandbox } from '@/utils/demoSandbox';

export function useDemoSandbox(): DemoSandbox | null {
  const [sandbox, setSandbox] = useState<DemoSandbox | null>(() => loadDemoSandbox());
  useEffect(() => subscribeDemoSandbox(() => setSandbox(loadDemoSandbox())), []);
  return sandbox;
}
