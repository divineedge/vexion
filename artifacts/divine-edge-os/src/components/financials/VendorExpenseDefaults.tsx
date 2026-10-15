import { useState } from 'react';
import {
  useGetVendorExpenseDefaults, getGetVendorExpenseDefaultsQueryKey, useUpdateVendorExpenseDefaults,
  useListVendors, type VendorExpenseDefaultsInput, type VendorExpenseDefaultValues,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { useSettingsAutosave, useAutosaveFields } from '@/hooks/use-settings-autosave';
import { AutosaveIndicator } from '@/components/settings/AutosaveIndicator';

const INHERIT: VendorExpenseDefaultsInput = {
  salesTaxPct: null, shippingAmount: null, capitalizeSalesTax: null, capitalizeShipping: null,
};

function DefaultsEditor({ scope, initial, company }: {
  scope: string; initial: VendorExpenseDefaultsInput; company: VendorExpenseDefaultValues;
}) {
  const isCompany = scope === 'company';
  const qc = useQueryClient();
  const mutation = useUpdateVendorExpenseDefaults();
  const [tax, setTax] = useState(initial.salesTaxPct == null ? '' : String(initial.salesTaxPct));
  const [shipping, setShipping] = useState(initial.shippingAmount == null ? '' : String(initial.shippingAmount));
  const [includeTax, setIncludeTax] = useState<boolean | null>(initial.capitalizeSalesTax ?? null);
  const [includeShipping, setIncludeShipping] = useState<boolean | null>(initial.capitalizeShipping ?? null);
  const payload = {
    salesTaxPct: tax.trim() === '' ? null : Number(tax),
    shippingAmount: shipping.trim() === '' ? null : Number(shipping),
    capitalizeSalesTax: includeTax, capitalizeShipping: includeShipping,
  };
  const valid = (payload.salesTaxPct === null ? !isCompany : Number.isFinite(payload.salesTaxPct) && payload.salesTaxPct >= 0 && payload.salesTaxPct <= 100)
    && (payload.shippingAmount === null ? !isCompany : Number.isFinite(payload.shippingAmount) && payload.shippingAmount >= 0 && payload.shippingAmount <= 1_000_000_000);
  const autosave = useSettingsAutosave(patch => mutation.mutateAsync({ scope, data: patch as VendorExpenseDefaultsInput }), {
    onSaved: () => { void qc.invalidateQueries({ queryKey: getGetVendorExpenseDefaultsQueryKey() }); },
  });
  useAutosaveFields(payload, true, autosave.queue, valid);

  return <div className="space-y-4" data-testid={`vendor-defaults-editor-${scope}`}>
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <div className="space-y-1.5">
        <label htmlFor={`default-tax-${scope}`} className="text-sm font-medium">Sales tax (%)</label>
        <Input id={`default-tax-${scope}`} type="number" min={0} max={100} step="0.001" value={tax}
          placeholder={isCompany ? '0' : `Company: ${company.salesTaxPct}%`} onChange={e => setTax(e.target.value)} />
      </div>
      <div className="space-y-1.5">
        <label htmlFor={`default-shipping-${scope}`} className="text-sm font-medium">Delivery / shipping ($)</label>
        <Input id={`default-shipping-${scope}`} type="number" min={0} max={1_000_000_000} step="0.01" value={shipping}
          placeholder={isCompany ? '0.00' : `Company: $${company.shippingAmount.toFixed(2)}`} onChange={e => setShipping(e.target.value)} />
      </div>
    </div>
    {([
      ['tax', 'Include sales tax in supply costs', includeTax, setIncludeTax, company.capitalizeSalesTax],
      ['shipping', 'Include delivery in supply costs', includeShipping, setIncludeShipping, company.capitalizeShipping],
    ] as const).map(([key, label, value, setValue, fallback]) => <div className="space-y-1.5" key={key}>
      <label id={`default-${key}-label-${scope}`} className="text-sm font-medium">{label}</label>
      <Select value={value === null ? 'inherit' : String(value)} onValueChange={v => setValue(v === 'inherit' ? null : v === 'true')}>
        <SelectTrigger aria-labelledby={`default-${key}-label-${scope}`}><SelectValue /></SelectTrigger>
        <SelectContent>
          {!isCompany && <SelectItem value="inherit">Use company default ({fallback ? 'Yes' : 'No'})</SelectItem>}
          <SelectItem value="true">Yes</SelectItem><SelectItem value="false">No</SelectItem>
        </SelectContent>
      </Select>
    </div>)}
    {!valid ? <p className="text-sm text-destructive" role="alert">Not saved. Enter a tax rate from 0 to 100 and a nonnegative delivery amount{isCompany ? '; both amounts are required.' : ', or leave an override blank to inherit.'}</p>
      : <AutosaveIndicator status={autosave.status} hasUnsaved={autosave.hasUnsaved} onRetry={() => { void autosave.retry(); }} />}
    {!isCompany && <Button type="button" variant="outline" size="sm" onClick={() => {
      setTax(''); setShipping(''); setIncludeTax(null); setIncludeShipping(null);
    }}>Use company defaults for all fields</Button>}
  </div>;
}

export default function VendorExpenseDefaults() {
  const query = useGetVendorExpenseDefaults();
  const vendors = useListVendors();
  const [vendorId, setVendorId] = useState('');
  return <details className="rounded-xl border bg-card">
    <summary className="cursor-pointer p-4 font-semibold">Tax &amp; delivery defaults</summary>
    <div className="px-4 pb-5 space-y-5">
      <p className="text-sm text-muted-foreground">Automatically saved. Used for new expenses only; each expense can be adjusted. Supply-cost choices apply when receiving inventory. Past expenses and received stock keep their recorded costs.</p>
      {query.isPending && <p role="status">Loading defaults…</p>}
      {query.isError && <div role="alert"><p>Could not load expense defaults.</p><Button variant="outline" onClick={() => query.refetch()}>Retry</Button></div>}
      {query.data && <div className="grid gap-6 lg:grid-cols-2">
        <section className="space-y-4">
          <h2 className="font-semibold">Company defaults</h2>
          <p className="text-sm text-muted-foreground">Used by every vendor unless that vendor overrides a field.</p>
          <DefaultsEditor scope="company" initial={query.data.company} company={query.data.company} />
        </section>
        <section className="space-y-4">
          <h2 className="font-semibold">Vendor overrides</h2>
          <Select value={vendorId || '__none__'} onValueChange={v => setVendorId(v === '__none__' ? '' : v)}>
            <SelectTrigger aria-label="Vendor for tax and delivery overrides"><SelectValue placeholder="Choose a vendor" /></SelectTrigger>
            <SelectContent><SelectItem value="__none__">Choose a vendor</SelectItem>
              {(vendors.data ?? []).map(v => <SelectItem key={v.id} value={String(v.id)}>{v.name}</SelectItem>)}
            </SelectContent>
          </Select>
          {vendors.isError && <Button variant="outline" onClick={() => vendors.refetch()}>Could not load vendors. Retry</Button>}
          <p className="text-sm text-muted-foreground">Blank amounts inherit the company value. Enter 0 or choose No to override it explicitly.</p>
          {vendorId && <DefaultsEditor key={vendorId} scope={vendorId} company={query.data.company}
            initial={query.data.vendors.find(v => String(v.vendorId) === vendorId)?.settings ?? INHERIT} />}
        </section>
      </div>}
    </div>
  </details>;
}
