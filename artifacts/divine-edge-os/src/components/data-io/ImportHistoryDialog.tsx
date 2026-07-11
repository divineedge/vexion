import React, { useEffect, useState } from 'react';
import {
  useListImportBatches,
  useRollbackImportBatch,
  type ImportExportEntity,
  type ImportBatchSummary,
} from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Loader2, Undo2, History } from 'lucide-react';
import { toast } from 'sonner';

interface ImportHistoryDialogProps {
  entity: ImportExportEntity;
  entityLabel: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after a successful rollback so the caller can refresh its list. */
  onRolledBack?: () => void;
}

export function ImportHistoryDialog({ entity, entityLabel, open, onOpenChange, onRolledBack }: ImportHistoryDialogProps) {
  const [batches, setBatches] = useState<ImportBatchSummary[] | null>(null);
  const [confirmBatch, setConfirmBatch] = useState<ImportBatchSummary | null>(null);
  const listBatches = useListImportBatches();
  const rollback = useRollbackImportBatch();

  useEffect(() => {
    if (!open) return;
    setBatches(null);
    listBatches.mutate(entity, {
      onSuccess: (data) => setBatches(data),
      onError: () => toast.error('Could not load import history.'),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, entity]);

  const handleRollback = () => {
    if (!confirmBatch) return;
    rollback.mutate(confirmBatch.id, {
      onSuccess: (data) => {
        toast.success(
          data.failedCount > 0
            ? `Rolled back with ${data.failedCount} row(s) that could not be undone (already changed since).`
            : `Import undone: ${data.deletedCount} row(s) removed, ${data.revertedCount} restored to their prior values.`,
        );
        setConfirmBatch(null);
        setBatches((prev) =>
          prev?.map((b) => (b.id === confirmBatch.id ? { ...b, status: 'rolled_back', rolledBackAt: new Date().toISOString() } : b)) ?? null,
        );
        onRolledBack?.();
      },
      onError: () => toast.error('Rollback failed. Please try again.'),
    });
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <History className="w-4 h-4" /> {entityLabel} Import History
            </DialogTitle>
            <DialogDescription>
              Recent bulk imports for {entityLabel.toLowerCase()}. Undoing a batch removes the rows it created and restores any
              rows it updated to their prior values.
            </DialogDescription>
          </DialogHeader>

          {listBatches.isPending && !batches ? (
            <div className="flex items-center justify-center py-10 text-sm text-muted-foreground gap-2">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading import history...
            </div>
          ) : !batches || batches.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">No imports have been run for {entityLabel.toLowerCase()} yet.</p>
          ) : (
            <div className="max-h-[28rem] overflow-y-auto border rounded-md">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>File</TableHead>
                    <TableHead>Results</TableHead>
                    <TableHead>By</TableHead>
                    <TableHead>When</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {batches.map((b) => (
                    <TableRow key={b.id}>
                      <TableCell className="text-sm">{b.fileName ?? `Import #${b.id}`}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {b.created} created · {b.updated} updated
                        {b.failed > 0 ? ` · ${b.failed} failed` : ''}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{b.createdByName ?? '—'}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{new Date(b.createdAt).toLocaleString()}</TableCell>
                      <TableCell>
                        {b.status === 'rolled_back' ? (
                          <Badge variant="secondary">Rolled back</Badge>
                        ) : (
                          <Badge variant="outline">Committed</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {b.status !== 'rolled_back' && (b.created > 0 || b.updated > 0) && (
                          <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setConfirmBatch(b)}>
                            <Undo2 className="w-3.5 h-3.5" /> Undo
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!confirmBatch} onOpenChange={(v) => !v && setConfirmBatch(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Undo this import?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmBatch && (
                <>
                  This will permanently delete the {confirmBatch.created} row{confirmBatch.created === 1 ? '' : 's'} this import
                  created{confirmBatch.updated > 0 ? ` and restore the ${confirmBatch.updated} row${confirmBatch.updated === 1 ? '' : 's'} it updated to their previous values` : ''}.
                  This cannot be undone.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={rollback.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleRollback} disabled={rollback.isPending} className="gap-2">
              {rollback.isPending && <Loader2 className="w-4 h-4 animate-spin" />} Undo import
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
