import React, { useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter } from '@/components/ui/sheet';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { toast } from 'sonner';
import { format, addYears } from 'date-fns';
import { Copy, Plus, MoreHorizontal, RefreshCw, XCircle, AlertTriangle, Play, Pause, Zap, Shield, Key, Eye, EyeOff, BookOpen } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';

import {
  useGetExternalAccessCatalog, getGetExternalAccessCatalogQueryKey,
  useListExternalConnections, getListExternalConnectionsQueryKey,
  useCreateExternalConnection,
  useUpdateExternalConnection,
  useRotateExternalConnection,
  useRevokeExternalConnection,
  useSetExternalWebhookSecret,
  useListExternalAudit, getListExternalAuditQueryKey,
  type ExternalConnection,
  type ExternalMode,
  type ExternalProvider,
  type ExternalScope,
  type ExternalConnectionInput,
   type ExternalAccessAuditRow,
   customFetch,
} from '@workspace/api-client-react';

type OAuthMcpRegistration = {
  connection: ExternalConnection;
  clientId: string;
  clientName: string;
  redirectUris: string[];
};

type OAuthMcpRegistrationResult = {
  connection: ExternalConnection;
  clientId: string;
  mcpUrl: string;
  authorizationServer: string;
  protectedResource: string;
};

const oauthMcpConnectionsQueryKey = ['external-access', 'oauth-mcp-connections'] as const;

