import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { toast } from 'sonner';
import { ShieldCheck, AlertTriangle } from 'lucide-react';
import { useHrAccess, useHrMeta, useSetHrAccess, hrErr, type HrMember } from './hrApi';

/** Owner-only: designate which active staff have private HR / hiring access. */
export default function HrAccessSettings() {
  const meta = useHrMeta();
  const isOwner = !!meta.data?.isOwner;
  const access = useHrAccess(isOwner);
  const setAccess = useSetHrAccess();
  const [pending, setPending] = useState<{ member: HrMember; enabled: boolean } | null>(null);

  const apply = () => {
    if (!pending) return;
    const { member, enabled } = pending;
    setAccess.mutate({ userId: member.id, enabled }, {
      onSuccess: () => toast.success(enabled ? `HR access granted to ${member.name}` : `HR access removed from ${member.name}`),
      onError: e => toast.error(hrErr(e, 'Could not update HR access')),
      onSettled: () => setPending(null),
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><ShieldCheck className="w-5 h-5 text-primary" />HR access</CardTitle>
        <CardDescription>Only the owner can grant or remove access. People with HR access can see applicant personal details, uploaded documents, and hiring notes.</CardDescription>
      </CardHeader>
      <CardContent>
        {meta.isLoading || (isOwner && access.isLoading) ? (
          <div className="space-y-2">{[0, 1, 2].map(i => <div key={i} className="h-12 rounded-md bg-muted animate-pulse" />)}</div>
        ) : !isOwner ? (
          <p className="text-sm text-muted-foreground" data-testid="text-hr-access-owner-only">Only the business owner can manage who has HR access.</p>
        ) : access.isError ? (
          <div className="flex items-center gap-3 text-sm text-destructive"><AlertTriangle className="w-4 h-4" />Couldn’t load staff.
            <Button size="sm" variant="outline" onClick={() => access.refetch()} data-testid="button-retry-hr-access">Retry</Button></div>
        ) : (access.data?.members ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">No staff accounts yet.</p>
        ) : (
          <ul className="divide-y">
            {(access.data?.members ?? []).map(m => {
              const self = m.id === meta.data?.ownUserId;
              return (
                <li key={m.id} className="flex items-center gap-3 py-3" data-testid={`row-hr-access-${m.id}`}>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{m.name}{self && <span className="text-muted-foreground font-normal"> (you)</span>}</p>
                    <p className="text-xs text-muted-foreground truncate">{m.email} · {m.role}</p>
                  </div>
                  {!m.isActive && <Badge variant="outline">Inactive</Badge>}
                  {m.hasHrAccess && <Badge variant="secondary">HR</Badge>}
                  <Switch
                    checked={m.hasHrAccess}
                    disabled={self || (!m.isActive && !m.hasHrAccess) || setAccess.isPending}
                    onCheckedChange={enabled => setPending({ member: m, enabled })}
                    aria-label={`HR access for ${m.name}`}
                    data-testid={`switch-hr-access-${m.id}`}
                  />
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>

      <AlertDialog open={!!pending} onOpenChange={o => !o && setPending(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{pending?.enabled ? `Give ${pending.member.name} HR access?` : `Remove HR access from ${pending?.member.name}?`}</AlertDialogTitle>
            <AlertDialogDescription>
              {pending?.enabled
                ? 'This is broad private access. They will be able to view every applicant’s name, email, phone, address and location details, answers, resumes and other uploaded documents, hiring notes, and the audit history, and move applicants between stages.'
                : 'They will immediately lose access to applicants, documents, and hiring notes.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-hr-access">Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={apply} data-testid="button-confirm-hr-access">{pending?.enabled ? 'Grant access' : 'Remove access'}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
