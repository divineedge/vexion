import { useState, useEffect } from 'react';
import { useListPortalInboxThreads, useGetPortalInboxThread, useReplyToPortalThread, getListPortalInboxThreadsQueryKey, getGetPortalInboxThreadQueryKey } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';
import { MessageSquare, Send, User, ChevronRight, Inbox } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { cn } from '@/lib/utils';
import { Link, useParams } from 'wouter';

export default function PortalInbox() {
  const queryClient = useQueryClient();
  const params = useParams<{ customerId?: string }>();

  // Seed selected customer from the URL param (e.g. notification click → /portal-inbox/42)
  const urlCustomerId = params.customerId ? parseInt(params.customerId, 10) : null;
  const [selectedCustomerId, setSelectedCustomerId] = useState<number | null>(
    urlCustomerId && !isNaN(urlCustomerId) ? urlCustomerId : null,
  );
  const [replyBody, setReplyBody] = useState('');

  // When the URL param changes (e.g. user navigates from a notification), sync selection
  useEffect(() => {
    if (urlCustomerId && !isNaN(urlCustomerId) && urlCustomerId !== selectedCustomerId) {
      setSelectedCustomerId(urlCustomerId);
      setReplyBody('');
    }
  }, [urlCustomerId]);

  const { data: threads, isLoading: threadsLoading } = useListPortalInboxThreads();
  const { data: thread, isLoading: threadLoading } = useGetPortalInboxThread(selectedCustomerId!, {
    query: {
      enabled: selectedCustomerId !== null,
      queryKey: getGetPortalInboxThreadQueryKey(selectedCustomerId!),
    },
  });
  const replyMutation = useReplyToPortalThread({
    mutation: {
      onSuccess: () => {
        setReplyBody('');
        if (selectedCustomerId !== null) {
          queryClient.invalidateQueries({ queryKey: getGetPortalInboxThreadQueryKey(selectedCustomerId) });
        }
        queryClient.invalidateQueries({ queryKey: getListPortalInboxThreadsQueryKey() });
      },
      onError: () => toast.error('Failed to send reply. Please try again.'),
    },
  });

  const handleReply = () => {
    if (!selectedCustomerId || !replyBody.trim()) return;
    replyMutation.mutate({ customerId: selectedCustomerId, data: { body: replyBody.trim() } });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleReply();
    }
  };

  const handleSelectThread = (customerId: number) => {
    setSelectedCustomerId(customerId);
    setReplyBody('');
    // Invalidate so the thread re-fetches and marks messages read
    queryClient.invalidateQueries({ queryKey: getGetPortalInboxThreadQueryKey(customerId) });
    // After opening, refresh the thread list so the unread badge clears
    setTimeout(() => {
      queryClient.invalidateQueries({ queryKey: getListPortalInboxThreadsQueryKey() });
    }, 800);
  };

  const totalUnread = threads?.reduce((sum: number, t: { unreadCount?: number }) => sum + (t.unreadCount ?? 0), 0) ?? 0;

  return (
    <div className="h-[calc(100vh-8rem)] flex flex-col gap-4 animate-in fade-in duration-500">
      <div className="flex items-center gap-3">
        <Inbox className="w-6 h-6 text-primary" />
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Portal Inbox</h1>
          <p className="text-sm text-muted-foreground">Messages from customers through the client portal.</p>
        </div>
        {totalUnread > 0 && (
          <Badge variant="destructive" className="ml-2">{totalUnread} unread</Badge>
        )}
      </div>

      <div className="flex-1 grid grid-cols-[320px_1fr] gap-4 min-h-0">
        {/* Thread list */}
        <Card className="flex flex-col min-h-0">
          <CardHeader className="py-3 px-4 border-b shrink-0">
            <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Conversations</CardTitle>
          </CardHeader>
          <div className="flex-1 overflow-y-auto divide-y">
            {threadsLoading && (
              <div className="p-4 space-y-3">
                {[1, 2, 3].map(i => <Skeleton key={i} className="h-14 w-full" />)}
              </div>
            )}
            {!threadsLoading && (!threads || threads.length === 0) && (
              <div className="flex flex-col items-center justify-center h-48 text-center gap-2 p-4">
                <MessageSquare className="w-8 h-8 text-muted-foreground/40" />
                <p className="text-sm text-muted-foreground">No portal messages yet.</p>
              </div>
            )}
            {threads?.map((t: { customerId: number; customerName: string; customerEmail: string; latestBody: string; latestAt: string; latestDirection: string; unreadCount: number }) => (
              <button
                key={t.customerId}
                className={cn(
                  'w-full text-left px-4 py-3 hover:bg-muted/50 transition-colors',
                  selectedCustomerId === t.customerId ? 'bg-muted' : '',
                )}
                onClick={() => handleSelectThread(t.customerId)}
              >
                <div className="flex items-start gap-2">
                  <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                    <User className="w-4 h-4 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm truncate">{t.customerName}</span>
                      {(t.unreadCount ?? 0) > 0 && (
                        <Badge variant="destructive" className="text-[10px] h-4 px-1 shrink-0">{t.unreadCount}</Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground truncate mt-0.5">
                      {t.latestDirection === 'inbound' ? '' : 'You: '}{t.latestBody}
                    </p>
                    <p className="text-[11px] text-muted-foreground/60 mt-0.5">
                      {t.latestAt ? formatDistanceToNow(new Date(t.latestAt), { addSuffix: true }) : ''}
                    </p>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </Card>

        {/* Message thread */}
        <Card className="flex flex-col min-h-0">
          {!selectedCustomerId ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center p-8">
              <MessageSquare className="w-12 h-12 text-muted-foreground/30" />
              <p className="text-muted-foreground">Select a conversation to view messages</p>
            </div>
          ) : (
            <>
              {/* Thread header */}
              <CardHeader className="py-3 px-4 border-b shrink-0">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <User className="w-4 h-4 text-muted-foreground" />
                    <CardTitle className="text-base">
                      {thread?.customer.name ?? <Skeleton className="h-4 w-32 inline-block" />}
                    </CardTitle>
                    {thread?.customer.email && (
                      <span className="text-sm text-muted-foreground">· {thread.customer.email}</span>
                    )}
                  </div>
                  <Link href={`/customers/${selectedCustomerId}`}>
                    <Button variant="ghost" size="sm" className="gap-1 text-xs">
                      View customer <ChevronRight className="w-3 h-3" />
                    </Button>
                  </Link>
                </div>
              </CardHeader>

              {/* Messages */}
              <div className="flex-1 overflow-y-auto p-4 space-y-3 min-h-0">
                {threadLoading && (
                  <div className="space-y-3">
                    <Skeleton className="h-14 w-3/4" />
                    <Skeleton className="h-14 w-3/4 ml-auto" />
                  </div>
                )}
                {!threadLoading && thread?.messages.length === 0 && (
                  <p className="text-sm text-muted-foreground text-center py-8">No messages in this thread.</p>
                )}
                {thread?.messages.map((msg: { id: number; direction: string; body: string; createdAt: string }) => (
                  <div key={msg.id} className={cn('flex', msg.direction === 'outbound' ? 'justify-end' : 'justify-start')}>
                    <div
                      className={cn(
                        'max-w-[75%] rounded-2xl px-4 py-2.5 text-sm',
                        msg.direction === 'outbound'
                          ? 'bg-primary text-primary-foreground rounded-br-sm'
                          : 'bg-muted text-foreground rounded-bl-sm',
                      )}
                    >
                      <p className="whitespace-pre-wrap">{msg.body}</p>
                      <p className={cn('text-[11px] mt-1', msg.direction === 'outbound' ? 'text-primary-foreground/60' : 'text-muted-foreground')}>
                        {msg.direction === 'inbound' ? (thread?.customer.name ?? 'Customer') : 'Staff'} ·{' '}
                        {formatDistanceToNow(new Date(msg.createdAt), { addSuffix: true })}
                      </p>
                    </div>
                  </div>
                ))}
              </div>

              {/* Reply compose */}
              <div className="border-t p-3 space-y-2 shrink-0">
                <Textarea
                  placeholder="Type a reply… (Ctrl+Enter to send)"
                  value={replyBody}
                  onChange={e => setReplyBody(e.target.value)}
                  onKeyDown={handleKeyDown}
                  rows={3}
                  className="resize-none text-sm"
                />
                <div className="flex justify-end">
                  <Button
                    size="sm"
                    onClick={handleReply}
                    disabled={!replyBody.trim() || replyMutation.isPending}
                    className="gap-2"
                  >
                    <Send className="w-3.5 h-3.5" />
                    {replyMutation.isPending ? 'Sending…' : 'Send Reply'}
                  </Button>
                </div>
              </div>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}
