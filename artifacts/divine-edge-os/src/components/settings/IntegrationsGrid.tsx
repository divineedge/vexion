import React, { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  useListIntegrations, getListIntegrationsQueryKey,
  useGetIntegration, getGetIntegrationQueryKey,
  useUpdateIntegration, useDisconnectIntegration, useTestIntegration,
  useGetIntegrationLogs,
  useSyncBankTransactions, useListBankTransactions, getListBankTransactionsQueryKey,
  useImportBankTransaction, useIgnoreBankTransaction,
  useGetQuickBooksAuthorizeUrl, getGetQuickBooksAuthorizeUrlQueryKey,
} from '@workspace/api-client-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Separator } from '@/components/ui/separator';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { toast } from 'sonner';
import { Landmark, Mail, Send as SendIcon, Calculator, Wifi, WifiOff, RefreshCw, CheckCircle2, XCircle } from 'lucide-react';
import { format } from 'date-fns';

const ICONS: Record<string, React.ReactNode> = {
  bank: <Landmark className="w-5 h-5" />,
  mailchimp: <Mail className="w-5 h-5" />,
  lob: <SendIcon className="w-5 h-5" />,
  quickbooks: <Calculator className="w-5 h-5" />,
};

const CONFIG_FIELDS: Record<string, { key: string; label: string; secret?: boolean }[]> = {
  bank: [
    { key: 'clientId', label: 'Plaid Client ID' },
    { key: 'secret', label: 'Plaid Secret', secret: true },
    { key: 'environment', label: 'Environment (sandbox/production)' },
  ],
  mailchimp: [
    { key: 'apiKey', label: 'Mailchimp API Key', secret: true },
    { key: 'audienceId', label: 'Audience (List) ID' },
  ],
  lob: [
    { key: 'apiKey', label: 'Lob API Key', secret: true },
  ],
  quickbooks: [
    { key: 'clientId', label: 'QuickBooks Client ID' },
    { key: 'clientSecret', label: 'QuickBooks Client Secret', secret: true },
    { key: 'environment', label: 'Environment (sandbox/production)' },
  ],
};

