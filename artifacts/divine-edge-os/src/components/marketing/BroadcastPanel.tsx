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
import { MessageSquare, Mail, Users, Send, Loader2, Clock, X, Pencil, Check } from 'lucide-react';
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
  const [selectedBroadcastId, setSelectedBroadcastId] = useState<number | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [editBody, setEditBody] = useState('');
  const [editSubject, setEditSubject] = useState('');
  const [editScheduledFor, setEditScheduledFor] = useState('');

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
        toast.success(isScheduled ? 'Broadcast scheduled' : 'Broadcast is sending');
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
    previewMutation.mutate({ data: { channel, filter } });
  };

  const handleSendClick = () => {
    if (!body.trim()) { toast.error('Message body is required'); return; }
    if (channel === 'email' && !subject.trim()) { toast.error('Subject is required for email'); return; }
    if (sendMode === 'later') {
      if (!scheduledFor) { toast.error('Please pick a date and time to schedule'); return; }
      if (new Date(scheduledFor) <= new Date()) { toast.error('Scheduled time must be in the future'); return; }
    }
    handlePreview();
    setConfirmOpen(true);
  };

  const handleConfirmSend = () => {
    sendMutation.mutate({
      data: {
        channel,
        subject: channel === 'email' ? subject : undefined,
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
                <Input placeholder="e.g. Spring lawn care specials" value={subject} onChange={e => setSubject(e.target.value)} />
              </div>
            )}
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Message</label>
              <Textarea
                rows={5}
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

            {!allCustomers && (
              <div className="grid grid-cols-2 gap-3">
                <Input placeholder="Tag" value={tag} onChange={e => setTag(e.target.value)} />
                <Select value={customerType || 'any'} onValueChange={v => setCustomerType(v === 'any' ? '' : v)}>
                  <SelectTrigger><SelectValue placeholder="Customer type" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="any">Any customer type</SelectItem>
                    {CUSTOMER_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Input placeholder="City" value={city} onChange={e => setCity(e.target.value)} />
                <Input placeholder="State (e.g. TX)" value={state} onChange={e => setState(e.target.value)} maxLength={2} />
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">Last service after</label>
                  <Input type="date" value={lastServiceAfter} onChange={e => setLastServiceAfter(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">Last service before</label>
                  <Input type="date" value={lastServiceBefore} onChange={e => setLastServiceBefore(e.target.value)} />
                </div>
                <Select value={campaignId || 'none'} onValueChange={v => setCampaignId(v === 'none' ? '' : v)}>
                  <SelectTrigger className="col-span-2"><SelectValue placeholder="Campaign membership" /></SelectTrigger>
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
              <Button onClick={handleSendClick} disabled={sendMutation.isPending}>
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
          <CardHeader>
            <CardTitle className="text-base">Send History</CardTitle>
            <CardDescription>Recent broadcasts and their delivery stats.</CardDescription>
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
                {(history ?? []).length === 0 ? (
                  <TableRow><TableCell colSpan={3} className="py-8 text-center text-muted-foreground text-sm">No broadcasts sent yet.</TableCell></TableRow>
                ) : (history ?? []).map(b => (
                  <TableRow key={b.id} className="cursor-pointer hover:bg-muted/50" onClick={() => setSelectedBroadcastId(b.id)}>
                    <TableCell>
                      <div className="flex items-center gap-1.5 text-sm">
                        {b.channel === 'sms' ? <MessageSquare className="w-3.5 h-3.5" /> : <Mail className="w-3.5 h-3.5" />}
                        {b.recipientCount}
                      </div>
                      <p className="text-xs text-muted-foreground">
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
                      <Badge variant={statusBadgeVariant(b.status)} className="text-xs">
                        {b.status === 'scheduled' && <Clock className="w-3 h-3 mr-1 inline" />}
                        {b.status}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
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
              <Button variant="outline" onClick={() => setConfirmOpen(false)}>Cancel</Button>
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
                  {detail.status === 'scheduled' && !editMode && (
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-1.5"
                        onClick={() => {
                          setEditBody(detail.body ?? '');
                          setEditSubject(detail.subject ?? '');
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
                        className="gap-1.5"
                        disabled={cancelMutation.isPending}
                        onClick={() => cancelMutation.mutate({ id: detail.id })}
                      >
                        {cancelMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <X className="w-3.5 h-3.5" />}
                        Cancel
                      </Button>
                    </div>
                  )}
                </div>

                {/* Edit form for scheduled broadcasts */}
                {detail.status === 'scheduled' && editMode ? (
                  <div className="space-y-3 rounded-lg border p-4 bg-muted/20">
                    <p className="text-sm font-medium">Edit Broadcast</p>
                    {detail.channel === 'email' && (
                      <div className="space-y-1.5">
                        <label className="text-xs font-medium text-muted-foreground">Subject</label>
                        <Input value={editSubject} onChange={e => setEditSubject(e.target.value)} placeholder="Subject" />
                      </div>
                    )}
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-muted-foreground">Message</label>
                      <Textarea
                        rows={5}
                        value={editBody}
                        onChange={e => setEditBody(e.target.value)}
                        placeholder="Message body"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-muted-foreground">Send date &amp; time</label>
                      <Input
                        type="datetime-local"
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
                          if (editScheduledFor && new Date(editScheduledFor) <= new Date()) {
                            toast.error('Scheduled time must be in the future'); return;
                          }
                          updateMutation.mutate({
                            id: detail.id,
                            data: {
                              body: editBody,
                              ...(detail.channel === 'email' ? { subject: editSubject } : {}),
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
                      <div className="grid grid-cols-3 gap-3 text-center">
                        <div className="p-3 bg-muted/40 rounded-lg"><p className="text-lg font-bold">{detail.recipientCount}</p><p className="text-xs text-muted-foreground">Targeted</p></div>
                        <div className="p-3 bg-emerald-50 dark:bg-emerald-950/20 rounded-lg"><p className="text-lg font-bold text-emerald-700">{detail.stats?.sent ?? 0}</p><p className="text-xs text-muted-foreground">Sent</p></div>
                        <div className="p-3 bg-red-50 dark:bg-red-950/20 rounded-lg"><p className="text-lg font-bold text-red-600">{detail.stats?.failed ?? 0}</p><p className="text-xs text-muted-foreground">Failed</p></div>
                      </div>
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
