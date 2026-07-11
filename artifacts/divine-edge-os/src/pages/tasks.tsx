import React, { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useListTasks, getListTasksQueryKey, type InternalTask } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, ListTodo, Calendar, Link2 } from 'lucide-react';
import { format } from 'date-fns';
import { TaskFormDrawer } from '@/components/tasks/TaskFormDrawer';
import { TaskActions } from '@/components/tasks/TaskActions';
import {
  TASK_PRIORITIES, TASK_STATUSES, priorityBadgeClass, statusBadgeClass, roleBucketLabel,
} from '@/lib/taskConstants';

export default function TasksPage() {
  const { user, isOwner, isManager, isDepartmentManager } = useAuth();
  const isAdmin = isOwner || isManager || isDepartmentManager;
  const qc = useQueryClient();

  const [createOpen, setCreateOpen] = useState(false);
  const [scope, setScope] = useState<'mine' | 'all'>(isAdmin ? 'all' : 'mine');
  const [statusFilter, setStatusFilter] = useState('__open__');
  const [priorityFilter, setPriorityFilter] = useState('__all__');

  const listParams = {
    scope,
    ...(statusFilter !== '__all__' && statusFilter !== '__open__' ? { status: statusFilter } : {}),
    ...(priorityFilter !== '__all__' ? { priority: priorityFilter } : {}),
  };

  const { data: tasks = [], isLoading } = useListTasks(
    listParams,
    { query: { queryKey: getListTasksQueryKey(listParams) } },
  );

  const visibleTasks = statusFilter === '__open__'
    ? tasks.filter(t => t.status === 'open' || t.status === 'in_progress')
    : tasks;

  const sorted = [...visibleTasks].sort((a, b) => {
    const order: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 };
    return (order[a.priority] ?? 2) - (order[b.priority] ?? 2) || new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Tasks</h1>
          <p className="text-muted-foreground mt-1">Internal to-dos — separate from customer jobs. Assign, track, and close the loop.</p>
        </div>
        <Button className="gap-2" onClick={() => setCreateOpen(true)}>
          <Plus className="w-4 h-4" /> New Task
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="p-4 border-b flex items-center gap-3 flex-wrap">
            {isAdmin && (
              <Select value={scope} onValueChange={v => setScope(v as 'mine' | 'all')}>
                <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Tasks</SelectItem>
                  <SelectItem value="mine">My Tasks</SelectItem>
                </SelectContent>
              </Select>
            )}
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__open__">Open + In Progress</SelectItem>
                <SelectItem value="__all__">All statuses</SelectItem>
                {TASK_STATUSES.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={priorityFilter} onValueChange={setPriorityFilter}>
              <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All priorities</SelectItem>
                {TASK_PRIORITIES.map(p => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="divide-y">
            {isLoading ? (
              <div className="py-10 text-center text-muted-foreground">Loading...</div>
            ) : sorted.length === 0 ? (
              <div className="py-14 text-center text-muted-foreground">
                <ListTodo className="w-8 h-8 mx-auto mb-2 opacity-30" />
                Nothing here. Create a task to assign work to a teammate.
              </div>
            ) : (
              sorted.map(task => <TaskRow key={task.id} task={task} />)
            )}
          </div>
        </CardContent>
      </Card>

      <TaskFormDrawer open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}

function TaskRow({ task }: { task: InternalTask }) {
  return (
    <div className="p-4 flex items-start justify-between gap-4 flex-wrap">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="font-medium truncate">{task.title}</p>
          <Badge variant="outline" className={priorityBadgeClass(task.priority)}>{task.priority}</Badge>
          <Badge variant="outline" className={statusBadgeClass(task.status)}>{task.status.replace('_', ' ')}</Badge>
        </div>
        {task.description && <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{task.description}</p>}
        {task.status === 'rejected' && task.rejectionReason && (
          <p className="text-xs text-destructive mt-1">Rejected: {task.rejectionReason}</p>
        )}
        <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground flex-wrap">
          <span>From {task.createdByName ?? '—'}</span>
          <span>→ {task.assignedToName ?? roleBucketLabel(task.assignedToRole)}</span>
          {task.dueDate && (
            <span className="flex items-center gap-1"><Calendar className="w-3 h-3" /> {format(new Date(task.dueDate), 'MMM d, yyyy')}</span>
          )}
          {task.contextLabel && (
            <span className="flex items-center gap-1"><Link2 className="w-3 h-3" /> {task.contextLabel}</span>
          )}
        </div>
      </div>
      <TaskActions task={task} />
    </div>
  );
}
