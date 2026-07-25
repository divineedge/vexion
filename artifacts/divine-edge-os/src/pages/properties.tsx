import React, { useState } from 'react';
import {
  useListProperties, getListPropertiesQueryKey,
  useCreateProperty,
  useListCustomers, getListCustomersQueryKey,
} from '@workspace/api-client-react';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Separator } from '@/components/ui/separator';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Search, Plus, Navigation } from 'lucide-react';
import PropertyThumbnail from '@/components/media/PropertyThumbnail';
import { useLocation } from 'wouter';
import { useDebounce } from '@/hooks/use-debounce';
import { Badge } from '@/components/ui/badge';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { ImportExportControls } from '@/components/data-io/ImportExportControls';

type NewPropertyForm = {
  customerId: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  type: string;
  notes: string;
  size: string;
  sizeUnit: string;
};

const EMPTY_FORM: NewPropertyForm = {
  customerId: '', address: '', city: '', state: '', zip: '', type: '', notes: '', size: '', sizeUnit: 'sqft',
};

export default function PropertiesPage() {
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 300);
  const [, setLocation] = useLocation();
  const qc = useQueryClient();
  const { canManageOffice } = useAuth();

  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState<NewPropertyForm>(EMPTY_FORM);
  const [typeFilter, setTypeFilter] = useState('all');
  const [geofenceFilter, setGeofenceFilter] = useState(false);
  const [sizeSortDir, setSizeSortDir] = useState<'none' | 'asc' | 'desc'>('none');

  const { data, isLoading } = useListProperties(
    { q: debouncedSearch || undefined },
    { query: { queryKey: getListPropertiesQueryKey({ q: debouncedSearch || undefined }) } }
  );

  const { data: customers } = useListCustomers({}, {
    query: { enabled: addOpen, queryKey: getListCustomersQueryKey({}) },
  });

  const createProperty = useCreateProperty();

  const handleCreate = () => {
    if (!form.address || !form.customerId) {
      toast.error('Customer and address are required');
      return;
    }
    createProperty.mutate({
      data: {
        customerId: parseInt(form.customerId, 10),
        address: form.address,
        city: form.city || undefined,
        state: form.state || undefined,
        zip: form.zip || undefined,
        type: form.type || undefined,
        notes: form.notes || undefined,
        size: form.size ? parseFloat(form.size) : undefined,
        sizeUnit: form.size ? (form.sizeUnit as 'sqft' | 'acres') : undefined,
      },
    }, {
      onSuccess: (prop) => {
        const geocodeStatus = (prop as unknown as { geocodeStatus?: string }).geocodeStatus;
        if (geocodeStatus === 'failed') {
          toast.warning('Property saved, but the address could not be found on the map. Open the Satellite Map tab to place the pin manually.');
        } else {
          toast.success('Property added');
        }
        qc.invalidateQueries({ queryKey: getListPropertiesQueryKey() });
        setAddOpen(false);
        setForm(EMPTY_FORM);
        setLocation(`/properties/${prop.id}`);
      },
      onError: () => toast.error('Failed to add property'),
    });
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Properties</h1>
          <p className="text-muted-foreground mt-1">Manage job sites and geofences.</p>
        </div>
        <div className="flex items-center gap-2">
          <ImportExportControls
            entity="properties"
            entityLabel="Properties"
            exportQuery={{ q: debouncedSearch || undefined }}
            onImportComplete={() => qc.invalidateQueries({ queryKey: getListPropertiesQueryKey() })}
          />
          {canManageOffice && (
            <Button onClick={() => setAddOpen(true)} className="gap-2" title="Add a new service property">
              <Plus className="w-4 h-4" /> Add Property
            </Button>
          )}
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="p-4 border-b flex items-center gap-4 flex-wrap">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search by address or customer..."
                title="Search by property address or customer name"
                className="pl-9"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger className="w-40 h-9" title="Filter by property type">
                <SelectValue placeholder="All types" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                <SelectItem value="residential">Residential</SelectItem>
                <SelectItem value="commercial">Commercial</SelectItem>
              </SelectContent>
            </Select>
            <button
              onClick={() => setGeofenceFilter(v => !v)}
              title={geofenceFilter ? 'Showing only properties with a geofence — click to clear' : 'Filter to properties that have a geofence set'}
              className={`flex items-center gap-1.5 text-sm h-9 px-3 rounded-md border transition-colors ${geofenceFilter ? 'bg-emerald-50 border-emerald-300 text-emerald-700' : 'border-input text-muted-foreground hover:text-foreground'}`}
            >
              <Navigation className="w-3.5 h-3.5" />
              {geofenceFilter ? 'Geofence: On' : 'Has Geofence'}
            </button>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Address</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="cursor-pointer select-none hover:text-foreground" onClick={() => { if (sizeSortDir === 'none') setSizeSortDir('desc'); else setSizeSortDir(d => d === 'asc' ? 'desc' : 'asc'); }}>
                  Size {sizeSortDir !== 'none' ? (sizeSortDir === 'asc' ? '↑' : '↓') : ''}
                </TableHead>
                <TableHead>Geofence</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">Loading properties...</TableCell>
                </TableRow>
              ) : (data ?? []).filter(p => typeFilter === 'all' || p.type === typeFilter).filter(p => !geofenceFilter || !!(p as any).geofenceLat).length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">No properties found.</TableCell>
                </TableRow>
              ) : (
                (data ?? []).filter(p => typeFilter === 'all' || p.type === typeFilter).filter(p => !geofenceFilter || !!(p as any).geofenceLat).sort((a, b) => {
                  if (sizeSortDir === 'none') return 0;
                  const aS = (a as any).size ?? (a as any).serviceableAreaSqft ?? 0;
                  const bS = (b as any).size ?? (b as any).serviceableAreaSqft ?? 0;
                  return sizeSortDir === 'asc' ? aS - bS : bS - aS;
                }).map((property) => (
                  <TableRow
                    key={property.id}
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => setLocation(`/properties/${property.id}`)}
                  >
                    <TableCell>
                      <div className="flex items-start gap-2">
                        <PropertyThumbnail profilePhotoUrl={(property as any).profilePhotoUrl} />
                        <div>
                          <a
                            href={`https://maps.google.com/?q=${encodeURIComponent(property.address + ', ' + property.city + ', ' + property.state)}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            title="Open in Google Maps"
                            className="font-medium hover:underline text-primary"
                            onClick={e => e.stopPropagation()}
                          >{property.address}</a>
                          <div className="text-xs text-muted-foreground" title={`${property.city}, ${property.state} ${property.zip}`}>{property.city}, {property.state} {property.zip}</div>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <span className="text-primary hover:underline" title={`View ${property.customerName}`} onClick={(e) => { e.stopPropagation(); setLocation(`/customers/${property.customerId}`); }}>
                        {property.customerName}
                      </span>
                    </TableCell>
                    <TableCell>
                      {property.type ? <Badge variant="secondary" className="capitalize" title={`Property type: ${property.type}`}>{property.type}</Badge> : '-'}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {(property as any).size
                        ? <span title={`Property size: ${Number((property as any).size).toLocaleString()} ${(property as any).sizeUnit ?? 'sqft'}`}>{Number((property as any).size).toLocaleString()} {(property as any).sizeUnit ?? 'sqft'}</span>
                        : (property as any).serviceableAreaSqft
                        ? <span title={`Estimated serviceable area: ~${Number((property as any).serviceableAreaSqft).toLocaleString()} sqft`}>~{Number((property as any).serviceableAreaSqft).toLocaleString()} sqft</span>
                        : '—'}
                    </TableCell>
                    <TableCell>
                      {property.geofenceLat ? (
                        <div className="flex items-center gap-1 text-sm text-emerald-600 font-medium" title={`Geofence active — radius: ${property.geofenceRadius}m`}>
                          <Navigation className="w-3 h-3" /> Set ({property.geofenceRadius}m)
                        </div>
                      ) : (
                        <span className="text-sm text-muted-foreground" title="No geofence configured for this property">Not set</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Add Property Sheet */}
      <Sheet open={addOpen} onOpenChange={open => { if (!open) { setAddOpen(false); setForm(EMPTY_FORM); } }}>
        <SheetContent className="w-full sm:max-w-md overflow-y-auto">
          <SheetHeader className="pb-4">
            <SheetTitle>Add Property</SheetTitle>
            <SheetDescription>Create a new property / job site for an existing customer.</SheetDescription>
          </SheetHeader>
          <div className="space-y-4 pb-6">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Customer <span className="text-destructive">*</span></label>
              <Select value={form.customerId} onValueChange={v => setForm(f => ({ ...f, customerId: v }))}>
                <SelectTrigger title="Customer who owns or is billed for this property"><SelectValue placeholder="Select customer..." /></SelectTrigger>
                <SelectContent>
                  {(customers?.items ?? []).map(c => (
                    <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium">Street Address <span className="text-destructive">*</span></label>
              <Input title="Property street address" placeholder="123 Main St" value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} />
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5 col-span-1">
                <label className="text-sm font-medium">City</label>
                <Input title="City" placeholder="Miami" value={form.city} onChange={e => setForm(f => ({ ...f, city: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">State</label>
                <Input title="2-letter state code" placeholder="FL" value={form.state} onChange={e => setForm(f => ({ ...f, state: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">ZIP</label>
                <Input title="ZIP/postal code" placeholder="33101" value={form.zip} onChange={e => setForm(f => ({ ...f, zip: e.target.value }))} />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium">Property Type</label>
              <Select value={form.type} onValueChange={v => setForm(f => ({ ...f, type: v }))}>
                <SelectTrigger title="Property type (residential, commercial, etc.)"><SelectValue placeholder="Select type..." /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="residential">Residential</SelectItem>
                  <SelectItem value="commercial">Commercial</SelectItem>
                  <SelectItem value="industrial">Industrial</SelectItem>
                  <SelectItem value="municipal">Municipal</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium">Property Size</label>
              <div className="flex gap-2">
                <Input
                  type="number"
                  placeholder="e.g. 5000"
                  value={form.size}
                  onChange={e => setForm(f => ({ ...f, size: e.target.value }))}
                  className="flex-1"
                  title="Property size (e.g. total lot area)"
                />
                <Select value={form.sizeUnit} onValueChange={v => setForm(f => ({ ...f, sizeUnit: v }))}>
                  <SelectTrigger className="w-24" title="Unit of measurement for the property size"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="sqft">sqft</SelectItem>
                    <SelectItem value="acres">acres</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium">Notes</label>
              <Input title="Internal notes about this property (e.g. access codes, gate info)" placeholder="Access codes, gate info..." value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
            </div>

            <Separator />
            <div className="flex gap-3 justify-end">
              <Button variant="outline" onClick={() => { setAddOpen(false); setForm(EMPTY_FORM); }}>Cancel</Button>
              <Button onClick={handleCreate} disabled={createProperty.isPending}>
                {createProperty.isPending ? 'Adding...' : 'Add Property'}
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
