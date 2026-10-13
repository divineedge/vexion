import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { customFetch } from '@workspace/api-client-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Layers, AlertTriangle, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';

export type InvoiceGroupingMode = 'combined' | 'by_property';
export const customerInvoiceGroupingQueryKey = (id: number) => ['customer-invoice-grouping', id] as const;

const OPTIONS: Array<{ value: InvoiceGroupingMode; label: string; hint: string }> = [
  { value: 'combined', label: 'One invoice for all properties', hint: 'Work at several addresses is listed with its property on a single invoice with one total.' },
  { value: 'by_property', label: 'Separate invoice per property', hint: 'Each property gets its own invoice. Useful for landlords or customers who pay per address.' },
];

export function CustomerInvoiceGroupingCard({ customerId }: { customerId: number }) {
  const { canManageOffice } = useAuth();
  if (!canManageOffice || !(customerId > 0)) return null;
  return <Inner customerId={customerId} />;
}

function Inner({ customerId }: { customerId: number }) {
  const qc = useQueryClient();
  const key = customerInvoiceGroupingQueryKey(customerId);
  const query = useQuery<{ mode: InvoiceGroupingMode }>({
    queryKey: key,
    queryFn: () => customFetch<{ mode: InvoiceGroupingMode }>(`/api/billing/customer-invoice-grouping/${customerId}`),
  });
  const saved: InvoiceGroupingMode = query.data?.mode === 'by_property' ? 'by_property' : 'combined';
  const [draft, setDraft] = useState<InvoiceGroupingMode>('combined');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (query.data) setDraft(saved); }, [query.data, saved]);

  const save = useMutation({
    mutationFn: (mode: InvoiceGroupingMode) =>
      customFetch<{ mode: InvoiceGroupingMode }>(`/api/billing/customer-invoice-grouping/${customerId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode }),
      }),
    onSuccess: r => {
      setError(null);
      qc.setQueryData(key, { mode: r?.mode === 'by_property' ? 'by_property' : 'combined' });
      toast.success('Invoice grouping saved');
    },
    onError: (e: unknown) => {
      const msg = e instanceof Error && e.message ? e.message : 'Failed to save invoice grouping';
      setError(msg);
      toast.error(msg);
    },
  });
  const dirty = !!query.data && draft !== saved;

  return (
    <Card data-testid="card-customer-invoice-grouping">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2"><Layers className="w-4 h-4 text-primary" />Invoice grouping</CardTitle>
        <CardDescription>Default for new invoices for this customer. Staff can still change it on a single invoice.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {query.isLoading ? (
          <div className="space-y-2"><Skeleton className="h-14 w-full" /><Skeleton className="h-14 w-full" /></div>
        ) : query.isError ? (
          <div className="flex items-center justify-between gap-3 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm">
            <span className="flex items-center gap-2 text-destructive"><AlertTriangle className="w-4 h-4" />Could not load invoice grouping.</span>
            <Button size="sm" variant="outline" className="gap-1.5" onClick={() => query.refetch()} data-testid="button-retry-invoice-grouping"><RefreshCw className="w-3.5 h-3.5" />Retry</Button>
          </div>
        ) : (
          <>
            <RadioGroup value={draft} onValueChange={v => setDraft(v as InvoiceGroupingMode)} disabled={save.isPending} aria-label="Invoice grouping" className="gap-2">
              {OPTIONS.map(o => (
                <label key={o.value} htmlFor={`grouping-${o.value}`} className={`flex cursor-pointer items-start gap-3 rounded-md border p-3 transition-colors ${draft === o.value ? 'border-primary bg-primary/5' : 'hover:bg-muted/50'}`}>
                  <RadioGroupItem id={`grouping-${o.value}`} value={o.value} className="mt-0.5" data-testid={`radio-invoice-grouping-${o.value}`} />
                  <span>
                    <span className="block text-sm font-medium">{o.label}{saved === o.value && <span className="ml-2 text-xs font-normal text-muted-foreground">(current)</span>}</span>
                    <span className="block text-xs text-muted-foreground">{o.hint}</span>
                  </span>
                </label>
              ))}
            </RadioGroup>
            {error && <p className="text-sm text-destructive" role="alert" data-testid="text-invoice-grouping-error">{error}</p>}
            <div className="flex items-center justify-end gap-3">
              <span className="text-xs" aria-live="polite" data-testid="status-invoice-grouping">
                {save.isPending ? 'Saving...' : dirty ? <span className="text-amber-600">Unsaved change</span> : save.isSuccess ? <span className="text-emerald-600">Saved</span> : null}
              </span>
              <Button size="sm" onClick={() => save.mutate(draft)} disabled={!dirty || save.isPending} data-testid="button-save-invoice-grouping">
                {save.isPending ? 'Saving...' : 'Save grouping'}
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

export default CustomerInvoiceGroupingCard;
