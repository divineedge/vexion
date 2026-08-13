/**
 * StaffNotesPanel — shared component for private staff notes on a customer or job.
 * Notes are never exposed to the customer; they are staff-only and tenant-scoped.
 */
import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { customFetch } from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Trash2, Plus, StickyNote, Lock } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';

interface StaffNote {
  id: number;
  authorId: number;
  authorName: string;
  body: string;
  createdAt: string;
}

interface StaffNotesPanelProps {
  entityType: 'customer' | 'job';
  entityId: number;
  currentUserId: number;
  /** True if the current user can delete any note (owner / office_manager / super_admin) */
  isAdmin: boolean;
}

export function StaffNotesPanel({ entityType, entityId, currentUserId, isAdmin }: StaffNotesPanelProps) {
  const qc = useQueryClient();
  const [addingNote, setAddingNote] = useState(false);
  const [noteBody, setNoteBody] = useState('');

  const queryKey = ['staff-notes', entityType, entityId];

  const { data: notes = [], isLoading } = useQuery<StaffNote[]>({
    queryKey,
    queryFn: () =>
      customFetch<StaffNote[]>(
        `/api/staff-notes?entityType=${entityType}&entityId=${entityId}`,
      ),
    enabled: !!entityId,
  });

  const addNote = useMutation({
    mutationFn: () =>
      customFetch<StaffNote>('/api/staff-notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entityType, entityId, body: noteBody.trim() }),
      }),
    onSuccess: () => {
      toast.success('Note added');
      setNoteBody('');
      setAddingNote(false);
      qc.invalidateQueries({ queryKey });
    },
    onError: () => toast.error('Failed to add note'),
  });

  const deleteNote = useMutation({
    mutationFn: (noteId: number) =>
      customFetch(`/api/staff-notes/${noteId}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast.success('Note deleted');
      qc.invalidateQueries({ queryKey });
    },
    onError: () => toast.error('Failed to delete note'),
  });

  const handleSubmit = () => {
    if (!noteBody.trim()) { toast.error('Note cannot be empty'); return; }
    addNote.mutate();
  };

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide flex items-center gap-1.5">
            <StickyNote className="w-3.5 h-3.5" />
            Internal Notes
          </p>
          <span
            className="inline-flex items-center gap-0.5 text-[10px] font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5"
            title="These notes are visible to staff only — never to customers"
          >
            <Lock className="w-2.5 h-2.5" /> Staff only
          </span>
          {notes.length > 0 && (
            <span className="inline-flex items-center text-[10px] bg-muted text-muted-foreground rounded px-1.5 py-0.5">
              {notes.length}
            </span>
          )}
        </div>
        {!addingNote && (
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs gap-1"
            title="Add an internal staff note"
            onClick={() => setAddingNote(true)}
          >
            <Plus className="w-3 h-3" /> Add Note
          </Button>
        )}
      </div>

      {/* Add note form */}
      {addingNote && (
        <div className="rounded-lg border p-3 space-y-2 bg-muted/30">
          <Textarea
            value={noteBody}
            onChange={e => setNoteBody(e.target.value)}
            placeholder="Add an internal note visible only to staff (e.g. gate code, dog on property, billing note)…"
            rows={3}
            className="text-sm resize-none"
            autoFocus
            maxLength={4000}
            onKeyDown={e => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSubmit();
            }}
          />
          <div className="flex items-center justify-between">
            <span className={`text-[10px] text-muted-foreground ${noteBody.length > 3600 ? 'text-amber-500' : ''}`}>
              {noteBody.length}/4000
            </span>
            <div className="flex gap-2">
              <Button
                size="sm"
                className="h-7 text-xs gap-1"
                disabled={addNote.isPending || !noteBody.trim()}
                onClick={handleSubmit}
                title="Save this staff note (Cmd/Ctrl+Enter)"
              >
                {addNote.isPending ? 'Saving…' : 'Save Note'}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs"
                onClick={() => { setNoteBody(''); setAddingNote(false); }}
                title="Discard this note"
              >
                Cancel
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Notes list */}
      {isLoading ? (
        <p className="text-xs text-muted-foreground py-2">Loading notes…</p>
      ) : notes.length === 0 ? (
        !addingNote && (
          <p className="text-sm text-muted-foreground italic py-1">
            No staff notes yet.
          </p>
        )
      ) : (
        <div className="space-y-2">
          {notes.map(note => {
            const canDelete = note.authorId === currentUserId || isAdmin;
            return (
              <div
                key={note.id}
                className="rounded-lg border bg-muted/20 px-3 py-2.5 space-y-1"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      className="text-xs font-medium truncate"
                      title={note.authorName}
                    >
                      {note.authorName}
                    </span>
                    <span
                      className="text-[10px] text-muted-foreground shrink-0"
                      title={new Date(note.createdAt).toLocaleString()}
                    >
                      {format(new Date(note.createdAt), 'MMM d, yyyy · h:mm a')}
                    </span>
                  </div>
                  {canDelete && (
                    <button
                      className="text-muted-foreground/40 hover:text-destructive transition-colors disabled:opacity-30 shrink-0"
                      title="Delete this note"
                      disabled={deleteNote.isPending}
                      onClick={() => {
                        if (!window.confirm('Delete this note? This cannot be undone.')) return;
                        deleteNote.mutate(note.id);
                      }}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
                <p className="text-sm whitespace-pre-wrap break-words">{note.body}</p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
