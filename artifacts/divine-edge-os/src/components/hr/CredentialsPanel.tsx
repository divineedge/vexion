import { useState } from 'react';
import { Link, useLocation } from 'wouter';
import { toast } from 'sonner';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useHrCredentials, useSaveCredentialWarning, useHrEmployees, hrErr } from '@/lib/hr';

export function CredentialsPanel() {
  const q = useHrCredentials(true);
  const save = useSaveCredentialWarning();
  const [lead, setLead] = useState<string | null>(null);
  const [filter, setFilter] = useState('upcoming');
  const employees = useHrEmployees(true);
  const [empId, setEmpId] = useState('');
  const [, setLocation] = useLocation();
  const go = (type: 'license' | 'certificate') => empId && setLocation(`/employees/${empId}?tab=documents&add=${type}`);
  if (q.isLoading) return <p className="text-sm">Loading credentials…</p>;
  if (q.isError || !q.data) return <div className="space-y-2"><p className="text-sm text-destructive">Could not load credentials.</p><Button onClick={() => q.refetch()}>Retry</Button></div>;
  const docs = q.data.documents.filter(d => filter === 'all' || d.expirationStatus === filter);
  const value = lead ?? String(q.data.warningDays);
  const invalid = value === '' || !Number.isInteger(Number(value)) || Number(value) < 0 || Number(value) > 365;
  return <div className="space-y-4">
    <Card><CardContent className="p-4 space-y-3">
      <div className="flex items-end gap-3 flex-wrap">
        <div className="space-y-1"><label htmlFor="credential-warning-days" className="text-sm font-medium">Company warning lead time (days)</label>
          <Input id="credential-warning-days" className="w-32" type="number" min={0} max={365} step={1} value={value} onChange={e => setLead(e.target.value)} /></div>
        <Button disabled={invalid || save.isPending || Number(value) === q.data.warningDays} onClick={() => save.mutate(Number(value), {
          onSuccess: () => { setLead(null); toast.success('Company warning period saved'); },
          onError: e => toast.error(hrErr(e, 'Could not save warning period')),
        })}>{save.isPending ? 'Saving…' : 'Save warning period'}</Button>
      </div>
      <p className="text-xs text-muted-foreground">0–365 days; default 30. Notices appear in the notification bell after the hourly check. Only owners and designated HR are notified, plus employees for deliberately shared credentials. Warnings never change employment status or account access.</p>
    </CardContent></Card>
    <Card><CardContent className="p-4 space-y-3">
      <div><p className="text-sm font-medium">Add a license or certificate</p>
        <p className="text-xs text-muted-foreground">Choose the employee, then attach the file and its expiration date. You can also open any employee, go to Documents, and use Add license or Add certificate.</p></div>
      <div className="flex flex-wrap gap-2">
        <Select value={empId} onValueChange={setEmpId}>
          <SelectTrigger className="w-64" aria-label="Employee" data-testid="select-credential-employee"><SelectValue placeholder={employees.isLoading ? 'Loading employees…' : 'Choose employee'} /></SelectTrigger>
          <SelectContent>{(employees.data?.employees ?? []).map(e => <SelectItem key={e.id} value={String(e.id)}>{e.name}{e.isActive ? '' : ' (inactive)'}</SelectItem>)}</SelectContent>
        </Select>
        <Button variant="outline" disabled={!empId} onClick={() => go('license')} data-testid="button-credential-add-license">Add license</Button>
        <Button variant="outline" disabled={!empId} onClick={() => go('certificate')} data-testid="button-credential-add-certificate">Add certificate</Button>
      </div>
      {employees.isError && <p className="text-xs text-destructive">Could not load employees. <button className="underline" onClick={() => employees.refetch()}>Retry</button></p>}
    </CardContent></Card>
    <Select value={filter} onValueChange={setFilter}><SelectTrigger className="w-64" aria-label="Credential expiration filter"><SelectValue /></SelectTrigger><SelectContent>
      <SelectItem value="upcoming">Expiring within {q.data.warningDays} days</SelectItem><SelectItem value="expired">Expired</SelectItem><SelectItem value="all">All credentials & renewal history</SelectItem><SelectItem value="renewed">Prior renewal evidence</SelectItem>
    </SelectContent></Select>
    <Card><CardContent className="p-0">
      {docs.length === 0 ? <p className="p-8 text-sm text-muted-foreground text-center">No credentials match this filter. Use Add license or Add certificate above.</p>
        : <div className="divide-y">{docs.map(doc => <Link key={doc.id} href={`/employees/${doc.employeeId}`} className="block px-4 py-3 hover:bg-muted/40">
          <div className="flex justify-between gap-2"><span className="font-medium text-sm">{doc.employeeName} · {doc.title}</span><Badge variant={doc.expirationStatus === 'expired' ? 'destructive' : 'outline'}>{doc.expirationStatus.replace('_', ' ')}</Badge></div>
          <p className="text-xs text-muted-foreground mt-1 capitalize">{doc.credentialType} · {doc.expiresOn ? `Expires ${doc.expiresOn}` : 'No expiration date'} · {doc.sharedWithEmployee ? 'Shared with employee' : 'Private'}{doc.renewsDocumentId ? ` · renews document #${doc.renewsDocumentId}` : ''}</p>
        </Link>)}</div>}
    </CardContent></Card>
  </div>;
}
