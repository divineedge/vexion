import React from 'react';
import { Textarea } from '@/components/ui/textarea';

export const OTHER_DECLINE_CHOICE = 'Other';

export function validateDeclineChoice(choice: string, comment: string): string | null {
  if (choice === OTHER_DECLINE_CHOICE && !comment.trim()) return 'Please tell us a bit more when choosing Other.';
  return null;
}

export default function DeclineReasonPicker({ options, choice, onChoice, comment, onComment }: {
  options: string[] | null | undefined;
  choice: string;
  onChoice: (v: string) => void;
  comment: string;
  onComment: (v: string) => void;
}) {
  const list = [...(options ?? []).filter(o => o !== OTHER_DECLINE_CHOICE), OTHER_DECLINE_CHOICE];
  const isOther = choice === OTHER_DECLINE_CHOICE;
  return (
    <div className="space-y-3">
      <div role="radiogroup" aria-label="Reason for declining" className="flex flex-wrap gap-2">
        {list.map(o => (
          <button
            key={o}
            type="button"
            role="radio"
            aria-checked={choice === o}
            onClick={() => onChoice(choice === o ? '' : o)}
            className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${choice === o ? 'border-primary bg-primary text-primary-foreground' : 'bg-background hover:bg-muted'}`}
          >
            {o}
          </button>
        ))}
      </div>
      <Textarea
        rows={3}
        maxLength={1000}
        placeholder={isOther ? 'Please describe your reason (required)' : 'Anything else we should know? (optional)'}
        value={comment}
        onChange={e => onComment(e.target.value)}
        aria-invalid={isOther && !comment.trim()}
      />
    </div>
  );
}
