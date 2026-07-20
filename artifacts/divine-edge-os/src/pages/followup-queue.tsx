import React, { useMemo, useState } from 'react';
import {
  useListFollowupQueueItems, getListFollowupQueueItemsQueryKey,
  useGetFollowupQueueItemContext, getGetFollowupQueueItemContextQueryKey,
  useResolveFollowupQueueItem,
  useAssignFollowupQueueItem,
  useListUsers, getListUsersQueryKey,
  type FollowupQueueItem,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Separator } from '@/components/ui/separator';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ListChecks, Phone, Mail, Voicemail, FileText, PhoneMissed, CheckCircle2, Clock, UserCircle2 } from 'lucide-react';
import { toast } from 'sonner';

const TRIGGER_META: Record<string, { label: string; icon: React.ElementType }> = {
  sent_estimate: { label: 'Estimate sent', icon: FileText },
  sent_invoice: { label: 'Invoice sent', icon: FileText },
  unanswered_email: { label: 'Unanswered email', icon: Mail },
  missed_call: { label: 'Missed call', icon: PhoneMissed },
  voicemail: { label: 'Voicemail', icon: Voicemail },
};

function triggerLabel(t: string) {
  return TRIGGER_META[t]?.label ?? t;
}

function priorityBadgeClass(p: string) {
  if (p === 'high') return 'bg-red-50 text-red-700 border-red-200';
  if (p === 'medium') return 'bg-amber-50 text-amber-700 border-amber-200';
  return 'bg-slate-50 text-slate-700 border-slate-200';
}

