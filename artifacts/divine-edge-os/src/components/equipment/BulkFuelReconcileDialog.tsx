import { useEffect, useRef, useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import {
  getListBulkFuelTanksQueryKey,
  getListBulkFuelTransactionsQueryKey,
  previewBulkFuelAdjustment,
  useCreateBulkFuelAdjustment,
  usePreviewBulkFuelAdjustment,
} from '@workspace/api-client-react';
import type { BulkFuelTank } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Calculator, Scale } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { fuelLossAlertKey } from './BulkFuelLossAlerts';

const formSchema = z.object({
  measuredGallons: z.string()
    .min(1, 'Measured gallons are required')
    .refine(value => Number.isFinite(Number(value)) && Number(value) >= 0, 'Enter a non-negative gallon amount'),
  reason: z.string().trim().min(1, 'A reconciliation reason is required'),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'A valid date is required'),
});

type FormValues = z.infer<typeof formSchema>;
type AdjustmentPreview = Awaited<ReturnType<typeof previewBulkFuelAdjustment>>;

interface BulkFuelReconcileDialogProps {
  tank: BulkFuelTank;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function formatGallons(value: number) {
  return `${value.toLocaleString(undefined, { minimumFractionDigits: 3, maximumFractionDigits: 3 })} gal`;
}

function formatMoney(value: number) {
  return value.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatSignedMoney(value: number) {
  if (value === 0) return formatMoney(0);
  return `${value > 0 ? '+' : '−'}${formatMoney(Math.abs(value))}`;
}

function statusOf(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null || !('status' in error)) return undefined;
  return typeof error.status === 'number' ? error.status : undefined;
}

function messageOf(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  return fallback;
}

export function BulkFuelReconcileDialog({
  tank,
  open,
  onOpenChange,
}: BulkFuelReconcileDialogProps) {
  const queryClient = useQueryClient();
  const previewMutation = usePreviewBulkFuelAdjustment();
  const commitMutation = useCreateBulkFuelAdjustment();
  const [preview, setPreview] = useState<AdjustmentPreview | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState('');
  const previewRequest = useRef(0);
  const today = new Date().toISOString().slice(0, 10);
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      measuredGallons: '',
      reason: '',
      date: today,
    },
  });
  const isPending = previewMutation.isPending || commitMutation.isPending;

  useEffect(() => {
    if (!open) return;
    previewRequest.current += 1;
    setPreview(null);
    setIdempotencyKey('');
    form.reset({ measuredGallons: '', reason: '', date: today });
  }, [form, open, tank.id, today]);

  const invalidatePreview = () => {
    previewRequest.current += 1;
    setPreview(null);
    setIdempotencyKey('');
  };

  const requestPreview = form.handleSubmit(async values => {
    const requestId = previewRequest.current + 1;
    previewRequest.current = requestId;
    setPreview(null);
    try {
      const result = await previewMutation.mutateAsync({
        id: tank.id,
        data: {
          measuredGallons: Number(values.measuredGallons),
          reason: values.reason.trim(),
          date: values.date,
        },
      });
      if (previewRequest.current !== requestId) return;
      setPreview(result);
      setIdempotencyKey(crypto.randomUUID());
    } catch (error: unknown) {
      if (previewRequest.current !== requestId) return;
      toast.error(messageOf(error, 'Unable to preview the reconciliation.'));
    }
  });

  const commitAdjustment = async () => {
    if (!preview || !idempotencyKey) return;
    try {
      const values = form.getValues();
      const result = await commitMutation.mutateAsync({
        id: tank.id,
        data: {
          measuredGallons: Number(values.measuredGallons),
          reason: values.reason.trim(),
          date: values.date,
          idempotencyKey,
          expectedMovementId: preview.expectedMovementId,
        },
      });
      void queryClient.invalidateQueries({ queryKey: fuelLossAlertKey });
      toast[result.duplicate ? 'info' : 'success'](
        result.duplicate
          ? 'This reconciliation was already recorded.'
          : 'Tank inventory reconciled.',
      );
      await Promise.all([
        queryClient.invalidateQueries({
          predicate: query => query.queryKey[0] === getListBulkFuelTanksQueryKey()[0],
        }),
        queryClient.invalidateQueries({
          queryKey: getListBulkFuelTransactionsQueryKey(tank.id),
        }),
      ]);
      onOpenChange(false);
    } catch (error: unknown) {
      if (statusOf(error) === 409) {
        previewRequest.current += 1;
        setPreview(null);
        setIdempotencyKey('');
        toast.error('Tank inventory changed or this request no longer matches. Review a new preview before confirming.');
        return;
      }
      // Keep the key for safe retry when the server outcome is unknown.
      toast.error(messageOf(error, 'The result is unknown. Retry confirmation to safely check this same request.'));
    }
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (isPending) return;
    onOpenChange(nextOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Scale className="h-5 w-5 text-primary" />
            Reconcile Tank: {tank.name}
          </DialogTitle>
          <DialogDescription>
            Correct book inventory to a measured tank reading. This creates an inventory adjustment, not equipment usage or an expense.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={requestPreview} className="space-y-4 py-2">
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="measuredGallons"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Measured Tank Gallons</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        data-testid="input-reconcile-measured-gallons"
                        type="number"
                        min="0"
                        step="0.001"
                        inputMode="decimal"
                        disabled={isPending}
                        onChange={event => {
                          field.onChange(event);
                          invalidatePreview();
                        }}
                      />
                    </FormControl>
                    <FormDescription>Current physical gauge or dip reading.</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="date"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Reading Date</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        data-testid="input-reconcile-date"
                        type="date"
                        disabled={isPending}
                        onChange={event => {
                          field.onChange(event);
                          invalidatePreview();
                        }}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <FormField
              control={form.control}
              name="reason"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Reason</FormLabel>
                  <FormControl>
                    <Textarea
                      {...field}
                      data-testid="input-reconcile-reason"
                      placeholder="Explain the count variance, gauge correction, or other cause"
                      rows={3}
                      disabled={isPending}
                      onChange={event => {
                        field.onChange(event);
                        invalidatePreview();
                      }}
                    />
                  </FormControl>
                  <FormDescription>This reason appears in the inventory audit history.</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            {preview ? (
              <div
                className="space-y-3 rounded-lg border bg-muted/30 p-4"
                data-testid="panel-reconcile-preview"
              >
                <div className="flex items-center gap-2 font-medium">
                  <Calculator className="h-4 w-4 text-primary" />
                  Server-calculated preview
                </div>
                <div className="grid grid-cols-[1fr_auto_auto] gap-x-4 gap-y-2 text-sm">
                  <span className="text-muted-foreground">Inventory</span>
                  <span className="text-xs font-medium uppercase text-muted-foreground">Before</span>
                  <span className="text-xs font-medium uppercase text-muted-foreground">After</span>
                  <span>Gallons</span>
                  <span className="text-right font-mono" data-testid="value-reconcile-before-gallons">{formatGallons(preview.beforeGallons)}</span>
                  <span className="text-right font-mono" data-testid="value-reconcile-after-gallons">{formatGallons(preview.afterGallons)}</span>
                  <span>Valuation</span>
                  <span className="text-right font-mono" data-testid="value-reconcile-before-value">{formatMoney(preview.beforeValue)}</span>
                  <span className="text-right font-mono" data-testid="value-reconcile-after-value">{formatMoney(preview.afterValue)}</span>
                </div>
                <div className="flex flex-wrap justify-between gap-2 border-t pt-3 text-sm font-medium">
                  <span>Change: {preview.gallonsChange > 0 ? '+' : ''}{formatGallons(preview.gallonsChange)}</span>
                  <span
                    className={preview.valueChange < 0 ? 'text-destructive' : 'text-primary'}
                    data-testid="value-reconcile-signed-valuation-change"
                  >
                    Valuation {formatSignedMoney(preview.valueChange)}
                  </span>
                </div>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  The adjustment is valued at the tank’s current weighted-average cost per gallon, preserving its blended unit cost. It does not create equipment consumption or a separate operating expense.
                </p>
                <div className="flex gap-2 rounded-md bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-300">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  Confirm only after verifying the physical reading. If tank activity occurs first, a new preview is required.
                </div>
              </div>
            ) : (
              <div className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
                Preview is required before the adjustment can be confirmed.
              </div>
            )}

            <DialogFooter>
              <Button
                data-testid="button-cancel-reconciliation"
                type="button"
                variant="outline"
                disabled={isPending}
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              {!preview ? (
                <Button
                  data-testid="button-preview-reconciliation"
                  type="submit"
                  disabled={isPending}
                >
                  {previewMutation.isPending ? 'Calculating…' : 'Preview Adjustment'}
                </Button>
              ) : (
                <Button
                  data-testid="button-confirm-reconciliation"
                  type="button"
                  disabled={isPending}
                  onClick={commitAdjustment}
                >
                  {commitMutation.isPending ? 'Confirming…' : 'Confirm Reconciliation'}
                </Button>
              )}
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}