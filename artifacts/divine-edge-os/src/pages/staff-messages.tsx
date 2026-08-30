import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  createStaffConversationMessage,
  getGetStaffMessagesUnreadSummaryQueryKey,
  getListStaffConversationMessagesQueryKey,
  getListStaffMessageAudiencesQueryKey,
  getListStaffMessageThreadsQueryKey,
  getListStaffMessagesQueryKey,
  listStaffConversationMessages,
  listStaffMessages,
  sendStaffMessageToAudience,
  useGetStaffMessagesUnreadSummary,
  useListStaffConversationMessages,
  useListStaffMessageAudiences,
  useListStaffMessageThreads,
  useListStaffMessages,
  type StaffMessage,
  type StaffMessageAudience,
  type StaffMessageThreadSummary,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { MessageSquare, Send, Users, RefreshCw, Inbox } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { hasEarlierMessagePage, mergeMessagePages, messageBeforeId } from '@/lib/messagePagination';
import { StaffAudiencePicker } from '@/components/StaffAudiencePicker';

const PAGE_SIZE = 100;
const audienceKey = (type: string, id: number | null | undefined) => `${type}:${id ?? 'all'}`;

export default function StaffMessagesPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<StaffMessageThreadSummary | null>(null);
  const [newAudience, setNewAudience] = useState<StaffMessageAudience | null>(null);
  const [draft, setDraft] = useState('');
  const [olderPages, setOlderPages] = useState<StaffMessage[][]>([]);
  const [newestHistory, setNewestHistory] = useState<StaffMessage[]>([]);
  const [earlierLoading, setEarlierLoading] = useState(false);
  const [earlierError, setEarlierError] = useState('');
  const [sending, setSending] = useState(false);

  const threadsQuery = useListStaffMessageThreads({ query: { queryKey: getListStaffMessageThreadsQueryKey(), refetchInterval: 30000 } });
  const audiencesQuery = useListStaffMessageAudiences({ query: { queryKey: getListStaffMessageAudiencesQueryKey(), staleTime: 30000 } });
  const { data: unreadSummary } = useGetStaffMessagesUnreadSummary({ query: { queryKey: getGetStaffMessagesUnreadSummaryQueryKey(), refetchInterval: 30000 } });
  const threads = threadsQuery.data ?? [];
  const audiences = audiencesQuery.data ?? [];
  const conversationId = selected?.conversationId ?? null;
  const legacyThreadId = selected && !conversationId ? selected.threadUserId : null;
  const params = { limit: PAGE_SIZE };
  const legacyQuery = useListStaffMessages(legacyThreadId ?? 0, params, {
    query: { queryKey: getListStaffMessagesQueryKey(legacyThreadId ?? 0, params), enabled: legacyThreadId != null, refetchInterval: legacyThreadId != null ? 30000 : false },
  });
  const conversationQuery = useListStaffConversationMessages(conversationId ?? 0, params, {
    query: { queryKey: getListStaffConversationMessagesQueryKey(conversationId ?? 0, params), enabled: conversationId != null, refetchInterval: conversationId != null ? 30000 : false },
  });
  const activeQuery = conversationId ? conversationQuery : legacyQuery;
  const newestMessages = (newAudience ? [] : activeQuery.data ?? []) as StaffMessage[];
  const allMessages = useMemo(
    () => mergeMessagePages(newestMessages, [...olderPages, newestHistory]),
    [newestMessages, olderPages, newestHistory],
  );
  const canLoadEarlier = hasEarlierMessagePage(newestMessages, olderPages, PAGE_SIZE);
  const selectedTitle = newAudience?.label ?? selected?.threadUserName ?? '';

  useEffect(() => {
    if (newestMessages.length) setNewestHistory(current => mergeMessagePages(newestMessages, [current]));
  }, [newestMessages]);

  useEffect(() => {
    setOlderPages([]);
    setNewestHistory([]);
    setEarlierError('');
    setDraft('');
  }, [conversationId, legacyThreadId, newAudience]);

  const refreshSummaries = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: getListStaffMessageThreadsQueryKey() }),
      queryClient.invalidateQueries({ queryKey: getGetStaffMessagesUnreadSummaryQueryKey() }),
    ]);
  }, [queryClient]);

  const chooseAudience = useCallback((key: string) => {
    const audience = audiences.find(item => audienceKey(item.audienceType, item.audienceId) === key);
    if (!audience) return;
    if (!audience.canSend) {
      toast.error('Only owners and managers can send company-wide messages.');
      return;
    }
    const matches = threads.filter(thread =>
      thread.audienceType === audience.audienceType && (thread.audienceId ?? null) === audience.audienceId,
    );
    const existing = matches.find(thread => thread.isSharedAudience) ?? matches[0];
    setSelected(existing ?? null);
    setNewAudience(existing ? null : audience);
  }, [audiences, threads]);

  const loadEarlier = useCallback(async () => {
    const beforeId = messageBeforeId(allMessages);
    if (!beforeId || earlierLoading || (!conversationId && !legacyThreadId)) return;
    setEarlierLoading(true);
    setEarlierError('');
    try {
      const page = conversationId
        ? await listStaffConversationMessages(conversationId, { limit: PAGE_SIZE, beforeId })
        : await listStaffMessages(legacyThreadId!, { limit: PAGE_SIZE, beforeId });
      setOlderPages(current => [...current, page]);
      await refreshSummaries();
    } catch {
      setEarlierError('Could not load earlier messages.');
    } finally {
      setEarlierLoading(false);
    }
  }, [allMessages, conversationId, earlierLoading, legacyThreadId, refreshSummaries]);

  const send = useCallback(async () => {
    const body = draft.trim();
    if (!body || sending || (!selected && !newAudience)) return;
    setSending(true);
    try {
      const clientMessageId = crypto.randomUUID();
      let message: StaffMessage;
      if (newAudience) {
        message = await sendStaffMessageToAudience({
          audienceType: newAudience.audienceType,
          audienceId: newAudience.audienceId,
          body,
          clientMessageId,
        });
      } else if (conversationId) {
        message = await createStaffConversationMessage(conversationId, { body, clientMessageId });
      } else {
        const { createStaffMessage } = await import('@workspace/api-client-react');
        message = await createStaffMessage(legacyThreadId!, { body, clientMessageId });
      }
      setDraft('');
      setNewestHistory(current => mergeMessagePages([message], [current]));
      await refreshSummaries();
      const refreshed = await threadsQuery.refetch();
      const next = refreshed.data?.find(thread => thread.conversationId === message.conversationId)
        ?? refreshed.data?.find(thread => thread.threadUserId === message.threadUserId && !message.conversationId);
      if (next) { setSelected(next); setNewAudience(null); }
    } catch {
      toast.error('Could not send message. Please try again.');
    } finally {
      setSending(false);
    }
  }, [conversationId, draft, legacyThreadId, newAudience, refreshSummaries, selected, sending, threadsQuery]);

  const selectedAudience = newAudience
    ?? (selected
      ? audiences.find(item =>
        item.audienceType === selected.audienceType
        && (item.audienceId ?? null) === (selected.audienceId ?? null),
      ) ?? null
      : null);

  return (
    <div className="h-[calc(100vh-8rem)] min-h-[560px] flex flex-col gap-5 animate-in fade-in duration-500">
      <div className="flex items-center justify-between gap-4 shrink-0">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-primary/10 p-2.5"><MessageSquare className="w-6 h-6 text-primary" /></div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Staff Messages</h1>
            <p className="text-sm text-muted-foreground">Reach a person, crew, division, or the whole team.</p>
          </div>
        </div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Users className="w-4 h-4" /><span>{threads.length} conversations</span>
          {!!unreadSummary?.total && <Badge>{unreadSummary.total} unread</Badge>}
        </div>
      </div>

      <Card className="flex-1 min-h-0 overflow-hidden">
        <div className="grid grid-cols-[280px_minmax(0,1fr)] h-full">
          <aside className="border-r bg-muted/10 min-h-0 flex flex-col">
            <div className="p-3 border-b space-y-3">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">To</label>
                <StaffAudiencePicker
                  audiences={audiences}
                  selected={selectedAudience}
                  onSelect={audience => chooseAudience(audienceKey(audience.audienceType, audience.audienceId))}
                  isLoading={audiencesQuery.isLoading}
                  isError={audiencesQuery.isError}
                />
                <p className="text-[11px] text-muted-foreground">Choose one active staff member or a team.</p>
              </div>
              <div className="flex items-center justify-between">
                <div><h2 className="font-semibold text-sm">Conversations</h2><p className="text-xs text-muted-foreground">Updates every 30 seconds</p></div>
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => void threadsQuery.refetch()}>
                  <RefreshCw className={`w-3.5 h-3.5 ${threadsQuery.isFetching ? 'animate-spin' : ''}`} />
                </Button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-1">
              {threadsQuery.isLoading ? <div className="space-y-2 p-2"><Skeleton className="h-14" /><Skeleton className="h-14" /></div>
                : threads.length === 0 ? <div className="p-5 text-center text-sm text-muted-foreground"><Inbox className="w-8 h-8 mx-auto mb-2 opacity-40" />Choose an audience to begin.</div>
                  : threads.map(thread => {
                    const key = thread.conversationId ? `c:${thread.conversationId}` : `l:${thread.threadUserId}`;
                    const selectedKey = selected?.conversationId ? `c:${selected.conversationId}` : selected ? `l:${selected.threadUserId}` : '';
                    return (
                      <button key={key} type="button" onClick={() => { setSelected(thread); setNewAudience(null); }}
                        className={`w-full rounded-lg p-3 text-left ${selectedKey === key ? 'bg-primary/10 ring-1 ring-primary/20' : 'hover:bg-muted'}`}>
                        <div className="flex justify-between gap-2"><span className="font-medium text-sm truncate">{thread.threadUserName}</span>{thread.unreadCount > 0 && <Badge>{thread.unreadCount}</Badge>}</div>
                        <p className="text-[11px] capitalize text-muted-foreground">{thread.audienceType?.replaceAll('_', ' ') ?? thread.threadUserRole.replaceAll('_', ' ')}</p>
                        <p className="text-xs text-muted-foreground truncate mt-1">{thread.lastMessage ?? 'No messages yet'}</p>
                      </button>
                    );
                  })}
            </div>
          </aside>

          <section className="min-w-0 min-h-0 flex flex-col">
            {!selected && !newAudience ? (
              <div className="flex-1 grid place-items-center text-center text-muted-foreground p-8">
                <div><MessageSquare className="w-12 h-12 mx-auto mb-3 opacity-25" /><p className="font-medium text-foreground">Choose who to message</p><p className="text-sm mt-1">Use the To selector for one person or a team, or open an existing conversation.</p></div>
              </div>
            ) : (
              <>
                <CardHeader className="border-b py-4 px-5"><CardTitle className="text-base">To: {selectedTitle}</CardTitle><p className="text-xs text-muted-foreground">{selectedAudience?.audienceType === 'staff' ? 'Direct staff conversation' : 'Staff team conversation'}</p></CardHeader>
                <CardContent className="flex-1 min-h-0 overflow-y-auto p-5 space-y-4">
                  {(canLoadEarlier || earlierError) && <div className="text-center"><Button size="sm" variant="outline" disabled={earlierLoading} onClick={() => void loadEarlier()}>{earlierLoading ? 'Loading…' : earlierError ? 'Retry loading earlier messages' : 'Load earlier messages'}</Button>{earlierError && <p className="text-xs text-destructive">{earlierError}</p>}</div>}
                  {!newAudience && activeQuery.isLoading ? <div className="space-y-3"><Skeleton className="h-12 w-2/3" /><Skeleton className="h-12 w-1/2 ml-auto" /></div>
                    : !newAudience && activeQuery.isError ? <div className="text-center py-10 text-sm text-muted-foreground">Could not load this conversation.<div><Button variant="outline" size="sm" className="mt-3" onClick={() => void activeQuery.refetch()}>Try again</Button></div></div>
                      : allMessages.length === 0 ? <div className="text-center py-10 text-sm text-muted-foreground">No messages yet. Start the conversation below.</div>
                        : allMessages.map(message => {
                          const own = message.senderId === user?.id;
                          return <div key={message.id} className={`flex flex-col ${own ? 'items-end' : 'items-start'}`}><span className="text-[10px] text-muted-foreground mb-1">{message.senderName} · {message.senderRole.replaceAll('_', ' ')} · {format(new Date(message.createdAt), 'MMM d, yyyy h:mm a')}</span><div className={`rounded-xl px-3.5 py-2.5 text-sm max-w-[78%] whitespace-pre-wrap ${own ? 'bg-primary text-primary-foreground' : 'bg-muted'}`}>{message.body}</div>{own && <span className="text-[10px] text-muted-foreground mt-1">{message.readByOthers ? 'Read' : 'Sent'}</span>}</div>;
                        })}
                </CardContent>
                <div className="border-t p-4"><div className="flex items-end gap-3"><Textarea rows={2} maxLength={4000} value={draft} onChange={event => setDraft(event.target.value)} placeholder={`Message ${selectedTitle}…`} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void send(); } }} /><Button disabled={!draft.trim() || sending || (!selected && !newAudience)} onClick={() => void send()}><Send className="w-4 h-4 mr-2" />{sending ? 'Sending…' : 'Send'}</Button></div></div>
              </>
            )}
          </section>
        </div>
      </Card>
    </div>
  );
}