export default function FollowupQueuePage() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const [triggerFilter, setTriggerFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<'open' | 'resolved'>('open');
  const [assigneeFilter, setAssigneeFilter] = useState<'all' | 'me'>('all');
  const [selected, setSelected] = useState<FollowupQueueItem | null>(null);

  const params = {
    ...(triggerFilter !== 'all' ? { triggerType: triggerFilter } : {}),
    status: statusFilter,
    ...(assigneeFilter === 'me' ? { assignedToUserId: 'me' } : {}),
  };

  const { data: items = [] } = useListFollowupQueueItems(params, {
    query: { queryKey: getListFollowupQueueItemsQueryKey(params), refetchInterval: 60000 },
  });

  const { data: users = [] } = useListUsers({ query: { queryKey: getListUsersQueryKey() } });

  const sorted = useMemo(() => [...items].sort((a, b) => b.ageDays - a.ageDays), [items]);

  const handleAssigned = (item: FollowupQueueItem) => {
    // Refresh selected item if it's the one being updated
    if (selected?.id === item.id) setSelected(item);
    qc.invalidateQueries({ queryKey: getListFollowupQueueItemsQueryKey(params) });
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Follow-Up Queue</h1>
          <p className="text-muted-foreground mt-1">
            Every sent estimate, unpaid invoice, unanswered email, missed call, and voicemail that needs a human follow-up — nothing here disappears until it's resolved.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Select value={assigneeFilter} onValueChange={v => setAssigneeFilter(v as 'all' | 'me')}>
            <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All follow-ups</SelectItem>
              <SelectItem value="me">My follow-ups</SelectItem>
            </SelectContent>
          </Select>
          <Select value={triggerFilter} onValueChange={setTriggerFilter}>
            <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All trigger types</SelectItem>
              {Object.entries(TRIGGER_META).map(([value, { label }]) => (
                <SelectItem key={value} value={value}>{label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={v => setStatusFilter(v as 'open' | 'resolved')}>
            <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="open">Open</SelectItem>
              <SelectItem value="resolved">Resolved</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <ListChecks className="w-4 h-4" /> {statusFilter === 'open' ? 'Open' : 'Resolved'} Items
            <Badge variant="secondary" className="ml-1">{sorted.length}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {sorted.length === 0 ? (
            <p className="text-sm text-muted-foreground py-10 text-center">
              {statusFilter === 'open' ? 'Nothing needs follow-up right now.' : 'No resolved items yet.'}
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Customer</TableHead>
                  <TableHead>Trigger</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead>Priority</TableHead>
                  <TableHead>Assigned to</TableHead>
                  <TableHead>Age</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sorted.map(item => {
                  const meta = TRIGGER_META[item.triggerType];
                  const Icon = meta?.icon ?? ListChecks;
                  return (
                    <TableRow key={item.id} className="cursor-pointer hover:bg-muted/40" onClick={() => setSelected(item)}>
                      <TableCell className="font-medium">{item.customerName ?? '—'}</TableCell>
                      <TableCell>
                        <span className="inline-flex items-center gap-1.5 text-sm">
                          <Icon className="w-3.5 h-3.5 text-muted-foreground" /> {triggerLabel(item.triggerType)}
                        </span>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground max-w-xs truncate">{item.reason}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={priorityBadgeClass(item.priority) + ' text-[10px]'}>{item.priority}</Badge>
                      </TableCell>
                      <TableCell onClick={e => e.stopPropagation()}>
                        <InlineAssignSelect
                          item={item}
                          users={users}
                          currentUserId={user?.id}
                          onAssigned={handleAssigned}
                        />
                      </TableCell>
                      <TableCell>
                        <span className="inline-flex items-center gap-1 text-sm">
                          <Clock className="w-3.5 h-3.5 text-muted-foreground" /> {item.ageDays}d
                        </span>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); setSelected(item); }}>
                          {item.status === 'open' ? 'Handle' : 'View'}
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <FollowupDrawer
        item={selected}
        users={users}
        currentUserId={user?.id}
        onOpenChange={(o) => { if (!o) setSelected(null); }}
        onAssigned={handleAssigned}
        onResolved={() => {
          setSelected(null);
          qc.invalidateQueries({ queryKey: getListFollowupQueueItemsQueryKey(params) });
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inline assign select — used in the table row
// ---------------------------------------------------------------------------
type User = { id: number; name: string };

function InlineAssignSelect({
  item, users, currentUserId, onAssigned,
}: {
  item: FollowupQueueItem;
  users: User[];
  currentUserId?: number;
  onAssigned: (item: FollowupQueueItem) => void;
}) {
  const assignMutation = useAssignFollowupQueueItem();

  const value = item.assignedToUserId != null ? String(item.assignedToUserId) : 'unassigned';

  const handleChange = (val: string) => {
    const assignedToUserId = val === 'unassigned' ? null : parseInt(val, 10);
    assignMutation.mutate(
      { id: item.id, data: { assignedToUserId } },
      {
        onSuccess: (updated) => {
          toast.success(assignedToUserId ? 'Assigned' : 'Unassigned');
          onAssigned(updated);
        },
        onError: () => toast.error('Failed to update assignment'),
      },
    );
  };

  return (
    <Select value={value} onValueChange={handleChange} disabled={assignMutation.isPending}>
      <SelectTrigger className="w-[140px] h-7 text-xs border-dashed">
        <SelectValue placeholder="Unassigned">
          {value === 'unassigned' ? (
            <span className="text-muted-foreground flex items-center gap-1"><UserCircle2 className="w-3 h-3" /> Unassigned</span>
          ) : (
            <span className="flex items-center gap-1"><UserCircle2 className="w-3 h-3" />{item.assignedToUserName ?? '...'}</span>
          )}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="unassigned">Unassigned</SelectItem>
        {currentUserId && !users.find(u => u.id === currentUserId) ? null : null}
        {users.map(u => (
          <SelectItem key={u.id} value={String(u.id)}>
            {u.name}{u.id === currentUserId ? ' (me)' : ''}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

// ---------------------------------------------------------------------------
// Drawer
// ---------------------------------------------------------------------------
function FollowupDrawer({
  item, users, currentUserId, onOpenChange, onAssigned, onResolved,
}: {
  item: FollowupQueueItem | null;
  users: User[];
  currentUserId?: number;
  onOpenChange: (o: boolean) => void;
  onAssigned: (item: FollowupQueueItem) => void;
  onResolved: () => void;
}) {
  const [note, setNote] = useState('');
  const resolveMutation = useResolveFollowupQueueItem();
  const assignMutation = useAssignFollowupQueueItem();

  const { data: context } = useGetFollowupQueueItemContext(item?.id ?? 0, {
    query: { queryKey: getGetFollowupQueueItemContextQueryKey(item?.id ?? 0), enabled: !!item },
  });

  React.useEffect(() => { setNote(''); }, [item?.id]);

  const handleResolve = () => {
    if (!item) return;
    if (!note.trim()) { toast.error('Log a communication note before resolving'); return; }
    resolveMutation.mutate({ id: item.id, data: { note } }, {
      onSuccess: () => { toast.success('Follow-up resolved'); onResolved(); },
      onError: () => toast.error('Failed to resolve follow-up'),
    });
  };

  const handleAssign = (val: string) => {
    if (!item) return;
    const assignedToUserId = val === 'unassigned' ? null : parseInt(val, 10);
    assignMutation.mutate(
      { id: item.id, data: { assignedToUserId } },
      {
        onSuccess: (updated) => {
          toast.success(assignedToUserId ? 'Assigned' : 'Unassigned');
          onAssigned(updated);
        },
        onError: () => toast.error('Failed to update assignment'),
      },
    );
  };

  const assignedValue = item?.assignedToUserId != null ? String(item.assignedToUserId) : 'unassigned';

  return (
    <Sheet open={!!item} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
        {item && (
          <>
            <SheetHeader className="pb-4">
              <SheetTitle>{context?.customer?.name ?? item.customerName ?? 'Customer'}</SheetTitle>
              <SheetDescription>{item.reason}</SheetDescription>
            </SheetHeader>

            <div className="space-y-6 pb-8">
              {/* Assign to */}
              <div className="space-y-1.5">
                <h4 className="text-sm font-semibold flex items-center gap-1.5"><UserCircle2 className="w-4 h-4" /> Assigned to</h4>
                <Select value={assignedValue} onValueChange={handleAssign} disabled={assignMutation.isPending || item.status === 'resolved'}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Unassigned" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="unassigned">Unassigned</SelectItem>
                    {users.map(u => (
                      <SelectItem key={u.id} value={String(u.id)}>
                        {u.name}{u.id === currentUserId ? ' (me)' : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <Separator />

              {context?.customer && (
                <div className="flex flex-wrap gap-2">
                  {context.customer.phone && (
                    <a href={`tel:${context.customer.phone}`}>
                      <Button size="sm" variant="outline" className="gap-1.5"><Phone className="w-3.5 h-3.5" /> Call {context.customer.phone}</Button>
                    </a>
                  )}
                  {context.customer.email && !context.customer.emailOptOut && (
                    <a href={`mailto:${context.customer.email}`}>
                      <Button size="sm" variant="outline" className="gap-1.5"><Mail className="w-3.5 h-3.5" /> Email</Button>
                    </a>
                  )}
                </div>
              )}

              <div className="space-y-2">
                <h4 className="text-sm font-semibold">Contact History</h4>
                {(!context?.contactHistory || context.contactHistory.length === 0) && (
                  <p className="text-sm text-muted-foreground">No prior communications on file.</p>
                )}
                <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                  {context?.contactHistory.map(h => (
                    <div key={h.id} className="text-sm border rounded-md p-2">
                      <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
                        <span className="capitalize">{h.direction} · {h.channel}</span>
                        <span>{new Date(h.createdAt).toLocaleString()}</span>
                      </div>
                      <p className="truncate">{h.body}</p>
                    </div>
                  ))}
                </div>
              </div>

              <Separator />

              <div className="space-y-2">
                <h4 className="text-sm font-semibold">Open Estimates</h4>
                {(!context?.openEstimates || context.openEstimates.length === 0) ? (
                  <p className="text-sm text-muted-foreground">None.</p>
                ) : (
                  <div className="space-y-1.5">
                    {context.openEstimates.map(e => (
                      <div key={e.id} className="flex items-center justify-between text-sm border rounded-md p-2">
                        <span>Estimate #{e.id} · {e.status}</span>
                        <span className="font-medium">${(e.total ?? 0).toLocaleString()}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <h4 className="text-sm font-semibold">Closed Estimates</h4>
                {(!context?.closedEstimates || context.closedEstimates.length === 0) ? (
                  <p className="text-sm text-muted-foreground">None.</p>
                ) : (
                  <div className="space-y-1.5">
                    {context.closedEstimates.map(e => (
                      <div key={e.id} className="flex items-center justify-between text-sm border rounded-md p-2">
                        <span>Estimate #{e.id} · {e.status}</span>
                        <span className="font-medium">${(e.total ?? 0).toLocaleString()}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {context?.invoices && context.invoices.length > 0 && (
                <div className="space-y-2">
                  <h4 className="text-sm font-semibold">Invoices</h4>
                  <div className="space-y-1.5">
                    {context.invoices.map(inv => (
                      <div key={inv.id} className="flex items-center justify-between text-sm border rounded-md p-2">
                        <span>{inv.invoiceNumber} · {inv.status}</span>
                        <span className="font-medium">${(inv.total ?? 0).toLocaleString()}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {item.status === 'open' ? (
                <>
                  <Separator />
                  <div className="space-y-2">
                    <h4 className="text-sm font-semibold">Log Communication & Resolve</h4>
                    <Textarea
                      rows={3}
                      placeholder="What happened? e.g. 'Called and left a message, will follow up Friday.'"
                      value={note}
                      onChange={e => setNote(e.target.value)}
                    />
                    <Button onClick={handleResolve} disabled={resolveMutation.isPending} className="gap-1.5 w-full">
                      <CheckCircle2 className="w-4 h-4" /> {resolveMutation.isPending ? 'Resolving…' : 'Mark Resolved'}
                    </Button>
                  </div>
                </>
              ) : (
                <>
                  <Separator />
                  <div className="space-y-1.5">
                    <h4 className="text-sm font-semibold">Resolution Note</h4>
                    <p className="text-sm text-muted-foreground">{item.communicationNote}</p>
                    <p className="text-xs text-muted-foreground">Resolved {item.resolvedAt ? new Date(item.resolvedAt).toLocaleString() : ''}</p>
                  </div>
                </>
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
