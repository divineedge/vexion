import React, { useState } from 'react';
import { useListQuoCalls, useCreateTaskFromQuoCall, getListQuoCallsQueryKey } from '@workspace/api-client-react';
import type { QuoCall } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { PhoneIncoming, PhoneOutgoing, PhoneMissed, Voicemail, ListPlus, Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';

function statusMeta(status: string, direction: string) {
  if (status === 'voicemail') return { label: 'Voicemail', icon: Voicemail, className: 'bg-amber-50 text-amber-700 border-amber-200' };
  if (['no-answer', 'busy', 'failed', 'missed'].includes(status)) {
    return { label: 'Missed', icon: PhoneMissed, className: 'bg-red-50 text-red-700 border-red-200' };
  }
  return direction === 'outgoing'
    ? { label: 'Outgoing', icon: PhoneOutgoing, className: 'bg-slate-50 text-slate-700 border-slate-200' }
    : { label: 'Completed', icon: PhoneIncoming, className: 'bg-emerald-50 text-emerald-700 border-emerald-200' };
}

function formatDuration(seconds: number | null) {
  if (!seconds) return '—';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export default function CallsPage() {
  const qc = useQueryClient();
  const [creatingId, setCreatingId] = useState<string | null>(null);
  const [callSearch, setCallSearch] = useState('');

  const { data: calls, isLoading, error } = useListQuoCalls({
    query: { queryKey: getListQuoCallsQueryKey(), refetchInterval: 60000 },
  });

  const createTaskMutation = useCreateTaskFromQuoCall();

  const handleCreateTask = (call: QuoCall) => {
    setCreatingId(call.id);
    createTaskMutation.mutate({ callId: call.id, data: {} }, {
      onSuccess: () => {
        toast.success('Task created from call');
        qc.invalidateQueries({ queryKey: getListQuoCallsQueryKey() });
      },
      onError: () => toast.error('Failed to create task'),
      onSettled: () => setCreatingId(null),
    });
  };

  const notConfigured = (error as { status?: number } | undefined)?.status === 400;

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Calls</h1>
        <p className="text-muted-foreground mt-1">
          Recent calls from your connected Quo phone number. Turn a missed call or voicemail into a task in one click.
        </p>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-3">
            <CardTitle className="text-base flex items-center gap-2">
              <PhoneIncoming className="w-4 h-4" /> Recent Calls
              {calls && <Badge variant="secondary" className="ml-1">{calls.length}</Badge>}
            </CardTitle>
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
              <Input value={callSearch} onChange={e => setCallSearch(e.target.value)} placeholder="Search…" className="h-8 text-sm pl-7 w-44" />
            </div>
          </div>
          {notConfigured && (
            <CardDescription className="text-amber-700">
              Connect Quo under Settings → SMS Provider to see calls here.
            </CardDescription>
          )}
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-muted-foreground py-10 text-center">Loading calls…</p>
          ) : notConfigured ? (
            <p className="text-sm text-muted-foreground py-10 text-center">
              No phone platform connected yet.
            </p>
          ) : !calls || calls.length === 0 ? (
            <p className="text-sm text-muted-foreground py-10 text-center">No calls yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Contact</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Duration</TableHead>
                  <TableHead>When</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(callSearch.trim()
                  ? calls.filter(c =>
                      (c.customerName ?? '').toLowerCase().includes(callSearch.toLowerCase()) ||
                      (c.participants ?? []).some(p => p.toLowerCase().includes(callSearch.toLowerCase())),
                    )
                  : calls
                ).map(call => {
                  const meta = statusMeta(call.status, call.direction);
                  const Icon = meta.icon;
                  return (
                    <TableRow key={call.id}>
                      <TableCell className="font-medium">
                        {call.customerName ?? (call.participants ?? [])[0] ?? 'Unknown'}
                        {call.customerName && (
                          <div className="text-xs text-muted-foreground font-normal">{(call.participants ?? [])[0]}</div>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={`gap-1 ${meta.className}`}>
                          <Icon className="w-3.5 h-3.5" /> {meta.label}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">{formatDuration(call.duration ?? null)}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{new Date(call.createdAt).toLocaleString()}</TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          variant="outline"
                          className="gap-1.5"
                          disabled={creatingId === call.id}
                          onClick={() => handleCreateTask(call)}
                        >
                          <ListPlus className="w-3.5 h-3.5" /> {creatingId === call.id ? 'Creating…' : 'Create Task'}
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
    </div>
  );
}
