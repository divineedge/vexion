import React, { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { customFetch } from '@workspace/api-client-react';
import { useGetTenantSettings, getGetTenantSettingsQueryKey } from '@workspace/api-client-react';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { useQueryClient as useQC } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Search, Plus, Briefcase, DollarSign, Clock, Edit, Trash2, TrendingUp } from 'lucide-react';
import { useDebounce } from '@/hooks/use-debounce';

interface Service {
  id: number;
  tenantId: number;
  name: string;
  description: string | null;
  category: string | null;
  basePrice: number;
  estimatedDuration: number | null;
  p4pPercentage: number | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

type ServiceForm = {
  name: string;
  description: string;
  category: string;
  basePrice: string;
  estimatedDuration: string;
  p4pPercentage: string;
  isActive: boolean;
};

const EMPTY_FORM: ServiceForm = {
  name: '',
  description: '',
  category: '',
  basePrice: '',
  estimatedDuration: '',
  p4pPercentage: '',
  isActive: true,
};

export default function ServicesPage() {
  const { canManageOffice } = useAuth();
  const qc = useQueryClient();

  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 300);
  const [sheetMode, setSheetMode] = useState<'create' | 'edit' | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [form, setForm] = useState<ServiceForm>(EMPTY_FORM);

  const { data: settings } = useGetTenantSettings({ query: { queryKey: getGetTenantSettingsQueryKey() } });
  const globalP4pRate = (settings as any)?.p4pMasterPercentage ?? 0;

  const { data: services, isLoading } = useQuery<Service[]>({
    queryKey: ['services', debouncedSearch],
    queryFn: () => {
      const params = new URLSearchParams();
      if (debouncedSearch) params.set('q', debouncedSearch);
      return customFetch<Service[]>(`/api/services?${params}`);
    },
  });

