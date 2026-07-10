import React from 'react';
import { 
  useGetTenantSettings, getGetTenantSettingsQueryKey, 
  useUpdateTenantSettings,
  useListUsers, getListUsersQueryKey,
  useListPlans, getListPlansQueryKey
} from '@workspace/api-client-react';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Building, CreditCard, Users, Settings as SettingsIcon, Shield, CheckCircle2 } from 'lucide-react';

export default function SettingsPage() {
  const { isSuperAdmin } = useAuth();
  
  const { data: settings } = useGetTenantSettings({ query: { queryKey: getGetTenantSettingsQueryKey() }});
  const { data: users } = useListUsers({ query: { queryKey: getListUsersQueryKey() }});
  const { data: plans } = useListPlans({ query: { enabled: isSuperAdmin, queryKey: getListPlansQueryKey() }});
  
  const updateSettings = useUpdateTenantSettings();

  const handleToggleStripe = (checked: boolean) => {
    updateSettings.mutate({ data: { stripeEnabled: checked }});
  };

  const handleToggleQb = (checked: boolean) => {
    updateSettings.mutate({ data: { quickbooksEnabled: checked }});
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto animate-in fade-in duration-500">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground mt-1">Manage company profile, integrations, and team access.</p>
      </div>

      <Tabs defaultValue="general" className="w-full">
        <TabsList className="grid grid-cols-4 md:w-[600px] mb-6">
          <TabsTrigger value="general"><Building className="w-4 h-4 mr-2" /> General</TabsTrigger>
          <TabsTrigger value="payments"><CreditCard className="w-4 h-4 mr-2" /> Integrations</TabsTrigger>
          <TabsTrigger value="users"><Users className="w-4 h-4 mr-2" /> Team</TabsTrigger>
          {isSuperAdmin && <TabsTrigger value="plans"><Shield className="w-4 h-4 mr-2" /> Plans</TabsTrigger>}
        </TabsList>
        
        <TabsContent value="general" className="space-y-6 focus-visible:outline-none">
          <Card>
            <CardHeader>
              <CardTitle>Company Profile</CardTitle>
              <CardDescription>Your public company information shown on invoices.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Company Name</label>
                  <Input defaultValue={settings?.companyName || ''} />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Timezone</label>
                  <Input defaultValue={settings?.timezone || 'America/Los_Angeles'} />
                </div>
              </div>
              <Button className="mt-2">Save Changes</Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Operational Defaults</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Default Tax Rate (%)</label>
                  <Input type="number" defaultValue={settings?.taxRate || 0} />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Default Material Buffer (%)</label>
                  <Input type="number" defaultValue={settings?.overageMaterialBuffer || 15} />
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="payments" className="space-y-6 focus-visible:outline-none">
          <Card>
            <CardHeader>
              <CardTitle>Payment Processing</CardTitle>
              <CardDescription>Connect Stripe to accept credit cards on invoices.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between p-4 border rounded-lg">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-[#635BFF]/10 rounded-xl flex items-center justify-center">
                    <span className="text-[#635BFF] font-bold text-xl">S</span>
                  </div>
                  <div>
                    <h3 className="font-semibold text-[#635BFF]">Stripe</h3>
                    <p className="text-sm text-muted-foreground">Accept credit cards and ACH</p>
                  </div>
                </div>
                <Switch 
                  checked={settings?.stripeEnabled} 
                  onCheckedChange={handleToggleStripe}
                />
              </div>
            </CardContent>
          </Card>
          
          <Card>
            <CardHeader>
              <CardTitle>Accounting</CardTitle>
              <CardDescription>Sync invoices and customers with QuickBooks.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between p-4 border rounded-lg">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-[#2CA01C]/10 rounded-xl flex items-center justify-center">
                    <span className="text-[#2CA01C] font-bold text-xl">qb</span>
                  </div>
                  <div>
                    <h3 className="font-semibold text-[#2CA01C]">QuickBooks Online</h3>
                    <p className="text-sm text-muted-foreground">Two-way sync for financials</p>
                  </div>
                </div>
                <Switch 
                  checked={settings?.quickbooksEnabled} 
                  onCheckedChange={handleToggleQb}
                />
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="users" className="focus-visible:outline-none">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <div>
                <CardTitle>Team Members</CardTitle>
                <CardDescription>Manage access and roles for your team.</CardDescription>
              </div>
              <Button size="sm">Invite Member</Button>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {users?.map((u) => (
                    <TableRow key={u.id}>
                      <TableCell className="font-medium">{u.name}</TableCell>
                      <TableCell className="text-muted-foreground">{u.email}</TableCell>
                      <TableCell>
                        <Badge variant="secondary" className="capitalize">
                          {u.role.replace('_', ' ')}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {u.isActive !== false ? (
                          <Badge className="bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20 border-transparent">Active</Badge>
                        ) : (
                          <Badge variant="outline" className="text-muted-foreground">Inactive</Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {isSuperAdmin && (
          <TabsContent value="plans" className="focus-visible:outline-none">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {plans?.map((plan) => (
                <Card key={plan.id} className={settings?.planTier === plan.tier ? "border-primary shadow-md relative" : ""}>
                  {settings?.planTier === plan.tier && (
                    <div className="absolute top-0 right-0 transform translate-x-2 -translate-y-2">
                      <Badge className="bg-primary text-primary-foreground">Current</Badge>
                    </div>
                  )}
                  <CardHeader>
                    <CardTitle className="text-xl capitalize">{plan.name}</CardTitle>
                    <div className="text-3xl font-bold tracking-tight mt-2">${plan.price}<span className="text-sm font-normal text-muted-foreground">/mo</span></div>
                  </CardHeader>
                  <CardContent>
                    <ul className="space-y-3 mb-6 text-sm">
                      {plan.features.map((feature, i) => (
                        <li key={i} className="flex items-start gap-2">
                          <CheckCircle2 className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                          <span>{feature}</span>
                        </li>
                      ))}
                    </ul>
                    <Button variant={settings?.planTier === plan.tier ? "outline" : "default"} className="w-full">
                      {settings?.planTier === plan.tier ? "Manage Plan" : "Upgrade"}
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
