import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  getGetStaffMessagesUnreadSummaryQueryKey,
  getListStaffMessageThreadsQueryKey,
  getListStaffMessagesQueryKey,
  listStaffMessages,
  useCreateStaffMessage,
  useGetStaffMessagesUnreadSummary,
  useListStaffMessageThreads,
  useListStaffMessages,
  type StaffMessage,
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

const MESSAGE_PAGE_SIZE = 100;

export default function StaffMessagesPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [selectedThreadId, setSelectedThreadId] = useState<number | null>(null);
  const [draft, setDraft] = useState('');
  const [olderPages, setOlderPages] = useState<StaffMessage[][]>([]);
  const [newestHistory, setNewestHistory] = useState<StaffMessage[]>([]);
  const [earlierLoading, setEarlierLoading] = useState(false);
  const [earlierError, setEarlierError] = useState('');

  const threadsQuery = useListStaffMessageThreads({
    query: {
      queryKey: getListStaffMessageThreadsQueryKey(),
      refetchInterval: 30000,
    },
  });
  const threads = threadsQuery.data ?? [];
  const selectedThread = threads.find(thread => thread.threadUserId === selectedThreadId) ?? null;

  const messagesQuery = useListStaffMessages(selectedThreadId ?? 0, { limit: MESSAGE_PAGE_SIZE }, {
    query: {
      enabled: selectedThreadId != null,
      queryKey: getListStaffMessagesQueryKey(selectedThreadId ?? 0, { limit: MESSAGE_PAGE_SIZE }),
      refetchInterval: selectedThreadId != null ? 30000 : false,
    },
  });
  const newestMessages = messagesQuery.data ?? [];
  const allMessages = useMemo(
    () => mergeMessagePages(newestMessages, [...olderPages, newestHistory]),
    [newestMessages, olderPages, newestHistory],
  );
  const canLoadEarlier = hasEarlierMessagePage(newestMessages, olderPages, MESSAGE_PAGE_SIZE);
  const sendMessage = useCreateStaffMessage();
  const { data: unreadSummary } = useGetStaffMessagesUnreadSummary({
    query: {
      queryKey: getGetStaffMessagesUnreadSummaryQueryKey(),
      refetchInterval: 30000,
    },
  });

  useEffect(() => {
    if (newestMessages.length) {
      setNewestHistory(current => mergeMessagePages(newestMessages, [current]));
    }
  }, [newestMessages]);

  useEffect(() => {
    setOlderPages([]);
    setNewestHistory([]);
    setEarlierError('');
    setEarlierLoading(false);
    setDraft('');
  }, [selectedThreadId]);

  const selectThread = useCallback((thread: StaffMessageThreadSummary) => {
    setSelectedThreadId(thread.threadUserId);
  }, []);

  const loadEarlier = useCallback(async () => {
    const beforeId = messageBeforeId(allMessages);
    if (!selectedThreadId || !beforeId || earlierLoading) return;
    setEarlierLoading(true);
    setEarlierError('');
    try {
      const page = await listStaffMessages(selectedThreadId, {
        limit: MESSAGE_PAGE_SIZE,
        beforeId,
      });
      setOlderPages(current => [...current, page]);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: getListStaffMessageThreadsQueryKey() }),
        queryClient.invalidateQueries({ queryKey: getGetStaffMessagesUnreadSummaryQueryKey() }),
      ]);
    } catch {
      setEarlierError('Could not load earlier messages.');
    } finally {
      setEarlierLoading(false);
    }
  }, [allMessages, earlierLoading, queryClient, selectedThreadId]);

  const send = useCallback(() => {
    const body = draft.trim();
    if (!body || selectedThreadId == null || sendMessage.isPending) return;
    sendMessage.mutate(
      {
        threadUserId: selectedThreadId,
        data: { body, clientMessageId: crypto.randomUUID() },
      },
      {
        onSuccess: () => {
          setDraft('');
          void messagesQuery.refetch();
          void threadsQuery.refetch();
        },
        onError: () => toast.error('Could not send message. Please try again.'),
      },
    );
  }, [draft, messagesQuery.refetch, selectedThreadId, sendMessage, threadsQuery.refetch]);

  return (
    <div className="h-[calc(100vh-8rem)] min-h-[560px] flex flex-col gap-5 animate-in fade-in duration-500">
      <div className="flex items-center justify-between gap-4 shrink-0">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-primary/10 p-2.5">
            <MessageSquare className="w-6 h-6 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Staff Messages</h1>
            <p className="text-sm text-muted-foreground">Private conversations with your field and office team.</p>
          </div>
        </div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Users className="w-4 h-4" />
          <span>{threads.length} conversation{threads.length === 1 ? '' : 's'}</span>
          {!!unreadSummary?.general && <Badge>{unreadSummary.general} unread</Badge>}
        </div>
      </div>

      <Card className="flex-1 min-h-0 overflow-hidden">
        <div className="grid grid-cols-[260px_minmax(0,1fr)] h-full">
          <aside className="border-r bg-muted/10 min-h-0 flex flex-col">
            <div className="px-4 py-3 border-b flex items-center justify-between shrink-0">
              <div>
                <h2 className="font-semibold text-sm">Conversations</h2>
                <p className="text-xs text-muted-foreground mt-0.5">Updates every 30 seconds</p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                title="Refresh conversations"
                onClick={() => void threadsQuery.refetch()}
              >
                <RefreshCw className={`w-3.5 h-3.5 ${threadsQuery.isFetching ? 'animate-spin' : ''}`} />
              </Button>
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-1">
              {threadsQuery.isLoading ? (
                <div className="space-y-2 p-2">
                  <Skeleton className="h-14 w-full" />
                  <Skeleton className="h-14 w-full" />
                  <Skeleton className="h-14 w-full" />
                </div>
              ) : threads.length === 0 ? (
                <div className="p-5 text-center text-sm text-muted-foreground">
                  <Inbox className="w-8 h-8 mx-auto mb-2 opacity-40" />
                  No staff conversations yet.
                </div>
              ) : (
                threads.map(thread => (
                  <button
                    key={thread.threadUserId}
                    type="button"
                    onClick={() => selectThread(thread)}
                    className={`w-full rounded-lg p-3 text-left transition-colors ${selectedThreadId === thread.threadUserId ? 'bg-primary/10 ring-1 ring-primary/20' : 'hover:bg-muted'}`}
                    data-testid={`button-staff-message-thread-${thread.threadUserId}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="font-medium text-sm truncate">{thread.threadUserName}</span>
                      {thread.unreadCount > 0 && <Badge className="h-5 min-w-5 px-1.5 text-[10px]">{thread.unreadCount}</Badge>}
                    </div>
                    <p className="text-[11px] capitalize text-muted-foreground mt-0.5">{thread.threadUserRole.replaceAll('_', ' ')}</p>
                    <p className="text-xs text-muted-foreground truncate mt-1.5">{thread.lastMessage ?? 'No messages yet'}</p>
                  </button>
                ))
              )}
            </div>
          </aside>

          <section className="min-w-0 min-h-0 flex flex-col">
            {selectedThread == null ? (
              <div className="flex-1 grid place-items-center text-center text-muted-foreground p-8">
                <div>
                  <MessageSquare className="w-12 h-12 mx-auto mb-3 opacity-25" />
                  <p className="font-medium text-foreground">Select a conversation</p>
                  <p className="text-sm mt-1">Choose a staff member to read and reply to their messages.</p>
                </div>
              </div>
            ) : (
              <>
                <CardHeader className="border-b py-4 px-5 shrink-0">
                  <CardTitle className="text-base">{selectedThread.threadUserName}</CardTitle>
                  <p className="text-xs text-muted-foreground capitalize">{selectedThread.threadUserRole.replaceAll('_', ' ')} · staff-only conversation</p>
                </CardHeader>
                <CardContent className="flex-1 min-h-0 overflow-y-auto p-5 space-y-4">
                  {(canLoadEarlier || earlierError) && (
                    <div className="text-center space-y-1">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={earlierLoading}
                        onClick={() => void loadEarlier()}
                        data-testid="button-load-earlier-staff-messages"
                      >
                        {earlierLoading ? 'Loading…' : earlierError ? 'Retry loading earlier messages' : 'Load earlier messages'}
                      </Button>
                      {earlierError && <p className="text-xs text-destructive">{earlierError}</p>}
                    </div>
                  )}
                  {messagesQuery.isLoading ? (
                    <div className="space-y-3">
                      <Skeleton className="h-12 w-2/3" />
                      <Skeleton className="h-12 w-1/2 ml-auto" />
                    </div>
                  ) : messagesQuery.isError ? (
                    <div className="text-center py-10 text-sm text-muted-foreground">
                      Could not load this conversation.
                      <div><Button variant="outline" size="sm" className="mt-3" onClick={() => void messagesQuery.refetch()}>Try again</Button></div>
                    </div>
                  ) : allMessages.length === 0 ? (
                    <div className="text-center py-10 text-sm text-muted-foreground">No messages yet. Start the conversation below.</div>
                  ) : (
                    allMessages.map(message => {
                      const own = message.senderId === user?.id;
                      return (
                        <div key={message.id} className={`flex flex-col ${own ? 'items-end' : 'items-start'}`} data-testid={`staff-message-${message.id}`}>
                          <span className="text-[10px] text-muted-foreground mb-1">
                            {message.senderName} · {message.senderRole.replaceAll('_', ' ')} · {format(new Date(message.createdAt), 'MMM d, yyyy h:mm a')}
                          </span>
                          <div className={`rounded-xl px-3.5 py-2.5 text-sm max-w-[78%] whitespace-pre-wrap break-words ${own ? 'bg-primary text-primary-foreground' : 'bg-muted'}`}>
                            {message.body}
                          </div>
                          {own && <span className="text-[10px] text-muted-foreground mt-1">{message.readByOthers ? 'Read' : 'Sent'}</span>}
                        </div>
                      );
                    })
                  )}
                </CardContent>
                <div className="border-t p-4 shrink-0">
                  <div className="flex items-end gap-3">
                    <Textarea
                      rows={2}
                      maxLength={4000}
                      value={draft}
                      onChange={event => setDraft(event.target.value)}
                      placeholder={`Message ${selectedThread.threadUserName}…`}
                      className="resize-none"
                      data-testid="input-staff-message"
                      onKeyDown={event => {
                        if (event.key === 'Enter' && !event.shiftKey) {
                          event.preventDefault();
                          send();
                        }
                      }}
                    />
                    <Button disabled={!draft.trim() || sendMessage.isPending} onClick={send} data-testid="button-send-staff-message">
                      <Send className="w-4 h-4 mr-2" />
                      {sendMessage.isPending ? 'Sending…' : 'Send'}
                    </Button>
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-2">Press Enter to send · Shift+Enter for a new line</p>
                </div>
              </>
            )}
          </section>
        </div>
      </Card>
    </div>
  );
}