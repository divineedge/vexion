import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { customFetch } from '@workspace/api-client-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { ShieldCheck, AlertTriangle, Info, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { CustomerInvoiceGroupingCard } from './CustomerInvoiceGroupingCard';

export type PolicyScope = 'company' | 'service' | 'customer';
export type DepositType = 'none' | 'fixed' | 'percent' | 'full';
export interface PaymentPolicy {
  depositType: DepositType | null;
  depositValue: number | null;
  requirePrepay: boolean | null;
  requireCard: boolean | null;
}

const EMPTY: PaymentPolicy = { depositType: null, depositValue: null, requirePrepay: null, requireCard: null };
export const paymentPolicyQueryKey = (scope: PolicyScope, id: number) => ['payment-policy', scope, id] as const;

const INHERIT = 'inherit';
const boolToVal = (b: boolean | null) => (b === null ? INHERIT : b ? 'yes' : 'no');
const valToBool = (v: string): boolean | null => (v === INHERIT ? null : v === 'yes');

interface Props {
  scope: PolicyScope;
  id: number;
  canEdit: boolean;
  title?: string;
}

export function PaymentPolicyCard(props: Props) {
  const { canManageOffice } = useAuth();
  if (!canManageOffice || !props.canEdit) return null;
  return (
    <>
      <PaymentPolicyCardInner {...props} />
      {props.scope === 'customer' && props.id > 0 && <CustomerInvoiceGroupingCard customerId={props.id} />}
    </>
  );
}

