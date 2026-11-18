import { useEffect, useMemo, useRef, useState } from 'react';
import { createInventoryItem, createVendor, customFetch, type InventoryItem } from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { InventoryItemCombobox } from '@/components/inventory/InventoryItemCombobox';
import { InvoiceFileView } from '@/components/vendors/InvoiceFileView';
import { groupPdfTextItems, MAX_VENDOR_INVOICE_BYTES } from '@/lib/vendorInvoiceFile';
import { toast } from 'sonner';

type Line = {
  id: string;
  description: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  sku: string;
  unit: string;
  destinationType: string;
  destinationId: string | null;
  fillDate: string | null;
  bbox?: { x?: number; y?: number; width?: number; height?: number; sku?: string; unit?: string };
};
type Choice = { id: number; name: string; sku?: string | null; quantity?: number; unit?: string | null; unitPrice?: number; isDraft?: boolean; title?: string; status?: string; currentGallons?: number; maxCapacity?: number };
type Invoice = {
  id: string;
  vendorId: number | null;
  draftVendorName: string | null;
  invoiceNumber: string;
  invoiceDate: string;
  totalAmount: number;
  taxAmount: number;
  shippingAmount: number;
  paymentStatus: string;
  vendorConfirmed: boolean;
  fileUrl: string;
  fileName: string;
  fileType: string;
  vendorWarning: string | null;
  enteredVendorName?: string | null;
  lines: Line[];
  vendors: Choice[];
  tanks: Choice[];
  jobs: Choice[];
  items: Choice[];
};
type Reservation = { id: string; jobId: number; jobTitle: string; name: string; quantity: number; unitCost: number };

const destinations = [
  ['overhead', 'Overhead'],
  ['inventory', 'Inventory'],
  ['bulk_fuel', 'Bulk fuel'],
  ['equipment', 'Equipment'],
  ['job_direct_expense', 'Job material'],
] as const;

