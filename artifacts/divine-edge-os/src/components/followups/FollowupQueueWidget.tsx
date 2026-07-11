import React from 'react';
import { Link } from 'wouter';
import { useListFollowupQueueItems, getListFollowupQueueItemsQueryKey } from '@workspace/api-client-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { PhoneMissed } from 'lucide-react';

const PRIORITY_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2 };

export function FollowupQueueWidget() {
  const params = { status: 'open' as const };
  const { data: items = [] } = useListFollowupQueueItems(params, {
    query: { queryKey: getListFollowupQueueItemsQueryKey(params), refetchInterval: 60000 },
  });

  const top = [...items]
    .sort((a, b) => (PRIORITY_ORDER[a.priority] ?? 2) - (PRIORITY_ORDER[b.priority] ?? 2) || b.ageDays - a.ageDays)
    .slice(0, 5);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <PhoneMissed className="w-4 h-4" /> Follow-Up Queue
          {items.length > 0 && <Badge variant="secondary" className="ml-1">{items.length}</Badge>}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {top.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">Nothing needs follow-up right now.</p>
        ) : (
          top.map(item => (
            <Link key={item.id} href="/followup-queue" className="block p-2.5 rounded-md border hover:bg-muted/50 transition-colors">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium truncate">{item.customerName ?? 'Unknown customer'}</p>
                <Badge variant="outline" className="text-[10px] shrink-0">{item.priority}</Badge>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5 truncate">{item.reason}</p>
            </Link>
          ))
        )}
        <Link href="/followup-queue" className="block text-center text-xs text-primary hover:underline pt-1">View full queue →</Link>
      </CardContent>
    </Card>
  );
}
