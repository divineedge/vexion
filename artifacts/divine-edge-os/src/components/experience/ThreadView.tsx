import { useState } from 'react';
import { format } from 'date-fns';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';
import { AuthedImage, ImagePicker, type UploadedImage } from './ImagePicker';
import { errorMessage, useExperienceAction, type SupportMessage, type SupportThread } from '@/lib/experience';

interface Props {
  thread: SupportThread;
  messages: SupportMessage[];
  currentUserId?: number;
  canInternal?: boolean;
  /** Drafts live in the parent so 30s refetches never wipe them. */
  draft: string;
  onDraft: (v: string) => void;
}

export function ThreadView({ thread, messages, currentUserId, canInternal, draft, onDraft }: Props) {
  const { run, isPending } = useExperienceAction();
  const [files, setFiles] = useState<UploadedImage[]>([]);
  const [internal, setInternal] = useState(false);

  async function send() {
    if (!draft.trim()) return;
    try {
      await run('replyThread', {
        threadId: thread.id, body: draft.trim(),
        ...(files.length ? { attachments: files.map(f => f.id) } : {}),
        ...(canInternal && internal ? { internal: true } : {}),
      });
      onDraft(''); setFiles([]); setInternal(false);
      toast.success('Reply sent');
    } catch (e) { toast.error(errorMessage(e, 'Reply not sent. Your text is kept.')); }
  }

  return (
    <div className="min-w-0 max-w-full space-y-4">
      <ol className="space-y-3">
        {messages.map(m => {
          const mine = m.userId === currentUserId;
          return (
            <li key={m.id} data-testid={`message-${m.id}`}
              className={`rounded-lg border p-3 text-sm ${m.internal ? 'border-amber-300 bg-amber-50/70' : mine ? 'bg-primary/5 border-primary/20 ml-6' : 'bg-card mr-6'}`}>
              <div className="mb-1 flex items-center gap-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                <span>{mine ? 'You' : 'Support'}</span>
                {m.internal && <span className="text-amber-700">Internal note</span>}
                <span className="ml-auto">{format(new Date(m.createdAt), 'MMM d, h:mm a')}</span>
              </div>
              <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere] leading-relaxed">{m.body}</p>
              {m.attachments.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {m.attachments.map(id => (
                    <AuthedImage key={id} url={`/api/experience/uploads/${encodeURIComponent(id)}`} alt="Attachment" className="h-20 w-20 rounded-md border" />
                  ))}
                </div>
              )}
            </li>
          );
        })}
        {messages.length === 0 && <li className="text-sm text-muted-foreground">No messages yet.</li>}
      </ol>
      <div className="space-y-2 rounded-lg border bg-background p-3">
        <Textarea rows={3} value={draft} onChange={e => onDraft(e.target.value)} placeholder="Write a reply" data-testid={`input-reply-${thread.id}`} />
        <ImagePicker uploadUrl="/api/experience/uploads" value={files} onChange={setFiles} testId={`reply-upload-${thread.id}`} label="Attach screenshot" />
        <div className="flex items-center gap-3">
          {canInternal && (
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <Switch checked={internal} onCheckedChange={setInternal} data-testid="switch-internal" /> Internal note
            </label>
          )}
          <Button size="sm" className="ml-auto" disabled={isPending || !draft.trim()} onClick={() => void send()} data-testid={`button-send-reply-${thread.id}`}>
            {isPending ? 'Sending...' : 'Send reply'}
          </Button>
        </div>
      </div>
    </div>
  );
}
