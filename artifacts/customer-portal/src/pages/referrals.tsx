import { useQuery } from '@tanstack/react-query';
import { customFetch } from '@workspace/api-client-react';
import { toast } from 'sonner';
import { Gift, Copy, Share2, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatCurrency, formatDate } from '@/lib/format';

interface ReferralData {
  enabled: boolean; tenantId: number; shareToken: string | null;
  rewardType: string; rewardValue: number; creditBalance: number; referralCount: number;
  rewards: { id: number; amount: number; earnedAt: string }[]; publicAppUrl?: string | null;
}

export default function Referrals() {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['portal-referrals'],
    queryFn: () => customFetch<ReferralData>('/api/portal/referrals'),
  });

  if (isLoading) return <div className="space-y-4">{[0, 1, 2].map(i => <div key={i} className="h-24 rounded-xl bg-muted animate-pulse" />)}</div>;
  if (isError || !data) return (
    <div className="text-center py-16 space-y-3"><AlertTriangle className="h-8 w-8 mx-auto text-destructive" /><p>Couldn’t load referrals.</p>
      <Button variant="outline" onClick={() => refetch()} data-testid="button-retry">Try again</Button></div>
  );
  if (!data.enabled || !data.shareToken) return (
    <div className="text-center py-16 space-y-2"><Gift className="h-10 w-10 mx-auto text-muted-foreground" />
      <h1 className="text-xl font-semibold">Referrals aren’t available</h1>
      <p className="text-muted-foreground text-sm">Your service company hasn’t turned on the referral program.</p></div>
  );

  const origin = (data.publicAppUrl || window.location.origin).replace(/\/$/, '');
  const link = `${origin}/quote-widget?tenantId=${data.tenantId}&ref=${encodeURIComponent(data.shareToken)}`;
  const reward = data.rewardType === 'percent' ? `${data.rewardValue}% credit` : `${formatCurrency(data.rewardValue)} credit`;
  const share = async () => {
    if (navigator.share) { try { await navigator.share({ title: 'Get an instant quote', url: link }); } catch { /* dismissed */ } }
    else { await navigator.clipboard.writeText(link); toast.success('Link copied'); }
  };

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2"><Gift className="h-6 w-6 text-primary" />Referrals</h1>
        <p className="text-muted-foreground text-sm mt-1">Earn {reward} when someone you refer pays their first invoice.</p>
      </div>

      <div className="rounded-xl border bg-card p-5 space-y-3">
        <p className="text-sm font-medium">Your share link</p>
        <div className="rounded-md bg-muted/60 border p-2.5 font-mono text-xs break-all" data-testid="text-referral-link">{link}</div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => navigator.clipboard.writeText(link).then(() => toast.success('Link copied'))} data-testid="button-copy-referral"><Copy className="h-4 w-4 mr-1.5" />Copy link</Button>
          <Button size="sm" variant="outline" onClick={share} data-testid="button-share-referral"><Share2 className="h-4 w-4 mr-1.5" />Share</Button>
        </div>
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        <div className="rounded-xl border bg-card p-5">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Referral credit balance</p>
          <p className="text-3xl font-bold mt-1" data-testid="text-credit-balance">{formatCurrency(data.creditBalance)}</p>
          <p className="text-xs text-muted-foreground mt-1">Earned credit only — separate from any deposits you’ve paid.</p>
        </div>
        <div className="rounded-xl border bg-card p-5">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Successful referrals</p>
          <p className="text-3xl font-bold mt-1" data-testid="text-referral-count">{data.referralCount}</p>
          <p className="text-xs text-muted-foreground mt-1">Counted after their first paid invoice.</p>
        </div>
      </div>

      <div className="rounded-xl border bg-card">
        <p className="px-5 py-3 border-b text-sm font-medium">Rewards earned</p>
        {data.rewards.length === 0 ? <p className="px-5 py-8 text-sm text-center text-muted-foreground">No rewards yet — share your link to get started.</p> : (
          <ul className="divide-y">{data.rewards.map(r => (
            <li key={r.id} className="px-5 py-3 flex justify-between text-sm" data-testid={`row-reward-${r.id}`}>
              <span className="text-muted-foreground">{formatDate(r.earnedAt)}</span><span className="font-medium">+{formatCurrency(r.amount)}</span>
            </li>))}</ul>
        )}
      </div>
    </div>
  );
}