  const createMutation = useMutation({
    mutationFn: (data: Partial<ServiceForm>) =>
      customFetch<Service>('/api/services', { method: 'POST', body: JSON.stringify(data), headers: { 'Content-Type': 'application/json' } }),
    onSuccess: () => {
      toast.success('Service created');
      qc.invalidateQueries({ queryKey: ['services'] });
      setSheetMode(null);
    },
    onError: () => toast.error('Failed to create service'),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<ServiceForm> }) =>
      customFetch<Service>(`/api/services/${id}`, { method: 'PATCH', body: JSON.stringify(data), headers: { 'Content-Type': 'application/json' } }),
    onSuccess: () => {
      toast.success('Service updated');
      qc.invalidateQueries({ queryKey: ['services'] });
      setSheetMode(null);
    },
    onError: () => toast.error('Failed to update service'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) =>
      customFetch(`/api/services/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast.success('Service deleted');
      qc.invalidateQueries({ queryKey: ['services'] });
      setSheetMode(null);
    },
    onError: () => toast.error('Failed to delete service'),
  });

  const openCreate = () => {
    setForm(EMPTY_FORM);
    setSelectedId(null);
    setSheetMode('create');
  };

  const openEdit = (s: Service) => {
    setForm({
      name: s.name,
      description: s.description ?? '',
      category: s.category ?? '',
      basePrice: String(s.basePrice),
      estimatedDuration: s.estimatedDuration != null ? String(s.estimatedDuration) : '',
      p4pPercentage: s.p4pPercentage != null ? String(s.p4pPercentage) : '',
      isActive: s.isActive,
    });
    setSelectedId(s.id);
    setSheetMode('edit');
  };

  const handleSave = () => {
    if (!form.name) { toast.error('Service name is required'); return; }
    // Send as strings; the API route parses them
    const payload: Partial<ServiceForm> = {
      name: form.name,
      description: form.description,
      category: form.category,
      basePrice: form.basePrice,
      estimatedDuration: form.estimatedDuration,
      p4pPercentage: form.p4pPercentage,
      isActive: form.isActive,
    };

    if (sheetMode === 'create') {
      createMutation.mutate(payload);
    } else if (sheetMode === 'edit' && selectedId) {
      updateMutation.mutate({ id: selectedId, data: payload });
    }
  };

  const activeCount = services?.filter(s => s.isActive).length ?? 0;
  const categories = [...new Set(services?.map(s => s.category).filter(Boolean) ?? [])];

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Service Catalog</h1>
          <p className="text-muted-foreground mt-1">Define the services your company offers and their pricing.</p>
        </div>
        {canManageOffice && (
          <Button className="gap-2" onClick={openCreate}>
            <Plus className="w-4 h-4" /> Add Service
          </Button>
        )}
      </div>

      {/* Summary row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-6 flex items-center gap-4">
            <div className="w-10 h-10 rounded-full bg-primary/10 text-primary flex items-center justify-center">
              <Briefcase className="w-5 h-5" />
            </div>
            <div>
              <p className="text-3xl font-bold">{activeCount}</p>
              <p className="text-sm text-muted-foreground">Active Services</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6 flex items-center gap-4">
            <div className="w-10 h-10 rounded-full bg-blue-500/10 text-blue-600 flex items-center justify-center">
              <DollarSign className="w-5 h-5" />
            </div>
            <div>
              <p className="text-3xl font-bold">{categories.length}</p>
              <p className="text-sm text-muted-foreground">Categories</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6 flex items-center gap-4">
            <div className="w-10 h-10 rounded-full bg-emerald-500/10 text-emerald-600 flex items-center justify-center">
              <TrendingUp className="w-5 h-5" />
            </div>
            <div>
              <p className="text-3xl font-bold">{globalP4pRate}%</p>
              <p className="text-sm text-muted-foreground">Global P4P Rate</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <div className="p-4 border-b">
            <div className="relative max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search services..."
                className="pl-9"
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Service</TableHead>
                <TableHead>Category</TableHead>
                <TableHead className="text-right">Base Price</TableHead>
                <TableHead className="text-right">Duration</TableHead>
                <TableHead className="text-right">P4P Rate</TableHead>
                <TableHead className="text-center">Status</TableHead>
                {canManageOffice && <TableHead className="w-[60px]" />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={7} className="py-8 text-center text-muted-foreground">Loading services...</TableCell></TableRow>
              ) : (services ?? []).length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-12 text-center text-muted-foreground">
                    <Briefcase className="w-10 h-10 mx-auto mb-3 opacity-30" />
                    <p className="font-medium">No services yet</p>
                    <p className="text-sm mt-1">Add your first service to start building your catalog.</p>
                  </TableCell>
                </TableRow>
              ) : (
                (services ?? []).map(s => (
                  <TableRow key={s.id} className={`hover:bg-muted/50 ${!s.isActive ? 'opacity-60' : ''}`}>
                    <TableCell>
                      <div className="font-medium">{s.name}</div>
                      {s.description && <div className="text-xs text-muted-foreground truncate max-w-xs mt-0.5">{s.description}</div>}
                    </TableCell>
                    <TableCell>
                      {s.category ? <Badge variant="outline">{s.category}</Badge> : <span className="text-muted-foreground text-sm">—</span>}
                    </TableCell>
                    <TableCell className="text-right font-medium">${s.basePrice.toFixed(2)}</TableCell>
                    <TableCell className="text-right text-sm text-muted-foreground">
                      {s.estimatedDuration != null ? (
                        <span className="flex items-center justify-end gap-1">
                          <Clock className="w-3.5 h-3.5" />
                          {s.estimatedDuration >= 60
                            ? `${Math.floor(s.estimatedDuration / 60)}h ${s.estimatedDuration % 60 > 0 ? `${s.estimatedDuration % 60}m` : ''}`
                            : `${s.estimatedDuration}m`}
                        </span>
                      ) : '—'}
                    </TableCell>
                    <TableCell className="text-right">
                      {s.p4pPercentage != null ? (
                        <span className="text-xs bg-primary/10 text-primary px-1.5 py-0.5 rounded font-medium">
                          {s.p4pPercentage}%
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">Global ({globalP4pRate}%)</span>
                      )}
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge variant={s.isActive ? 'default' : 'secondary'} className={s.isActive ? 'bg-emerald-100 text-emerald-700 border-emerald-200' : ''}>
                        {s.isActive ? 'Active' : 'Inactive'}
                      </Badge>
                    </TableCell>
                    {canManageOffice && (
                      <TableCell>
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(s)}>
                          <Edit className="w-4 h-4" />
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Create / Edit Sheet */}
      <Sheet open={sheetMode !== null} onOpenChange={open => { if (!open) setSheetMode(null); }}>
        <SheetContent className="w-full sm:max-w-md overflow-y-auto">
          <SheetHeader className="pb-4">
            <SheetTitle>{sheetMode === 'create' ? 'Add Service' : 'Edit Service'}</SheetTitle>
            <SheetDescription>
              {sheetMode === 'create'
                ? 'Add a service to your catalog. Customers can be booked for any of these.'
                : 'Update the service details.'}
            </SheetDescription>
          </SheetHeader>

          <div className="space-y-4 pb-6">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Service Name <span className="text-destructive">*</span></label>
              <Input
                placeholder="e.g. Full Lawn Service"
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium">Category</label>
              <Input
                placeholder="e.g. Landscaping, Irrigation"
                value={form.category}
                onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium">Description</label>
              <Textarea
                placeholder="What does this service include?"
                rows={3}
                value={form.description}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              />
            </div>

            <Separator />

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Base Price ($)</label>
                <Input
                  type="number"
                  step="0.01"
                  placeholder="0.00"
                  value={form.basePrice}
                  onChange={e => setForm(f => ({ ...f, basePrice: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Est. Duration (min)</label>
                <Input
                  type="number"
                  min={0}
                  placeholder="e.g. 60"
                  value={form.estimatedDuration}
                  onChange={e => setForm(f => ({ ...f, estimatedDuration: e.target.value }))}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium">P4P Payout Rate (%)</label>
              <Input
                type="number"
                step="0.1"
                placeholder={`Leave blank to use global (${globalP4pRate}%)`}
                value={form.p4pPercentage}
                onChange={e => setForm(f => ({ ...f, p4pPercentage: e.target.value }))}
              />
              <p className="text-xs text-muted-foreground">
                Override the global P4P rate for this specific service. Leave blank to inherit the global rate.
              </p>
            </div>

            <Separator />

            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">Active</p>
                <p className="text-xs text-muted-foreground">Inactive services are hidden from scheduling.</p>
              </div>
              <Switch
                checked={form.isActive}
                onCheckedChange={v => setForm(f => ({ ...f, isActive: v }))}
              />
            </div>

            <Separator />

            {sheetMode === 'edit' && selectedId && (
              <Button
                variant="ghost"
                className="text-destructive hover:text-destructive w-full gap-2"
                onClick={() => deleteMutation.mutate(selectedId)}
                disabled={deleteMutation.isPending}
              >
                <Trash2 className="w-4 h-4" /> Delete Service
              </Button>
            )}

            <div className="flex gap-3 justify-end">
              <Button variant="outline" onClick={() => setSheetMode(null)}>Cancel</Button>
              <Button onClick={handleSave} disabled={createMutation.isPending || updateMutation.isPending}>
                {createMutation.isPending || updateMutation.isPending ? 'Saving...' : sheetMode === 'create' ? 'Create Service' : 'Save Changes'}
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
