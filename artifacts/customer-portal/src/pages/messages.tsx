import { useState, useRef, useEffect } from "react";
import { usePortalListMessages, usePortalSendMessage, getPortalListMessagesQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { MessageSquare, Send, ArrowUp } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { cn } from "@/lib/utils";

export default function Messages() {
  const queryClient = useQueryClient();
  const { data: messages, isLoading } = usePortalListMessages();
  const sendMutation = usePortalSendMessage();
  const [body, setBody] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isLoading) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, isLoading]);

  const handleSend = () => {
    const trimmed = body.trim();
    if (!trimmed) return;
    sendMutation.mutate(
      { data: { body: trimmed } },
      {
        onSuccess: () => {
          setBody("");
          queryClient.invalidateQueries({ queryKey: getPortalListMessagesQueryKey() });
        },
        onError: () => toast.error("Failed to send message. Please try again."),
      },
    );
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-foreground">Messages</h1>
        <p className="text-muted-foreground mt-1">Send a question or note to our team. We'll reply here.</p>
      </div>

      <Card className="shadow-sm">
        <CardHeader className="border-b">
          <div className="flex items-center gap-2">
            <MessageSquare className="w-5 h-5 text-primary" />
            <CardTitle className="text-lg">Your Conversation</CardTitle>
          </div>
          <CardDescription>Messages are visible only to you and our staff.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {/* Thread */}
          <div className="min-h-[300px] max-h-[500px] overflow-y-auto p-4 space-y-4">
            {isLoading && (
              <div className="space-y-3">
                <Skeleton className="h-16 w-3/4" />
                <Skeleton className="h-16 w-3/4 ml-auto" />
                <Skeleton className="h-16 w-2/4" />
              </div>
            )}
            {!isLoading && (!messages || messages.length === 0) && (
              <div className="flex flex-col items-center justify-center h-48 text-center gap-3">
                <MessageSquare className="w-10 h-10 text-muted-foreground/40" />
                <div>
                  <p className="font-medium text-foreground">No messages yet</p>
                  <p className="text-sm text-muted-foreground mt-1">Start a conversation below — we typically reply within one business day.</p>
                </div>
              </div>
            )}
            {messages?.map(msg => (
              <div
                key={msg.id}
                className={cn("flex", msg.direction === "inbound" ? "justify-end" : "justify-start")}
              >
                <div
                  className={cn(
                    "max-w-[80%] rounded-2xl px-4 py-3 text-sm",
                    msg.direction === "inbound"
                      ? "bg-primary text-primary-foreground rounded-br-sm"
                      : "bg-muted text-foreground rounded-bl-sm",
                  )}
                >
                  <p className="whitespace-pre-wrap">{msg.body}</p>
                  <p
                    className={cn(
                      "text-[11px] mt-1.5",
                      msg.direction === "inbound" ? "text-primary-foreground/60" : "text-muted-foreground",
                    )}
                  >
                    {msg.direction === "inbound" ? "You" : "Staff"} ·{" "}
                    {formatDistanceToNow(new Date(msg.createdAt), { addSuffix: true })}
                  </p>
                </div>
              </div>
            ))}
            <div ref={bottomRef} />
          </div>

          {/* Compose */}
          <div className="border-t p-4 space-y-3">
            <Textarea
              placeholder="Type your message… (Ctrl+Enter to send)"
              value={body}
              onChange={e => setBody(e.target.value)}
              onKeyDown={handleKeyDown}
              rows={3}
              className="resize-none"
            />
            <div className="flex justify-end">
              <Button
                onClick={handleSend}
                disabled={!body.trim() || sendMutation.isPending}
                className="gap-2"
              >
                <Send className="w-4 h-4" />
                {sendMutation.isPending ? "Sending…" : "Send Message"}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
