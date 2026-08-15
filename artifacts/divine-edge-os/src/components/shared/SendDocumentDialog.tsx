import React, { useState } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { toast } from 'sonner';
import { Mail, MessageSquare, Link2, CheckCircle2, Loader2, ExternalLink } from 'lucide-react';

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
  type, docNumber, customerName, customerPhone, publicLink, portalUrl,
  onSendEmail, isSendingEmail, children,
}: SendDocumentDialogProps) {
  const [emailSent, setEmailSent] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const label = type === 'invoice' ? 'Invoice' : 'Estimate';

  const handleSendEmail = async () => {
    await onSendEmail();
    setEmailSent(true);
    setTimeout(() => setEmailSent(false), 4000);
  };

  const handleCopyLink = () => {
    if (!publicLink) return;
    navigator.clipboard.writeText(publicLink).then(() => {
      setLinkCopied(true);
      toast.success('Link copied to clipboard');
      setTimeout(() => setLinkCopied(false), 3000);
    });
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
                <p className="text-sm font-medium">{emailSent ? 'Email sent!' : 'Email'}</p>
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
              disabled={isSendingEmail}
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
                  <p className="text-xs text-muted-foreground">Public link not yet generated.</p>
                )}
              </div>
            </div>
            <Button
              size="sm"
              variant={linkCopied ? 'outline' : 'outline'}
              className="shrink-0"
              onClick={handleCopyLink}
              disabled={!publicLink}
            >
              {linkCopied ? 'Copied' : 'Copy'}
            </Button>
          </div>

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
