import { ShieldCheck } from 'lucide-react';

/** Must match artifacts/api-server/src/lib/cardAuthorization.ts CARD_AUTHORIZATION_TERMS. */
export const CARD_AUTHORIZATION_TERMS = "By continuing with this option selected, I authorize the business named on this document to securely save my card with its payment provider and charge it for future invoices for services I authorize, either when an invoice is sent, on its due date, or when staff initiates payment under the business's billing policy. I can withdraw this authorization or remove my saved card in my customer profile or by contacting the business. Card numbers and security codes are handled by the payment provider, not stored in this software. Uncheck this option to make a one-time payment without saving this card or authorizing future charges.";

/** Default-on save-card choice with the authorization terms always visible before the action button. */
export function SaveCardConsent({ checked, onChange, disabled, id = 'save-card-consent' }: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  id?: string;
}) {
  return (
    <div className="rounded-md border bg-muted/30 p-3 space-y-2" data-testid="card-authorization">
      <label htmlFor={id} className="flex items-start gap-2 cursor-pointer select-none">
        <input
          id={id}
          type="checkbox"
          className="mt-0.5 h-4 w-4 shrink-0 accent-[hsl(var(--primary))]"
          checked={checked}
          disabled={disabled}
          onChange={e => onChange(e.target.checked)}
          data-testid="checkbox-save-card"
        />
        <span className="text-sm font-medium leading-snug">Save this card and authorize future invoice charges</span>
      </label>
      <CardAuthorizationTerms />
    </div>
  );
}

export function CardAuthorizationTerms() {
  return (
    <p className="text-[11px] leading-relaxed text-muted-foreground flex gap-1.5" data-testid="text-card-authorization-terms">
      <ShieldCheck className="w-3.5 h-3.5 shrink-0 mt-0.5" />
      <span>{CARD_AUTHORIZATION_TERMS}</span>
    </p>
  );
}

/** Staff-side confirmation (never prechecked) that the customer authorized future charges. */
export function StaffAuthorizationCheckbox({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="rounded-md border border-dashed p-3 space-y-2">
      <label className="flex items-start gap-2 cursor-pointer select-none">
        <input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0 accent-[hsl(var(--primary))]" checked={checked}
          onChange={e => onChange(e.target.checked)} data-testid="checkbox-staff-customer-authorization" />
        <span className="text-xs font-semibold uppercase tracking-wide">Customer authorization confirmed</span>
      </label>
      <p className="text-[11px] text-muted-foreground">Check only if the customer agreed to these terms. Unchecked cards are stored without permission for automatic charges.</p>
      <CardAuthorizationTerms />
    </div>
  );
}
