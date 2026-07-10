import React, { useState, useEffect } from 'react';
import {
  useGetTenantSettings, getGetTenantSettingsQueryKey,
  useUpdateTenantSettings,
  useListUsers, getListUsersQueryKey,
  useCreateUser, useUpdateUser, useDeleteUser,
  useListPlans, getListPlansQueryKey,
  useListChemicalProducts, getListChemicalProductsQueryKey,
  useCreateChemicalProduct, useUpdateChemicalProduct, useDeleteChemicalProduct,
  useListChemicalMixtures, getListChemicalMixturesQueryKey,
  useCreateChemicalMixture, useUpdateChemicalMixture, useDeleteChemicalMixture,
} from '@workspace/api-client-react';
import type { ChemicalProduct, ChemicalMixture, ChemicalMixtureItem } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Separator } from '@/components/ui/separator';
import {
  Building, CreditCard, Users, Shield, CheckCircle2, Plus, Trash2,
  GripVertical, EyeOff, Eye, Star, Settings as SettingsIcon, TrendingUp,
  ArrowRight, FlaskConical, Pencil, X,
} from 'lucide-react';
import { toast } from 'sonner';
import { BUILT_IN_CUSTOMER_FIELDS, getActiveCustomerFields, type CustomerFieldConfig } from '@/lib/fieldConfig';

