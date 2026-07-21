import React, { useState } from 'react';
import { Bell, CheckCheck } from 'lucide-react';
import { Link } from 'wouter';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import {
  useListNotifications, useMarkNotificationRead, useMarkAllNotificationsRead,
  getListNotificationsQueryKey,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { formatDistanceToNow } from 'date-fns';

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();
  const { data: notifications = [] } = useListNotifications({ query: { refetchInterval: 30000, queryKey: getListNotificationsQueryKey() } });
  const unreadCount = notifications.filter(n => !n.isRead).length;

  const markRead = useMarkNotificationRead({
    mutation: { onSuccess: () => queryClient.invalidateQueries({ queryKey: getListNotificationsQueryKey() }) },
  });
  const markAllRead = useMarkAllNotificationsRead({
    mutation: { onSuccess: () => queryClient.invalidateQueries({ queryKey: getListNotificationsQueryKey() }) },
  });

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button className="relative text-muted-foreground hover:text-foreground transition-colors" aria-label="Notifications">
          <Bell className="w-5 h-5" />
          {unreadCount > 0 && (
            <span className="absolute -top-1.5 -right-1.5 min-w-[1.1rem] h-[1.1rem] px-1 rounded-full bg-destructive text-white text-[10px] font-semibold flex items-center justify-center">
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between px-3 py-2 border-b">
          <span className="text-sm font-semibold">Notifications</span>
          {unreadCount > 0 && (
            <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={() => markAllRead.mutate()}>
              <CheckCheck className="w-3.5 h-3.5" /> Mark all read
            </Button>
          )}
        </div>
        <div className="max-h-80 overflow-y-auto divide-y">
          {notifications.length === 0 && (
            <p className="text-sm text-muted-foreground px-3 py-6 text-center">No notifications yet</p>
          )}
          {notifications.map(n => (
            <Link
              key={n.id}
              href={n.linkPath ?? (n.taskId != null ? `/tasks?taskId=${n.taskId}` : `/follow-up-queue`)}
              onClick={() => { setOpen(false); if (!n.isRead) markRead.mutate({ id: n.id }); }}
              className={`block px-3 py-2.5 text-sm hover:bg-muted/50 transition-colors ${!n.isRead ? 'bg-primary/5' : ''}`}
            >
              <div className="flex items-start gap-2">
                {!n.isRead && <span className="w-1.5 h-1.5 rounded-full bg-primary mt-1.5 shrink-0" />}
                <div className={n.isRead ? 'pl-3.5' : ''}>
                  <p className="text-foreground">{n.message}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{formatDistanceToNow(new Date(n.createdAt), { addSuffix: true })}</p>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
