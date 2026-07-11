import React, { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useQueryClient } from '@tanstack/react-query';
import {
  useCreateTask, getListTasksQueryKey, getListEquipmentTasksQueryKey,
  useListUsers, getListUsersQueryKey,
  useListCustomers, getListCustomersQueryKey,
  useListJobs, getListJobsQueryKey,
  useListProperties, getListPropertiesQueryKey,
  useListEquipment, getListEquipmentQueryKey,
  type InternalTask,
} from '@workspace/api-client-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { toast } from 'sonner';
import {
  QUICK_ACTION_TYPES, TASK_PRIORITIES, TASK_CONTEXT_TYPES, TASK_ROLE_BUCKETS,
} from '@/lib/taskConstants';

interface TaskFormDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Pre-fill and lock the context link, e.g. when launched from an equipment detail page */
  lockedContext?: { contextType: 'customer' | 'job' | 'property' | 'equipment'; contextId: number; label: string };
  onCreated?: (task: InternalTask) => void;
}

type Assignee = { kind: 'user'; userId: number } | { kind: 'role'; role: string };

export function TaskFormDrawer({ open, onOpenChange, lockedContext, onCreated }: TaskFormDrawerProps) {
  const { user, isOwner, isManager, isDepartmentManager, isCrewManager, isTechnician } = useAuth();
  const qc = useQueryClient();
  const isAdminOffice = isOwner || isManager || isDepartmentManager;

  const [quickAction, setQuickAction] = useState<string>('custom');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState('normal');
  const [dueDate, setDueDate] = useState('');
  const [contextType, setContextType] = useState<string>(lockedContext?.contextType ?? '__none__');
  const [contextId, setContextId] = useState<string>(lockedContext ? String(lockedContext.contextId) : '');
  const [assignee, setAssignee] = useState<string>(''); // encoded as "user:<id>" or "role:<bucket>"

  const { data: users = [] } = useListUsers({ query: { enabled: open, queryKey: getListUsersQueryKey() } });
  const { data: customersResponse } = useListCustomers(undefined, { query: { enabled: open && contextType === 'customer', queryKey: getListCustomersQueryKey() } });
  const customers = customersResponse?.items ?? [];
  const { data: jobs = [] } = useListJobs(undefined, { query: { enabled: open && contextType === 'job', queryKey: getListJobsQueryKey() } });
  const { data: properties = [] } = useListProperties(undefined, { query: { enabled: open && contextType === 'property', queryKey: getListPropertiesQueryKey() } });
  const { data: equipmentList = [] } = useListEquipment(undefined, { query: { enabled: open && contextType === 'equipment', queryKey: getListEquipmentQueryKey() } });

  const createTask = useCreateTask({
    mutation: {
      onSuccess: (task) => {
        toast.success('Task created');
        qc.invalidateQueries({ queryKey: getListTasksQueryKey() });
        if (task.contextType === 'equipment' && task.contextId) {
          qc.invalidateQueries({ queryKey: getListEquipmentTasksQueryKey(task.contextId) });
        }
        onCreated?.(task);
        reset();
        onOpenChange(false);
      },
      onError: (err: any) => toast.error(err?.message ?? 'Failed to create task'),
    },
  });

  function reset() {
    setQuickAction('custom');
    setTitle('');
    setDescription('');
    setPriority('normal');
    setDueDate('');
    setAssignee('');
    if (!lockedContext) { setContextType('__none__'); setContextId(''); }
  }

  useEffect(() => {
    if (!open) return;
    if (lockedContext) {
      setContextType(lockedContext.contextType);
      setContextId(String(lockedContext.contextId));
    }
  }, [open, lockedContext]);

  function applyQuickAction(value: string) {
    setQuickAction(value);
    const action = QUICK_ACTION_TYPES.find(a => a.value === value);
    if (!action) return;
    if (!lockedContext) {
      setContextType(action.defaultContextType ?? '__none__');
      setContextId('');
    }
    if (action.defaultAssignedToRole) setAssignee(`role:${action.defaultAssignedToRole}`);
    setTitle(action.titleTemplate());
  }

  // Assignee options available to the current caller, per role-routing rules.
  const assigneeOptions: { value: string; label: string }[] = [];
  if (isAdminOffice) {
    assigneeOptions.push(...TASK_ROLE_BUCKETS.map(b => ({ value: `role:${b.value}`, label: b.label })));
    users.filter(u => u.id !== user?.id).forEach(u => assigneeOptions.push({ value: `user:${u.id}`, label: `${u.name} (${u.role.replace('_', ' ')})` }));
  } else if (isCrewManager) {
    assigneeOptions.push({ value: 'role:admin_office', label: 'Any Admin/Office' });
    if (user) assigneeOptions.push({ value: `user:${user.id}`, label: `${user.name} (myself)` });
    users.filter(u => u.role === 'technician').forEach(u => assigneeOptions.push({ value: `user:${u.id}`, label: u.name }));
  } else {
    // technician / other
    assigneeOptions.push({ value: 'role:admin_office', label: 'Any Admin/Office' });
    users.filter(u => u.role === 'crew_manager').forEach(u => assigneeOptions.push({ value: `user:${u.id}`, label: `${u.name} (my manager)` }));
  }

  const contextOptions: { id: number; label: string }[] = contextType === 'customer' ? customers.map(c => ({ id: c.id, label: c.name }))
    : contextType === 'job' ? jobs.map(j => ({ id: j.id, label: j.title }))
    : contextType === 'property' ? properties.map(p => ({ id: p.id, label: p.address }))
    : contextType === 'equipment' ? equipmentList.map(e => ({ id: e.id, label: e.name }))
    : [];

  function handleSubmit() {
    if (!title.trim()) { toast.error('Title is required'); return; }
    if (!assignee) { toast.error('Choose an assignee'); return; }
    const [kind, value] = assignee.split(':');
    createTask.mutate({
      data: {
        title: title.trim(),
        description: description.trim() || undefined,
        taskType: quickAction !== 'custom' ? quickAction : undefined,
        priority,
        dueDate: dueDate || undefined,
        assignedToUserId: kind === 'user' ? parseInt(value, 10) : undefined,
        assignedToRole: kind === 'role' ? value : undefined,
        contextType: contextType !== '__none__' ? contextType : undefined,
        contextId: contextType !== '__none__' && contextId ? parseInt(contextId, 10) : undefined,
      },
    });
  }

  return (
    <Sheet open={open} onOpenChange={o => { if (!o) reset(); onOpenChange(o); }}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader className="pb-4">
          <SheetTitle>New Task</SheetTitle>
          <SheetDescription>Assign work to a teammate or a role — they'll get an in-app notification.</SheetDescription>
        </SheetHeader>
        <div className="space-y-4 pb-6">
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Quick Action</label>
            <Select value={quickAction} onValueChange={applyQuickAction}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {QUICK_ACTION_TYPES.map(a => <SelectItem key={a.value} value={a.value}>{a.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium">Title <span className="text-destructive">*</span></label>
            <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Call back about reschedule" />
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium">Description</label>
            <Textarea rows={3} value={description} onChange={e => setDescription(e.target.value)} placeholder="Any extra detail..." />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Priority</label>
              <Select value={priority} onValueChange={setPriority}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TASK_PRIORITIES.map(p => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Due Date</label>
              <Input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium">Assign To <span className="text-destructive">*</span></label>
            <Select value={assignee} onValueChange={setAssignee}>
              <SelectTrigger><SelectValue placeholder="Select assignee..." /></SelectTrigger>
              <SelectContent>
                {assigneeOptions.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <Separator />

          <div className="space-y-1.5">
            <label className="text-sm font-medium">Link to</label>
            <Select value={contextType} onValueChange={v => { setContextType(v); setContextId(''); }} disabled={!!lockedContext}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">Nothing specific</SelectItem>
                {TASK_CONTEXT_TYPES.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {lockedContext ? (
            <p className="text-sm text-muted-foreground">Linked to: <span className="font-medium text-foreground">{lockedContext.label}</span></p>
          ) : contextType !== '__none__' && (
            <div className="space-y-1.5">
              <label className="text-sm font-medium">{TASK_CONTEXT_TYPES.find(c => c.value === contextType)?.label}</label>
              <Select value={contextId} onValueChange={setContextId}>
                <SelectTrigger><SelectValue placeholder="Select..." /></SelectTrigger>
                <SelectContent>
                  {contextOptions.map((o: { id: number; label: string }) => <SelectItem key={o.id} value={String(o.id)}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}

          <Separator />
          <div className="flex gap-3 justify-end">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={createTask.isPending}>
              {createTask.isPending ? 'Creating...' : 'Create Task'}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
