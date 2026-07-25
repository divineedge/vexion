import React, { useEffect, useState } from 'react';
import {
  useListImportBatches,
  useRollbackImportBatch,
  type ImportExportEntity,
  type ImportBatchSummary,
  type ImportBatchRollbackResult,
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
import { Loader2, Undo2, History, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';

interface ImportHistoryDialogProps {
  entity: ImportExportEntity;
  entityLabel: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after a successful rollback so the caller can refresh its list. */
  onRolledBack?: () => void;
}

interface RollbackResultDialogProps {
  result: ImportBatchRollbackResult;
  onClose: () => void;
}

function RollbackResultDialog({ result, onClose }: RollbackResultDialogProps) {
  const hasBlockedRows = result.blockedRows.length > 0;
  const hasOtherErrors = result.errors.length > 0;

  return (
    <AlertDialog open onOpenChange={(v) => !v && onClose()}>
      <AlertDialogContent className="sm:max-w-lg">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            {hasBlockedRows || hasOtherErrors ? (
              <>
                <AlertTriangle className="w-4 h-4 text-amber-500" />
                Import partially undone
              </>
            ) : (
              'Import undone'
            )}
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-3 text-sm">
              {/* Summary line */}
              <p>
                {result.deletedCount > 0 && (
                  <span>{result.deletedCount} row{result.deletedCount === 1 ? '' : 's'} removed{result.revertedCount > 0 ? ', ' : '.'}</span>
                )}
                {result.revertedCount > 0 && (
                  <span>{result.revertedCount} row{result.revertedCount === 1 ? '' : 's'} restored to prior values.</span>
                )}
                {result.deletedCount === 0 && result.revertedCount === 0 && (
                  <span>No rows could be undone.</span>
                )}
              </p>

              {/* Blocked rows — FK dependents */}
              {hasBlockedRows && (
                <div className="rounded-md border border-amber-200 bg-amber-50 p-3 space-y-2">
                  <p className="font-medium text-amber-800">
                    {result.blockedRows.length} row{result.blockedRows.length === 1 ? '' : 's'} couldn't be removed because other records depend on them:
                  </p>
                  <ul className="space-y-1 text-amber-700 list-disc list-inside">
                    {result.blockedRows.map((b) => (
                      <li key={`${b.row}-${b.recordId}`}>
                        <span className="font-medium">Row {b.row}</span> (record #{b.recordId}): {b.reason}
                      </li>
                    ))}
                  </ul>
                  <p className="text-amber-700 text-xs pt-1">
                    To fully undo this import, delete the dependent records first, then undo it again.
                  </p>
                </div>
              )}

              {/* Other unexpected errors */}
              {hasOtherErrors && (
                <div className="rounded-md border border-red-200 bg-red-50 p-3 space-y-2">
                  <p className="font-medium text-red-800">
                    {result.errors.length} row{result.errors.length === 1 ? '' : 's'} failed unexpectedly:
                  </p>
                  <ul className="space-y-1 text-red-700 list-disc list-inside text-xs">
                    {result.errors.slice(0, 10).map((e, i) => (
                      <li key={i}>{e}</li>
                    ))}
                    {result.errors.length > 10 && (
                      <li>…and {result.errors.length - 10} more</li>
                    )}
                  </ul>
                </div>
              )}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogAction title="Close this dialog" onClick={onClose}>OK</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function ImportHistoryDialog({ entity, entityLabel, open, onOpenChange, onRolledBack }: ImportHistoryDialogProps) {
  const [batches, setBatches] = useState<ImportBatchSummary[] | null>(null);
  const [confirmBatch, setConfirmBatch] = useState<ImportBatchSummary | null>(null);
  const [rollbackResult, setRollbackResult] = useState<ImportBatchRollbackResult | null>(null);
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
        setConfirmBatch(null);
        // Update batch status in the list regardless of partial failure
        const newStatus = (data.blockedRows.length > 0 || data.errors.length > 0) ? 'rollback_partial' : 'rolled_back';
        setBatches((prev) =>
          prev?.map((b) => (b.id === confirmBatch.id ? { ...b, status: newStatus, rolledBackAt: new Date().toISOString() } : b)) ?? null,
        );
        onRolledBack?.();

        const hasIssues = data.failedCount > 0 || data.blockedRows.length > 0;
        if (hasIssues) {
          // Show the detailed result dialog for partial failures / blocked rows
          setRollbackResult(data);
        } else {
          toast.success(
            `Import undone: ${data.deletedCount} row${data.deletedCount === 1 ? '' : 's'} removed` +
              (data.revertedCount > 0 ? `, ${data.revertedCount} restored to prior values.` : '.'),
          );
        }
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
                        ) : b.status === 'rollback_partial' ? (
                          <Badge variant="outline" className="border-amber-400 text-amber-700 bg-amber-50">Partially undone</Badge>
                        ) : (
                          <Badge variant="outline">Committed</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {b.status !== 'rolled_back' && (b.created > 0 || b.updated > 0) && (
                          <Button size="sm" variant="outline" title={b.status === 'rollback_partial' ? 'Retry undoing this partially-rolled-back import' : 'Undo this import — removes rows it created and restores rows it updated'} className="gap-1.5" onClick={() => setConfirmBatch(b)}>
                            <Undo2 className="w-3.5 h-3.5" />
                            {b.status === 'rollback_partial' ? 'Retry undo' : 'Undo'}
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
              {confirmBatch && confirmBatch.status === 'rollback_partial' ? (
                <>
                  Some rows from this import couldn't be removed last time because other records depend on them.
                  This will retry removing those rows. If the blocking records have been deleted, they'll be removed now.
                </>
              ) : (
                <>
                  This will permanently delete the {confirmBatch?.created} row{confirmBatch?.created === 1 ? '' : 's'} this import
                  created{confirmBatch && confirmBatch.updated > 0 ? ` and restore the ${confirmBatch.updated} row${confirmBatch.updated === 1 ? '' : 's'} it updated to their previous values` : ''}.
                  {' '}If any rows have dependent records (e.g. jobs booked against an imported customer), those rows will be skipped
                  and you'll see exactly what's blocking them.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel title="Keep this import as-is" disabled={rollback.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction title="Confirm and undo this import" onClick={handleRollback} disabled={rollback.isPending} className="gap-2">
              {rollback.isPending && <Loader2 className="w-4 h-4 animate-spin" />} Undo import
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {rollbackResult && (
        <RollbackResultDialog
          result={rollbackResult}
          onClose={() => setRollbackResult(null)}
        />
      )}
    </>
  );
}
