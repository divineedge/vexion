/**
 * Opens a new window with a formatted, print-ready version of an estimate or invoice.
 * Uses window.print() so the browser's native PDF / print dialog handles output.
 */

function base64Logo(tenantId: number, apiBase: string): string {
  return `${apiBase}/api/public/tenants/${tenantId}/logo`;
}

function logoTag(logoUrl: string | null | undefined, tenantId: number | undefined, apiBase: string): string {
  if (!logoUrl) return '';
  const src = tenantId ? base64Logo(tenantId, apiBase) : (logoUrl ?? '');
  return `<img src="${src}" alt="Logo" style="height:60px;width:auto;object-fit:contain;margin:0 auto 8px;display:block;" />`;
}

function brandingHeader(settings: Record<string, unknown>, apiBase: string): string {
  const items: string[] = [];
  if (settings?.businessPhone) items.push(`Phone: ${settings.businessPhone}`);
  if (settings?.businessEmail) items.push(`Email: ${settings.businessEmail}`);
  if (settings?.businessWebsite) items.push(`Web: ${settings.businessWebsite}`);
  if (settings?.businessContactAddress || settings?.businessAddress) items.push(`settings.businessContactAddress ?? settings.businessAddress}`);
  return `
    <div style="text-align:center;margin-bottom:24px;padding-bottom:16px;border-bottom:1px solid #e5e7eb;">
      ${logoTag(settings?.logoUrl as string, settings?.tenantId as number, apiBase)}
      ${settings?.companyName ? `<div style="font-size:20px;font-weight:700;margin-bottom:2px;">${settings.companyName}</div>` : ''}
      ${settings?.businessTagline ? `<div style="font-size:12px;color:#6b7280;font-style:italic;margin-bottom:6px;">${settings.businessTagline}</div>` : ''}
      ${items.length ? `<div style="font-size:11px;color:#6b7280;">${items.join(' &nbsp;·&nbsp; ')}</div>` : ''}
    </div>`;
}

const PRINT_CSS = `
  * { box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; font-size: 13px; color: #111; margin: 0; padding: 32px; }
  h1 { font-size: 22px; font-weight: 700; margin: 0 0 4px; }
  h2 { font-size: 16px; font-weight: 700; margin: 0 0 4px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 16px; }
  th { background: #f3f4f6; text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: .05em; padding: 7px 12px; font-weight: 600; border-bottom: 1px solid #e5e7eb; }
  th.right, td.right { text-align: right; }
  th.center, td.center { text-align: center; }
  td { padding: 8px 12px; border-bottom: 1px solid #f3f4f6; }
  tfoot td { border-top: 2px solid #e5e7eb; font-weight: 700; background: #f9fafb; }
  .badge { display:inline-block;padding:2px 8px;border-radius:9999px;font-size:11px;font-weight:600;border:1px solid #e5e7eb; }
  .section { margin-bottom: 20px; }
  .meta-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 20px; }
  .meta-item label { display: block; font-size: 10px; text-transform: uppercase; letter-spacing: .06em; color: #9ca3af; font-weight: 600; margin-bottom: 2px; }
  .meta-item p { margin: 0; font-weight: 500; }
  .optional-header td { background: #fef9c3; color: #92400e; font-size: 11px; font-weight: 700; letter-spacing: .05em; text-transform: uppercase; }
  .optional-row td { background: #fefce8; }
  .totals-table td { padding: 6px 12px; }
  .footer { margin-top: 24px; padding-top: 12px; border-top: 1px solid #e5e7eb; font-size: 11px; color: #6b7280; text-align: center; }
  @media print { body { padding: 16px; } }
`;

