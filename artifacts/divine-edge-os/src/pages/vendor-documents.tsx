import { useEffect, useMemo, useRef, useState } from 'react';
import { customFetch } from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';

type Line = {
  id: string;
  description: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  destinationType: string;
  destinationId: string | null;
  fillDate: string | null;
  bbox?: { x?: number; y?: number; width?: number; height?: number };
};
type Choice = { id: number; name: string; isDraft?: boolean; title?: string; status?: string; currentGallons?: number; maxCapacity?: number };
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
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [activeLine, setActiveLine] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [consumed, setConsumed] = useState<Record<string, string>>({});
  const drag = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);

  const loadReservations = () => customFetch<{ reservations: Reservation[] }>('/api/inventory-reservations').then(data => setReservations(data.reservations ?? [])).catch(() => setReservations([]));
  useEffect(() => { void loadReservations(); }, []);

  const upload = async (file: File) => {
    setBusy(true);
    setError('');
    try {
      const fileUrl = await readFile(file);
      const created = await customFetch<Invoice>('/api/vendor-documents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileName: file.name, fileType: file.type === 'application/pdf' ? 'pdf' : 'image', fileUrl, ocrText }),
      });
      setInvoice(created);
      setVendorId(created.vendorId);
      setConfirmed(false);
      setZoom(1);
      setRotation(0);
      setPan({ x: 0, y: 0 });
      await loadReservations();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'Upload failed');
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
          lines: invoice.lines.map(line => ({ id: line.id, destinationType: line.destinationType, destinationId: line.destinationId, fillDate: line.fillDate || String(invoice.invoiceDate).slice(0, 10) })),
        }),
      });
      setInvoice(saved);
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
          <textarea className="min-h-16 w-64 rounded-md border bg-background p-2 text-sm" placeholder="Paste invoice text when the file is a photo" value={ocrText} onChange={event => setOcrText(event.target.value)} />
          <Button disabled={busy} onClick={() => fileRef.current?.click()}>Upload PDF or image</Button>
          <input ref={fileRef} hidden type="file" accept="application/pdf,image/*" onChange={event => { const file = event.target.files?.[0]; if (file) void upload(file); }} />
        </div>
      </div>
      {invoice && (
        <div className="grid gap-4 lg:grid-cols-2 min-h-[70vh]">
          <div className="overflow-hidden rounded-lg border bg-muted/30">
            <div className="flex gap-2 border-b bg-background p-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setZoom(value => Math.min(3, value + 0.25))}>Zoom in</Button>
              <Button type="button" variant="outline" size="sm" onClick={() => setZoom(value => Math.max(0.5, value - 0.25))}>Zoom out</Button>
              <Button type="button" variant="outline" size="sm" onClick={() => setRotation(value => (value + 90) % 360)}>Rotate</Button>
            </div>
            <div className="relative h-[68vh] overflow-hidden" onMouseDown={event => { drag.current = { x: event.clientX, y: event.clientY, panX: pan.x, panY: pan.y }; }} onMouseMove={event => { if (!drag.current) return; setPan({ x: drag.current.panX + event.clientX - drag.current.x, y: drag.current.panY + event.clientY - drag.current.y }); }} onMouseUp={() => { drag.current = null; }} onMouseLeave={() => { drag.current = null; }}>
              <div className="absolute left-1/2 top-1/2" style={{ transform: `translate(-50%, -50%) translate(${pan.x}px, ${pan.y}px) scale(${zoom}) rotate(${rotation}deg)` }}>
                {invoice.fileType === 'pdf' ? <iframe title={invoice.fileName} src={invoice.fileUrl} className="h-[60vh] w-[36vw] bg-white pointer-events-none" /> : <img alt={invoice.fileName} src={invoice.fileUrl} className="max-h-[60vh] max-w-full" />}
                {invoice.lines.map(line => activeLine === line.id && line.bbox ? <button key={line.id} className="absolute border-2 border-amber-500 bg-amber-300/30" style={{ left: `${line.bbox.x ?? 0}%`, top: `${line.bbox.y ?? 0}%`, width: `${line.bbox.width ?? 0}%`, height: `${line.bbox.height ?? 0}%` }} /> : null)}
              </div>
            </div>
          </div>
          <div className="space-y-3 overflow-auto rounded-lg border p-4">
            {invoice.vendorWarning && <div className="rounded-md border border-amber-500 bg-amber-50 p-3 text-sm text-amber-950">New vendor detected: '{invoice.draftVendorName}'. Create new profile or merge with existing <select className="mx-1 rounded border bg-white p-1" aria-label="Existing vendors" value={vendorId ?? ''} onChange={event => setVendorId(Number(event.target.value))}><option value={invoice.vendorId ?? ''}>Create new profile</option>{invoice.vendors.filter(vendor => !vendor.isDraft).map(vendor => <option key={vendor.id} value={vendor.id}>{vendor.name}</option>)}</select>?</div>}
            <label className="block text-sm">Vendor<select className="mt-1 w-full rounded border p-2" value={vendorId ?? ''} onChange={event => setVendorId(Number(event.target.value))}>{invoice.vendors.map(vendor => <option key={vendor.id} value={vendor.id}>{vendor.name}{vendor.isDraft ? ' (new)' : ''}</option>)}</select></label>
            <div className="grid grid-cols-2 gap-2">
              <label className="text-sm">Invoice number<Input value={invoice.invoiceNumber ?? ''} onChange={event => setInvoice({ ...invoice, invoiceNumber: event.target.value })} /></label>
              <label className="text-sm">Invoice date<Input type="date" value={String(invoice.invoiceDate ?? '').slice(0, 10)} onChange={event => setInvoice({ ...invoice, invoiceDate: event.target.value })} /></label>
              <label className="text-sm">Total<Input type="number" value={invoice.totalAmount ?? 0} onChange={event => setInvoice({ ...invoice, totalAmount: Number(event.target.value) })} /></label>
              <label className="text-sm">Tax<Input type="number" value={invoice.taxAmount ?? 0} onChange={event => setInvoice({ ...invoice, taxAmount: Number(event.target.value) })} /></label>
              <label className="text-sm">Shipping<Input type="number" value={invoice.shippingAmount ?? 0} onChange={event => setInvoice({ ...invoice, shippingAmount: Number(event.target.value) })} /></label>
            </div>
            <table className="w-full text-sm">
              <thead><tr className="text-left"><th>Item</th><th>Qty</th><th>Send to</th><th>Fill date</th></tr></thead>
              <tbody>
                {invoice.lines.map(line => (
                  <tr key={line.id} className={activeLine === line.id ? 'bg-amber-50' : ''} onMouseEnter={() => setActiveLine(line.id)}>
                    <td className="py-1 pr-2">{line.description}</td>
                    <td>{line.quantity}</td>
                    <td>
                      <select className="rounded border p-1" value={line.destinationType} onChange={event => updateLine(line.id, { destinationType: event.target.value, destinationId: null })}>{destinations.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
                      {line.destinationType === 'bulk_fuel' && <select className="mt-1 block rounded border p-1" value={line.destinationId ?? ''} onChange={event => updateLine(line.id, { destinationId: event.target.value })}><option value="">Tank</option>{invoice.tanks.map(tank => <option key={tank.id} value={tank.id}>{tank.name}</option>)}</select>}
                      {line.destinationType === 'job_direct_expense' && <select className="mt-1 block rounded border p-1" value={line.destinationId ?? ''} onChange={event => updateLine(line.id, { destinationId: event.target.value })}><option value="">Job</option>{invoice.jobs.map(job => <option key={job.id} value={job.id}>{job.title ?? job.name}</option>)}</select>}
                      {line.destinationType === 'inventory' && <select className="mt-1 block rounded border p-1" value={line.destinationId ?? ''} onChange={event => updateLine(line.id, { destinationId: event.target.value })}><option value="">New or matching item</option>{invoice.items.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select>}
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

function readFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}