export default function IntegrationsGrid() {
  const qc = useQueryClient();
  const [openName, setOpenName] = useState<string | null>(null);
  const [bankTxnOpen, setBankTxnOpen] = useState(false);

  const { data: integrations } = useListIntegrations({ query: { queryKey: getListIntegrationsQueryKey() } });

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Integrations</CardTitle>
          <CardDescription>Connect third-party services for banking, email marketing, direct mail, and accounting.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {(integrations ?? []).map(i => (
              <div key={i.name} className="flex items-center justify-between p-4 border rounded-lg">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-muted flex items-center justify-center">{ICONS[i.name]}</div>
                  <div>
                    <h3 className="font-semibold">{i.displayName}</h3>
                    <p className="text-xs text-muted-foreground">{i.description}</p>
                    {i.connected ? (
                      <Badge variant="secondary" className="text-xs mt-1 gap-1"><Wifi className="w-3 h-3" /> Connected</Badge>
                    ) : (
                      <Badge variant="outline" className="text-xs mt-1 gap-1 text-muted-foreground"><WifiOff className="w-3 h-3" /> Not connected</Badge>
                    )}
                  </div>
                </div>
                <div className="flex flex-col gap-1.5 items-end">
                  <Button size="sm" variant="outline" onClick={() => setOpenName(i.name)}>Configure</Button>
                  {i.name === 'bank' && i.connected && (
                    <Button size="sm" variant="ghost" className="text-xs" onClick={() => setBankTxnOpen(true)}>View transactions</Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {openName && (
        <IntegrationConfigSheet
          name={openName}
          onClose={() => setOpenName(null)}
          onChanged={() => qc.invalidateQueries({ queryKey: getListIntegrationsQueryKey() })}
        />
      )}

      {bankTxnOpen && <BankTransactionsSheet onClose={() => setBankTxnOpen(false)} />}
    </>
  );
}

function IntegrationConfigSheet({ name, onClose, onChanged }: { name: string; onClose: () => void; onChanged: () => void }) {
  const { data: detail } = useGetIntegration(name, { query: { queryKey: getGetIntegrationQueryKey(name) } });
  const { data: logs } = useGetIntegrationLogs(name);
  const [values, setValues] = useState<Record<string, string>>({});
  const [testResult, setTestResult] = useState<{ success: boolean; error?: string } | null>(null);

  const update = useUpdateIntegration({
    mutation: {
      onSuccess: () => { toast.success('Saved'); onChanged(); },
      onError: () => toast.error('Failed to save configuration'),
    },
  });
  const disconnect = useDisconnectIntegration({
    mutation: {
      onSuccess: () => { toast.success('Disconnected'); onChanged(); onClose(); },
      onError: () => toast.error('Failed to disconnect'),
    },
  });
  const test = useTestIntegration({
    mutation: {
      onSuccess: (result) => { setTestResult(result); onChanged(); if (result.success) toast.success('Connection successful'); else toast.error(result.error ?? 'Test failed'); },
      onError: () => toast.error('Test failed'),
    },
  });
  const authorizeUrl = useGetQuickBooksAuthorizeUrl({ query: { enabled: false, queryKey: getGetQuickBooksAuthorizeUrlQueryKey() } });

  const fields = CONFIG_FIELDS[name] ?? [];
  const merged = { ...(detail?.config as Record<string, string> | undefined), ...values };

  const handleSave = () => {
    update.mutate({ name, data: { config: merged, connected: true } });
  };

  const handleQuickBooksConnect = async () => {
    // Save credentials first so the server can build a valid authorize URL, then redirect.
    await update.mutateAsync({ name, data: { config: merged } });
    const result = await authorizeUrl.refetch();
    if (result.data?.url) window.location.href = result.data.url;
    else toast.error('Could not start QuickBooks authorization — check your Client ID/Secret.');
  };

  return (
    <Sheet open onOpenChange={open => { if (!open) onClose(); }}>
      <SheetContent className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader className="pb-4">
          <SheetTitle>{detail?.displayName ?? name}</SheetTitle>
          <SheetDescription>{detail?.description}</SheetDescription>
        </SheetHeader>
        <div className="space-y-4 pb-6">
          {fields.map(f => (
            <div key={f.key} className="space-y-1.5">
              <label className="text-sm font-medium">{f.label}</label>
              <Input
                type={f.secret ? 'password' : 'text'}
                value={values[f.key] ?? merged[f.key] ?? ''}
                onChange={e => setValues(v => ({ ...v, [f.key]: e.target.value }))}
                placeholder={f.secret && merged[f.key] ? 'Unchanged — enter a new value to replace' : ''}
              />
            </div>
          ))}

          <div className="flex gap-2">
            <Button onClick={handleSave} disabled={update.isPending}>{update.isPending ? 'Saving...' : 'Save'}</Button>
            {name === 'quickbooks' ? (
              <Button variant="outline" onClick={handleQuickBooksConnect}>Connect via OAuth</Button>
            ) : (
              <Button variant="outline" onClick={() => test.mutate({ name })} disabled={test.isPending}>
                {test.isPending ? 'Testing...' : 'Test Connection'}
              </Button>
            )}
            {detail?.connected && (
              <Button variant="ghost" className="text-destructive" onClick={() => disconnect.mutate({ name })}>Disconnect</Button>
            )}
          </div>

          {testResult && (
            <div className={`rounded-lg border p-3 text-sm flex items-center gap-2 ${testResult.success ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-red-50 border-red-200 text-red-700'}`}>
              {testResult.success ? <CheckCircle2 className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
              {testResult.success ? 'Connection healthy' : testResult.error}
            </div>
          )}

          <Separator />
          <div className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Sync Log</p>
            <div className="rounded-lg border divide-y max-h-52 overflow-y-auto">
              {(logs ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground p-3">No activity yet.</p>
              ) : (logs ?? []).map(l => (
                <div key={l.id} className="px-3 py-2 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="font-medium capitalize">{l.action}</span>
                    <Badge variant={l.status === 'success' ? 'secondary' : 'destructive'} className="text-xs">{l.status}</Badge>
                  </div>
                  {l.message && <p className="text-xs text-muted-foreground mt-0.5">{l.message}</p>}
                  <p className="text-xs text-muted-foreground">{format(new Date(l.createdAt), 'MMM d, h:mm a')}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function BankTransactionsSheet({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const { data: transactions } = useListBankTransactions({ status: 'pending' }, { query: { queryKey: getListBankTransactionsQueryKey({ status: 'pending' }) } });

  const sync = useSyncBankTransactions({
    mutation: {
      onSuccess: (result) => {
        toast.success(`${result.imported} new transaction${result.imported === 1 ? '' : 's'} pulled${result.simulated ? ' (simulated feed)' : ''}`);
        qc.invalidateQueries({ queryKey: getListBankTransactionsQueryKey({ status: 'pending' }) });
      },
      onError: () => toast.error('Sync failed'),
    },
  });
  const importTxn = useImportBankTransaction({
    mutation: {
      onSuccess: () => { toast.success('Imported to expense ledger'); qc.invalidateQueries({ queryKey: getListBankTransactionsQueryKey({ status: 'pending' }) }); },
      onError: () => toast.error('Import failed'),
    },
  });
  const ignoreTxn = useIgnoreBankTransaction({
    mutation: {
      onSuccess: () => qc.invalidateQueries({ queryKey: getListBankTransactionsQueryKey({ status: 'pending' }) }),
    },
  });

  return (
    <Sheet open onOpenChange={open => { if (!open) onClose(); }}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader className="pb-4">
          <div className="flex items-center justify-between">
            <div>
              <SheetTitle>Bank Transactions</SheetTitle>
              <SheetDescription>Pending transactions waiting to be imported into the Vendor & Expense Ledger.</SheetDescription>
            </div>
            <Button size="sm" variant="outline" className="gap-1.5" onClick={() => sync.mutate()} disabled={sync.isPending}>
              <RefreshCw className={`w-3.5 h-3.5 ${sync.isPending ? 'animate-spin' : ''}`} /> Sync
            </Button>
          </div>
        </SheetHeader>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Description</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {(transactions ?? []).length === 0 ? (
              <TableRow><TableCell colSpan={3} className="py-8 text-center text-muted-foreground text-sm">No pending transactions.</TableCell></TableRow>
            ) : (transactions ?? []).map(t => (
              <TableRow key={t.id}>
                <TableCell>
                  <p className="text-sm font-medium">{t.description}</p>
                  <p className="text-xs text-muted-foreground">{format(new Date(t.date), 'MMM d, yyyy')}{t.guessedCategory ? ` · ${t.guessedCategory}` : ''}</p>
                </TableCell>
                <TableCell className="text-right text-sm font-medium">${t.amount.toFixed(2)}</TableCell>
                <TableCell className="text-right">
                  <div className="flex gap-1 justify-end">
                    <Button size="sm" variant="outline" onClick={() => importTxn.mutate({ id: t.id, data: {} })}>Import</Button>
                    <Button size="sm" variant="ghost" onClick={() => ignoreTxn.mutate({ id: t.id })}>Ignore</Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </SheetContent>
    </Sheet>
  );
}
