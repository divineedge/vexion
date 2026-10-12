import { useEffect, useState } from 'react';
import { customFetch } from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { Copy, ExternalLink } from 'lucide-react';

interface Cfg { enabled: boolean; publicAppUrl?: string | null; services: unknown[] }

export default function WidgetEmbedPanel({ tenantId }: { tenantId: number | null }) {
  const [cfg, setCfg] = useState<Cfg | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!tenantId) return;
    customFetch<Cfg>(`/api/widget/config?tenantId=${tenantId}`).then(setCfg).catch(() => setFailed(true));
  }, [tenantId]);

  if (!tenantId) return <p className="text-sm text-muted-foreground">Company not resolved for this account.</p>;

  const published = cfg?.publicAppUrl?.replace(/\/$/, '') || null;
  const base = published ?? `${window.location.origin}${import.meta.env.BASE_URL.replace(/\/$/, '')}`;
  const link = `${base}/quote-widget?tenantId=${tenantId}`;
  const iframe = `<iframe src="${link}" style="width:100%;max-width:520px;height:720px;border:0;border-radius:16px" loading="lazy" title="Instant quote"></iframe>`;
  const copy = (t: string, label: string) => navigator.clipboard.writeText(t).then(() => toast.success(`${label} copied`));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {published ? <Badge data-testid="status-widget-url">Published URL</Badge>
          : <Badge variant="outline" data-testid="status-widget-url">Preview mode — publish the app for a permanent link</Badge>}
        {cfg && !cfg.enabled && <Badge variant="destructive">Widget disabled</Badge>}
        {cfg && cfg.enabled && cfg.services.length === 0 && <Badge variant="outline">No priced services published</Badge>}
        {failed && <Badge variant="outline">Couldn’t load widget status</Badge>}
      </div>
      <div className="space-y-1">
        <p className="text-xs font-medium text-muted-foreground">Direct link</p>
        <div className="rounded-md bg-muted/50 border p-2.5 font-mono text-xs break-all" data-testid="text-widget-link">{link}</div>
      </div>
      <div className="space-y-1">
        <p className="text-xs font-medium text-muted-foreground">Embed code (responsive)</p>
        <div className="rounded-md bg-muted/50 border p-2.5 font-mono text-xs break-all" data-testid="text-widget-iframe">{iframe}</div>
      </div>
      <p className="text-xs text-muted-foreground">Add <code>&amp;dh=CODE</code> for door-hanger tracking. Referral links add <code>&amp;ref=</code> automatically.</p>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" className="gap-2 text-xs" onClick={() => copy(iframe, 'Embed code')} data-testid="button-copy-iframe"><Copy className="w-3.5 h-3.5" />Copy embed code</Button>
        <Button size="sm" variant="outline" className="gap-2 text-xs" onClick={() => copy(link, 'Link')} data-testid="button-copy-link"><Copy className="w-3.5 h-3.5" />Copy link</Button>
        <Button size="sm" variant="outline" className="gap-2 text-xs" onClick={() => window.open(link, '_blank')} data-testid="button-preview-widget"><ExternalLink className="w-3.5 h-3.5" />Preview</Button>
      </div>
    </div>
  );
}
