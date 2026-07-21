import React, { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useListTasks, useBulkArchiveTasks, getListTasksQueryKey, type InternalTask } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Plus, ListTodo, Calendar, Link2, Archive } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { TaskFormDrawer } from '@/components/tasks/TaskFormDrawer';
import { TaskActions } from '@/components/tasks/TaskActions';
import {
  TASK_PRIORITIES, TASK_STATUSES, priorityBadgeClass, statusBadgeClass, roleBucketLabel,
} from '@/lib/taskConstants';
import { Label } from '@/components/ui/label';

export default function TasksPage() {
  const { user, isOwner, isManager, isDepartmentManager } = useAuth();
  const isAdmin = isOwner || isManager || isDepartmentManager;
  const qc = useQueryClient();

  const [createOpen, setCreateOpen] = useState(false);
  const [scope, setScope] = useState<'mine' | 'all'>(isAdmin ? 'all' : 'mine');
  const [statusFilter, setStatusFilter] = useState('__open__');
  const [priorityFilter, setPriorityFilter] = useState('__all__');
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [archiveConfirmOpen, setArchiveConfirmOpen] = useState(false);
  const [showArchived, setShowArchived] = useState(false);

  const listParams = {
    scope,
    ...(statusFilter !== '__all__' && statusFilter !== '__open__' ? { status: statusFilter } : {}),
    ...(priorityFilter !== '__all__' ? { priority: priorityFilter } : {}),
    ...(isAdmin && showArchived ? { includeArchived: true } : {}),
  };

  const { data: tasks = [], isLoading } = useListTasks(
    listParams,
    { query: { queryKey: getListTasksQueryKey(listParams) } },
  );

  const visibleTasks = (() => {
    let filtered = tasks;
    if (statusFilter === '__open__') {
      filtered = filtered.filter(t => t.status === 'open' || t.status === 'in_progress');
    }
    if (!showArchived) {
      filtered = filtered.filter(t => !t.archivedAt);
    } else if (showArchived) {
      filtered = filtered.filter(t => !!t.archivedAt);
    }
    return filtered;
  })();

  const sorted = [...visibleTasks].sort((a, b) => {
    const order: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 };
    return (order[a.priority] ?? 2) - (order[b.priority] ?? 2) || new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });

  const bulkArchive = useBulkArchiveTasks({
    mutation: {
      onSuccess: (res) => {
        qc.invalidateQueries({ queryKey: getListTasksQueryKey() });
        toast.success(`${res.archived} task${res.archived === 1 ? '' : 's'} archived`);
        setSelected(new Set());
        setArchiveConfirmOpen(false);
      },
      onError: (err: any) => toast.error(err?.message ?? 'Failed to archive tasks'),
    },
  });

  const allIds = sorted.map(t => t.id);
  const allSelected = allIds.length > 0 && allIds.every(id => selected.has(id));
  const someSelected = selected.size > 0;

  function toggleAll() {
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(allIds));
    }
  }

  function toggleOne(id: number) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  // Clear selection when filter changes
  function changeScope(v: 'mine' | 'all') { setScope(v); setSelected(new Set()); }
  function changeStatus(v: string) { setStatusFilter(v); setSelected(new Set()); }
  function changePriority(v: string) { setPriorityFilter(v); setSelected(new Set()); }
  function toggleShowArchived() { setShowArchived(prev => !prev); setSelected(new Set()); }

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
              <Select value={scope} onValueChange={v => changeScope(v as 'mine' | 'all')}>
                <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Tasks</SelectItem>
                  <SelectItem value="mine">My Tasks</SelectItem>
                </SelectContent>
              </Select>
            )}
            <Select value={statusFilter} onValueChange={changeStatus}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__open__">Open + In Progress</SelectItem>
                <SelectItem value="__all__">All statuses</SelectItem>
                {TASK_STATUSES.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={priorityFilter} onValueChange={changePriority}>
              <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All priorities</SelectItem>
                {TASK_PRIORITIES.map(p => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
              </SelectContent>
            </Select>

            {isAdmin && (
              <div className="flex items-center gap-2 ml-auto">
                <Checkbox
                  id="show-archived"
                  checked={showArchived}
                  onCheckedChange={toggleShowArchived}
                />
                <Label htmlFor="show-archived" className="text-sm cursor-pointer select-none">
                  Show archived
                </Label>
              </div>
            )}
            {isAdmin && someSelected && !showArchived && (
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">{selected.size} selected</span>
                <Button size="sm" variant="outline" className="gap-1.5 h-8" onClick={() => setArchiveConfirmOpen(true)} disabled={bulkArchive.isPending}>
                  <Archive className="w-3.5 h-3.5" /> Archive selected
                </Button>
              </div>
            )}
          </div>

          {/* Select-all bar — only for admins viewing active tasks */}
          {isAdmin && !showArchived && sorted.length > 0 && (
            <div className="px-4 py-2 border-b bg-muted/30 flex items-center gap-2 text-xs text-muted-foreground">
              <Checkbox
                checked={allSelected}
                onCheckedChange={toggleAll}
                aria-label="Select all tasks"
              />
              <span>{allSelected ? 'Deselect all' : `Select all ${sorted.length}`}</span>
            </div>
          )}

          <div className="divide-y">
            {isLoading ? (
              <div className="py-10 text-center text-muted-foreground">Loading...</div>
            ) : sorted.length === 0 ? (
              <div className="py-14 text-center text-muted-foreground">
                <ListTodo className="w-8 h-8 mx-auto mb-2 opacity-30" />
                Nothing here. Create a task to assign work to a teammate.
              </div>
            ) : (
              sorted.map(task => (
                <TaskRow
                  key={task.id}
                  task={task}
                  isAdmin={isAdmin}
                  showArchived={showArchived}
                  selected={selected.has(task.id)}
                  onToggle={() => toggleOne(task.id)}
                />
              ))
            )}
          </div>
        </CardContent>
      </Card>

      <TaskFormDrawer open={createOpen} onOpenChange={setCreateOpen} />

      <Dialog open={archiveConfirmOpen} onOpenChange={setArchiveConfirmOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Archive {selected.size} task{selected.size === 1 ? '' : 's'}?</DialogTitle>
            <DialogDescription>
              Archived tasks are hidden from all default views. You can reveal them later by filtering for archived tasks.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setArchiveConfirmOpen(false)}>Cancel</Button>
            <Button
              onClick={() => bulkArchive.mutate({ data: { ids: Array.from(selected) } })}
              disabled={bulkArchive.isPending}
            >
              Archive
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function TaskRow({ task, isAdmin, showArchived, selected, onToggle }: {
  task: InternalTask;
  isAdmin: boolean;
  showArchived: boolean;
  selected: boolean;
  onToggle: () => void;
}) {
  return (
    <div className={`p-4 flex items-start gap-3 flex-wrap transition-colors ${selected ? 'bg-muted/40' : ''} ${task.archivedAt ? 'opacity-75' : ''}`}>
      {isAdmin && !showArchived && (
        <div className="pt-0.5">
          <Checkbox checked={selected} onCheckedChange={onToggle} aria-label={`Select task: ${task.title}`} />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="font-medium truncate">{task.title}</p>
          <Badge variant="outline" className={priorityBadgeClass(task.priority)}>{task.priority}</Badge>
          <Badge variant="outline" className={statusBadgeClass(task.status)}>{task.status.replace('_', ' ')}</Badge>
          {task.archivedAt && (
            <Badge variant="outline" className="text-muted-foreground border-muted-foreground/40 bg-muted/50">
              Archived {format(new Date(task.archivedAt), 'MMM d, yyyy')}
            </Badge>
          )}
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