function PaymentPolicyCardInner({ scope, id, canEdit, title }: Props) {
  const qc = useQueryClient();
  const isCompany = scope === 'company';
  const inheritLabel = scope === 'customer' ? 'Inherit (service, then company)' : 'Inherit company default';

  const query = useQuery<PaymentPolicy>({
    queryKey: paymentPolicyQueryKey(scope, id),
    queryFn: async () => {
      const r = await customFetch<{ policy?: PaymentPolicy } & Partial<PaymentPolicy>>(`/api/billing/payment-policy/${scope}/${id}`);
      return { ...EMPTY, ...(r && 'policy' in r && r.policy ? r.policy : r) } as PaymentPolicy;
    },
    enabled: Number.isFinite(id) && (isCompany ? id === 0 : id > 0),
  });

  const [draft, setDraft] = useState<PaymentPolicy>(EMPTY);
  const [valueStr, setValueStr] = useState('');
  useEffect(() => {
    if (query.data) {
      setDraft(query.data);
      setValueStr(query.data.depositValue != null ? String(query.data.depositValue) : '');
    }
  }, [query.data]);

  const save = useMutation({
    mutationFn: (body: PaymentPolicy) =>
      customFetch<{ policy: PaymentPolicy }>(`/api/billing/payment-policy/${scope}/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      }),
    onSuccess: (r) => {
      qc.setQueryData(paymentPolicyQueryKey(scope, id), { ...EMPTY, ...r.policy });
      toast.success('Payment policy saved');
    },
    onError: (e: unknown) => toast.error(e instanceof Error && e.message ? e.message : 'Failed to save payment policy'),
  });

  const needsValue = draft.depositType === 'fixed' || draft.depositType === 'percent';
  const handleSave = () => {
    let depositValue: number | null = null;
    if (needsValue) {
      const n = Number(valueStr);
      if (!valueStr.trim() || !Number.isFinite(n) || n <= 0) { toast.error('Enter a deposit amount greater than zero'); return; }
      if (draft.depositType === 'percent' && n > 100) { toast.error('Percent deposit cannot exceed 100'); return; }
      depositValue = n;
    }
    const body: PaymentPolicy = { ...draft, depositValue };
    if (isCompany) {
      body.depositType = body.depositType ?? 'none';
      body.requirePrepay = body.requirePrepay ?? false;
      body.requireCard = body.requireCard ?? false;
    }
    save.mutate(body);
  };

  const disabled = !canEdit || save.isPending;
  const companyVal = (v: string) => (isCompany && v === INHERIT ? 'no' : v);

  return (
    <Card data-testid={`card-payment-policy-${scope}`}>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2"><ShieldCheck className="w-4 h-4 text-primary" />{title ?? 'Payment requirements'}</CardTitle>
        <CardDescription>
          {isCompany
            ? 'Company defaults. Services and customers can override deposits; a company prepayment requirement applies to every job.'
            : scope === 'service'
              ? 'Overrides for this service. Customer settings take priority over service settings for deposit amount.'
              : 'Overrides for this customer. These take priority over service and company deposit settings.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {query.isLoading ? (
          <div className="space-y-3"><Skeleton className="h-9 w-full" /><Skeleton className="h-9 w-full" /><Skeleton className="h-9 w-full" /></div>
        ) : query.isError ? (
          <div className="flex items-center justify-between gap-3 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm">
            <span className="flex items-center gap-2 text-destructive"><AlertTriangle className="w-4 h-4" />Could not load payment policy.</span>
            <Button size="sm" variant="outline" className="gap-1.5" onClick={() => query.refetch()} data-testid="button-retry-payment-policy"><RefreshCw className="w-3.5 h-3.5" />Retry</Button>
          </div>
        ) : (
          <>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Deposit requirement</label>
              <div className="flex flex-wrap gap-2">
                <Select
                  value={draft.depositType ?? (isCompany ? 'none' : INHERIT)}
                  onValueChange={v => setDraft(d => ({ ...d, depositType: v === INHERIT ? null : (v as DepositType) }))}
                  disabled={disabled}
                >
                  <SelectTrigger className="w-60" data-testid={`select-deposit-type-${scope}`}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {!isCompany && <SelectItem value={INHERIT}>{inheritLabel}</SelectItem>}
                    <SelectItem value="none">{isCompany ? 'No deposit' : 'No deposit (waived)'}</SelectItem>
                    <SelectItem value="fixed">Fixed amount</SelectItem>
                    <SelectItem value="percent">Percent of estimate</SelectItem>
                    <SelectItem value="full">Full amount</SelectItem>
                  </SelectContent>
                </Select>
                {needsValue && (
                  <div className="flex items-center gap-1">
                    {draft.depositType === 'fixed' && <span className="text-sm text-muted-foreground">$</span>}
                    <Input className="w-28" inputMode="decimal" value={valueStr} onChange={e => setValueStr(e.target.value)} disabled={disabled} data-testid={`input-deposit-value-${scope}`} />
                    {draft.depositType === 'percent' && <span className="text-sm text-muted-foreground">%</span>}
                  </div>
                )}
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Require prepayment before scheduling</label>
                <Select value={companyVal(boolToVal(draft.requirePrepay))} onValueChange={v => setDraft(d => ({ ...d, requirePrepay: valToBool(v) }))} disabled={disabled}>
                  <SelectTrigger data-testid={`select-require-prepay-${scope}`}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {!isCompany && <SelectItem value={INHERIT}>{inheritLabel}</SelectItem>}
                    <SelectItem value="yes">Required</SelectItem>
                    <SelectItem value="no">Not required</SelectItem>
                  </SelectContent>
                </Select>
                {!isCompany && <p className="text-xs text-muted-foreground">If the company requires prepayment, it cannot be waived here.</p>}
                {scope === 'customer' && <p className="text-xs text-muted-foreground">Required means full payment for every future scheduled service—not just the current estimate or invoice. Useful for new customers or past payment problems.</p>}
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Require saved card</label>
                <Select value={companyVal(boolToVal(draft.requireCard))} onValueChange={v => setDraft(d => ({ ...d, requireCard: valToBool(v) }))} disabled={disabled}>
                  <SelectTrigger data-testid={`select-require-card-${scope}`}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {!isCompany && <SelectItem value={INHERIT}>{inheritLabel}</SelectItem>}
                    <SelectItem value="yes">Required</SelectItem>
                    <SelectItem value="no">Not required</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">A saved card does not count as payment.</p>
              </div>
            </div>

            <div className="flex gap-2 rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground" data-testid="text-payment-policy-disclosure">
              <Info className="w-4 h-4 shrink-0 mt-0.5" />
              <span>Marking a requirement does not charge anyone. Jobs that need a deposit or prepayment stay blocked from scheduling until an actual payment is recorded.</span>
            </div>

            {canEdit && (
              <div className="flex justify-end">
                <Button size="sm" onClick={handleSave} disabled={save.isPending} data-testid={`button-save-payment-policy-${scope}`}>
                  {save.isPending ? 'Saving...' : 'Save payment policy'}
                </Button>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

export default PaymentPolicyCard;
