import React, { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  usePreviewBroadcast, useSendBroadcast, useCancelBroadcast, useUpdateBroadcast,
  useListBroadcasts, getListBroadcastsQueryKey,
  useGetBroadcast, getGetBroadcastQueryKey,
} from '@workspace/api-client-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Separator } from '@/components/ui/separator';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { toast } from 'sonner';
import { MessageSquare, Mail, Users, Send, Loader2, Clock, X, Pencil, Check, Copy } from 'lucide-react';
import { format } from 'date-fns';

interface Campaign {
  id: number;
  name: string;
}

const CUSTOMER_TYPES = ['residential', 'commercial', 'hoa'];

function statusBadgeVariant(status: string) {
  if (status === 'completed') return 'secondary';
  if (status === 'failed') return 'destructive';
  if (status === 'cancelled') return 'outline';
  if (status === 'scheduled') return 'outline';
  return 'outline';
}

function NotInterestedSelector({ campaigns, value, onChange, sourceCampaignId }: {
  campaigns: Campaign[]; value: string; onChange: (v: string) => void; sourceCampaignId?: number | null;
}) {
  const options = campaigns.filter(c => c.id !== sourceCampaignId);
  return (
    <div className="space-y-1.5 rounded-lg border p-3 bg-muted/20">
      <label className="text-sm font-medium">"Not interested right now" destination <span className="text-destructive">*</span></label>
      <Select value={value || 'none'} onValueChange={v => onChange(v === 'none' ? '' : v)}>
        <SelectTrigger title="Campaign that recipients move to when they click Not interested right now"><SelectValue placeholder="Choose a destination campaign" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="none" disabled>Choose a destination campaign</SelectItem>
          {options.map(c => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}
        </SelectContent>
      </Select>
      {options.length === 0 && <p className="text-xs text-destructive">Create another marketing campaign first; it must be different from the campaign you're sending to.</p>}
      <div className="text-xs text-muted-foreground space-y-1 pt-1">
        <p>Every email ends with two buttons:</p>
        <p><strong>Not interested right now</strong> moves the customer to the campaign you pick above and stops this campaign's emails to them. They still get your other emails.</p>
        <p><strong>Unsubscribe</strong> stops all marketing emails to that customer.</p>
      </div>
    </div>
  );
}

export default function BroadcastPanel({ campaigns }: { campaigns: Campaign[] }) {
  const qc = useQueryClient();
  const [channel, setChannel] = useState<'sms' | 'email'>('email');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [tag, setTag] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [customerType, setCustomerType] = useState('');
  const [lastServiceBefore, setLastServiceBefore] = useState('');
  const [lastServiceAfter, setLastServiceAfter] = useState('');
  const [campaignId, setCampaignId] = useState('');
  const [allCustomers, setAllCustomers] = useState(false);
  const [sendMode, setSendMode] = useState<'now' | 'later'>('now');
  const [scheduledFor, setScheduledFor] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [estimatedCount, setEstimatedCount] = useState<number | null>(null);
  const [selectedBroadcastId, setSelectedBroadcastId] = useState<number | null>(null);
  const [historyFilter, setHistoryFilter] = useState<string>('all');
  const [editMode, setEditMode] = useState(false);
  const [editBody, setEditBody] = useState('');
  const [editSubject, setEditSubject] = useState('');
  const [editScheduledFor, setEditScheduledFor] = useState('');
  const [notInterestedId, setNotInterestedId] = useState('');
  const [editNotInterestedId, setEditNotInterestedId] = useState('');

  const filter = {
    ...(allCustomers ? { allCustomers: true } : {
      ...(tag ? { tag } : {}),
      ...(city ? { city } : {}),
      ...(state ? { state } : {}),
      ...(customerType ? { customerType } : {}),
      ...(lastServiceBefore ? { lastServiceBefore } : {}),
      ...(lastServiceAfter ? { lastServiceAfter } : {}),
      ...(campaignId ? { campaignId: parseInt(campaignId, 10) } : {}),
    }),
  };

  const previewMutation = usePreviewBroadcast();
  const sendMutation = useSendBroadcast({
    mutation: {
      onSuccess: (data) => {
        const isScheduled = data.status === 'scheduled';
        const stats = (data as any).stats as { sent?: number; failed?: number } | null;
        if (!isScheduled && stats && (stats.failed ?? 0) > 0 && (stats.sent ?? 0) > 0) {
          toast.warning(`Broadcast partially failed — ${stats.sent} sent, ${stats.failed} failed. Check broadcast history for details.`);
        } else if (!isScheduled && stats && (stats.failed ?? 0) > 0 && (stats.sent ?? 0) === 0) {
          toast.error(`Broadcast failed to send. Check broadcast history for details.`);
        } else {
          toast.success(isScheduled ? 'Broadcast scheduled' : 'Broadcast is sending');
        }
        qc.invalidateQueries({ queryKey: getListBroadcastsQueryKey() });
        setConfirmOpen(false);
        setSubject('');
        setBody('');
        setScheduledFor('');
        setSendMode('now');
      },
      onError: () => toast.error('Failed to send broadcast'),
    },
  });
  const updateMutation = useUpdateBroadcast({
    mutation: {
      onSuccess: (data) => {
        toast.success('Broadcast updated');
        qc.invalidateQueries({ queryKey: getListBroadcastsQueryKey() });
        qc.invalidateQueries({ queryKey: getGetBroadcastQueryKey(data.id) });
        setEditMode(false);
      },
      onError: () => toast.error('Could not update broadcast'),
    },
  });
  const cancelMutation = useCancelBroadcast({
    mutation: {
      onSuccess: () => {
        toast.success('Broadcast cancelled');
        qc.invalidateQueries({ queryKey: getListBroadcastsQueryKey() });
        if (selectedBroadcastId != null) {
          qc.invalidateQueries({ queryKey: getGetBroadcastQueryKey(selectedBroadcastId) });
        }
        setSelectedBroadcastId(null);
      },
      onError: () => toast.error('Could not cancel — broadcast may have already started sending'),
    },
  });

  const { data: history } = useListBroadcasts({ query: { queryKey: getListBroadcastsQueryKey() } });
  const { data: detail } = useGetBroadcast(selectedBroadcastId ?? 0, {
    query: { enabled: selectedBroadcastId != null, queryKey: getGetBroadcastQueryKey(selectedBroadcastId ?? 0) },
  });

  const handlePreview = () => {
    previewMutation.mutate({ data: { channel, filter } }, {
      onSuccess: (data: any) => { if (typeof data?.count === 'number') setEstimatedCount(data.count); },
    });
  };

  const handleSendClick = () => {
    if (!body.trim()) { toast.error('Message body is required'); return; }
    if (channel === 'email' && !subject.trim()) { toast.error('Subject is required for email'); return; }
    if (channel === 'email' && !notInterestedId) { toast.error('Choose a "Not interested right now" destination campaign'); return; }
    if (channel === 'email' && campaignId && notInterestedId === campaignId) { toast.error('Destination campaign must differ from the source campaign'); return; }
    if (sendMode === 'later') {
      if (!scheduledFor) { toast.error('Please pick a date and time to schedule'); return; }
      if (new Date(scheduledFor) <= new Date()) { toast.error('Scheduled time must be in the future'); return; }
    }
    handlePreview();
    setConfirmOpen(true);
  };

  const handleConfirmSend = () => {
    // Close before resetting composer state so the drawer never flashes
    // an immediate-send confirmation after scheduling successfully.
    setConfirmOpen(false);
    sendMutation.mutate({
      data: {
        channel,
        subject: channel === 'email' ? subject : undefined,
        ...(channel === 'email' ? { notInterestedCampaignId: parseInt(notInterestedId, 10) } : {}),
        body,
        filter,
        ...(sendMode === 'later' && scheduledFor ? { scheduledFor: new Date(scheduledFor).toISOString() } : {}),
      },
    });
  };

  // Min datetime for the picker = now + 5 min, formatted for datetime-local input (local time)
  function toDatetimeLocal(d: Date): string {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  const minDateTime = toDatetimeLocal(new Date(Date.now() + 5 * 60 * 1000));

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* Composer */}
        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Send className="w-4 h-4" /> Compose Broadcast
            </CardTitle>
            <CardDescription>Send a one-time SMS or email to a filtered customer segment. Opted-out customers are always excluded.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-2">
              <Button variant={channel === 'email' ? 'default' : 'outline'} size="sm" className="gap-1.5" onClick={() => setChannel('email')}>
                <Mail className="w-3.5 h-3.5" /> Email
              </Button>
              <Button variant={channel === 'sms' ? 'default' : 'outline'} size="sm" className="gap-1.5" onClick={() => setChannel('sms')}>
                <MessageSquare className="w-3.5 h-3.5" /> SMS
              </Button>
            </div>

            {channel === 'email' && (
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Subject</label>
                <Input title="Email subject line for this broadcast" placeholder="e.g. Spring lawn care specials" value={subject} onChange={e => setSubject(e.target.value)} />
              </div>
            )}
            {channel === 'email' && (
              <NotInterestedSelector
                campaigns={campaigns}
                value={notInterestedId}
                onChange={setNotInterestedId}
                sourceCampaignId={!allCustomers && campaignId ? parseInt(campaignId, 10) : null}
              />
            )}
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Message</label>
              <Textarea
                rows={5}
                title={`Broadcast message body — use {{name}} to personalize with the customer's first name`}
                placeholder={`Write your ${channel === 'sms' ? 'text message' : 'email'}... Use {{name}} to personalize with the customer's first name.`}
                value={body}
                onChange={e => setBody(e.target.value)}
              />
            </div>

            <Separator />

            <div className="space-y-1.5">
              <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Target Segment</label>
              <div className="flex items-center gap-2">
                <input type="checkbox" id="all-customers" checked={allCustomers} onChange={e => setAllCustomers(e.target.checked)} className="accent-primary" />
                <label htmlFor="all-customers" className="text-sm">Send to all customers (skip filters)</label>
              </div>
            </div>

            {!allCustomers && estimatedCount !== null && (
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <span className="font-medium text-foreground">{estimatedCount}</span> estimated recipients
              </p>
            )}
            {!allCustomers && (
              <div className="grid grid-cols-2 gap-3">
                <Input title="Filter recipients who have this tag" placeholder="Tag" value={tag} onChange={e => setTag(e.target.value)} />
                <Select value={customerType || 'any'} onValueChange={v => setCustomerType(v === 'any' ? '' : v)}>
                  <SelectTrigger title="Filter recipients by customer type"><SelectValue placeholder="Customer type" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="any">Any customer type</SelectItem>
                    {CUSTOMER_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Input title="Filter recipients in this city" placeholder="City" value={city} onChange={e => setCity(e.target.value)} />
                <Input title="Filter recipients in this state (2-letter code)" placeholder="State (e.g. TX)" value={state} onChange={e => setState(e.target.value)} maxLength={2} />
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">Last service after</label>
                  <Input type="date" title="Only send to customers whose last service was after this date" value={lastServiceAfter} onChange={e => setLastServiceAfter(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">Last service before</label>
                  <Input type="date" title="Only send to customers whose last service was before this date" value={lastServiceBefore} onChange={e => setLastServiceBefore(e.target.value)} />
                </div>
                <Select value={campaignId || 'none'} onValueChange={v => setCampaignId(v === 'none' ? '' : v)}>
                  <SelectTrigger className="col-span-2" title="Only send to recipients enrolled in a specific campaign"><SelectValue placeholder="Campaign membership" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Any campaign</SelectItem>
                    {campaigns.map(c => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}

            <Separator />

            {/* Send timing */}
            <div className="space-y-2">
              <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">When to Send</label>
              <div className="flex gap-2">
                <Button
                  variant={sendMode === 'now' ? 'default' : 'outline'}
                  size="sm"
                  className="gap-1.5"
                  onClick={() => setSendMode('now')}
                >
                  <Send className="w-3.5 h-3.5" /> Send now
                </Button>
                <Button
                  variant={sendMode === 'later' ? 'default' : 'outline'}
                  size="sm"
                  className="gap-1.5"
                  onClick={() => setSendMode('later')}
                >
                  <Clock className="w-3.5 h-3.5" /> Schedule for later
                </Button>
              </div>
              {sendMode === 'later' && (
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">Send date &amp; time</label>
                  <Input
                    type="datetime-local"
                    min={minDateTime}
                    value={scheduledFor}
                    onChange={e => setScheduledFor(e.target.value)}
                    className="w-full"
                  />
                </div>
              )}
            </div>

            <div className="flex items-center justify-between pt-2">
              <Button variant="outline" size="sm" onClick={handlePreview} disabled={previewMutation.isPending} className="gap-1.5">
                {previewMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Users className="w-3.5 h-3.5" />}
                Preview Recipients
              </Button>
              <Button title={sendMode === 'later' ? 'Schedule this broadcast for later delivery' : 'Send this broadcast to all matching recipients now'} onClick={handleSendClick} disabled={sendMutation.isPending}>
                {sendMode === 'later' ? 'Schedule Broadcast' : 'Send Broadcast'}
              </Button>
            </div>

            {previewMutation.data && (
              <div className="rounded-lg border bg-muted/30 p-3 text-sm">
                <p className="font-medium">{previewMutation.data.count} recipient{previewMutation.data.count === 1 ? '' : 's'} match this segment</p>
                {previewMutation.data.sample.length > 0 && (
                  <p className="text-xs text-muted-foreground mt-1">
                    e.g. {previewMutation.data.sample.slice(0, 5).map(s => s.name).join(', ')}
                    {previewMutation.data.count > 5 ? '…' : ''}
                  </p>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* History */}
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between pb-3 flex-wrap gap-2">
            <div>
              <CardTitle className="text-base">Send History</CardTitle>
              <CardDescription>Recent broadcasts and their delivery stats.</CardDescription>
            </div>
            <Select value={historyFilter} onValueChange={setHistoryFilter}>
              <SelectTrigger title="Filter broadcast history by status" className="h-7 text-xs w-32">
                <SelectValue placeholder="All" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all" className="text-xs">All</SelectItem>
                <SelectItem value="completed" className="text-xs">Sent</SelectItem>
                <SelectItem value="scheduled" className="text-xs">Scheduled</SelectItem>
                <SelectItem value="failed" className="text-xs">Failed</SelectItem>
              </SelectContent>
            </Select>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Channel</TableHead>
                  <TableHead className="text-right">Sent</TableHead>
                  <TableHead className="text-right">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(() => { const filtered = (history ?? []).filter(b => historyFilter === 'all' || b.status === historyFilter); return filtered.length === 0 ? (
                  <TableRow><TableCell colSpan={3} className="py-8 text-center text-muted-foreground text-sm">{(history ?? []).length === 0 ? 'No broadcasts sent yet.' : 'No broadcasts match this filter.'}</TableCell></TableRow>
                ) : filtered.map(b => (
                  <TableRow key={b.id} className="cursor-pointer hover:bg-muted/50" onClick={() => setSelectedBroadcastId(b.id)}>
                    <TableCell>
                      <div className="flex items-center gap-1.5 text-sm">
                        {b.channel === 'sms' ? <MessageSquare className="w-3.5 h-3.5" /> : <Mail className="w-3.5 h-3.5" />}
                        {b.recipientCount}
                      </div>
                      <p className="text-xs text-muted-foreground" title={b.status === 'scheduled' && b.scheduledFor ? `Scheduled for ${new Date(b.scheduledFor).toLocaleString()}` : `Created ${new Date(b.createdAt).toLocaleString()}`}>
                        {b.status === 'scheduled' && b.scheduledFor
                          ? <>Scheduled: {format(new Date(b.scheduledFor), 'MMM d, h:mm a')}</>
                          : format(new Date(b.createdAt), 'MMM d, h:mm a')
                        }
                      </p>
                    </TableCell>
                    <TableCell className="text-right text-sm">
                      {b.status === 'scheduled' || b.status === 'cancelled' ? '—' : `${b.stats?.sent ?? 0} / ${b.recipientCount}`}
                    </TableCell>
                    <TableCell className="text-right">
                      <Badge variant={statusBadgeVariant(b.status)} className="text-xs" title={`Broadcast status: ${b.status}`}>
                        {b.status === 'scheduled' && <Clock className="w-3 h-3 mr-1 inline" />}
                        {b.status}
                      </Badge>
                    </TableCell>
                  </TableRow>
                )); })()}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      {/* Confirm send sheet */}
      <Sheet open={confirmOpen} onOpenChange={setConfirmOpen}>
        <SheetContent className="w-full sm:max-w-md">
          <SheetHeader className="pb-4">
            <SheetTitle>Confirm Broadcast</SheetTitle>
            <SheetDescription>
              {sendMode === 'later' && scheduledFor
                ? `This will be queued and sent at ${format(new Date(scheduledFor), 'MMM d, yyyy h:mm a')}. You can cancel it from the history list before it fires.`
                : 'This will send immediately — it cannot be recalled once sent.'
              }
            </SheetDescription>
          </SheetHeader>
          <div className="space-y-3">
            <div className="rounded-lg border bg-muted/30 p-3 text-sm">
              <p><strong>Channel:</strong> {channel.toUpperCase()}</p>
              <p><strong>Recipients:</strong> {previewMutation.data?.count ?? '—'}</p>
              {channel === 'email' && <p><strong>Subject:</strong> {subject}</p>}
              {sendMode === 'later' && scheduledFor && (
                <p><strong>Scheduled for:</strong> {format(new Date(scheduledFor), 'MMM d, yyyy h:mm a')}</p>
              )}
            </div>
            <div className="flex gap-3 justify-end">
              <Button variant="outline" title="Cancel and do not send this broadcast" onClick={() => setConfirmOpen(false)}>Cancel</Button>
              <Button onClick={handleConfirmSend} disabled={sendMutation.isPending}>
                {sendMutation.isPending
                  ? (sendMode === 'later' ? 'Scheduling...' : 'Sending...')
                  : sendMode === 'later'
                    ? 'Confirm Schedule'
                    : `Send to ${previewMutation.data?.count ?? 0}`
                }
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      {/* Broadcast detail sheet */}
      <Sheet open={selectedBroadcastId != null} onOpenChange={open => {
        if (!open) { setSelectedBroadcastId(null); setEditMode(false); }
      }}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          {detail && (
            <>
              <SheetHeader className="pb-4">
                <SheetTitle>{detail.channel === 'sms' ? 'SMS' : 'Email'} Broadcast</SheetTitle>
                <SheetDescription>
                  {detail.status === 'scheduled' && detail.scheduledFor
                    ? `Scheduled to send ${format(new Date(detail.scheduledFor), 'MMM d, yyyy h:mm a')}`
                    : format(new Date(detail.createdAt), 'MMM d, yyyy h:mm a')
                  }
                </SheetDescription>
              </SheetHeader>
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <Badge variant={statusBadgeVariant(detail.status)}>
                    {detail.status === 'scheduled' && <Clock className="w-3 h-3 mr-1 inline" />}
                    {detail.status}
                  </Badge>
                  <div className="flex gap-2">
                    {((['completed', 'failed', 'cancelled'] as string[]).includes(detail.status)) && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-1.5"
                        onClick={() => {
                          setChannel(detail.channel as 'sms' | 'email');
                          setSubject(detail.subject ?? '');
                          setBody(detail.body ?? '');
                          setSelectedBroadcastId(null);
                        }}
                        title="Use as template for a new broadcast"
                      >
                        <Copy className="w-3.5 h-3.5" /> Duplicate
                      </Button>
                    )}
                    {detail.status === 'scheduled' && !editMode && (
                      <>
                        <Button
                          variant="outline"
                          size="sm"
                          className="gap-1.5"
                          onClick={() => {
                            setEditBody(detail.body ?? '');
                            setEditSubject(detail.subject ?? '');
                            setEditNotInterestedId(detail.notInterestedCampaignId != null ? String(detail.notInterestedCampaignId) : '');
                            setEditScheduledFor(
                              detail.scheduledFor
                                ? toDatetimeLocal(new Date(detail.scheduledFor))
                                : ''
                            );
                            setEditMode(true);
                          }}
                        >
                          <Pencil className="w-3.5 h-3.5" /> Edit
                        </Button>
                        <Button
                          variant="destructive"
                          size="sm"
                          title="Cancel this scheduled broadcast — it will not be sent"
                          className="gap-1.5"
                          disabled={cancelMutation.isPending}
                          onClick={() => cancelMutation.mutate({ id: detail.id })}
                        >
                          {cancelMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <X className="w-3.5 h-3.5" />}
                          Cancel
                        </Button>
                      </>
                    )}
                  </div>
                </div>

                {/* Edit form for scheduled broadcasts */}
                {detail.status === 'scheduled' && editMode ? (
                  <div className="space-y-3 rounded-lg border p-4 bg-muted/20">
                    <p className="text-sm font-medium">Edit Broadcast</p>
                    {detail.channel === 'email' && (
                      <div className="space-y-1.5">
                        <label className="text-xs font-medium text-muted-foreground">Subject</label>
                        <Input title="Updated email subject line for this broadcast" value={editSubject} onChange={e => setEditSubject(e.target.value)} placeholder="Subject" />
                      </div>
                    )}
                    {detail.channel === 'email' && (
                      <NotInterestedSelector
                        campaigns={campaigns}
                        value={editNotInterestedId}
                        onChange={setEditNotInterestedId}
                        sourceCampaignId={(detail.recipientFilter as { campaignId?: number } | null | undefined)?.campaignId ?? null}
                      />
                    )}
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-muted-foreground">Message</label>
                      <Textarea
                        rows={5}
                        title="Updated broadcast message body"
                        value={editBody}
                        onChange={e => setEditBody(e.target.value)}
                        placeholder="Message body"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-muted-foreground">Send date &amp; time</label>
                      <Input
                        type="datetime-local"
                        title="Updated date and time to send this broadcast"
                        min={minDateTime}
                        value={editScheduledFor}
                        onChange={e => setEditScheduledFor(e.target.value)}
                      />
                    </div>
                    <div className="flex gap-2 justify-end">
                      <Button variant="outline" size="sm" onClick={() => setEditMode(false)}>
                        Discard
                      </Button>
                      <Button
                        size="sm"
                        className="gap-1.5"
                        disabled={updateMutation.isPending}
                        onClick={() => {
                          if (!editBody.trim()) { toast.error('Message body is required'); return; }
                          if (detail.channel === 'email' && !editNotInterestedId) { toast.error('Choose a "Not interested right now" destination campaign'); return; }
                          const srcId = (detail.recipientFilter as { campaignId?: number } | null | undefined)?.campaignId;
                          if (detail.channel === 'email' && srcId != null && Number(editNotInterestedId) === srcId) { toast.error('Destination campaign must differ from the source campaign'); return; }
                          if (editScheduledFor && new Date(editScheduledFor) <= new Date()) {
                            toast.error('Scheduled time must be in the future'); return;
                          }
                          updateMutation.mutate({
                            id: detail.id,
                            data: {
                              body: editBody,
                              ...(detail.channel === 'email' ? { subject: editSubject, notInterestedCampaignId: parseInt(editNotInterestedId, 10) } : {}),
                              ...(editScheduledFor ? { scheduledFor: new Date(editScheduledFor).toISOString() } : {}),
                            },
                          });
                        }}
                      >
                        {updateMutation.isPending
                          ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          : <Check className="w-3.5 h-3.5" />}
                        Save Changes
                      </Button>
                    </div>
                  </div>
                ) : (
                  <>
                    {detail.status !== 'scheduled' && detail.status !== 'cancelled' && (
                      <>
                        <div className="grid grid-cols-3 gap-3 text-center">
                          <div className="p-3 bg-muted/40 rounded-lg"><p className="text-lg font-bold">{detail.recipientCount}</p><p className="text-xs text-muted-foreground">Targeted</p></div>
                          <div className="p-3 bg-emerald-50 dark:bg-emerald-950/20 rounded-lg"><p className="text-lg font-bold text-emerald-700">{detail.stats?.sent ?? 0}</p><p className="text-xs text-muted-foreground">Sent</p></div>
                          <div className="p-3 bg-red-50 dark:bg-red-950/20 rounded-lg"><p className="text-lg font-bold text-red-600">{detail.stats?.failed ?? 0}</p><p className="text-xs text-muted-foreground">Failed</p></div>
                        </div>
                        {(detail.stats?.failed ?? 0) > 0 && (detail.stats?.sent ?? 0) > 0 && (
                          <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800 px-3 py-2 text-sm text-amber-800 dark:text-amber-300">
                            <span className="text-amber-500">⚠</span>
                            <span>Broadcast partially failed — {detail.stats!.failed} of {detail.recipientCount} recipients were not reached. Check provider settings or recipient contact info.</span>
                          </div>
                        )}
                        {(detail.stats?.failed ?? 0) > 0 && (detail.stats?.sent ?? 0) === 0 && (
                          <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 dark:bg-red-950/20 dark:border-red-800 px-3 py-2 text-sm text-red-800 dark:text-red-300">
                            <span>⛔</span>
                            <span>Broadcast failed entirely — no messages were delivered. Check your messaging provider configuration.</span>
                          </div>
                        )}
                      </>
                    )}

                    {detail.status === 'scheduled' && (
                      <div className="rounded-lg border bg-muted/30 p-3 text-sm text-muted-foreground">
                        <p><strong>Recipients at send time:</strong> {detail.recipientCount} (opt-outs re-checked when sent)</p>
                      </div>
                    )}

                    {detail.subject && <p className="text-sm"><strong>Subject:</strong> {detail.subject}</p>}
                    <p className="text-sm whitespace-pre-wrap border rounded-lg p-3 bg-muted/20">{detail.body}</p>

                    {(detail.recipients ?? []).length > 0 && (
                      <div className="rounded-lg border divide-y max-h-64 overflow-y-auto">
                        {(detail.recipients ?? []).map(r => (
                          <div key={r.id} className="flex items-center justify-between px-3 py-2 text-sm">
                            <span>{r.customerName}</span>
                            <Badge variant={r.status === 'sent' ? 'secondary' : 'destructive'} className="text-xs">{r.status}</Badge>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
