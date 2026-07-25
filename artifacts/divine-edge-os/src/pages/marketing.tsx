import React, { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { customFetch } from '@workspace/api-client-react';
import { useListCustomers, getListCustomersQueryKey } from '@workspace/api-client-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Separator } from '@/components/ui/separator';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';
import { Plus, Trash2, TrendingUp, DollarSign, Users, Trophy, Target, UserPlus, UserMinus, Send, Pencil, Mail, MessageSquare, MapPin, Megaphone, Star, Share2 } from 'lucide-react';
import { format } from 'date-fns';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import BroadcastPanel from '@/components/marketing/BroadcastPanel';

interface Campaign {
  id: number;
  tenantId: number;
  name: string;
  channel: string;
  budget: number;
  startDate: string | null;
  endDate: string | null;
  notes: string | null;
  customerCount: number;
  totalRevenue: number;
  roas: number | null;
  createdAt: string;
  updatedAt: string;
}

interface RoasEntry {
  id: number;
  name: string;
  channel: string;
  budget: number;
  customerCount: number;
  totalRevenue: number;
  roas: number | null;
  roasLabel: string;
}

interface CampaignCustomer {
  id: number;
  campaignId: number;
  customerId: number;
  acquiredAt: string;
  customerName: string | null;
  customerEmail: string | null;
}

const CHANNEL_LABELS: Record<string, string> = {
  google_ads: 'Google Ads',
  facebook: 'Facebook / Meta',
  mailer: 'Direct Mailer',
  door_hanger: 'Door Hanger',
  yard_sign: 'Yard Sign',
  referral: 'Referral',
  other: 'Other',
};

const CHANNEL_COLORS: Record<string, string> = {
  google_ads: '#4285F4',
  facebook: '#1877F2',
  mailer: '#F59E0B',
  door_hanger: '#10B981',
  yard_sign: '#8B5CF6',
  referral: '#EC4899',
  other: '#6B7280',
};

const CHANNEL_ICONS: Record<string, React.ElementType> = {
  google_ads: Megaphone,
  facebook: Share2,
  mailer: Mail,
  door_hanger: MapPin,
  yard_sign: MapPin,
  referral: Star,
  other: MessageSquare,
};

function RoasBadge({ roas }: { roas: number | null }) {
  if (roas == null) return <span className="text-muted-foreground text-sm">N/A</span>;
  const color = roas >= 4 ? 'text-emerald-700 bg-emerald-50 border-emerald-200' : roas >= 2 ? 'text-amber-700 bg-amber-50 border-amber-200' : 'text-red-700 bg-red-50 border-red-200';
  return <Badge variant="outline" className={`font-bold text-sm ${color}`} title={`Return on Ad Spend: ${roas.toFixed(1)}x`}>{roas.toFixed(1)}x</Badge>;
}

export default function MarketingPage() {
  const { isOwner, canManageOffice } = useAuth();
  const qc = useQueryClient();

  const [selectedCampaign, setSelectedCampaign] = useState<Campaign | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editForm, setEditForm] = useState({ name: '', channel: 'google_ads', budget: '', startDate: '', endDate: '', notes: '' });
  const [addCustomerUserId, setAddCustomerUserId] = useState('');
  const [form, setForm] = useState({ name: '', channel: 'google_ads', budget: '', startDate: '', endDate: '', notes: '' });
  const [deleteCampaignId, setDeleteCampaignId] = useState<number | null>(null);

  const { data: campaigns, isLoading } = useQuery<Campaign[]>({
    queryKey: ['marketing-campaigns'],
    queryFn: () => customFetch<Campaign[]>('/api/marketing/campaigns'),
  });

  const { data: leaderboard } = useQuery<RoasEntry[]>({
    queryKey: ['marketing-roas'],
    queryFn: () => customFetch<RoasEntry[]>('/api/marketing/roas'),
  });

  const { data: campaignCustomers, refetch: refetchCustomers } = useQuery<CampaignCustomer[]>({
    queryKey: ['campaign-customers', selectedCampaign?.id],
    queryFn: () =>
      selectedCampaign
        ? customFetch<CampaignCustomer[]>(`/api/marketing/campaigns/${selectedCampaign.id}/customers`)
        : Promise.resolve([]),
    enabled: selectedCampaign != null,
  });

  const { data: allCustomers } = useListCustomers({}, {
    query: { enabled: selectedCampaign != null, queryKey: getListCustomersQueryKey({}) },
  });

  const createMutation = useMutation({
    mutationFn: (data: typeof form) =>
      customFetch<Campaign>('/api/marketing/campaigns', {
        method: 'POST',
        body: JSON.stringify({ ...data, budget: parseFloat(data.budget) || 0 }),
        headers: { 'Content-Type': 'application/json' },
      }),
    onSuccess: () => {
      toast.success('Campaign created');
      qc.invalidateQueries({ queryKey: ['marketing-campaigns'] });
      qc.invalidateQueries({ queryKey: ['marketing-roas'] });
      setCreateOpen(false);
      setForm({ name: '', channel: 'google_ads', budget: '', startDate: '', endDate: '', notes: '' });
    },
    onError: () => toast.error('Failed to create campaign'),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: typeof editForm }) =>
      customFetch<Campaign>(`/api/marketing/campaigns/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ ...data, budget: parseFloat(data.budget) || 0 }),
        headers: { 'Content-Type': 'application/json' },
      }),
    onSuccess: (updated) => {
      toast.success('Campaign updated');
      qc.invalidateQueries({ queryKey: ['marketing-campaigns'] });
      qc.invalidateQueries({ queryKey: ['marketing-roas'] });
      setSelectedCampaign(updated);
      setEditOpen(false);
    },
    onError: () => toast.error('Failed to update campaign'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) =>
      customFetch(`/api/marketing/campaigns/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast.success('Campaign deleted');
      qc.invalidateQueries({ queryKey: ['marketing-campaigns'] });
      qc.invalidateQueries({ queryKey: ['marketing-roas'] });
      setSelectedCampaign(null);
    },
    onError: () => toast.error('Failed to delete campaign'),
  });

  const addCustomerMutation = useMutation({
    mutationFn: ({ campaignId, customerId }: { campaignId: number; customerId: number }) =>
      customFetch(`/api/marketing/campaigns/${campaignId}/customers`, {
        method: 'POST',
        body: JSON.stringify({ customerId }),
        headers: { 'Content-Type': 'application/json' },
      }),
    onSuccess: () => {
      toast.success('Customer linked to campaign');
      refetchCustomers();
      qc.invalidateQueries({ queryKey: ['marketing-campaigns'] });
      qc.invalidateQueries({ queryKey: ['marketing-roas'] });
      setAddCustomerUserId('');
    },
    onError: () => toast.error('Failed to link customer'),
  });

  const removeCustomerMutation = useMutation({
    mutationFn: ({ campaignId, customerId }: { campaignId: number; customerId: number }) =>
      customFetch(`/api/marketing/campaigns/${campaignId}/customers/${customerId}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast.success('Customer unlinked');
      refetchCustomers();
      qc.invalidateQueries({ queryKey: ['marketing-campaigns'] });
      qc.invalidateQueries({ queryKey: ['marketing-roas'] });
    },
    onError: () => toast.error('Failed to unlink customer'),
  });

  const totalBudget = campaigns?.reduce((s, c) => s + c.budget, 0) ?? 0;
  const totalRevenue = campaigns?.reduce((s, c) => s + c.totalRevenue, 0) ?? 0;
  const overallRoas = totalBudget > 0 ? totalRevenue / totalBudget : null;

  const unlinkedCustomers = (allCustomers?.items ?? []).filter(
    c => !(campaignCustomers ?? []).some(cc => cc.customerId === c.id),
  );

  // ROAS chart data
  const chartData = (leaderboard ?? []).slice(0, 8).map(r => ({
    name: r.name.length > 14 ? r.name.slice(0, 14) + '…' : r.name,
    roas: r.roas ?? 0,
    channel: r.channel,
  }));

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Marketing</h1>
          <p className="text-muted-foreground mt-1">
            Campaign ROAS tracking and bulk customer messaging
          </p>
        </div>
      </div>

      <Tabs defaultValue="campaigns">
        <TabsList>
          <TabsTrigger value="campaigns" className="gap-1.5" title="View and manage marketing campaigns"><Target className="w-3.5 h-3.5" /> Campaigns</TabsTrigger>
          <TabsTrigger value="broadcast" className="gap-1.5" title="Send and schedule SMS/email broadcasts"><Send className="w-3.5 h-3.5" /> Broadcast</TabsTrigger>
        </TabsList>

        <TabsContent value="broadcast" className="mt-4">
          <BroadcastPanel campaigns={(campaigns ?? []).map(c => ({ id: c.id, name: c.name }))} />
        </TabsContent>

        <TabsContent value="campaigns" className="mt-4 space-y-6">

      <div className="flex justify-end">
        {canManageOffice && (
          <Button className="gap-2" title="Create a new marketing campaign" onClick={() => setCreateOpen(true)}>
            <Plus className="w-4 h-4" /> New Campaign
          </Button>
        )}
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-primary/10 text-primary flex items-center justify-center">
              <Target className="w-5 h-5" />
            </div>
            <div>
              <p className="text-2xl font-bold" title={`${campaigns?.length ?? 0} campaign${(campaigns?.length ?? 0) !== 1 ? 's' : ''} total`}>{campaigns?.length ?? 0}</p>
              <p className="text-xs text-muted-foreground">Total Campaigns</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-red-50 text-red-600 flex items-center justify-center">
              <DollarSign className="w-5 h-5" />
            </div>
            <div>
              <p className="text-2xl font-bold" title={`Total budget spent: $${totalBudget.toLocaleString()}`}>${totalBudget.toLocaleString()}</p>
              <p className="text-xs text-muted-foreground">Total Budget Spent</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center">
              <TrendingUp className="w-5 h-5" />
            </div>
            <div>
              <p className="text-2xl font-bold" title={`Total campaign revenue: $${totalRevenue.toLocaleString()}`}>${totalRevenue.toLocaleString()}</p>
              <p className="text-xs text-muted-foreground">Revenue from Campaigns</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className={`w-10 h-10 rounded-full flex items-center justify-center ${overallRoas != null && overallRoas >= 4 ? 'bg-emerald-50 text-emerald-600' : overallRoas != null && overallRoas >= 2 ? 'bg-amber-50 text-amber-600' : 'bg-muted text-muted-foreground'}`}>
              <Trophy className="w-5 h-5" />
            </div>
            <div>
              <p className="text-2xl font-bold" title={overallRoas != null ? `Overall Return on Ad Spend: ${overallRoas.toFixed(1)}x` : 'No ROAS data yet'}>{overallRoas != null ? `${overallRoas.toFixed(1)}x` : '—'}</p>
              <p className="text-xs text-muted-foreground">Overall ROAS</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ROAS Bar Chart */}
      {chartData.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Trophy className="w-4 h-4" /> ROAS Leaderboard
            </CardTitle>
            <CardDescription>Revenue returned per $1 of marketing spend. 4x+ is excellent.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[220px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} layout="vertical" margin={{ left: 0, right: 40 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="hsl(var(--border))" />
                  <XAxis type="number" fontSize={11} tickLine={false} axisLine={false} stroke="hsl(var(--muted-foreground))" tickFormatter={v => `${v}x`} />
                  <YAxis type="category" dataKey="name" fontSize={11} tickLine={false} axisLine={false} stroke="hsl(var(--muted-foreground))" width={100} />
                  <Tooltip
                    contentStyle={{ backgroundColor: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))', borderRadius: '8px' }}
                    formatter={(v: number) => [`${v.toFixed(1)}x`, 'ROAS']}
                  />
                  <Bar dataKey="roas" radius={[0, 4, 4, 0]}>
                    {chartData.map((entry, i) => (
                      <Cell key={i} fill={CHANNEL_COLORS[entry.channel] ?? '#6B7280'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            {/* Legend */}
            <div className="flex flex-wrap gap-3 mt-3">
              {Object.entries(CHANNEL_COLORS).map(([key, color]) => (
                <div key={key} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <div className="w-2.5 h-2.5 rounded-sm" style={{ background: color }} />
                  {CHANNEL_LABELS[key]}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Campaign table */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Campaign</TableHead>
                <TableHead>Channel</TableHead>
                <TableHead className="text-right">Budget</TableHead>
                <TableHead className="text-right">Revenue</TableHead>
                <TableHead className="text-right">Customers</TableHead>
                <TableHead className="text-right">ROAS</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">Loading campaigns...</TableCell>
                </TableRow>
              ) : (campaigns ?? []).length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-12 text-center text-muted-foreground">
                    <Target className="w-10 h-10 mx-auto mb-3 opacity-30" />
                    <p>No marketing campaigns yet.</p>
                    <p className="text-sm mt-1">Create a campaign and link customers acquired through it to track ROAS.</p>
                  </TableCell>
                </TableRow>
              ) : (
                (campaigns ?? []).map(c => (
                  <TableRow key={c.id} className="cursor-pointer hover:bg-muted/50" onClick={() => setSelectedCampaign(c)}>
                    <TableCell>
                      <p className="font-medium" title={c.name}>{c.name}</p>
                      {c.startDate && (
                        <p className="text-xs text-muted-foreground" title={`Campaign period: ${format(new Date(c.startDate), 'MMMM d, yyyy')}${c.endDate ? ` – ${format(new Date(c.endDate), 'MMMM d, yyyy')}` : ' onwards'}`}>{format(new Date(c.startDate), 'MMM d, yyyy')}{c.endDate ? ` – ${format(new Date(c.endDate), 'MMM d, yyyy')}` : ''}</p>
                      )}
                    </TableCell>
                    <TableCell>
                      {(() => {
                        const Icon = CHANNEL_ICONS[c.channel] ?? MessageSquare;
                        return (
                          <Badge variant="secondary" className="text-xs gap-1" style={{ color: CHANNEL_COLORS[c.channel] }} title={`Channel: ${CHANNEL_LABELS[c.channel] ?? c.channel}`}>
                            <Icon className="w-3 h-3" />{CHANNEL_LABELS[c.channel] ?? c.channel}
                          </Badge>
                        );
                      })()}
                    </TableCell>
                    <TableCell className="text-right font-medium" title={`Campaign budget: $${c.budget.toLocaleString()}`}>${c.budget.toLocaleString()}</TableCell>
                    <TableCell className="text-right font-medium text-emerald-600" title={`Total revenue attributed: $${c.totalRevenue.toLocaleString()}`}>${c.totalRevenue.toLocaleString()}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1" title={`${c.customerCount} customer${c.customerCount !== 1 ? 's' : ''} attributed to this campaign`}>
                        <Users className="w-3.5 h-3.5 text-muted-foreground" />
                        {c.customerCount}
                      </div>
                    </TableCell>
                    <TableCell className="text-right"><RoasBadge roas={c.roas} /></TableCell>
                    <TableCell>
                      {canManageOffice && (
                        <Button
                          variant="ghost"
                          size="icon"
                          title="Delete this campaign"
                          className="h-8 w-8 text-muted-foreground hover:text-destructive"
                          onClick={e => { e.stopPropagation(); setDeleteCampaignId(c.id); }}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Create Campaign Sheet */}
      <Sheet open={createOpen} onOpenChange={open => { if (!open) setCreateOpen(false); }}>
        <SheetContent className="w-full sm:max-w-md overflow-y-auto">
          <SheetHeader className="pb-4">
            <SheetTitle>New Marketing Campaign</SheetTitle>
            <SheetDescription>Track marketing spend and link acquired customers to measure ROAS.</SheetDescription>
          </SheetHeader>
          <div className="space-y-4 pb-6">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Campaign Name <span className="text-destructive">*</span></label>
              <Input title="Enter a descriptive campaign name" placeholder="e.g. Q2 Google Ads Push" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Channel <span className="text-destructive">*</span></label>
                <Select value={form.channel} onValueChange={v => setForm(f => ({ ...f, channel: v }))}>
                  <SelectTrigger title="Primary channel used for this marketing campaign"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(CHANNEL_LABELS).map(([k, v]) => (
                      <SelectItem key={k} value={k}>{v}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Budget ($)</label>
                <Input type="number" min={0} step={100} title="Total budget allocated for this campaign" placeholder="2500" value={form.budget} onChange={e => setForm(f => ({ ...f, budget: e.target.value }))} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Start Date</label>
                <Input type="date" title="Campaign start date" value={form.startDate} onChange={e => setForm(f => ({ ...f, startDate: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">End Date</label>
                <Input type="date" title="Campaign end date" value={form.endDate} onChange={e => setForm(f => ({ ...f, endDate: e.target.value }))} />
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Notes</label>
              <Textarea title="Notes about targeting, creative direction, etc." placeholder="Target area, creative, etc." rows={2} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
            </div>
            <Separator />
            <div className="flex gap-3 justify-end">
              <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
              <Button onClick={() => createMutation.mutate(form)} disabled={createMutation.isPending || !form.name}>
                {createMutation.isPending ? 'Creating...' : 'Create Campaign'}
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      {/* Campaign Detail Sheet */}
      <Sheet open={selectedCampaign != null} onOpenChange={open => { if (!open) setSelectedCampaign(null); }}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          {selectedCampaign && (
            <>
              <SheetHeader className="pb-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <SheetTitle className="text-xl" title={selectedCampaign.name}>{selectedCampaign.name}</SheetTitle>
                    <SheetDescription>
                      {CHANNEL_LABELS[selectedCampaign.channel] ?? selectedCampaign.channel} ·{' '}
                      Budget: ${selectedCampaign.budget.toLocaleString()}
                    </SheetDescription>
                  </div>
                  <div className="flex items-center gap-2">
                    <RoasBadge roas={selectedCampaign.roas} />
                    {canManageOffice && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground hover:text-foreground shrink-0"
                        onClick={() => {
                          setEditForm({
                            name: selectedCampaign.name,
                            channel: selectedCampaign.channel,
                            budget: String(selectedCampaign.budget),
                            startDate: selectedCampaign.startDate?.slice(0, 10) ?? '',
                            endDate: selectedCampaign.endDate?.slice(0, 10) ?? '',
                            notes: selectedCampaign.notes ?? '',
                          });
                          setEditOpen(true);
                        }}
                      >
                        <Pencil className="w-4 h-4" />
                      </Button>
                    )}
                  </div>
                </div>
              </SheetHeader>

              <div className="space-y-5">
                {/* Stats */}
                <div className="grid grid-cols-2 gap-3 text-center">
                  <div className="p-3 bg-muted/40 rounded-lg">
                    <p className="text-lg font-bold" title={`Campaign budget: $${selectedCampaign.budget.toLocaleString()}`}>${selectedCampaign.budget.toLocaleString()}</p>
                    <p className="text-xs text-muted-foreground">Budget</p>
                  </div>
                  <div className="p-3 bg-emerald-50 dark:bg-emerald-950/20 rounded-lg">
                    <p className="text-lg font-bold text-emerald-700" title={`Attributed revenue: $${selectedCampaign.totalRevenue.toLocaleString()}`}>${selectedCampaign.totalRevenue.toLocaleString()}</p>
                    <p className="text-xs text-muted-foreground">Revenue</p>
                  </div>
                  <div className="p-3 bg-primary/5 rounded-lg">
                    <p className="text-lg font-bold text-primary" title={selectedCampaign.roas != null ? `Return on ad spend: ${selectedCampaign.roas.toFixed(1)}x` : 'ROAS not yet calculated'}>{selectedCampaign.roas != null ? `${selectedCampaign.roas.toFixed(1)}x` : '—'}</p>
                    <p className="text-xs text-muted-foreground">ROAS</p>
                  </div>
                  <div className="p-3 bg-muted/30 rounded-lg">
                    <p className="text-lg font-bold" title={selectedCampaign.customerCount > 0 && selectedCampaign.budget > 0 ? `Cost per acquired customer: $${(selectedCampaign.budget / selectedCampaign.customerCount).toFixed(0)}` : 'No customers linked yet'}>
                      {selectedCampaign.customerCount > 0 && selectedCampaign.budget > 0
                        ? `$${(selectedCampaign.budget / selectedCampaign.customerCount).toFixed(0)}`
                        : '—'}
                    </p>
                    <p className="text-xs text-muted-foreground">Cost / Customer</p>
                  </div>
                </div>

                {/* Customers */}
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Customers Acquired ({selectedCampaign.customerCount})</p>
                  {(campaignCustomers ?? []).length === 0 ? (
                    <p className="text-sm text-muted-foreground py-4 text-center border rounded-lg border-dashed">
                      No customers linked yet. Add customers acquired via this campaign to track their lifetime revenue.
                    </p>
                  ) : (
                    <div className="rounded-lg border divide-y">
                      {(campaignCustomers ?? []).map(cc => (
                        <div key={cc.id} className="flex items-center justify-between px-3 py-2.5">
                          <div>
                            <p className="text-sm font-medium" title={cc.customerName ?? undefined}>{cc.customerName}</p>
                            {cc.customerEmail && <p className="text-xs text-muted-foreground" title={`Email: ${cc.customerEmail}`}>{cc.customerEmail}</p>}
                          </div>
                          {canManageOffice && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-muted-foreground hover:text-destructive"
                              title={`Remove ${cc.customerName ?? 'customer'} from this campaign`}
                              onClick={() => removeCustomerMutation.mutate({ campaignId: selectedCampaign.id, customerId: cc.customerId })}
                            >
                              <UserMinus className="w-3.5 h-3.5" />
                            </Button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Add customer */}
                {canManageOffice && unlinkedCustomers.length > 0 && (
                  <>
                    <Separator />
                    <div className="space-y-2">
                      <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Link Customer</p>
                      <div className="flex gap-2">
                        <Select value={addCustomerUserId} onValueChange={setAddCustomerUserId}>
                          <SelectTrigger className="flex-1" title="Select a customer to link to this campaign"><SelectValue placeholder="Select customer..." /></SelectTrigger>
                          <SelectContent>
                            {unlinkedCustomers.map(c => (
                              <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Button
                          size="icon"
                          disabled={!addCustomerUserId || addCustomerMutation.isPending}
                          onClick={() => addCustomerMutation.mutate({ campaignId: selectedCampaign.id, customerId: parseInt(addCustomerUserId, 10) })}
                        >
                          <UserPlus className="w-4 h-4" />
                        </Button>
                      </div>
                      <p className="text-xs text-muted-foreground">Revenue from all paid invoices for this customer will count toward this campaign's ROAS.</p>
                    </div>
                  </>
                )}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
        </TabsContent>
      </Tabs>

      {/* Edit Campaign Sheet */}
      <Sheet open={editOpen} onOpenChange={open => { if (!open) setEditOpen(false); }}>
        <SheetContent className="w-full sm:max-w-md overflow-y-auto">
          <SheetHeader className="pb-4">
            <SheetTitle>Edit Campaign</SheetTitle>
            <SheetDescription>Update campaign details.</SheetDescription>
          </SheetHeader>
          <div className="space-y-4 pb-6">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Campaign Name <span className="text-destructive">*</span></label>
              <Input title="Campaign name" placeholder="e.g. Q2 Google Ads Push" value={editForm.name} onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Channel <span className="text-destructive">*</span></label>
                <Select value={editForm.channel} onValueChange={v => setEditForm(f => ({ ...f, channel: v }))}>
                  <SelectTrigger title="Primary channel for this campaign"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(CHANNEL_LABELS).map(([k, v]) => (
                      <SelectItem key={k} value={k}>{v}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Budget ($)</label>
                <Input type="number" min={0} step={100} title="Total budget allocated for this campaign" placeholder="2500" value={editForm.budget} onChange={e => setEditForm(f => ({ ...f, budget: e.target.value }))} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Start Date</label>
                <Input type="date" title="Campaign start date" value={editForm.startDate} onChange={e => setEditForm(f => ({ ...f, startDate: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">End Date</label>
                <Input type="date" title="Campaign end date" value={editForm.endDate} onChange={e => setEditForm(f => ({ ...f, endDate: e.target.value }))} />
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Notes</label>
              <Textarea title="Notes about targeting, creative direction, etc." placeholder="Target area, creative, etc." rows={2} value={editForm.notes} onChange={e => setEditForm(f => ({ ...f, notes: e.target.value }))} />
            </div>
            <Separator />
            <div className="flex gap-3 justify-end">
              <Button variant="outline" onClick={() => setEditOpen(false)}>Cancel</Button>
              <Button title="Save campaign changes" onClick={() => selectedCampaign && updateMutation.mutate({ id: selectedCampaign.id, data: editForm })} disabled={updateMutation.isPending || !editForm.name}>
                {updateMutation.isPending ? 'Saving...' : 'Save Changes'}
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      {/* Delete Campaign Confirmation */}
      {deleteCampaignId != null && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          onClick={() => setDeleteCampaignId(null)}
        >
          <div
            className="bg-card rounded-xl shadow-xl p-6 max-w-sm w-full mx-4 space-y-4"
            onClick={e => e.stopPropagation()}
          >
            <h2 className="text-base font-semibold">Delete Campaign</h2>
            <p className="text-sm text-muted-foreground">Are you sure you want to delete this campaign? This action cannot be undone.</p>
            <div className="flex gap-3 justify-end">
              <button
                className="text-sm px-3 py-1.5 rounded-md border hover:bg-muted transition-colors"
                onClick={() => setDeleteCampaignId(null)}
              >
                Cancel
              </button>
              <button
                className="text-sm px-3 py-1.5 rounded-md bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors"
                onClick={() => { deleteMutation.mutate(deleteCampaignId); setDeleteCampaignId(null); }}
                disabled={deleteMutation.isPending}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
