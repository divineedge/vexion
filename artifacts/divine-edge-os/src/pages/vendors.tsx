import VendorExpenseLedger from '@/components/financials/VendorExpenseLedger';
import { useAuth } from '@/contexts/AuthContext';
import VendorExpenseDefaults from '@/components/financials/VendorExpenseDefaults';

export default function VendorsPage() {
  const { user } = useAuth();
  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Vendors</h1>
          <p className="text-muted-foreground mt-1">Suppliers you buy from and the expenses you pay them. Kept separate from customer invoices.</p>
        </div>
      </div>
      {user?.role !== 'technician' && <VendorExpenseDefaults />}
      <VendorExpenseLedger canEdit={user?.role !== 'technician'} />
    </div>
  );
}