export default function VendorDocumentsPage() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [ocrText, setOcrText] = useState('');
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [vendorId, setVendorId] = useState<number | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [vendorName, setVendorName] = useState('');
  const [addingLine, setAddingLine] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [consumed, setConsumed] = useState<Record<string, string>>({});

  const loadReservations = () => customFetch<{ reservations: Reservation[] }>('/api/inventory-reservations').then(data => setReservations(data.reservations ?? [])).catch(() => setReservations([]));
  useEffect(() => { void loadReservations(); }, []);

  const upload = async (file: File) => {
    setBusy(true);
    setError('');
    try {
      if (!file.size) throw new Error('That file is empty.');
      if (file.size > MAX_VENDOR_INVOICE_BYTES) throw new Error('That file is too large to review here. Use a PDF or image under 12 MB.');
      const typedVendor = vendorName.trim();
      const body = new FormData();
      body.append('file', file);
      if (typedVendor) body.append('vendorName', typedVendor);
      const pasted = ocrText.trim();
      const extracted = pasted || (isPdf(file) ? await readPdfText(file).catch(() => '') : '');
      if (extracted) body.append('ocrText', extracted.slice(0, 200_000));
      const created = await customFetch<Invoice>('/api/vendor-documents', { method: 'POST', body });
      const preview = URL.createObjectURL(file);
      setInvoice(current => {
        if (current?.fileUrl.startsWith('blob:')) URL.revokeObjectURL(current.fileUrl);
        return { ...created, fileUrl: preview, lines: (created.lines ?? []).map(normalizeLine) };
      });
      setSourceFile(file);
      setVendorId(created.vendorId);
      setVendorName(typedVendor || created.enteredVendorName?.trim() || created.draftVendorName?.trim() || '');
      setConfirmed(false);
      await loadReservations();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Upload failed';
      setError(message);
      toast.error(message);
    } finally {
      setBusy(false);
    }
  };

  const updateLine = (id: string, patch: Partial<Line>) => {
    setInvoice(current => current ? { ...current, lines: current.lines.map(line => line.id === id ? { ...line, ...patch } : line) } : current);
  };

  const post = async () => {
    if (!invoice || vendorId == null) return;
    setBusy(true);
    setError('');
    try {
      const saved = await customFetch<Invoice>(`/api/vendor-documents/${invoice.id}/commit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vendorConfirmed: confirmed,
          vendorId,
          invoiceNumber: invoice.invoiceNumber,
          invoiceDate: String(invoice.invoiceDate).slice(0, 10),
          totalAmount: Number(invoice.totalAmount),
          taxAmount: Number(invoice.taxAmount),
          shippingAmount: Number(invoice.shippingAmount),
          paymentStatus: invoice.paymentStatus,
          vendorName,
          lines: invoice.lines.map(line => ({
            id: line.id,
            description: line.description,
            quantity: Number(line.quantity),
            unitPrice: Number(line.unitPrice),
            totalPrice: Number(line.totalPrice),
            sku: line.sku,
            unit: line.unit,
            destinationType: line.destinationType,
            destinationId: line.destinationId,
            fillDate: line.fillDate || String(invoice.invoiceDate).slice(0, 10),
          })),
        }),
      });
      setInvoice(current => ({ ...saved, fileUrl: current?.fileUrl.startsWith('blob:') ? current.fileUrl : saved.fileUrl }));
      toast.success('Invoice posted');
      await loadReservations();
    } catch (cause) {
      const message = cause && typeof cause === 'object' && 'data' in cause && typeof (cause as { data?: { error?: string } }).data?.error === 'string'
        ? (cause as { data: { error: string } }).data.error
        : cause instanceof Error ? cause.message : 'Could not post the invoice';
      setError(message);
      toast.error(message);
    } finally {
      setBusy(false);
    }
  };

  const addVendor = async () => {
    const name = vendorName.trim();
    if (!name) {
      toast.error('Enter a vendor name.');
      return;
    }
    setBusy(true);
    try {
      const created = await createVendor({ name });
      setInvoice(current => current ? {
        ...current,
        vendors: [...current.vendors.filter(vendor => vendor.id !== created.id), { id: created.id, name: created.name, isDraft: false }],
      } : current);
      setVendorId(created.id);
      setVendorName(created.name);
      toast.success(`Added vendor ${created.name}`);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Could not add that vendor';
      setError(message);
      toast.error(message);
    } finally {
      setBusy(false);
    }
  };

  const addInventoryPart = async (line: Line) => {
    const name = line.description.trim();
    if (!name) {
      toast.error('Enter a name for the new inventory part.');
      return;
    }
    setAddingLine(line.id);
    try {
      const created = await createInventoryItem({
        name,
        sku: line.sku.trim() || `PART-${name.replace(/[^A-Za-z0-9]+/g, '').slice(0, 12) || 'NEW'}-${line.id.slice(0, 4)}`,
        costPrice: Number(line.unitPrice) || 0,
        quantity: 0,
        unit: line.unit.trim() || 'each',
      });
      setInvoice(current => {
        if (!current) return current;
        const choice: Choice = { id: created.id, name: created.name, sku: created.sku, quantity: created.quantity, unit: created.unit, unitPrice: Number(created.costPrice ?? created.unitPrice ?? 0) };
        return {
          ...current,
          items: [...current.items.filter(item => item.id !== created.id), choice],
          lines: current.lines.map(row => row.id === line.id ? { ...row, destinationType: 'inventory', destinationId: String(created.id) } : row),
        };
      });
      toast.success(`Added ${created.name} as a new inventory part`);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Could not add that inventory part';
      setError(message);
      toast.error(message);
    } finally {
      setAddingLine(null);
    }
  };

  const reconcile = async (jobId: number) => {
    const lines = reservations.filter(row => row.jobId === jobId).map(row => ({ reservationId: row.id, consumedQuantity: Number(consumed[row.id] ?? row.quantity) }));
    await customFetch(`/api/jobs/${jobId}/inventory-reconciliation`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lines }) });
    toast.success('Leftover stock returned to general inventory');
    await loadReservations();
  };

  const groups = useMemo(() => {
    const map = new Map<number, Reservation[]>();
    reservations.forEach(row => map.set(row.jobId, [...(map.get(row.jobId) ?? []), row]));
    return [...map.entries()];
  }, [reservations]);

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Vendor documents</h1>
          <p className="text-muted-foreground mt-1">Review an invoice beside the file, match the vendor, and send fuel or job materials to the right place.</p>
        </div>
        <div className="flex gap-2 items-end">
          <label className="block text-sm">Vendor name<Input data-testid="upload-vendor-name" value={vendorName} onChange={event => setVendorName(event.target.value)} placeholder="Vendor you are uploading" /></label>
          <textarea className="min-h-16 w-64 rounded-md border bg-background p-2 text-sm" placeholder="Paste invoice text when the file is a photo" value={ocrText} onChange={event => setOcrText(event.target.value)} />
          <Button disabled={busy} onClick={() => fileRef.current?.click()}>Upload PDF or image</Button>
          <input ref={fileRef} hidden type="file" accept="application/pdf,image/*" onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void upload(file); }} />
        </div>
      </div>
      {error && !invoice && <div className="rounded-md border border-red-500 bg-red-50 p-3 text-sm text-red-900">{error}</div>}
      {invoice && (
        <div className="grid gap-4 lg:grid-cols-2 min-h-[70vh]">
          <InvoiceFileView file={sourceFile} fileUrl={invoice.fileUrl} fileType={invoice.fileType} fileName={invoice.fileName} />
          <div className="space-y-3 overflow-auto rounded-lg border p-4">
            {invoice.vendorWarning && <div className="rounded-md border border-amber-500 bg-amber-50 p-3 text-sm text-amber-950">New vendor detected: '{invoice.draftVendorName}'. Create a new profile or pick an existing vendor below.</div>}
            <label className="block text-sm">Vendor<select className="mt-1 w-full rounded border p-2" data-testid="vendor-select" value={vendorId ?? ''} onChange={event => setVendorId(event.target.value ? Number(event.target.value) : null)}><option value="">Choose a vendor</option>{invoice.vendors.map(vendor => <option key={vendor.id} value={vendor.id}>{vendor.name}{vendor.isDraft ? ' (new)' : ''}</option>)}</select></label>
            <div className="flex items-end gap-2">
              <label className="block flex-1 text-sm">Vendor name<Input data-testid="vendor-name" value={vendorName} onChange={event => setVendorName(event.target.value)} placeholder="Name you entered for this vendor" /></label>
              <Button type="button" variant="outline" data-testid="add-vendor" disabled={busy} onClick={() => void addVendor()}>Add vendor</Button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <label className="text-sm">Invoice number<Input value={invoice.invoiceNumber ?? ''} onChange={event => setInvoice({ ...invoice, invoiceNumber: event.target.value })} /></label>
              <label className="text-sm">Invoice date<Input type="date" value={String(invoice.invoiceDate ?? '').slice(0, 10)} onChange={event => setInvoice({ ...invoice, invoiceDate: event.target.value })} /></label>
              <label className="text-sm">Total<Input type="number" value={invoice.totalAmount ?? 0} onChange={event => setInvoice({ ...invoice, totalAmount: Number(event.target.value) })} /></label>
              <label className="text-sm">Tax<Input type="number" value={invoice.taxAmount ?? 0} onChange={event => setInvoice({ ...invoice, taxAmount: Number(event.target.value) })} /></label>
              <label className="text-sm">Shipping<Input type="number" value={invoice.shippingAmount ?? 0} onChange={event => setInvoice({ ...invoice, shippingAmount: Number(event.target.value) })} /></label>
            </div>
            <div>
              <h2 className="text-sm font-semibold">Parts and supplies</h2>
              <p className="text-xs text-muted-foreground">{(invoice.lines ?? []).length ? 'These lines were read from the file. Match a line to an inventory part, or add it as a new part.' : 'No parts or supplies were read from this file. For a photo, paste the invoice text and upload it again.'}</p>
            </div>
            <table className="w-full text-sm">
              <thead><tr className="text-left"><th>Item</th><th>Qty</th><th>Price</th><th>Send to</th><th>Fill date</th></tr></thead>
              <tbody>
                {(invoice.lines ?? []).map(line => (
                  <tr key={line.id}>
                    <td className="py-1 pr-2 space-y-1">
                      <Input aria-label="Part name" data-testid={`line-description-${line.id}`} value={line.description} onChange={event => updateLine(line.id, { description: event.target.value })} />
                      <Input aria-label="SKU" data-testid={`line-sku-${line.id}`} value={line.sku} onChange={event => updateLine(line.id, { sku: event.target.value })} placeholder="SKU" />
                    </td>
                    <td className="space-y-1">
                      <Input aria-label="Quantity" data-testid={`line-quantity-${line.id}`} type="number" value={line.quantity} onChange={event => updateLine(line.id, { quantity: Number(event.target.value) })} />
                      <Input aria-label="Unit" data-testid={`line-unit-${line.id}`} value={line.unit} onChange={event => updateLine(line.id, { unit: event.target.value })} placeholder="Unit" />
                    </td>
                    <td className="space-y-1">
                      <Input aria-label="Unit price" data-testid={`line-unit-price-${line.id}`} type="number" value={line.unitPrice} onChange={event => updateLine(line.id, { unitPrice: Number(event.target.value) })} />
                      <Input aria-label="Line total" data-testid={`line-total-${line.id}`} type="number" value={line.totalPrice} onChange={event => updateLine(line.id, { totalPrice: Number(event.target.value) })} />
                    </td>
                    <td>
                      <select className="rounded border p-1" value={line.destinationType} onChange={event => updateLine(line.id, { destinationType: event.target.value, destinationId: null })}>{destinations.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
                      {line.destinationType === 'bulk_fuel' && <select className="mt-1 block rounded border p-1" value={line.destinationId ?? ''} onChange={event => updateLine(line.id, { destinationId: event.target.value })}><option value="">Tank</option>{invoice.tanks.map(tank => <option key={tank.id} value={tank.id}>{tank.name}</option>)}</select>}
                      {line.destinationType === 'job_direct_expense' && <select className="mt-1 block rounded border p-1" value={line.destinationId ?? ''} onChange={event => updateLine(line.id, { destinationId: event.target.value })}><option value="">Job</option>{invoice.jobs.map(job => <option key={job.id} value={job.id}>{job.title ?? job.name}</option>)}</select>}
                      {line.destinationType === 'inventory' && (
                        <div className="mt-1 space-y-1">
                          <InventoryItemCombobox
                            items={(invoice.items ?? []).map(inventoryChoice)}
                            value={line.destinationId == null || line.destinationId === '' ? null : Number(line.destinationId)}
                            onSelect={item => updateLine(line.id, { destinationId: String(item.id), destinationType: 'inventory' })}
                            placeholder="Match an existing part"
                          />
                          <Button type="button" variant="outline" size="sm" data-testid={`add-inventory-part-${line.id}`} disabled={addingLine === line.id} onClick={() => void addInventoryPart(line)}>Add as new inventory part</Button>
                          <p className="text-xs text-muted-foreground">{line.destinationId ? 'Matched to an existing inventory part. Posting adds this quantity to that part.' : 'This line will be added as a new inventory part when you post.'}</p>
                        </div>
                      )}
                    </td>
                    <td>{line.destinationType === 'bulk_fuel' && <Input type="date" value={line.fillDate || String(invoice.invoiceDate ?? '').slice(0, 10)} onChange={event => updateLine(line.id, { fillDate: event.target.value })} />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {error && <div className="rounded-md border border-red-500 bg-red-50 p-3 text-sm text-red-900">{error}</div>}
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />I confirm this vendor assignment</label>
            <Button disabled={busy || invoice.vendorConfirmed || !confirmed} onClick={() => void post()}>{invoice.vendorConfirmed ? 'Posted' : 'Post invoice'}</Button>
          </div>
        </div>
      )}
      {groups.length > 0 && (
        <div className="space-y-3 rounded-lg border p-4">
          <h2 className="text-lg font-semibold">Completed job material check</h2>
          {groups.map(([jobId, rows]) => (
            <div key={jobId} className="space-y-2">
              <p className="font-medium">{rows[0].jobTitle}</p>
              {rows.map(row => (
                <label key={row.id} className="flex items-center gap-2 text-sm">{row.name} reserved {row.quantity}. Used <Input className="w-24" type="number" value={consumed[row.id] ?? String(row.quantity)} onChange={event => setConsumed(current => ({ ...current, [row.id]: event.target.value }))} /></label>
              ))}
              <Button variant="outline" onClick={() => void reconcile(jobId)}>Save used quantity and return leftover</Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function inventoryChoice(item: Choice): InventoryItem {
  return {
    id: Number(item.id),
    tenantId: 0,
    name: item.name,
    sku: item.sku ?? '',
    unitPrice: Number(item.unitPrice ?? 0),
    quantity: Number(item.quantity ?? 0),
    unit: item.unit ?? 'each',
    createdAt: '',
  };
}

function normalizeLine(line: Line): Line {
  const bbox = line.bbox ?? {};
  return {
    ...line,
    description: line.description ?? '',
    quantity: Number(line.quantity ?? 0),
    unitPrice: Number(line.unitPrice ?? 0),
    totalPrice: Number(line.totalPrice ?? 0),
    sku: line.sku || bbox.sku || '',
    unit: line.unit || bbox.unit || '',
  };
}

function isPdf(file: File): boolean {
  return file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
}

async function readPdfText(file: File): Promise<string> {
  const pdfjs = await import('pdfjs-dist');
  const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const pages = Math.min(doc.numPages, 8);
  const chunks: string[] = [];
  for (let pageNumber = 1; pageNumber <= pages; pageNumber += 1) {
    const page = await doc.getPage(pageNumber);
    const content = await page.getTextContent();
    chunks.push(groupPdfTextItems(content.items as { str?: string; transform?: number[] }[]));
  }
  return chunks.filter(Boolean).join('\n');
}
