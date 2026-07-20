import React, { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useQueryClient } from '@tanstack/react-query';
import {
  useUpdateTask, useDeleteTask,
  getListTasksQueryKey, getListEquipmentTasksQueryKey,
  type InternalTask,
} from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { PlayCircle, CheckCircle2, XCircle, Hand, RotateCcw, Trash2 } from 'lucide-react';
import { roleBucketMatches } from '@/lib/roleBucket';

export function TaskActions({ task }: { task: InternalTask }) {
  const { user, isOwner, isManager, isDepartmentManager, isCrewManager, isTechnician } = useAuth();
  const qc = useQueryClient();
  const [rejectOpen, setRejectOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [rejectionReason, setRejectionReason] = useState('');

  const role = isOwner ? 'company_owner' : isManager ? 'office_manager' : isDepartmentManager ? 'department_manager' : isCrewManager ? 'crew_manager' : 'technician';
  const isAdmin = isOwner || isManager || isDepartmentManager;

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: getListTasksQueryKey() });
    if (task.contextType === 'equipment' && task.contextId) {
      qc.invalidateQueries({ queryKey: getListEquipmentTasksQueryKey(task.contextId) });
    }
  };

  const updateTask = useUpdateTask({
    mutation: {
      onSuccess: () => { invalidate(); toast.success('Task updated'); },
      onError: (err: any) => toast.error(err?.message ?? 'Failed to update task'),
    },
  });

  const deleteTask = useDeleteTask({
    mutation: {
      onSuccess: () => { invalidate(); toast.success('Task deleted'); setDeleteOpen(false); },
      onError: (err: any) => toast.error(err?.message ?? 'Failed to delete task'),
    },
  });

  const isAssignee = task.assignedToUserId === user?.id;
  const canClaim = !task.assignedToUserId && task.assignedToRole && roleBucketMatches(task.assignedToRole, role);
  const isCreator = task.createdById === user?.id;

  const canAct = isAdmin || isAssignee || canClaim;

  function claim() {
    updateTask.mutate({ id: task.id, data: { claim: true } });
  }

  function setStatus(status: string) {
    updateTask.mutate({ id: task.id, data: { status } });
  }

  function submitReject() {
    if (!rejectionReason.trim()) { toast.error('Give a reason for rejecting'); return; }
    updateTask.mutate({ id: task.id, data: { status: 'rejected', rejectionReason: rejectionReason.trim() } }, {
      onSuccess: () => { invalidate(); setRejectOpen(false); setRejectionReason(''); },
    });
  }

  if (task.status === 'done') {
    return (
      <div className="flex items-center gap-1.5">
        <span className="text-xs text-emerald-600 font-medium">Completed</span>
        {isAdmin && (
          <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive" onClick={() => setDeleteOpen(true)}>
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
        )}
        <DeleteDialog open={deleteOpen} onOpenChange={setDeleteOpen} taskTitle={task.title}
          onConfirm={() => deleteTask.mutate({ id: task.id })} isPending={deleteTask.isPending} />
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {canClaim && (
        <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={claim} disabled={updateTask.isPending}>
          <Hand className="w-3.5 h-3.5" /> Claim
        </Button>
      )}
      {canAct && !canClaim && task.status === 'open' && (
        <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => setStatus('in_progress')} disabled={updateTask.isPending}>
          <PlayCircle className="w-3.5 h-3.5" /> Start
        </Button>
      )}
      {canAct && !canClaim && (task.status === 'open' || task.status === 'in_progress') && (
        <>
          <Button size="sm" className="h-7 text-xs gap-1" onClick={() => setStatus('done')} disabled={updateTask.isPending}>
            <CheckCircle2 className="w-3.5 h-3.5" /> Complete
          </Button>
          <Button size="sm" variant="ghost" className="h-7 text-xs gap-1 text-destructive hover:text-destructive" onClick={() => setRejectOpen(true)} disabled={updateTask.isPending}>
            <XCircle className="w-3.5 h-3.5" /> Reject
          </Button>
        </>
      )}
      {isCreator && task.status === 'rejected' && (
        <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => setStatus('open')} disabled={updateTask.isPending}>
          <RotateCcw className="w-3.5 h-3.5" /> Resubmit
        </Button>
      )}
      {isAdmin && (
        <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive" onClick={() => setDeleteOpen(true)} disabled={deleteTask.isPending}>
          <Trash2 className="w-3.5 h-3.5" />
        </Button>
      )}

      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Reject Task</DialogTitle>
            <DialogDescription>Explain why this task can't be completed as assigned. The creator will be notified and can revise & resubmit.</DialogDescription>
          </DialogHeader>
          <Textarea rows={3} value={rejectionReason} onChange={e => setRejectionReason(e.target.value)} placeholder="e.g. Wrong customer info, need more detail..." />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectOpen(false)}>Cancel</Button>
            <Button variant="destructive" onClick={submitReject} disabled={updateTask.isPending}>Reject Task</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <DeleteDialog open={deleteOpen} onOpenChange={setDeleteOpen} taskTitle={task.title}
        onConfirm={() => deleteTask.mutate({ id: task.id })} isPending={deleteTask.isPending} />
    </div>
  );
}

function DeleteDialog({ open, onOpenChange, taskTitle, onConfirm, isPending }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  taskTitle: string;
  onConfirm: () => void;
  isPending: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Delete Task</DialogTitle>
          <DialogDescription>
            Permanently delete <span className="font-medium">"{taskTitle}"</span>? This cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="destructive" onClick={onConfirm} disabled={isPending}>Delete</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
