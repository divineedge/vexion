import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

export interface DuplicateCustomerDetails {
  id?: number;
  name: string;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  archived?: boolean;
}

function Detail({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-sm">{value?.trim() ? value : '—'}</div>
    </div>
  );
}

function RecordCard({ title, customer }: { title: string; customer: DuplicateCustomerDetails }) {
  return (
    <div className="rounded-md border p-3 space-y-2">
      <div className="text-sm font-semibold">{title}</div>
      <Detail label="Name" value={customer.name} />
      <Detail label="Email" value={customer.email} />
      <Detail label="Phone" value={customer.phone} />
      <Detail label="Address" value={customer.address} />
      {customer.archived ? <div className="text-xs text-muted-foreground">This record is archived.</div> : null}
    </div>
  );
}

export function CustomerDuplicateDialog({
  open,
  existing,
  incoming,
  busy,
  position,
  dismissLabel = 'Decide later',
  onMerge,
  onForceCreate,
  onDismiss,
}: {
  open: boolean;
  existing: DuplicateCustomerDetails | null;
  incoming: DuplicateCustomerDetails | null;
  busy?: boolean;
  position?: string;
  dismissLabel?: string;
  onMerge: () => void;
  onForceCreate: () => void;
  onDismiss: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next && !busy) onDismiss(); }}>
      <DialogContent className="max-w-2xl" data-testid="dialog-duplicate-customer">
        <DialogHeader>
          <DialogTitle>Duplicate customer detected</DialogTitle>
          <DialogDescription>
            {position ? `${position}. ` : ''}
            This email, phone, or name and address already belongs to a customer. Compare the records, then merge them or keep a separate customer.
          </DialogDescription>
        </DialogHeader>
        {existing && incoming ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <RecordCard title="Existing customer" customer={existing} />
            <RecordCard title="New entry" customer={incoming} />
          </div>
        ) : null}
        <DialogFooter className="flex-wrap gap-2">
          <Button variant="ghost" disabled={busy} onClick={onDismiss}>{dismissLabel}</Button>
          <Button variant="outline" disabled={busy} onClick={onForceCreate} data-testid="button-force-create-customer">
            {busy ? 'Working…' : 'Keep Separate / Force Create'}
          </Button>
          <Button disabled={busy} onClick={onMerge} data-testid="button-merge-customer-records">
            {busy ? 'Working…' : 'Merge Records'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