function printDocument(html: string): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Print</title><style>${PRINT_CSS}</style></head><body>${html}</body></html>`;
}

function openPrintWindow(doc: string) {
  const win = window.open('', '_blank', 'width=860,height=750');
  if (!win) { alert('Please allow pop-ups to print.'); return; }
  win.document.write(doc);
  win.document.close();
  win.onload = () => { win.focus(); win.print(); };
}

export function buildEstimatePrintDocument(estimate: Record<string, unknown>, settings: Record<string, unknown>): string {
  const legacyTerms = ((estimate.lineItems as Array<Record<string, unknown>> | undefined) ?? []).find(i => i?.type === 'text_block' && i?.role === 'terms');
  const estTerms = typeof estimate.termsText === 'string' ? estimate.termsText : String(legacyTerms?.content ?? '');
  const apiBase = (import.meta.env.BASE_URL ?? '/').replace(/\/$/, '');
  const items = (estimate.lineItems ?? []) as Array<{ id: string; description: string; qty: number; unitPrice: number; markup: number; discount: number; isOptional: boolean; optionalPitchLine: string }>;
  const calcItem = (i: typeof items[0]) => i.qty * i.unitPrice * (1 + i.markup / 100) * (1 - i.discount / 100);
  const required = items.filter(i => !i.isOptional);
  const optional = items.filter(i => i.isOptional);
  const total = items.reduce((s, i) => s + calcItem(i), 0);

  const fmt$ = (n: number) => `$${n.toFixed(2)}`;
  const fmtDate = (d: string) => new Date(d).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

  const requiredRows = required.map(it => `
    <tr>
      <td>${it.description || '—'}${it.markup > 0 || it.discount > 0 ? `<br><small style="color:#6b7280;">${fmt$(it.unitPrice)} each${it.markup > 0 ? ` + ${it.markup}% markup` : ''}${it.discount > 0 ? ` − ${it.discount}% off` : ''}</small>` : ''}</td>
      <td class="center">${it.qty}</td>
      <td class="right">${fmt$(calcItem(it))}</td>
    </tr>`).join('');

  const optionalRows = optional.length ? `
    <tr class="optional-header"><td colspan="3">Optional Add-Ons</td></tr>
    ${optional.map(it => `<tr class="optional-row"><td>${it.description || '—'}${it.optionalPitchLine ? `<br><small style="color:#6b7280;font-style:italic;">${it.optionalPitchLine}</small>` : ''}</td><td class="center">${it.qty}</td><td class="right">${fmt$(calcItem(it))}</td></tr>`).join('')}` : '';

  const meta: string[] = [];
  if (estimate.customerName) meta.push(`<div class="meta-item"><label>Customer</label><p>${estimate.customerName}</p></div>`);
  if (estimate.propertyAddress) meta.push(`<div class="meta-item"><label>Property</label><p>${estimate.propertyAddress}</p></div>`);
  if (estimate.scheduledAt) meta.push(`<div class="meta-item"><label>Scheduled</label><p>${fmtDate(estimate.scheduledAt as string)}</p></div>`);
  if (estimate.expiresAt) meta.push(`<div class="meta-item"><label>Expires</label><p>${fmtDate(estimate.expiresAt as string)}</p></div>`);

  const html = `
    ${brandingHeader(settings, apiBase)}
    <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:16px;">
      <div>
        <h1>${estimate.id === 'PREVIEW' ? 'Estimate (preview)' : `Estimate #${estimate.id}`}</h1>
        <div style="color:#6b7280;font-size:12px;">Prepared ${estimate.createdAt ? fmtDate(estimate.createdAt as string) : ''}</div>
      </div>
      <span class="badge">${String(estimate.status ?? '').toUpperCase()}</span>
    </div>
    ${meta.length ? `<div class="meta-grid">${meta.join('')}</div>` : ''}
    ${(estimate.notes as string) ? `<div style="color:#6b7280;font-style:italic;margin-bottom:16px;padding:10px;background:#f9fafb;border-radius:6px;">${estimate.notes}</div>` : ''}
    <table>
      <thead><tr><th>Service</th><th class="center" style="width:60px;">Qty</th><th class="right" style="width:100px;">Price</th></tr></thead>
      <tbody>${requiredRows}${optionalRows}</tbody>
      <tfoot><tr><td colspan="2" class="right">Total</td><td class="right">${fmt$(total)}</td></tr></tfoot>
    </table>
    ${estTerms.trim() ? `<div class="section" style="margin-top:16px;"><div style="font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:#9ca3af;font-weight:600;margin-bottom:4px;">Terms &amp; Conditions</div><div style="white-space:pre-wrap;color:#4b5563;font-size:12px;">${escapeHtml(estTerms)}</div></div>` : ''}
    ${(settings?.invoiceFooterText as string) ? `<div class="footer">${settings.invoiceFooterText}</div>` : ''}
  `;
  return printDocument(html);
}

export function buildInvoicePrintDocument(invoice: Record<string, unknown>, settings: Record<string, unknown>): string {
  const apiBase = (import.meta.env.BASE_URL ?? '/').replace(/\/$/, '');
  const lineItems = (invoice.lineItems ?? []) as Array<{ id: string | number; description: string; quantity: number; unitPrice: number; total: number }>;
  const subtotal = (invoice.subtotal as number) ?? 0;
  const tax = (invoice.tax as number) ?? 0;
  const total = (invoice.total as number) ?? 0;
  const creditApplied = typeof invoice.creditApplied === 'number' ? invoice.creditApplied : 0;
  const balanceDue = typeof invoice.balanceDue === 'number' ? invoice.balanceDue : total;
  const fmt$ = (n: number) => `$${n.toFixed(2)}`;
  const fmtDate = (d: string) => new Date(d).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

  const liRows = lineItems.map(li => `
    <tr>
      <td>${li.description || '—'}</td>
      <td class="center">${li.quantity}</td>
      <td class="right">${fmt$(li.unitPrice)}</td>
      <td class="right">${fmt$(li.total)}</td>
    </tr>`).join('');

  const meta: string[] = [];
  if (invoice.customerName) meta.push(`<div class="meta-item"><label>Customer</label><p>${invoice.customerName}</p></div>`);
  if (invoice.dueDate) meta.push(`<div class="meta-item"><label>Due Date</label><p>${fmtDate(invoice.dueDate as string)}</p></div>`);
  if (invoice.createdAt) meta.push(`<div class="meta-item"><label>Invoice Date</label><p>${fmtDate(invoice.createdAt as string)}</p></div>`);
  if (invoice.paidAt) meta.push(`<div class="meta-item"><label>Paid On</label><p>${fmtDate(invoice.paidAt as string)}</p></div>`);

  const html = `
    ${brandingHeader(settings, apiBase)}
    <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:16px;">
      <div>
        <h1 style="font-family:monospace;">${invoice.invoiceNumber ?? `Invoice #${invoice.id}`}</h1>
        <div style="color:#6b7280;font-size:12px;">Issued ${invoice.createdAt ? fmtDate(invoice.createdAt as string) : ''}</div>
      </div>
      <span class="badge">${String(invoice.status ?? '').toUpperCase()}</span>
    </div>
    ${meta.length ? `<div class="meta-grid">${meta.join('')}</div>` : ''}
    ${(invoice.notes as string) ? `<div style="color:#6b7280;font-style:italic;margin-bottom:16px;padding:10px;background:#f9fafb;border-radius:6px;">${invoice.notes}</div>` : ''}
    <table>
      <thead><tr><th>Description</th><th class="center" style="width:60px;">Qty</th><th class="right" style="width:100px;">Unit Price</th><th class="right" style="width:100px;">Total</th></tr></thead>
      <tbody>${liRows || '<tr><td colspan="4" style="text-align:center;color:#9ca3af;">No line items</td></tr>'}</tbody>
    </table>
    <table class="totals-table" style="width:260px;margin-left:auto;">
      <tbody>
        <tr><td>Subtotal</td><td class="right">${fmt$(subtotal)}</td></tr>
        ${tax > 0 ? `<tr><td>Tax</td><td class="right">${fmt$(tax)}</td></tr>` : ''}
        <tr style="font-weight:700;font-size:15px;"><td>Total</td><td class="right">${fmt$(total)}</td></tr>
        ${creditApplied > 0 ? `<tr style="color:#047857;"><td>Prepaid credit applied</td><td class="right">-${fmt$(creditApplied)}</td></tr><tr style="font-weight:700;font-size:15px;"><td>Balance due</td><td class="right">${fmt$(balanceDue)}</td></tr>` : ''}
      </tbody>
    </table>
    ${(invoice.termsText as string) ? `<div class="section" style="margin-top:16px;"><div style="font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:#9ca3af;font-weight:600;margin-bottom:4px;">Terms &amp; Conditions</div><div style="white-space:pre-wrap;color:#4b5563;font-size:12px;">${escapeHtml(invoice.termsText as string)}</div></div>` : ''}
    ${(settings?.invoiceFooterText as string) ? `<div class="footer">${settings.invoiceFooterText}</div>` : ''}
  `;
  return printDocument(html);
}

function escapeHtml(v: string): string {
  return v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function printEstimate(estimate: Record<string, unknown>, settings: Record<string, unknown>) {
  openPrintWindow(buildEstimatePrintDocument(estimate, settings));
}

export function printInvoice(invoice: Record<string, unknown>, settings: Record<string, unknown>) {
  openPrintWindow(buildInvoicePrintDocument(invoice, settings));
}
