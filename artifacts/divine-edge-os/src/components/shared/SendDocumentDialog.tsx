import React, { useState, useEffect, useRef } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { toast } from 'sonner';
import { Mail, MessageSquare, Link2, CheckCircle2, Loader2, ExternalLink } from 'lucide-react';

export interface DocumentLinkDetails {
  publicLink: string | null;
  customerName?: string | null;
  customerPhone?: string | null;
}

export interface SendDocumentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 'invoice' or 'estimate' */
  type: 'invoice' | 'estimate';
  docNumber?: string;
  customerName?: string | null;
  customerPhone?: string | null;
  /** Full public URL for the document */
  publicLink?: string | null;
  loadPublicLink?: () => Promise<DocumentLinkDetails>;
  generatePublicLink?: () => Promise<DocumentLinkDetails>;
  /** Portal URL (customer-facing) */
  portalUrl?: string | null;
  /** Called when the user clicks "Send Email" */
  onSendEmail: () => Promise<void> | void;
  isSendingEmail?: boolean;
  /** Extra content rendered inside the dialog (e.g., expiry date for estimates) */
  children?: React.ReactNode;
}

export function SendDocumentDialog({
  open, onOpenChange,
  type, docNumber, customerName: initialName, customerPhone: initialPhone, publicLink: initialLink, portalUrl,
  loadPublicLink, generatePublicLink,
  onSendEmail, isSendingEmail, children,
}: SendDocumentDialogProps) {
  const [emailSent, setEmailSent] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [linkDetails, setLinkDetails] = useState<DocumentLinkDetails | null>(null);
  const [loadingLink, setLoadingLink] = useState(false);
  const loadLinkRef = useRef(loadPublicLink);
  loadLinkRef.current = loadPublicLink;
  const publicLink = linkDetails?.publicLink ?? initialLink;
  const customerName = linkDetails?.customerName ?? initialName;
  const customerPhone = linkDetails?.customerPhone ?? initialPhone;
  const label = type === 'invoice' ? 'Invoice' : 'Estimate';

  useEffect(() => {
    let active = true;
    setLinkDetails(null); setEmailSent(false); setLinkCopied(false);
    setLoadingLink(!!(open && loadLinkRef.current));
    if (open && loadLinkRef.current) {
      loadLinkRef.current().then(details => { if (active) setLinkDetails(details); })
        .catch(() => { if (active) toast.error('Could not load the link. Try Generate Link again.'); })
        .finally(() => { if (active) setLoadingLink(false); });
    }
    return () => { active = false; };
  }, [open, docNumber, type]);

  const handleGenerateLink = async () => {
    if (!generatePublicLink) return;
    setLoadingLink(true);
    try {
      const details = await generatePublicLink();
      setLinkDetails(details);
      toast.success('Link ready to share. No email or text was sent.');
    } catch (error: any) {
      toast.error(error?.data?.error ?? error?.message ?? 'Could not generate the link');
    } finally { setLoadingLink(false); }
  };

  const handleSendEmail = async () => {
    try {
      await onSendEmail();
      setEmailSent(true);
      if (loadLinkRef.current) {
        try { setLinkDetails(await loadLinkRef.current()); }
        catch { toast.error('The email request finished, but the link could not be refreshed. Reopen this dialog to load it.'); }
      }
      setTimeout(() => setEmailSent(false), 4000);
    } catch {
      setEmailSent(false);
      toast.error('Email was not sent. You can copy the link or check delivery history.');
    }
  };

  const handleCopyLink = () => {
    if (!publicLink) return;
    navigator.clipboard.writeText(publicLink).then(() => {
      setLinkCopied(true);
      toast.success('Link copied to clipboard');
      setTimeout(() => setLinkCopied(false), 3000);
    }).catch(() => toast.error('Clipboard access was blocked. Select and copy the link below.'));
  };

  const smsBody = publicLink
    ? encodeURIComponent(
        `Hi${customerName ? ` ${customerName}` : ''}! Your ${label.toLowerCase()} ${docNumber ? `#${docNumber} ` : ''}is ready. View it here: ${publicLink}`
      )
    : null;
  const smsHref = customerPhone && smsBody
    ? `sms:${customerPhone.replace(/\D/g, '')}?body=${smsBody}`
    : smsBody
    ? `sms:?body=${smsBody}`
    : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Send {label}</DialogTitle>
          <DialogDescription>
            {docNumber ? `${label} #${docNumber}` : label}
            {customerName ? ` · ${customerName}` : ''}
          </DialogDescription>
        </DialogHeader>

        {/* Extra content slot (e.g., expiry date for estimates) */}
        {children && (
          <>
            <div className="pt-1">{children}</div>
            <Separator />
          </>
        )}

        <div className="space-y-3 py-1">
          {/* Email */}
          <div className="rounded-lg border p-4 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3 min-w-0">
              <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${emailSent ? 'bg-emerald-100 text-emerald-600' : 'bg-blue-50 text-blue-600'}`}>
                {emailSent ? <CheckCircle2 className="w-4 h-4" /> : <Mail className="w-4 h-4" />}
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium">{emailSent ? 'Email requested' : 'Email'}</p>
                <p className="text-xs text-muted-foreground">
                  {emailSent ? 'Customer has been notified.' : "Sends to the customer's email on file."}
                </p>
              </div>
            </div>
            <Button
              size="sm"
              variant={emailSent ? 'outline' : 'default'}
              className="shrink-0 gap-1.5"
              onClick={handleSendEmail}
              disabled={isSendingEmail || loadingLink}
            >
              {isSendingEmail ? (
                <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Sending…</>
              ) : emailSent ? (
                <>Resend</>
              ) : (
                <>Send</>
              )}
            </Button>
          </div>

          {/* Text / SMS */}
          <div className="rounded-lg border p-4 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0 bg-green-50 text-green-600">
                <MessageSquare className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium">Text Message</p>
                <p className="text-xs text-muted-foreground">
                  {customerPhone ? `Opens your SMS app to ${customerPhone}` : 'Opens your SMS app with the link pre-filled.'}
                </p>
              </div>
            </div>
            {smsHref || smsBody ? (
              <a href={smsHref ?? `sms:?body=${smsBody}`} target="_blank" rel="noopener noreferrer">
                <Button size="sm" variant="outline" className="shrink-0 gap-1.5" disabled={!publicLink}>
                  <MessageSquare className="w-3.5 h-3.5" /> Open SMS
                </Button>
              </a>
            ) : (
              <Button size="sm" variant="outline" className="shrink-0" disabled>
                No link available
              </Button>
            )}
          </div>

          {/* Copy link */}
          <div className="rounded-lg border p-4 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3 min-w-0">
              <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${linkCopied ? 'bg-emerald-100 text-emerald-600' : 'bg-purple-50 text-purple-600'}`}>
                {linkCopied ? <CheckCircle2 className="w-4 h-4" /> : <Link2 className="w-4 h-4" />}
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium">{linkCopied ? 'Copied!' : 'Copy Link'}</p>
                {publicLink ? (
                  <p className="text-xs text-muted-foreground truncate max-w-[180px]" title={publicLink}>{publicLink}</p>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    {loadingLink ? 'Loading link…' : type === 'estimate' ? 'Generate a link to publish this estimate in the customer portal. No email is sent.' : 'Generate a link to share this invoice.'}
                  </p>
                )}
              </div>
            </div>
            <Button
              size="sm"
              variant={linkCopied ? 'outline' : 'outline'}
              className="shrink-0"
              onClick={publicLink ? handleCopyLink : handleGenerateLink}
              disabled={loadingLink || isSendingEmail || (!publicLink && !generatePublicLink)}
            >
              {loadingLink ? 'Loading…' : linkCopied ? 'Copied' : publicLink ? 'Copy' : 'Generate Link'}
            </Button>
          </div>
          {publicLink && <input aria-label={`${label} share link`} className="w-full rounded border bg-muted p-2 text-xs"
            value={publicLink} readOnly onFocus={event => event.currentTarget.select()} />}

          {/* Customer Portal */}
          {portalUrl && (
            <div className="rounded-lg border p-4 flex items-center justify-between gap-4">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0 bg-orange-50 text-orange-600">
                  <ExternalLink className="w-4 h-4" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium">Customer Portal</p>
                  <p className="text-xs text-muted-foreground">
                    Customer can log in to view &amp; pay all their documents.
                  </p>
                </div>
              </div>
              <a href={portalUrl} target="_blank" rel="noopener noreferrer">
                <Button size="sm" variant="outline" className="shrink-0">
                  Open <ExternalLink className="w-3 h-3 ml-1" />
                </Button>
              </a>
            </div>
          )}
        </div>

        <div className="flex justify-end pt-1">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