export default function ExternalAccessSettings() {
  const qc = useQueryClient();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editingConn, setEditingConn] = useState<ExternalConnection | null>(null);
  
  const [tokenDialogData, setTokenDialogData] = useState<{ token: string; prefix: string; mode: string; id: string; provider: string } | null>(null);
  const [revokeConfirmId, setRevokeConfirmId] = useState<string | null>(null);
  const [rotateConfirmId, setRotateConfirmId] = useState<string | null>(null);
  const [webhookDialogId, setWebhookDialogId] = useState<string | null>(null);
  const [oauthRegistrationResult, setOauthRegistrationResult] = useState<OAuthMcpRegistrationResult | null>(null);
  
  const { data: catalogData, isLoading: catalogLoading } = useGetExternalAccessCatalog({
    query: { queryKey: getGetExternalAccessCatalogQueryKey() }
  });
  
  const { data: connections = [], isLoading: connectionsLoading } = useListExternalConnections({
    query: { queryKey: getListExternalConnectionsQueryKey() }
  });

  const {
    data: oauthRegistrations = [],
    isLoading: oauthRegistrationsLoading,
    isError: oauthRegistrationsError,
    error: oauthRegistrationsLoadError,
    refetch: refetchOauthRegistrations,
  } = useQuery({
    queryKey: oauthMcpConnectionsQueryKey,
    queryFn: () => customFetch<OAuthMcpRegistration[]>('/api/external-access/oauth-mcp-connections', { responseType: 'json' }),
  });

  const oauthConnectionIds = new Set(oauthRegistrations.map((registration) => registration.connection.id));
  // OAuth-only registrations must never fall back into the bearer controls:
  // rotating one would create an unintended bearer credential. The list query
  // is authoritative, while the server's OAuth-only prefix keeps that safe if
  // the separate registration list has a transient loading/error state.
  const bearerConnections = connections.filter((connection) => !oauthConnectionIds.has(connection.id) && connection.tokenPrefix !== 'OAuth only');

  const revoke = useRevokeExternalConnection({
    mutation: {
      onSuccess: () => {
        toast.success('Access revoked permanently');
        qc.invalidateQueries({ queryKey: getListExternalConnectionsQueryKey() });
        qc.invalidateQueries({ queryKey: oauthMcpConnectionsQueryKey });
        setRevokeConfirmId(null);
      },
      onError: () => toast.error('Failed to revoke access'),
    }
  });

  const rotate = useRotateExternalConnection({
    mutation: {
      gcTime: 0,
      onSuccess: (res: any) => {
        setTokenDialogData({ token: res.token, prefix: res.connection.tokenPrefix, mode: res.connection.mode, id: res.connection.id, provider: res.connection.provider });
        qc.invalidateQueries({ queryKey: getListExternalConnectionsQueryKey() });
        setRotateConfirmId(null);
      },
      onError: () => toast.error('Failed to rotate token'),
      onSettled: () => {
        setTimeout(() => rotate.reset(), 0);
      }
    }
  });

  useEffect(() => {
    return () => {
      if (rotate) rotate.reset();
    };
  }, []);

  const update = useUpdateExternalConnection({
    mutation: {
      onSuccess: () => {
        toast.success('Connection updated');
        qc.invalidateQueries({ queryKey: getListExternalConnectionsQueryKey() });
        qc.invalidateQueries({ queryKey: oauthMcpConnectionsQueryKey });
      },
      onError: () => toast.error('Failed to update connection'),
    }
  });

  const handlePauseResume = (conn: ExternalConnection) => {
    update.mutate({ id: conn.id, data: { enabled: !conn.enabled } });
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between pb-4">
          <div>
            <CardTitle>API & AI Access</CardTitle>
            <CardDescription>
              Manage external third-party tools, custom VoIP integrations, and AI assistants. 
              <br />
              <strong>Warning:</strong> Any tool you connect will have access to your company's data up to the granted permissions.
            </CardDescription>
          </div>
          <Button onClick={() => { setEditingConn(null); setSheetOpen(true); }} className="shrink-0 gap-1.5">
            <Plus className="w-4 h-4" /> New Connection
          </Button>
        </CardHeader>
        <CardContent>
          {connectionsLoading || oauthRegistrationsLoading ? (
            <div className="text-center py-8 text-muted-foreground text-sm">Loading connections...</div>
          ) : bearerConnections.length === 0 ? (
            <div className="text-center py-12 border rounded-lg bg-muted/20">
              <Zap className="w-8 h-8 mx-auto text-muted-foreground mb-3 opacity-50" />
              <h3 className="font-medium">No Bearer Connections</h3>
              <p className="text-sm text-muted-foreground mt-1 mb-4">Create a bearer connection for APIs, header-capable MCP clients, or webhooks.</p>
              <Button variant="outline" onClick={() => { setEditingConn(null); setSheetOpen(true); }}>
                Create Connection
              </Button>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Last Used</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {bearerConnections.map((conn: ExternalConnection) => (
                  <TableRow key={conn.id} className={conn.revokedAt ? 'opacity-60 bg-muted/10' : ''}>
                    <TableCell>
                      <p className="font-medium text-sm">{conn.name}</p>
                      <p className="text-xs text-muted-foreground">{conn.tokenPrefix}... • Expires {format(new Date(conn.expiresAt), 'MMM d, yyyy')}</p>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="capitalize text-xs font-normal">
                        {conn.provider === 'generic' ? conn.mode.toUpperCase() : conn.provider}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {conn.revokedAt ? (
                        <Badge variant="destructive" className="gap-1 bg-red-100 text-red-700 hover:bg-red-100 border-red-200">
                          <XCircle className="w-3 h-3" /> Revoked
                        </Badge>
                      ) : !conn.enabled ? (
                        <Badge variant="secondary" className="gap-1 bg-slate-100 text-slate-700 hover:bg-slate-100 border-slate-200">
                          <Pause className="w-3 h-3" /> Paused
                        </Badge>
                      ) : (
                        <Badge variant="default" className="gap-1 bg-emerald-100 text-emerald-800 hover:bg-emerald-100 border-emerald-200">
                          <Play className="w-3 h-3 fill-current" /> Active
                        </Badge>
                      )}
                      {new Date(conn.expiresAt) < new Date() && !conn.revokedAt && (
                        <Badge variant="destructive" className="ml-2 gap-1 text-xs">Expired</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {conn.lastUsedAt ? format(new Date(conn.lastUsedAt), 'MMM d, h:mm a') : 'Never'}
                    </TableCell>
                    <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="sm" className="h-8 w-8 p-0"><MoreHorizontal className="w-4 h-4" /></Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => { setEditingConn(conn); setSheetOpen(true); }} disabled={!!conn.revokedAt}>
                            Edit Permissions
                          </DropdownMenuItem>
                          {conn.provider === 'quo' && (
                            <DropdownMenuItem onClick={() => setWebhookDialogId(conn.id)} disabled={!!conn.revokedAt}>
                              Set Webhook Secret
                            </DropdownMenuItem>
                          )}
                          {!conn.revokedAt && (
                            <DropdownMenuItem onClick={() => handlePauseResume(conn)}>
                              {conn.enabled ? 'Pause Access' : 'Resume Access'}
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem onClick={() => setRotateConfirmId(conn.id)} disabled={!!conn.revokedAt}>
                            Rotate Token
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem onClick={() => setRevokeConfirmId(conn.id)} disabled={!!conn.revokedAt} className="text-red-600 focus:text-red-700">
                            Revoke Permanently
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <OAuthMcpRegistrations
        registrations={oauthRegistrations}
        isLoading={oauthRegistrationsLoading}
        error={oauthRegistrationsError ? oauthRegistrationsLoadError : null}
        onRetry={() => void refetchOauthRegistrations()}
        onPauseResume={handlePauseResume}
        onRevoke={(connection) => setRevokeConfirmId(connection.id)}
      />

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <BookOpen className="w-4 h-4" /> Setup & Documentation
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <div className="space-y-2 text-muted-foreground">
            <p>
              <strong className="text-foreground">Bearer connections:</strong> Use the generated Bearer token to authenticate REST or header-capable MCP requests. Send it in the <code>Authorization: Bearer &lt;token&gt;</code> header.
            </p>
            <p>
              <strong className="text-foreground">Remote MCP OAuth:</strong> OAuth 2.1 is available for separately registered remote-MCP clients. It requires a pre-registered client ID and exact HTTPS redirect URI, plus authorization-code PKCE using <code>S256</code>. During setup, the company owner reviews and explicitly approves the selected tenant-wide categories.
            </p>
            <p className="text-xs">
              Assistant products vary in their remote-MCP OAuth discovery and registration support. Configure OAuth only after your assistant documents support for protected-resource metadata, authorization code + PKCE (<code>S256</code>), and an owner-entered client ID and redirect URI. This does not claim compatibility with any particular assistant.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="p-3 bg-muted rounded-md font-mono text-xs overflow-x-auto whitespace-pre">
              {`curl -H "Authorization: Bearer dev_..." \\
  ${import.meta.env.VITE_PUBLIC_APP_URL || window.location.origin}/api/external/v1/customers`}
            </div>
            <div className="p-3 bg-muted rounded-md font-mono text-xs overflow-x-auto whitespace-pre">
              {`// MCP Client Config (URL/Header capable clients)
{
  "mcpServers": {
    "divine-edge": {
      "type": "http",
      "url": "${import.meta.env.VITE_PUBLIC_APP_URL || window.location.origin}/api/external/mcp",
      "headers": {
        "Authorization": "Bearer dev_..."
      }
    }
  }
}
// Note: Format varies by client.`}
            </div>
          </div>
          {!import.meta.env.VITE_PUBLIC_APP_URL && (
            <div className="p-3 border border-yellow-200 bg-yellow-50 text-yellow-800 rounded-md text-xs flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <p>You are using a development origin ({window.location.origin}). For production Webhooks or MCP, configure your published VITE_PUBLIC_APP_URL.</p>
            </div>
          )}
          <div className="pt-2">
            <span className="text-muted-foreground">Read the exact REST payloads: </span>
            <a href="/api/external/v1/openapi.json" target="_blank" className="text-primary hover:underline inline-flex items-center gap-1 font-medium">
              View OpenAPI Specification JSON
            </a>
          </div>
        </CardContent>
      </Card>

      <AuditLogViewer connections={connections} />

      {sheetOpen && (
        <ConnectionSheet 
          conn={editingConn} 
          catalog={catalogData} 
          onClose={() => setSheetOpen(false)}
          onSuccess={(res) => {
             if (res?.oauthRegistration) {
               setOauthRegistrationResult(res.oauthRegistration);
               qc.invalidateQueries({ queryKey: oauthMcpConnectionsQueryKey });
             } else if (res?.token && res?.connection) {
              setTokenDialogData({ token: res.token, prefix: res.connection.tokenPrefix, mode: res.connection.mode, id: res.connection.id, provider: res.connection.provider });
            }
            qc.invalidateQueries({ queryKey: getListExternalConnectionsQueryKey() });
            setSheetOpen(false);
          }}
        />
      )}

      {/* Revoke Confirm */}
      <Dialog open={!!revokeConfirmId} onOpenChange={(o) => !o && setRevokeConfirmId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-red-600 flex items-center gap-2"><AlertTriangle className="w-5 h-5" /> Revoke Connection?</DialogTitle>
            <DialogDescription>
              This action is permanent and cannot be undone. All future requests using this connection's credentials will fail immediately. Data already copied by the third party cannot be retrieved.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRevokeConfirmId(null)}>Cancel</Button>
            <Button variant="destructive" onClick={() => revokeConfirmId && revoke.mutate({ id: revokeConfirmId })} disabled={revoke.isPending}>
              {revoke.isPending ? 'Revoking...' : 'Revoke Permanently'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <OAuthRegistrationResultDialog
        registration={oauthRegistrationResult}
        onClose={() => setOauthRegistrationResult(null)}
      />

      {/* Rotate Confirm */}
      <Dialog open={!!rotateConfirmId} onOpenChange={(o) => !o && setRotateConfirmId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rotate Token</DialogTitle>
            <DialogDescription>
              Are you sure? The existing token will be immediately invalidated. You will be shown a new token to update your integration.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRotateConfirmId(null)}>Cancel</Button>
            <Button onClick={() => rotateConfirmId && rotate.mutate({ id: rotateConfirmId })} disabled={rotate.isPending}>
              {rotate.isPending ? 'Rotating...' : 'Rotate Token'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Token Display Dialog */}
      <Dialog open={!!tokenDialogData} onOpenChange={(o) => {
        if (!o) setTokenDialogData(null);
      }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Save Your Secret Token</DialogTitle>
            <DialogDescription>
              This token grants access to your workspace. <strong>It will never be shown again.</strong> Copy it now and store it securely in your third-party tool.
            </DialogDescription>
          </DialogHeader>
          
          <div className="mt-4 space-y-4">
            <div className="relative">
              <Input readOnly value={tokenDialogData?.token || ''} className="pr-12 font-mono text-sm" />
              <Button size="sm" variant="ghost" className="absolute right-1 top-1 h-7 w-7 p-0" 
                onClick={() => {
                  navigator.clipboard.writeText(tokenDialogData?.token || '');
                  toast.success('Token copied to clipboard');
                }}>
                <Copy className="w-4 h-4" />
              </Button>
            </div>
            
            {tokenDialogData?.mode === 'webhook' && (
              <div className="p-3 bg-blue-50 text-blue-800 rounded-md text-xs border border-blue-200">
                <p className="font-medium mb-1">Webhook URL Configuration</p>
                <p>Use this URL for your provider:</p>
                <code className="block mt-1 bg-white/50 p-1.5 rounded">{import.meta.env.VITE_PUBLIC_APP_URL || window.location.origin}/api/external/webhooks/{tokenDialogData.id}/{tokenDialogData.provider}</code>
                {tokenDialogData.provider === 'ringcentral' && (
                  <p className="mt-2 text-xs">
                    <strong>RingCentral Setup:</strong> Configure your subscription using your connection token as the <code>deliveryMode.validationToken</code>. The system supports telephony sessions and instant SMS notifications (message-store notifications requiring API fetch are not supported).
                  </p>
                )}
                {tokenDialogData.provider === 'quo' && (
                  <p className="mt-2 text-xs">
                    <strong>Quo Setup:</strong> Supports <code>call.completed</code>, <code>message.received</code>, and <code>message.sent</code> events. Set your webhook signing secret from the connections menu.
                  </p>
                )}
              </div>
            )}
          </div>
          
          <DialogFooter className="mt-6">
            <Button variant="default" onClick={() => setTokenDialogData(null)}>I have saved it</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      
      {/* Webhook Secret Dialog */}
      {webhookDialogId && (
        <WebhookSecretDialog 
          connectionId={webhookDialogId} 
          onClose={() => setWebhookDialogId(null)} 
        />
      )}
    </div>
  );
}

function copyOAuthValue(value: string, label: string) {
  void navigator.clipboard.writeText(value)
    .then(() => toast.success(`${label} copied to clipboard`))
    .catch(() => toast.error(`Could not copy ${label.toLowerCase()}`));
}

function OAuthMcpRegistrations({
  registrations,
  isLoading,
  error,
  onRetry,
  onPauseResume,
  onRevoke,
}: {
  registrations: OAuthMcpRegistration[];
  isLoading: boolean;
  error: unknown;
  onRetry: () => void;
  onPauseResume: (connection: ExternalConnection) => void;
  onRevoke: (connection: ExternalConnection) => void;
}) {
  const message = error && typeof error === 'object' && 'message' in error && typeof error.message === 'string'
    ? error.message
    : 'OAuth registrations could not be loaded.';

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Key className="w-4 h-4" /> OAuth MCP client registrations
        </CardTitle>
        <CardDescription>
          Public OAuth client IDs for remote MCP assistants. These are separate from bearer-token connections and have no client secret.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="py-5 text-center text-sm text-muted-foreground">Loading OAuth registrations...</div>
        ) : error ? (
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
            <p>{message}</p>
            <Button className="mt-3" size="sm" variant="outline" onClick={onRetry}>Try again</Button>
          </div>
        ) : registrations.length === 0 ? (
          <div className="rounded-lg border border-dashed bg-muted/20 px-4 py-7 text-center">
            <p className="font-medium text-sm">No OAuth MCP clients registered</p>
            <p className="mt-1 text-sm text-muted-foreground">Choose “OAuth MCP client” when creating a new connection to register one.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {registrations.map((registration) => (
              <div key={registration.clientId} className="rounded-lg border p-4 space-y-3">
                <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p className="font-medium">{registration.clientName}</p>
                    <p className="text-sm text-muted-foreground">{registration.connection.name} · Expires {format(new Date(registration.connection.expiresAt), 'MMM d, yyyy')}</p>
                  </div>
                  {registration.connection.revokedAt ? (
                    <Badge variant="destructive">Revoked</Badge>
                  ) : !registration.connection.enabled ? (
                    <Badge variant="secondary">Paused</Badge>
                  ) : new Date(registration.connection.expiresAt) < new Date() ? (
                    <Badge variant="destructive">Expired</Badge>
                  ) : (
                    <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100">Active</Badge>
                  )}
                </div>
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Public client ID</p>
                  <div className="mt-1 flex gap-2">
                    <Input value={registration.clientId} readOnly className="font-mono text-xs" aria-label={`${registration.clientName} public client ID`} />
                    <Button type="button" variant="outline" size="icon" title="Copy public client ID" onClick={() => copyOAuthValue(registration.clientId, 'Client ID')}>
                      <Copy className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Registered redirect URI{registration.redirectUris.length === 1 ? '' : 's'}</p>
                  <ul className="mt-1 space-y-1">
                    {registration.redirectUris.map((redirectUri) => (
                      <li key={redirectUri} className="break-all font-mono text-xs text-muted-foreground">{redirectUri}</li>
                    ))}
                  </ul>
                </div>
                {!registration.connection.revokedAt && (
                  <div className="flex flex-wrap gap-2 border-t pt-3">
                    <Button type="button" size="sm" variant="outline" onClick={() => onPauseResume(registration.connection)}>
                      {registration.connection.enabled ? 'Pause access' : 'Resume access'}
                    </Button>
                    <Button type="button" size="sm" variant="outline" className="text-destructive hover:text-destructive" onClick={() => onRevoke(registration.connection)}>
                      Revoke permanently
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function OAuthRegistrationResultDialog({
  registration,
  onClose,
}: {
  registration: OAuthMcpRegistrationResult | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={!!registration} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>OAuth MCP client registered</DialogTitle>
          <DialogDescription>
            Save these public setup values in the assistant’s custom/pre-registered OAuth client settings. No client secret is created.
          </DialogDescription>
        </DialogHeader>
        {registration && (
          <div className="space-y-4 py-2">
            <CopyableOAuthSetupValue label="Public client ID" value={registration.clientId} />
            <CopyableOAuthSetupValue label="MCP endpoint" value={registration.mcpUrl} />
            <CopyableOAuthSetupValue label="Authorization server" value={registration.authorizationServer} />
            <CopyableOAuthSetupValue label="Protected resource metadata" value={registration.protectedResource} />
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
              <p className="font-medium">Before connecting</p>
              <p className="mt-1">
                Use the exact registered redirect URI, choose authorization code with PKCE <code>S256</code>, and complete the owner consent page. This setup is documented for compatible clients but is not a live compatibility guarantee for any assistant product, account, or plan.
              </p>
            </div>
          </div>
        )}
        <DialogFooter>
          <Button onClick={onClose}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CopyableOAuthSetupValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <div className="flex gap-2">
        <Input value={value} readOnly className="font-mono text-xs" />
        <Button type="button" variant="outline" size="icon" title={`Copy ${label}`} onClick={() => copyOAuthValue(value, label)}>
          <Copy className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
}

function WebhookSecretDialog({ connectionId, onClose }: { connectionId: string; onClose: () => void }) {
  const [secret, setSecret] = useState('');
  const [show, setShow] = useState(false);
  const qc = useQueryClient();
  const setWebhookSecret = useSetExternalWebhookSecret({
    mutation: {
      gcTime: 0,
      onSuccess: () => {
        toast.success('Webhook signature secret saved');
        qc.invalidateQueries({ queryKey: getListExternalConnectionsQueryKey() });
        onClose();
      },
      onError: () => toast.error('Failed to save webhook secret'),
      onSettled: () => {
        setSecret('');
        setTimeout(() => setWebhookSecret.reset(), 0);
      }
    }
  });

  useEffect(() => {
    return () => {
      setSecret('');
      if (setWebhookSecret) setWebhookSecret.reset();
    };
  }, []);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Set Webhook Signing Secret</DialogTitle>
          <DialogDescription>
            Enter the secret provided by your VoIP provider (e.g. Quo) used to verify incoming webhook signatures. This value is encrypted and never displayed again.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label>Signing Secret</Label>
            <div className="relative">
              <Input 
                type={show ? "text" : "password"} 
                value={secret} 
                onChange={(e) => setSecret(e.target.value)}
                placeholder="whsec_..."
                className="pr-10"
              />
              <Button type="button" variant="ghost" size="sm" className="absolute right-1 top-1 h-7 w-7 p-0" onClick={() => setShow(!show)}>
                {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </Button>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button 
            disabled={!secret || setWebhookSecret.isPending} 
            onClick={() => setWebhookSecret.mutate({ id: connectionId, data: { secret } })}>
            {setWebhookSecret.isPending ? 'Saving...' : 'Save Secret'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ConnectionSheet({ conn, catalog, onClose, onSuccess }: { conn: ExternalConnection | null, catalog: any, onClose: () => void, onSuccess: (data?: any) => void }) {
  const isEditing = !!conn;
  const [authentication, setAuthentication] = useState<'bearer' | 'oauth'>('bearer');
  const [name, setName] = useState(conn?.name || '');
  const [description, setDescription] = useState(conn?.description || '');
  const [mode, setMode] = useState<ExternalMode>(conn?.mode || 'both');
  const [provider, setProvider] = useState<ExternalProvider>(conn?.provider || 'generic');
  const [scopes, setScopes] = useState<Set<ExternalScope>>(new Set(conn?.scopes || []));
  const [allowWrites, setAllowWrites] = useState(conn?.allowWrites || false);
  const [expiresAt, setExpiresAt] = useState(conn ? conn.expiresAt.split('T')[0] : format(addYears(new Date(), 1), 'yyyy-MM-dd'));
  const [riskAcknowledged, setRiskAcknowledged] = useState(false);
  const [clientName, setClientName] = useState('');
  const [redirectUris, setRedirectUris] = useState<string[]>(['']);
  const [oauthSubmitting, setOauthSubmitting] = useState(false);
  
  const create = useCreateExternalConnection({
    mutation: {
      gcTime: 0,
      onSuccess: (res: any) => { toast.success('Connection created'); onSuccess(res); },
      onError: () => toast.error('Failed to create connection'),
      onSettled: () => {
        setTimeout(() => create.reset(), 0);
      }
    }
  });

  useEffect(() => {
    return () => {
      if (create) create.reset();
    };
  }, []);
  
  const update = useUpdateExternalConnection({
    mutation: {
      onSuccess: (res: any) => { toast.success('Permissions updated'); onSuccess(res); },
      onError: () => toast.error('Failed to update connection')
    }
  });

  const handleSubmit = () => {
    if (!name.trim()) { toast.error('Name is required'); return; }
    if (scopes.size === 0) { toast.error('Select at least one permission scope'); return; }
    if (!riskAcknowledged) { toast.error('You must acknowledge the security risk'); return; }

    if (!isEditing && authentication === 'oauth') {
      const normalizedRedirectUris = redirectUris.map((uri) => uri.trim()).filter(Boolean);
      if (!clientName.trim()) { toast.error('Assistant/client name is required for OAuth'); return; }
      if (normalizedRedirectUris.length === 0) { toast.error('Add the exact HTTPS redirect URI supplied by the assistant'); return; }
      if (normalizedRedirectUris.length > 10) { toast.error('OAuth registrations support at most 10 redirect URIs'); return; }
      if (new Set(normalizedRedirectUris).size !== normalizedRedirectUris.length) { toast.error('Each OAuth redirect URI must be unique'); return; }
      for (const redirectUri of normalizedRedirectUris) {
        try {
          const url = new URL(redirectUri);
          if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.toString() !== redirectUri) {
            throw new Error('invalid URI');
          }
        } catch {
          toast.error('Each redirect URI must be an exact absolute HTTPS URL without credentials or a fragment');
          return;
        }
      }

      setOauthSubmitting(true);
      void customFetch<OAuthMcpRegistrationResult>('/api/external-access/oauth-mcp-connections', {
        method: 'POST',
        responseType: 'json',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          ...(description.trim() ? { description: description.trim() } : {}),
          scopes: Array.from(scopes),
          allowWrites,
          expiresAt: new Date(expiresAt).toISOString(),
          riskAcknowledged: true,
          clientName: clientName.trim(),
          redirectUris: normalizedRedirectUris,
        }),
      })
        .then((registration) => {
          toast.success('OAuth MCP client registered');
          onSuccess({ oauthRegistration: registration });
        })
        .catch((error: unknown) => {
          const message = error && typeof error === 'object' && 'message' in error && typeof error.message === 'string'
            ? error.message
            : 'Failed to register OAuth MCP client';
          toast.error(message);
        })
        .finally(() => setOauthSubmitting(false));
      return;
    }

    const data: ExternalConnectionInput = {
      name, description, mode, provider, scopes: Array.from(scopes), allowWrites, expiresAt: new Date(expiresAt).toISOString(), riskAcknowledged
    };

    if (isEditing) {
      update.mutate({ id: conn.id, data });
    } else {
      create.mutate({ data });
    }
  };

  const applyPreset = (presetId: string) => {
    const preset = catalog?.presets?.find((p: any) => p.id === presetId);
    if (!preset) return;
    setName(preset.label);
    setDescription(preset.description);
    setMode(preset.mode);
    setProvider(preset.provider);
    setScopes(new Set(preset.scopes as ExternalScope[]));
    // Owner must manually enable writes and check the acknowledgment
    setAllowWrites(false);
    setRiskAcknowledged(false);
  };

  const toggleScope = (id: ExternalScope, isWrite: boolean) => {
    const next = new Set(scopes);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setScopes(next);
    
    // Auto-disable writes if no write scopes selected
    if (allowWrites) {
      const hasWrite = Array.from(next).some(s => catalog?.permissions?.find((p: any) => p.id === s)?.write);
      if (!hasWrite) setAllowWrites(false);
    }
  };

  const handleModeChange = (v: ExternalMode) => {
    setMode(v);
    if (v === 'webhook') {
      if (provider === 'generic') setProvider('quo');
    } else {
      if (provider !== 'generic') setProvider('generic');
    }
  };

  const handleProviderChange = (v: ExternalProvider) => {
    setProvider(v);
    if (v === 'quo' || v === 'ringcentral') {
      setMode('webhook');
    } else if (mode === 'webhook') {
      setMode('both');
    }
  };

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
        <SheetHeader className="pb-4 border-b">
          <SheetTitle>{isEditing ? 'Edit Bearer Connection' : 'New API/AI Connection'}</SheetTitle>
          <SheetDescription>
            Configure authentication and permissions for a third-party service. Permissions apply across your business.
          </SheetDescription>
        </SheetHeader>
        
        <div className="space-y-6 py-6">
          {!isEditing && (
            <div className="space-y-3">
              <Label>Authentication method</Label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setAuthentication('bearer')}
                  className={`rounded-lg border p-3 text-left transition-colors ${authentication === 'bearer' ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'hover:bg-muted/50'}`}
                >
                  <p className="font-medium text-sm">Bearer token</p>
                  <p className="mt-1 text-xs text-muted-foreground">REST, header-capable MCP, and webhook connections. A secret token is shown once.</p>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAuthentication('oauth');
                    setMode('mcp');
                    setProvider('generic');
                  }}
                  className={`rounded-lg border p-3 text-left transition-colors ${authentication === 'oauth' ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'hover:bg-muted/50'}`}
                >
                  <p className="font-medium text-sm">OAuth MCP client</p>
                  <p className="mt-1 text-xs text-muted-foreground">A public client ID for an assistant that supports OAuth authorization code + PKCE.</p>
                </button>
              </div>
            </div>
          )}

          {!isEditing && catalog?.presets && catalog.presets.length > 0 && (
            <div className="space-y-3">
              <Label>Quick Setup Presets</Label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {catalog.presets.map((p: any) => (
                  <Button key={p.id} variant="outline" className="justify-start h-auto py-2 px-3 text-left" onClick={() => applyPreset(p.id)}>
                    <div>
                      <div className="font-medium text-sm">{p.label}</div>
                      <div className="text-xs text-muted-foreground whitespace-normal line-clamp-2 mt-0.5">{p.description}</div>
                    </div>
                  </Button>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Connection Name</Label>
              <Input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Zapier, Customer Support AI" />
            </div>
            
            <div className="space-y-2">
              <Label>Description</Label>
              <Input value={description} onChange={e => setDescription(e.target.value)} placeholder="Internal note about purpose" />
            </div>

            {!isEditing && authentication === 'bearer' && (
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Protocol</Label>
                  <Select value={mode} onValueChange={(v: any) => handleModeChange(v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="both">REST & MCP</SelectItem>
                      <SelectItem value="api">REST API</SelectItem>
                      <SelectItem value="mcp">MCP (AI Assistants)</SelectItem>
                      <SelectItem value="webhook">Webhook Only</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Provider format</Label>
                  <Select value={provider} onValueChange={(v: any) => handleProviderChange(v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {mode !== 'webhook' && <SelectItem value="generic">Generic Standard</SelectItem>}
                      {mode === 'webhook' && <SelectItem value="quo">Quo VoIP</SelectItem>}
                      {mode === 'webhook' && <SelectItem value="ringcentral">RingCentral</SelectItem>}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}
            
            {!isEditing && (
              <div className="space-y-2">
                <Label>Expiration Date</Label>
                <Input type="date" value={expiresAt} onChange={e => setExpiresAt(e.target.value)} max={format(addYears(new Date(), 1), 'yyyy-MM-dd')} />
                <p className="text-xs text-muted-foreground">Maximum lifespan is 1 year. Shorter is recommended.</p>
              </div>
            )}

            {!isEditing && authentication === 'oauth' && (
              <div className="space-y-4 rounded-lg border border-primary/20 bg-primary/5 p-4">
                <div>
                  <Label className="text-base">OAuth MCP client registration</Label>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Register one assistant at a time. This creates a public client ID, not a client secret. The assistant must use authorization code flow with PKCE <code>S256</code>.
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="oauth-client-name">Assistant/client name</Label>
                  <Input id="oauth-client-name" value={clientName} onChange={(event) => setClientName(event.target.value)} placeholder="e.g. Claude" />
                </div>
                <div className="space-y-2">
                  <Label>Exact HTTPS redirect URI(s)</Label>
                  <p className="text-xs text-muted-foreground">
                    Copy each redirect URI from the assistant’s own setup screen. Redirects must match exactly; wildcards, fragments, credentials, and guessed callbacks are not accepted.
                  </p>
                  {redirectUris.map((redirectUri, index) => (
                    <div key={index} className="flex gap-2">
                      <Input
                        aria-label={`OAuth redirect URI ${index + 1}`}
                        type="url"
                        value={redirectUri}
                        onChange={(event) => setRedirectUris((uris) => uris.map((uri, uriIndex) => uriIndex === index ? event.target.value : uri))}
                        placeholder="https://assistant.example.com/oauth/callback"
                      />
                      {redirectUris.length > 1 && (
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => setRedirectUris((uris) => uris.filter((_, uriIndex) => uriIndex !== index))}
                        >
                          Remove
                        </Button>
                      )}
                    </div>
                  ))}
                  {redirectUris.length < 10 && (
                    <Button type="button" variant="outline" size="sm" onClick={() => setRedirectUris((uris) => [...uris, ''])}>
                      <Plus className="w-4 h-4 mr-1.5" /> Add redirect URI
                    </Button>
                  )}
                </div>
                <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                  Remote MCP OAuth compatibility varies by assistant product, account, and plan. Register only a client that documents protected-resource discovery, a manually entered client ID, and PKCE <code>S256</code>. This registration does not verify live compatibility.
                </div>
              </div>
            )}
          </div>
          
          <div className="space-y-4 border-t pt-6">
            <div>
              <h3 className="font-semibold mb-1">Access Permissions</h3>
              <p className="text-sm text-muted-foreground mb-4">Select the specific data categories this connection can access. Permissions apply tenant-wide to all matching records.</p>
            </div>
            
            <div className="space-y-3">
              {(catalog?.permissions || []).map((perm: any) => (
                <div key={perm.id} className={`flex items-start space-x-3 p-3 rounded-lg border ${scopes.has(perm.id) ? 'bg-primary/5 border-primary/20' : 'bg-transparent'}`}>
                  <Checkbox 
                    id={`perm-${perm.id}`} 
                    checked={scopes.has(perm.id)} 
                    onCheckedChange={() => toggleScope(perm.id, perm.write)} 
                  />
                  <div className="grid gap-1.5 leading-none w-full">
                    <Label htmlFor={`perm-${perm.id}`} className="font-medium cursor-pointer flex items-center gap-2">
                      {perm.label}
                      {perm.sensitive && <Badge variant="destructive" className="text-[10px] px-1.5 py-0">Sensitive</Badge>}
                      {perm.write && <Badge variant="default" className="text-[10px] px-1.5 py-0 bg-blue-100 text-blue-700 hover:bg-blue-100">Write Action</Badge>}
                    </Label>
                    <p className="text-sm text-muted-foreground">{perm.description}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
          
          <div className="space-y-4 border-t pt-6">
            <div className="flex items-center justify-between">
              <div>
                <Label className="text-base font-semibold">Enable Write Operations</Label>
                <p className="text-sm text-muted-foreground">Allow this connection to modify data or ingest events.</p>
              </div>
              <Switch 
                checked={allowWrites} 
                onCheckedChange={setAllowWrites}
                disabled={!Array.from(scopes).some(s => catalog?.permissions?.find((p: any) => p.id === s)?.write)}
              />
            </div>
            
            <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
              <div className="flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-red-600 mt-0.5 shrink-0" />
                <div>
                  <h4 className="font-semibold text-red-800">Security Acknowledgment</h4>
                  <p className="text-sm text-red-700 mt-1 mb-3">
                    By granting this access, you understand that external services may retain copied data, and AI systems may make mistakes. 
                    Revoking access will stop future requests but cannot recall data already transmitted.
                  </p>
                  <label className="flex items-center space-x-2 cursor-pointer">
                    <Checkbox checked={riskAcknowledged} onCheckedChange={(v) => setRiskAcknowledged(!!v)} className="border-red-400 data-[state=checked]:bg-red-600 data-[state=checked]:border-red-600" />
                    <span className="text-sm font-medium text-red-800">I accept the risks and authorize this access</span>
                  </label>
                </div>
              </div>
            </div>
          </div>
          
        </div>
        
        <SheetFooter className="border-t pt-4">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={create.isPending || update.isPending || oauthSubmitting}>
            {create.isPending || update.isPending || oauthSubmitting ? 'Saving...' : (isEditing ? 'Update Permissions' : authentication === 'oauth' ? 'Register OAuth Client' : 'Generate Token')}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function AuditLogViewer({ connections }: { connections: ExternalConnection[] }) {
  const [filterConnId, setFilterConnId] = useState<string>('all');
  const params = filterConnId !== 'all' ? { connectionId: filterConnId, limit: 50 } : { limit: 50 };
  
  const { data: logs = [], isLoading } = useListExternalAudit(params, {
    query: {
      queryKey: getListExternalAuditQueryKey(params)
    }
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <div>
          <CardTitle className="text-base">Audit Log</CardTitle>
          <CardDescription>Recent API and Webhook activity</CardDescription>
        </div>
        <Select value={filterConnId} onValueChange={setFilterConnId}>
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder="All Connections" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Connections</SelectItem>
            {connections.map(c => (
              <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="py-4 text-center text-sm text-muted-foreground">Loading activity...</div>
        ) : logs.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground border rounded-lg bg-muted/10">No recent activity found.</div>
        ) : (
          <div className="rounded-md border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Time</TableHead>
                  <TableHead>Connection</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Transport</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logs.map((log: ExternalAccessAuditRow) => (
                  <TableRow key={log.id}>
                    <TableCell className="text-xs whitespace-nowrap text-muted-foreground">
                      {format(new Date(log.createdAt), 'MMM d, h:mm:ss a')}
                    </TableCell>
                    <TableCell className="text-sm font-medium">{log.connectionName}</TableCell>
                    <TableCell className="text-sm font-mono text-xs">{log.action}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-[10px] uppercase">{log.transport}</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={log.status === 'allowed' ? 'secondary' : 'destructive'} className={log.status === 'allowed' ? 'bg-emerald-50 text-emerald-700' : ''}>
                        {log.status}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}