export default function SettingsPage() {
  const { isSuperAdmin, isOwner } = useAuth();
  const qc = useQueryClient();

  const { data: settings } = useGetTenantSettings({ query: { queryKey: getGetTenantSettingsQueryKey() } });
  const { data: users } = useListUsers({ query: { queryKey: getListUsersQueryKey() } });
  const { data: plans } = useListPlans({ query: { enabled: isSuperAdmin, queryKey: getListPlansQueryKey() } });
  const { data: chemProducts } = useListChemicalProducts({ query: { queryKey: getListChemicalProductsQueryKey() } });
  const { data: chemMixtures } = useListChemicalMixtures({ query: { queryKey: getListChemicalMixturesQueryKey() } });

  const updateSettings = useUpdateTenantSettings();
  const createUser = useCreateUser();
  const updateUser = useUpdateUser();
  const deleteUser = useDeleteUser();
  const createChemProduct = useCreateChemicalProduct();
  const updateChemProduct = useUpdateChemicalProduct();
  const deleteChemProduct = useDeleteChemicalProduct();
  const createChemMixture = useCreateChemicalMixture();
  const updateChemMixture = useUpdateChemicalMixture();
  const deleteChemMixture = useDeleteChemicalMixture();

  // General
  const [companyName, setCompanyName] = useState('');
  const [timezone, setTimezone] = useState('');
  const [taxRate, setTaxRate] = useState('');
  const [buffer, setBuffer] = useState('');

  // Inventory pricing
  const [markupPct, setMarkupPct] = useState('');
  const [showCostToTech, setShowCostToTech] = useState(false);

  // Customer fields
  const [customerFields, setCustomerFields] = useState<CustomerFieldConfig[]>([]);
  const [addFieldOpen, setAddFieldOpen] = useState(false);
  const [newField, setNewField] = useState<Partial<CustomerFieldConfig>>({ type: 'text', visible: true, required: false, isBuiltIn: false });
  const [newOptions, setNewOptions] = useState('');

  // Operational
  const [durationUnit, setDurationUnit] = useState<'minutes' | 'hours'>('minutes');
  const [autoInvoiceFrequency, setAutoInvoiceFrequency] = useState<'off' | 'daily' | 'weekly' | 'monthly'>('off');
  const [p4pMasterPct, setP4pMasterPct] = useState('0');

  // Equipment thresholds
  const [equipRepairPct, setEquipRepairPct] = useState('50');
  const [equipResalePct, setEquipResalePct] = useState('20');

  // Team
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteForm, setInviteForm] = useState({ name: '', email: '', role: 'technician' });

  // Chemicals – Product form
  const [prodFormOpen, setProdFormOpen] = useState(false);
  const [editingProd, setEditingProd] = useState<ChemicalProduct | null>(null);
  const [prodForm, setProdForm] = useState({ name: '', epaRegNumber: '', activeIngredients: '', signalWord: '', rei: '', phi: '', labelSdsUrl: '', unit: 'oz' });

  // Chemicals – Mixture form
  const [mixFormOpen, setMixFormOpen] = useState(false);
  const [editingMix, setEditingMix] = useState<ChemicalMixture | null>(null);
  const [mixForm, setMixForm] = useState({ name: '', description: '' });
  const [mixItems, setMixItems] = useState<Array<{ productId: string; ratioAmount: string; ratioUnit: string }>>([]);

  useEffect(() => {
    if (settings) {
      setCompanyName(settings.companyName ?? '');
      setTimezone(settings.timezone ?? 'America/Los_Angeles');
      setTaxRate(String(settings.taxRate ?? 8.5));
      setBuffer(String(settings.overageMaterialBuffer ?? 10));
      setMarkupPct(String(settings.defaultMarkupPct ?? 20));
      setShowCostToTech(settings.showCostPriceToTech ?? false);
      setDurationUnit((settings.durationUnit as 'minutes' | 'hours') ?? 'minutes');
      setAutoInvoiceFrequency((settings.autoInvoiceFrequency as 'off' | 'daily' | 'weekly' | 'monthly') ?? 'off');
      setP4pMasterPct(String((settings as any).p4pMasterPercentage ?? 0));
      setEquipRepairPct(String((settings as any).equipmentRepairThresholdPct ?? 50));
      setEquipResalePct(String((settings as any).equipmentResaleThresholdPct ?? 20));
      setCustomerFields(getActiveCustomerFields(settings));
    }
  }, [settings]);

  const saveGeneral = () => {
    updateSettings.mutate(
      { data: { companyName, timezone, taxRate: parseFloat(taxRate), overageMaterialBuffer: parseFloat(buffer) } },
      {
        onSuccess: () => { toast.success('Settings saved'); qc.invalidateQueries({ queryKey: getGetTenantSettingsQueryKey() }); },
        onError: () => toast.error('Failed to save settings'),
      },
    );
  };

  const saveInventoryPricing = () => {
    updateSettings.mutate(
      { data: { defaultMarkupPct: parseFloat(markupPct) || 20, showCostPriceToTech: showCostToTech } },
      {
        onSuccess: () => { toast.success('Pricing settings saved'); qc.invalidateQueries({ queryKey: getGetTenantSettingsQueryKey() }); },
        onError: () => toast.error('Failed to save pricing settings'),
      },
    );
  };

  const saveOperational = () => {
    updateSettings.mutate(
      { data: { durationUnit, autoInvoiceFrequency, p4pMasterPercentage: parseFloat(p4pMasterPct) || 0 } as Parameters<typeof updateSettings.mutate>[0]['data'] },
      {
        onSuccess: () => { toast.success('Operational settings saved'); qc.invalidateQueries({ queryKey: getGetTenantSettingsQueryKey() }); },
        onError: () => toast.error('Failed to save settings'),
      },
    );
  };

  const saveEquipmentThresholds = () => {
    updateSettings.mutate(
      { data: { equipmentRepairThresholdPct: parseFloat(equipRepairPct) || 50, equipmentResaleThresholdPct: parseFloat(equipResalePct) || 20 } as Parameters<typeof updateSettings.mutate>[0]['data'] },
      {
        onSuccess: () => { toast.success('Equipment thresholds saved'); qc.invalidateQueries({ queryKey: getGetTenantSettingsQueryKey() }); },
        onError: () => toast.error('Failed to save equipment thresholds'),
      },
    );
  };

  const saveCustomerFields = (fields: CustomerFieldConfig[]) => {
    updateSettings.mutate(
      { data: { customerFields: fields } },
      {
        onSuccess: () => { toast.success('Customer fields updated'); qc.invalidateQueries({ queryKey: getGetTenantSettingsQueryKey() }); },
        onError: () => toast.error('Failed to save customer fields'),
      },
    );
  };

  const toggleFieldProp = (key: string, prop: 'visible' | 'required') => {
    const next = customerFields.map(f => f.key === key ? { ...f, [prop]: !f[prop] } : f);
    setCustomerFields(next);
    saveCustomerFields(next);
  };

  const removeCustomField = (key: string) => {
    const next = customerFields.filter(f => f.key !== key);
    setCustomerFields(next);
    saveCustomerFields(next);
  };

  const addCustomField = () => {
    if (!newField.label || !newField.key) { toast.error('Label and key are required'); return; }
    const options = newField.type === 'select' ? newOptions.split(',').map(s => s.trim()).filter(Boolean) : undefined;
    const field: CustomerFieldConfig = {
      key: newField.key!.replace(/\s+/g, '_').toLowerCase(),
      label: newField.label!,
      type: newField.type as CustomerFieldConfig['type'] ?? 'text',
      options,
      visible: true,
      required: newField.required ?? false,
      isBuiltIn: false,
    };
    if (customerFields.some(f => f.key === field.key)) { toast.error('A field with this key already exists'); return; }
    const next = [...customerFields, field];
    setCustomerFields(next);
    saveCustomerFields(next);
    setAddFieldOpen(false);
    setNewField({ type: 'text', visible: true, required: false, isBuiltIn: false });
    setNewOptions('');
  };

  const handleInvite = () => {
    if (!inviteForm.name || !inviteForm.email) { toast.error('Name and email are required'); return; }
    createUser.mutate(
      { data: inviteForm as Parameters<typeof createUser.mutate>[0]['data'] },
      {
        onSuccess: () => {
          toast.success(`${inviteForm.name} added`);
          qc.invalidateQueries({ queryKey: getListUsersQueryKey() });
          setInviteOpen(false);
          setInviteForm({ name: '', email: '', role: 'technician' });
        },
        onError: () => toast.error('Failed to add user'),
      },
    );
  };

  const toggleUserActive = (id: number, current: boolean) => {
    updateUser.mutate({ id, data: { isActive: !current } }, {
      onSuccess: () => {
        toast.success(current ? 'User deactivated' : 'User activated');
        qc.invalidateQueries({ queryKey: getListUsersQueryKey() });
      },
      onError: () => toast.error('Failed to update user'),
    });
  };

  const handleDeleteUser = (id: number, name: string) => {
    if (!window.confirm(`Remove ${name} from your team?`)) return;
    deleteUser.mutate({ id }, {
      onSuccess: () => {
        toast.success(`${name} removed`);
        qc.invalidateQueries({ queryKey: getListUsersQueryKey() });
      },
      onError: () => toast.error('Failed to remove user'),
    });
  };

  // Live sell price preview in inventory pricing card
  const sellPreview = (() => {
    const cost = 10; // example cost
    const m = parseFloat(markupPct);
    if (isNaN(m)) return null;
    return cost * (1 + m / 100);
  })();

  return (
    <div className="space-y-6 max-w-5xl mx-auto animate-in fade-in duration-500">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground mt-1">Manage company profile, integrations, and team access.</p>
      </div>

      <Tabs defaultValue="general" className="w-full">
        <TabsList className="flex flex-wrap gap-1 h-auto mb-6">
          <TabsTrigger value="general"><Building className="w-4 h-4 mr-2" />General</TabsTrigger>
          <TabsTrigger value="customer-fields"><SettingsIcon className="w-4 h-4 mr-2" />Customer Fields</TabsTrigger>
          <TabsTrigger value="payments"><CreditCard className="w-4 h-4 mr-2" />Integrations</TabsTrigger>
          <TabsTrigger value="users"><Users className="w-4 h-4 mr-2" />Team</TabsTrigger>
          {isSuperAdmin && <TabsTrigger value="plans"><Shield className="w-4 h-4 mr-2" />Plans</TabsTrigger>}
          <TabsTrigger value="operational"><SettingsIcon className="w-4 h-4 mr-2" />Operational</TabsTrigger>
          <TabsTrigger value="chemicals"><FlaskConical className="w-4 h-4 mr-2" />Chemicals</TabsTrigger>
        </TabsList>

        {/* ── General ── */}
        <TabsContent value="general" className="space-y-6 focus-visible:outline-none">
          <Card>
            <CardHeader>
              <CardTitle>Company Profile</CardTitle>
              <CardDescription>Your public company information shown on invoices.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Company Name</label>
                  <Input value={companyName} onChange={e => setCompanyName(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Timezone</label>
                  <Input value={timezone} onChange={e => setTimezone(e.target.value)} />
                </div>
              </div>
              <Button onClick={saveGeneral} disabled={updateSettings.isPending}>
                {updateSettings.isPending ? 'Saving...' : 'Save Changes'}
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Operational Defaults</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Default Tax Rate (%)</label>
                  <Input type="number" value={taxRate} onChange={e => setTaxRate(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Default Material Buffer (%)</label>
                  <Input type="number" value={buffer} onChange={e => setBuffer(e.target.value)} />
                </div>
              </div>
              <Button onClick={saveGeneral} disabled={updateSettings.isPending} variant="outline">Save Defaults</Button>
            </CardContent>
          </Card>

          {/* Inventory Pricing */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><TrendingUp className="w-5 h-5" /> Inventory Pricing</CardTitle>
              <CardDescription>
                Set your standard markup on parts. The sell price shown to customers is calculated as:
                Buy Price × (1 + Markup %).
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Default Markup (%)</label>
                  <Input
                    type="number"
                    min={0}
                    step={1}
                    value={markupPct}
                    onChange={e => setMarkupPct(e.target.value)}
                    placeholder="20"
                  />
                  <p className="text-xs text-muted-foreground">Applied when adding a new item unless overridden per-item.</p>
                </div>

                {/* Live preview */}
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Preview (on $10.00 cost)</label>
                  <div className="flex items-center gap-2 rounded-lg border px-3 py-2 bg-muted/30 text-sm h-10">
                    <span className="text-muted-foreground">$10.00</span>
                    <ArrowRight className="w-3.5 h-3.5 text-muted-foreground" />
                    <span className="font-semibold text-primary">
                      {sellPreview != null ? `$${sellPreview.toFixed(2)}` : '—'}
                    </span>
                  </div>
                </div>
              </div>

              <Separator />

              <div className="flex items-center justify-between rounded-lg border p-4">
                <div>
                  <p className="text-sm font-medium">Show buy price to technicians</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    When off, technicians only see the sell price — not what you paid for an item.
                  </p>
                </div>
                <Switch
                  checked={showCostToTech}
                  onCheckedChange={v => setShowCostToTech(v)}
                />
              </div>

              <Button onClick={saveInventoryPricing} disabled={updateSettings.isPending} variant="outline">
                Save Pricing Settings
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Customer Fields ── */}
        <TabsContent value="customer-fields" className="space-y-6 focus-visible:outline-none">
          <Card>
            <CardHeader className="flex flex-row items-start justify-between pb-2">
              <div>
                <CardTitle>Customer Form Fields</CardTitle>
                <CardDescription>
                  Control which fields appear on customer forms. Toggle visibility and required status for each field.
                  Core fields (Name, Email, Phone) are always required.
                </CardDescription>
              </div>
              <Button size="sm" onClick={() => setAddFieldOpen(true)} className="gap-2 shrink-0 ml-4">
                <Plus className="w-4 h-4" /> Add Custom Field
              </Button>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="flex items-center gap-6 text-xs text-muted-foreground py-2 border-b mb-3">
                <div className="flex items-center gap-1.5"><Eye className="w-3 h-3" /> Visible on form</div>
                <div className="flex items-center gap-1.5"><Star className="w-3 h-3" /> Required to submit</div>
                <div className="flex items-center gap-1.5"><Badge variant="outline" className="text-[10px] px-1">Built-in</Badge> Cannot be deleted</div>
              </div>
              <div className="space-y-1">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide px-2 py-1">Core Fields (always active)</p>
                {['name', 'email', 'phone'].map(key => (
                  <div key={key} className="flex items-center gap-4 px-3 py-2.5 rounded-lg bg-muted/30 border">
                    <div className="flex-1">
                      <span className="font-medium text-sm capitalize">{key === 'name' ? 'Full Name' : key}</span>
                      <Badge variant="outline" className="ml-2 text-[10px] px-1">Built-in</Badge>
                    </div>
                    <Switch checked disabled />
                    <Switch checked disabled />
                    <div className="w-8" />
                  </div>
                ))}
              </div>
              <div className="space-y-1 pt-2">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide px-2 py-1">Configurable Fields</p>
                {customerFields.map(field => (
                  <div
                    key={field.key}
                    className={`flex items-center gap-4 px-3 py-2.5 rounded-lg border transition-colors ${field.visible ? 'bg-background' : 'bg-muted/20 opacity-60'}`}
                  >
                    <GripVertical className="w-4 h-4 text-muted-foreground/40 cursor-grab shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-sm">{field.label}</span>
                        {field.isBuiltIn && <Badge variant="outline" className="text-[10px] px-1">Built-in</Badge>}
                        <span className="text-xs text-muted-foreground capitalize">{field.type}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {field.visible ? <Eye className="w-3.5 h-3.5 text-muted-foreground" /> : <EyeOff className="w-3.5 h-3.5 text-muted-foreground/40" />}
                      <Switch checked={field.visible} onCheckedChange={() => toggleFieldProp(field.key, 'visible')} />
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <Star className={`w-3.5 h-3.5 ${field.required ? 'text-amber-500' : 'text-muted-foreground/40'}`} />
                      <Switch checked={field.required} disabled={!field.visible} onCheckedChange={() => toggleFieldProp(field.key, 'required')} />
                    </div>
                    {!field.isBuiltIn ? (
                      <Button variant="ghost" size="icon" className="w-8 h-8 text-muted-foreground hover:text-destructive" onClick={() => removeCustomField(field.key)}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    ) : <div className="w-8" />}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Add custom field sheet */}
          <Sheet open={addFieldOpen} onOpenChange={setAddFieldOpen}>
            <SheetContent className="w-full sm:max-w-md">
              <SheetHeader className="pb-4">
                <SheetTitle>Add Custom Field</SheetTitle>
                <SheetDescription>This field will appear on all customer forms for your team.</SheetDescription>
              </SheetHeader>
              <div className="space-y-4 pb-6">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Field Label <span className="text-destructive">*</span></label>
                  <Input
                    placeholder="e.g. License Number"
                    value={newField.label ?? ''}
                    onChange={e => setNewField(f => ({ ...f, label: e.target.value, key: e.target.value.replace(/\s+/g, '_').toLowerCase() }))}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Field Key <span className="text-destructive">*</span></label>
                  <Input
                    placeholder="license_number"
                    value={newField.key ?? ''}
                    onChange={e => setNewField(f => ({ ...f, key: e.target.value }))}
                    className="font-mono text-sm"
                  />
                  <p className="text-xs text-muted-foreground">Unique identifier. Lowercase, underscores only.</p>
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Field Type</label>
                  <Select value={newField.type} onValueChange={v => setNewField(f => ({ ...f, type: v as CustomerFieldConfig['type'] }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="text">Text</SelectItem>
                      <SelectItem value="number">Number</SelectItem>
                      <SelectItem value="date">Date</SelectItem>
                      <SelectItem value="textarea">Long Text</SelectItem>
                      <SelectItem value="select">Dropdown</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {newField.type === 'select' && (
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">Options <span className="text-destructive">*</span></label>
                    <Input placeholder="Option 1, Option 2, Option 3" value={newOptions} onChange={e => setNewOptions(e.target.value)} />
                    <p className="text-xs text-muted-foreground">Comma-separated list of dropdown options.</p>
                  </div>
                )}
                <div className="flex items-center justify-between rounded-lg border p-3">
                  <div>
                    <p className="text-sm font-medium">Required field</p>
                    <p className="text-xs text-muted-foreground">Team must fill this in to save a customer</p>
                  </div>
                  <Switch checked={newField.required ?? false} onCheckedChange={v => setNewField(f => ({ ...f, required: v }))} />
                </div>
                <Separator />
                <div className="flex gap-3 justify-end">
                  <Button variant="outline" onClick={() => setAddFieldOpen(false)}>Cancel</Button>
                  <Button onClick={addCustomField}>Add Field</Button>
                </div>
              </div>
            </SheetContent>
          </Sheet>
        </TabsContent>

        {/* ── Integrations ── */}
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
                <Switch checked={settings?.stripeEnabled} onCheckedChange={v => updateSettings.mutate({ data: { stripeEnabled: v } })} />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Accounting</CardTitle>
              <CardDescription>Push invoices and customer data to QuickBooks automatically.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between p-4 border rounded-lg">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-[#2CA01C]/10 rounded-xl flex items-center justify-center">
                    <span className="text-[#2CA01C] font-bold text-xl">QB</span>
                  </div>
                  <div>
                    <h3 className="font-semibold text-[#2CA01C]">QuickBooks Online</h3>
                    <p className="text-sm text-muted-foreground">
                      One-way push — this app sends to QuickBooks
                    </p>
                  </div>
                </div>
                <Switch checked={settings?.quickbooksEnabled} onCheckedChange={v => updateSettings.mutate({ data: { quickbooksEnabled: v } })} />
              </div>

              {settings?.quickbooksEnabled && (
                <div className="rounded-lg bg-muted/40 border border-dashed p-4 text-sm space-y-2">
                  <p className="font-medium">What gets pushed to QuickBooks:</p>
                  <ul className="space-y-1 text-muted-foreground text-xs list-disc list-inside">
                    <li>New and updated invoices (status, line items, totals)</li>
                    <li>Customer names and contact info</li>
                    <li>Payments marked as Paid</li>
                  </ul>
                  <p className="text-xs text-muted-foreground pt-1">
                    Data flows one-way: changes made in QuickBooks do not sync back here.
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Team ── */}
        <TabsContent value="users" className="focus-visible:outline-none">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <div>
                <CardTitle>Team Members</CardTitle>
                <CardDescription>Manage access and roles for your team.</CardDescription>
              </div>
              {isOwner && (
                <Button size="sm" onClick={() => setInviteOpen(true)} className="gap-2">
                  <Plus className="w-4 h-4" /> Add Member
                </Button>
              )}
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Status</TableHead>
                    {isOwner && <TableHead className="w-[100px]">Actions</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(users ?? []).map(u => (
                    <TableRow key={u.id}>
                      <TableCell className="font-medium">{u.name}</TableCell>
                      <TableCell className="text-muted-foreground text-sm">{u.email}</TableCell>
                      <TableCell>
                        <Badge variant="secondary" className="capitalize">{u.role.replace(/_/g, ' ')}</Badge>
                      </TableCell>
                      <TableCell>
                        {u.isActive !== false ? (
                          <Badge className="bg-emerald-500/10 text-emerald-600 border-transparent">Active</Badge>
                        ) : (
                          <Badge variant="outline" className="text-muted-foreground">Inactive</Badge>
                        )}
                      </TableCell>
                      {isOwner && (
                        <TableCell>
                          <div className="flex items-center gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 text-xs px-2"
                              onClick={() => toggleUserActive(u.id, u.isActive !== false)}
                              disabled={updateUser.isPending}
                            >
                              {u.isActive !== false ? 'Deactivate' : 'Activate'}
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-muted-foreground hover:text-destructive"
                              onClick={() => handleDeleteUser(u.id, u.name)}
                              disabled={deleteUser.isPending}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                          </div>
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* Invite Sheet */}
          <Sheet open={inviteOpen} onOpenChange={setInviteOpen}>
            <SheetContent className="w-full sm:max-w-md">
              <SheetHeader className="pb-4">
                <SheetTitle>Add Team Member</SheetTitle>
                <SheetDescription>Add a new user to your team. They'll receive access immediately.</SheetDescription>
              </SheetHeader>
              <div className="space-y-4 pb-6">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Full Name <span className="text-destructive">*</span></label>
                  <Input value={inviteForm.name} onChange={e => setInviteForm(f => ({ ...f, name: e.target.value }))} placeholder="Jane Smith" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Email <span className="text-destructive">*</span></label>
                  <Input type="email" value={inviteForm.email} onChange={e => setInviteForm(f => ({ ...f, email: e.target.value }))} placeholder="jane@company.com" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Role</label>
                  <Select value={inviteForm.role} onValueChange={v => setInviteForm(f => ({ ...f, role: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="company_owner">Company Owner</SelectItem>
                      <SelectItem value="office_manager">Office Manager</SelectItem>
                      <SelectItem value="department_manager">Department Manager</SelectItem>
                      <SelectItem value="crew_manager">Crew Manager</SelectItem>
                      <SelectItem value="technician">Technician</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Separator />
                <div className="flex gap-3 justify-end">
                  <Button variant="outline" onClick={() => setInviteOpen(false)}>Cancel</Button>
                  <Button onClick={handleInvite} disabled={createUser.isPending}>
                    {createUser.isPending ? 'Adding...' : 'Add Member'}
                  </Button>
                </div>
              </div>
            </SheetContent>
          </Sheet>
        </TabsContent>

        {/* ── Plans (superadmin) ── */}
        {isSuperAdmin && (
          <TabsContent value="plans" className="focus-visible:outline-none">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {(plans ?? []).map(plan => (
                <Card key={plan.id} className={settings?.planTier === plan.tier ? 'border-primary shadow-md relative' : ''}>
                  {settings?.planTier === plan.tier && (
                    <div className="absolute -top-2 -right-2">
                      <Badge className="bg-primary text-primary-foreground">Current</Badge>
                    </div>
                  )}
                  <CardHeader>
                    <CardTitle className="text-xl capitalize">{plan.name}</CardTitle>
                    <div className="text-3xl font-bold tracking-tight mt-2">
                      ${plan.price}<span className="text-sm font-normal text-muted-foreground">/mo</span>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <ul className="space-y-2 mb-6 text-sm">
                      {(plan.features ?? []).map((feature, i) => (
                        <li key={i} className="flex items-start gap-2">
                          <CheckCircle2 className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                          <span>{feature}</span>
                        </li>
                      ))}
                    </ul>
                    <Button variant={settings?.planTier === plan.tier ? 'outline' : 'default'} className="w-full">
                      {settings?.planTier === plan.tier ? 'Manage Plan' : 'Upgrade'}
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>
        )}

        {/* ── Operational ── */}
        <TabsContent value="operational" className="space-y-6 focus-visible:outline-none">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <SettingsIcon className="w-5 h-5" /> Job Settings
              </CardTitle>
              <CardDescription>Configure how job durations are entered and how invoices are generated.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Duration unit */}
                <div className="space-y-2">
                  <label className="text-sm font-medium">Duration Input Unit</label>
                  <p className="text-xs text-muted-foreground">How field staff enter job durations. Stored internally in minutes.</p>
                  <div className="flex items-center rounded-md border p-1 bg-muted/50 w-fit gap-1">
                    <Button
                      size="sm"
                      variant={durationUnit === 'minutes' ? 'secondary' : 'ghost'}
                      className="h-8 px-4 text-sm"
                      onClick={() => setDurationUnit('minutes')}
                    >Minutes</Button>
                    <Button
                      size="sm"
                      variant={durationUnit === 'hours' ? 'secondary' : 'ghost'}
                      className="h-8 px-4 text-sm"
                      onClick={() => setDurationUnit('hours')}
                    >Hours</Button>
                  </div>
                </div>

                {/* Auto-invoice frequency */}
                <div className="space-y-2">
                  <label className="text-sm font-medium">Auto-Invoice Frequency</label>
                  <p className="text-xs text-muted-foreground">Automatically generate invoices for completed jobs on a schedule.</p>
                  <Select value={autoInvoiceFrequency} onValueChange={v => setAutoInvoiceFrequency(v as typeof autoInvoiceFrequency)}>
                    <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="off">Off (manual only)</SelectItem>
                      <SelectItem value="daily">Daily</SelectItem>
                      <SelectItem value="weekly">Weekly</SelectItem>
                      <SelectItem value="monthly">Monthly</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* P4P Master Percentage */}
              <div className="col-span-2 space-y-2 pt-2 border-t">
                <label className="text-sm font-medium flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-primary" />
                  Global P4P Master Payout Percentage
                </label>
                <p className="text-xs text-muted-foreground">
                  Default Pay-for-Performance rate applied to all services. Individual service blueprints can override this with their own percentage.
                  Set to 0 to disable P4P calculations.
                </p>
                <div className="flex items-center gap-2 w-fit">
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    step={0.5}
                    className="w-24 text-right"
                    value={p4pMasterPct}
                    onChange={e => setP4pMasterPct(e.target.value)}
                  />
                  <span className="text-sm font-medium text-muted-foreground">%</span>
                  <span className="text-xs text-muted-foreground ml-2">
                    {parseFloat(p4pMasterPct) > 0 ? `= ${parseFloat(p4pMasterPct)} per $100 of net labor revenue` : 'P4P disabled'}
                  </span>
                </div>
              </div>

              <div className="flex justify-end pt-2 border-t">
                <Button onClick={saveOperational} disabled={updateSettings.isPending} variant="outline">
                  Save Job Settings
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Equipment Sell Thresholds */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">Equipment Sell Thresholds</CardTitle>
              <CardDescription>
                Configure when the system should recommend selling a piece of equipment.
                A sell badge appears when either condition is met.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="grid grid-cols-2 gap-6">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Repair Cost Threshold (%)</label>
                  <div className="flex items-center gap-2">
                    <Input
                      type="number" min={0} max={200} step={5}
                      className="w-24 text-right"
                      value={equipRepairPct}
                      onChange={e => setEquipRepairPct(e.target.value)}
                    />
                    <span className="text-sm text-muted-foreground">% of purchase price</span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Flag when total repair cost exceeds this % of the original purchase price.
                  </p>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Resale Value Threshold (%)</label>
                  <div className="flex items-center gap-2">
                    <Input
                      type="number" min={0} max={100} step={5}
                      className="w-24 text-right"
                      value={equipResalePct}
                      onChange={e => setEquipResalePct(e.target.value)}
                    />
                    <span className="text-sm text-muted-foreground">% of purchase price</span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Flag when estimated resale value (age-depreciated) falls below this %.
                  </p>
                </div>
              </div>
              <Button onClick={saveEquipmentThresholds} disabled={updateSettings.isPending} variant="outline">
                Save Equipment Thresholds
              </Button>
            </CardContent>
          </Card>
        </TabsContent>
        {/* ── Chemicals ── */}
        <TabsContent value="chemicals" className="space-y-6 focus-visible:outline-none">
          {/* Products Library */}
          <Card>
            <CardHeader className="flex flex-row items-start justify-between pb-2">
              <div>
                <CardTitle className="flex items-center gap-2"><FlaskConical className="w-5 h-5" /> Chemical Products</CardTitle>
                <CardDescription>Pesticides, herbicides, and fertilizers with EPA registration and safety data.</CardDescription>
              </div>
              <Button size="sm" className="gap-2 ml-4 shrink-0" onClick={() => { setEditingProd(null); setProdForm({ name: '', epaRegNumber: '', activeIngredients: '', signalWord: '', rei: '', phi: '', labelSdsUrl: '', unit: 'oz' }); setProdFormOpen(true); }}>
                <Plus className="w-4 h-4" /> Add Product
              </Button>
            </CardHeader>
            <CardContent className="p-0">
              {(chemProducts ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground px-6 py-4">No chemical products yet. Add your first product to build your library.</p>
              ) : (
                <div className="divide-y">
                  {(chemProducts ?? []).map(p => (
                    <div key={p.id} className={`flex items-start gap-4 px-6 py-3 ${!p.isActive ? 'opacity-50' : ''}`}>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium text-sm">{p.name}</span>
                          {p.signalWord && (
                            <Badge variant="outline" className={`text-[10px] px-1.5 ${p.signalWord === 'DANGER' ? 'bg-red-50 text-red-700 border-red-200' : p.signalWord === 'WARNING' ? 'bg-orange-50 text-orange-700 border-orange-200' : 'bg-yellow-50 text-yellow-700 border-yellow-200'}`}>
                              {p.signalWord}
                            </Badge>
                          )}
                          {!p.isActive && <Badge variant="outline" className="text-[10px] px-1.5">Inactive</Badge>}
                        </div>
                        {p.epaRegNumber && <p className="text-xs text-muted-foreground mt-0.5">EPA #{p.epaRegNumber}</p>}
                        {p.activeIngredients && <p className="text-xs text-muted-foreground">{p.activeIngredients}</p>}
                        <div className="flex items-center gap-3 mt-0.5 text-xs text-muted-foreground">
                          <span>Unit: {p.unit}</span>
                          {p.rei != null && <span>REI: {p.rei}h</span>}
                          {p.phi != null && <span>PHI: {p.phi}d</span>}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <Button variant="ghost" size="icon" className="w-7 h-7" onClick={() => {
                          setEditingProd(p);
                          setProdForm({ name: p.name, epaRegNumber: p.epaRegNumber ?? '', activeIngredients: p.activeIngredients ?? '', signalWord: p.signalWord ?? '', rei: p.rei != null ? String(p.rei) : '', phi: p.phi != null ? String(p.phi) : '', labelSdsUrl: p.labelSdsUrl ?? '', unit: p.unit });
                          setProdFormOpen(true);
                        }}>
                          <Pencil className="w-3.5 h-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="w-7 h-7 text-muted-foreground hover:text-destructive" onClick={() => {
                          if (!window.confirm(`Delete ${p.name}?`)) return;
                          deleteChemProduct.mutate({ id: p.id }, {
                            onSuccess: () => { toast.success('Product deleted'); qc.invalidateQueries({ queryKey: getListChemicalProductsQueryKey() }); },
                            onError: () => toast.error('Failed to delete'),
                          });
                        }}>
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Mixtures Library */}
          <Card>
            <CardHeader className="flex flex-row items-start justify-between pb-2">
              <div>
                <CardTitle>Tank Mixtures</CardTitle>
                <CardDescription>Named mixes (e.g. "Broadleaf Control Mix") that auto-expand to per-product breakdown when applied.</CardDescription>
              </div>
              <Button size="sm" className="gap-2 ml-4 shrink-0" onClick={() => { setEditingMix(null); setMixForm({ name: '', description: '' }); setMixItems([]); setMixFormOpen(true); }}>
                <Plus className="w-4 h-4" /> Add Mixture
              </Button>
            </CardHeader>
            <CardContent className="p-0">
              {(chemMixtures ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground px-6 py-4">No mixtures yet. Create a mixture to let field staff log complex applications as a single entry.</p>
              ) : (
                <div className="divide-y">
                  {(chemMixtures ?? []).map(m => (
                    <div key={m.id} className={`px-6 py-3 ${!m.isActive ? 'opacity-50' : ''}`}>
                      <div className="flex items-start gap-4">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-sm">{m.name}</span>
                            {!m.isActive && <Badge variant="outline" className="text-[10px] px-1.5">Inactive</Badge>}
                          </div>
                          {m.description && <p className="text-xs text-muted-foreground mt-0.5">{m.description}</p>}
                          {m.items.length > 0 && (
                            <div className="mt-1.5 space-y-0.5">
                              {m.items.map((item: ChemicalMixtureItem) => (
                                <p key={item.id} className="text-xs text-muted-foreground">
                                  {item.productName ?? `Product #${item.productId}`}: {item.ratioAmount} {item.ratioUnit} per gal
                                </p>
                              ))}
                            </div>
                          )}
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <Button variant="ghost" size="icon" className="w-7 h-7" onClick={() => {
                            setEditingMix(m);
                            setMixForm({ name: m.name, description: m.description ?? '' });
                            setMixItems(m.items.map((i: ChemicalMixtureItem) => ({ productId: String(i.productId), ratioAmount: String(i.ratioAmount), ratioUnit: i.ratioUnit })));
                            setMixFormOpen(true);
                          }}>
                            <Pencil className="w-3.5 h-3.5" />
                          </Button>
                          <Button variant="ghost" size="icon" className="w-7 h-7 text-muted-foreground hover:text-destructive" onClick={() => {
                            if (!window.confirm(`Delete ${m.name}?`)) return;
                            deleteChemMixture.mutate({ id: m.id }, {
                              onSuccess: () => { toast.success('Mixture deleted'); qc.invalidateQueries({ queryKey: getListChemicalMixturesQueryKey() }); },
                              onError: () => toast.error('Failed to delete'),
                            });
                          }}>
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Product Form Sheet */}
          <Sheet open={prodFormOpen} onOpenChange={open => { if (!open) { setProdFormOpen(false); setEditingProd(null); } }}>
            <SheetContent className="w-full sm:max-w-md overflow-y-auto">
              <SheetHeader className="pb-4">
                <SheetTitle>{editingProd ? 'Edit Product' : 'Add Chemical Product'}</SheetTitle>
                <SheetDescription>Fill in the product details for your chemical library.</SheetDescription>
              </SheetHeader>
              <div className="space-y-4 pb-6">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Product Name <span className="text-destructive">*</span></label>
                  <Input placeholder="e.g. RoundUp Pro Concentrate" value={prodForm.name} onChange={e => setProdForm(f => ({ ...f, name: e.target.value }))} />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">EPA Reg #</label>
                    <Input placeholder="524-343" value={prodForm.epaRegNumber} onChange={e => setProdForm(f => ({ ...f, epaRegNumber: e.target.value }))} />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">Signal Word</label>
                    <Select value={prodForm.signalWord} onValueChange={v => setProdForm(f => ({ ...f, signalWord: v }))}>
                      <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">None</SelectItem>
                        <SelectItem value="CAUTION">CAUTION</SelectItem>
                        <SelectItem value="WARNING">WARNING</SelectItem>
                        <SelectItem value="DANGER">DANGER</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Active Ingredients</label>
                  <Input placeholder="e.g. Glyphosate 41%" value={prodForm.activeIngredients} onChange={e => setProdForm(f => ({ ...f, activeIngredients: e.target.value }))} />
                </div>
                <div className="grid grid-cols-3 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">Unit</label>
                    <Select value={prodForm.unit} onValueChange={v => setProdForm(f => ({ ...f, unit: v }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="oz">oz</SelectItem>
                        <SelectItem value="fl oz">fl oz</SelectItem>
                        <SelectItem value="lb">lb</SelectItem>
                        <SelectItem value="gal">gal</SelectItem>
                        <SelectItem value="l">L</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">REI (hrs)</label>
                    <Input type="number" min={0} placeholder="4" value={prodForm.rei} onChange={e => setProdForm(f => ({ ...f, rei: e.target.value }))} />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">PHI (days)</label>
                    <Input type="number" min={0} placeholder="0" value={prodForm.phi} onChange={e => setProdForm(f => ({ ...f, phi: e.target.value }))} />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Label / SDS URL</label>
                  <Input placeholder="https://…" value={prodForm.labelSdsUrl} onChange={e => setProdForm(f => ({ ...f, labelSdsUrl: e.target.value }))} />
                </div>
                <Separator />
                <div className="flex gap-3 justify-end">
                  <Button variant="outline" onClick={() => setProdFormOpen(false)}>Cancel</Button>
                  <Button onClick={() => {
                    if (!prodForm.name) { toast.error('Name is required'); return; }
                    const data = {
                      name: prodForm.name,
                      epaRegNumber: prodForm.epaRegNumber || undefined,
                      activeIngredients: prodForm.activeIngredients || undefined,
                      signalWord: (prodForm.signalWord && prodForm.signalWord !== 'none') ? prodForm.signalWord as 'CAUTION' | 'WARNING' | 'DANGER' : undefined,
                      rei: prodForm.rei ? parseInt(prodForm.rei, 10) : undefined,
                      phi: prodForm.phi ? parseInt(prodForm.phi, 10) : undefined,
                      labelSdsUrl: prodForm.labelSdsUrl || undefined,
                      unit: prodForm.unit,
                    };
                    if (editingProd) {
                      updateChemProduct.mutate({ id: editingProd.id, data }, {
                        onSuccess: () => { toast.success('Product updated'); qc.invalidateQueries({ queryKey: getListChemicalProductsQueryKey() }); setProdFormOpen(false); },
                        onError: () => toast.error('Failed to update'),
                      });
                    } else {
                      createChemProduct.mutate({ data }, {
                        onSuccess: () => { toast.success('Product added'); qc.invalidateQueries({ queryKey: getListChemicalProductsQueryKey() }); setProdFormOpen(false); },
                        onError: () => toast.error('Failed to add product'),
                      });
                    }
                  }} disabled={createChemProduct.isPending || updateChemProduct.isPending}>
                    {editingProd ? 'Save Changes' : 'Add Product'}
                  </Button>
                </div>
              </div>
            </SheetContent>
          </Sheet>

          {/* Mixture Form Sheet */}
          <Sheet open={mixFormOpen} onOpenChange={open => { if (!open) { setMixFormOpen(false); setEditingMix(null); } }}>
            <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
              <SheetHeader className="pb-4">
                <SheetTitle>{editingMix ? 'Edit Mixture' : 'Add Tank Mixture'}</SheetTitle>
                <SheetDescription>Define a named mix by specifying how much of each product goes into a gallon of solution.</SheetDescription>
              </SheetHeader>
              <div className="space-y-4 pb-6">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Mixture Name <span className="text-destructive">*</span></label>
                  <Input placeholder="e.g. Broadleaf Control Mix" value={mixForm.name} onChange={e => setMixForm(f => ({ ...f, name: e.target.value }))} />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Description</label>
                  <Input placeholder="What is this mixture used for?" value={mixForm.description} onChange={e => setMixForm(f => ({ ...f, description: e.target.value }))} />
                </div>

                <Separator />
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium">Products in this mixture</p>
                  <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={() => setMixItems(items => [...items, { productId: '', ratioAmount: '', ratioUnit: 'oz' }])}>
                    <Plus className="w-3 h-3" /> Add Product
                  </Button>
                </div>
                {mixItems.length === 0 && <p className="text-sm text-muted-foreground">Add at least one product to define the mixture ratio.</p>}
                <div className="space-y-3">
                  {mixItems.map((item, i) => (
                    <div key={i} className="flex gap-2 items-end">
                      <div className="flex-1 space-y-1">
                        <label className="text-xs text-muted-foreground">Product</label>
                        <Select value={item.productId} onValueChange={v => setMixItems(items => items.map((x, j) => j === i ? { ...x, productId: v } : x))}>
                          <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="Select…" /></SelectTrigger>
                          <SelectContent>
                            {(chemProducts ?? []).filter(p => p.isActive).map(p => (
                              <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="w-20 space-y-1">
                        <label className="text-xs text-muted-foreground">Amount</label>
                        <Input className="h-8 text-sm" type="number" min={0} step={0.1} placeholder="2" value={item.ratioAmount} onChange={e => setMixItems(items => items.map((x, j) => j === i ? { ...x, ratioAmount: e.target.value } : x))} />
                      </div>
                      <div className="w-24 space-y-1">
                        <label className="text-xs text-muted-foreground">Unit/gal</label>
                        <Select value={item.ratioUnit} onValueChange={v => setMixItems(items => items.map((x, j) => j === i ? { ...x, ratioUnit: v } : x))}>
                          <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="oz">oz</SelectItem>
                            <SelectItem value="fl oz">fl oz</SelectItem>
                            <SelectItem value="lb">lb</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive mb-0.5" onClick={() => setMixItems(items => items.filter((_, j) => j !== i))}>
                        <X className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  ))}
                </div>

                <Separator />
                <div className="flex gap-3 justify-end">
                  <Button variant="outline" onClick={() => setMixFormOpen(false)}>Cancel</Button>
                  <Button onClick={() => {
                    if (!mixForm.name) { toast.error('Name is required'); return; }
                    const data = {
                      name: mixForm.name,
                      description: mixForm.description || undefined,
                      items: mixItems.filter(i => i.productId && i.ratioAmount).map(i => ({
                        productId: parseInt(i.productId, 10),
                        ratioAmount: parseFloat(i.ratioAmount),
                        ratioUnit: i.ratioUnit,
                      })),
                    };
                    if (editingMix) {
                      updateChemMixture.mutate({ id: editingMix.id, data }, {
                        onSuccess: () => { toast.success('Mixture updated'); qc.invalidateQueries({ queryKey: getListChemicalMixturesQueryKey() }); setMixFormOpen(false); },
                        onError: () => toast.error('Failed to update'),
                      });
                    } else {
                      createChemMixture.mutate({ data }, {
                        onSuccess: () => { toast.success('Mixture created'); qc.invalidateQueries({ queryKey: getListChemicalMixturesQueryKey() }); setMixFormOpen(false); },
                        onError: () => toast.error('Failed to create'),
                      });
                    }
                  }} disabled={createChemMixture.isPending || updateChemMixture.isPending}>
                    {editingMix ? 'Save Changes' : 'Create Mixture'}
                  </Button>
                </div>
              </div>
            </SheetContent>
          </Sheet>
        </TabsContent>
      </Tabs>
    </div>
  );
}
