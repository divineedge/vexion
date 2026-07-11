import React, { useState } from 'react';
import { Link } from 'wouter';
import { useListTasks } from '@workspace/api-client-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ListTodo, Plus } from 'lucide-react';
import { priorityBadgeClass } from '@/lib/taskConstants';
import { TaskFormDrawer } from './TaskFormDrawer';

export function MyTasksWidget() {
  const [createOpen, setCreateOpen] = useState(false);
  const { data: tasks = [] } = useListTasks({ scope: 'mine' });
  const open = tasks.filter(t => t.status === 'open' || t.status === 'in_progress')
    .sort((a, b) => {
      const order: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 };
      return (order[a.priority] ?? 2) - (order[b.priority] ?? 2);
    })
    .slice(0, 5);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <ListTodo className="w-4 h-4" /> My Tasks
          {open.length > 0 && <Badge variant="secondary" className="ml-1">{open.length}</Badge>}
        </CardTitle>
        <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs" onClick={() => setCreateOpen(true)}>
          <Plus className="w-3.5 h-3.5" /> New
        </Button>
      </CardHeader>
      <CardContent className="space-y-2">
        {open.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">You're all caught up.</p>
        ) : (
          open.map(t => (
            <Link key={t.id} href="/tasks" className="block p-2.5 rounded-md border hover:bg-muted/50 transition-colors">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium truncate">{t.title}</p>
                <Badge variant="outline" className={priorityBadgeClass(t.priority) + ' text-[10px] shrink-0'}>{t.priority}</Badge>
              </div>
              {t.contextLabel && <p className="text-xs text-muted-foreground mt-0.5 truncate">{t.contextLabel}</p>}
            </Link>
          ))
        )}
        <Link href="/tasks" className="block text-center text-xs text-primary hover:underline pt-1">View all tasks →</Link>
      </CardContent>
      <TaskFormDrawer open={createOpen} onOpenChange={setCreateOpen} />
    </Card>
  );
}
