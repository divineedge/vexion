import React, { useState, lazy, Suspense } from 'react';
import {
  useGetProperty, getGetPropertyQueryKey,
  useUpdateProperty,
  useUpdateGeofencePin,
  useListJobs, getListJobsQueryKey,
  useListCustomers, getListCustomersQueryKey,
  useTransferProperty,
  useUpdatePropertyMeasurements,
  useListPropertyQuotes, getListPropertyQuotesQueryKey,
  useGetTenantSettings,
  useListPropertyMedia, getListPropertyMediaQueryKey,
  useListBlueprints, getListBlueprintsQueryKey,
  useListRepairLogs, getListRepairLogsQueryKey,
  useCreateRepairLog,
  useGetRepairLogSummary, getGetRepairLogSummaryQueryKey,
  useDeleteRepairLog,
  useListUsers, getListUsersQueryKey,
  useUpdateBlueprint,
  customFetch,
} from '@workspace/api-client-react';
import type { MeasurementZone, Quote } from '@workspace/api-client-react';
import { useParams, useLocation } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Separator } from '@/components/ui/separator';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem } from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  ArrowLeft, Edit, MapPin, Navigation, Calendar, Save, GitMerge,
  AlertTriangle, Clock, ChevronDown, Check, ArrowRight, Satellite,
  Calculator, ExternalLink, Copy, Ruler, Images, DraftingCompass, Archive, ArchiveRestore,
  Wrench, Plus, Trash2, DollarSign, TrendingUp, BarChart3,
} from 'lucide-react';
import MediaGallery from '@/components/media/MediaGallery';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

const PropertySatelliteMap = lazy(() => import('@/components/map/PropertySatelliteMap'));
const QuickQuotePanel = lazy(() => import('@/components/property/QuickQuotePanel'));

const STATUS_COLORS: Record<string, string> = {
  completed: 'bg-emerald-500/10 text-emerald-700 border-transparent',
  in_progress: 'bg-blue-500/10 text-blue-700 border-transparent',
  scheduled: 'bg-amber-500/10 text-amber-700 border-transparent',
  on_hold: 'bg-gray-200 text-gray-600 border-transparent',
  cancelled: 'bg-red-500/10 text-red-600 border-transparent',
};

const QUOTE_STATUS_COLORS: Record<string, string> = {
  pending: 'bg-amber-500/10 text-amber-700 border-transparent',
  approved: 'bg-emerald-500/10 text-emerald-700 border-transparent',
  declined: 'bg-red-500/10 text-red-600 border-transparent',
};

interface OwnershipRecord {
  id: number;
  previousCustomerId: number | null;
  previousCustomerName: string | null;
  newCustomerId: number | null;
  newCustomerName: string | null;
  notes: string | null;
  transferredAt: string;
}

export default function PropertyDetailPage() {
  const params = useParams();
  const id = Number(params.id);
  const [, setLocation] = useLocation();
  const qc = useQueryClient();

  const [editing, setEditing] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [ownershipHistory, setOwnershipHistory] = useState<OwnershipRecord[]>([]);
  const [ownershipLoading, setOwnershipLoading] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({});
  const [geoInput, setGeoInput] = useState({ lat: '', lng: '', radius: '50' });
  const [transferForm, setTransferForm] = useState({ newCustomerId: '', notes: '', customerSearch: '' });
  const [customerPickerOpen, setCustomerPickerOpen] = useState(false);
  const [savingMeasurements, setSavingMeasurements] = useState(false);
  const [geocodeFailed, setGeocodeFailed] = useState(false);
  const [activeTab, setActiveTab] = useState('satellite');

  // ── Repair log state ──────────────────────────────────────────────────────
  const [repairDialogOpen, setRepairDialogOpen] = useState(false);
  const [repairFilterElementId, setRepairFilterElementId] = useState<string | null>(null);
  const EMPTY_REPAIR = {
    componentType: 'sprinkler', replacedWhat: '', replacedWithName: '',
    nozzleBrand: '', nozzleType: '', nozzleGpm: '', nozzleRadiusFt: '', nozzleArcDegrees: '',
    partsCost: '', laborCost: '', notes: '', performedAt: '',
  };
  const [repairForm, setRepairForm] = useState(EMPTY_REPAIR);

  const { data: property, isLoading } = useGetProperty(id, {
    query: { enabled: !!id, queryKey: getGetPropertyQueryKey(id) },
  });
  const { data: jobs } = useListJobs(
    { propertyId: id } as Parameters<typeof useListJobs>[0],
    { query: { enabled: !!id, queryKey: getListJobsQueryKey({ propertyId: id } as Parameters<typeof useListJobs>[0]) } },
  );
  const { data: allCustomers } = useListCustomers(
    { limit: 200 },
    { query: { queryKey: getListCustomersQueryKey({ limit: 200 }) } },
  );
  const { data: quotes } = useListPropertyQuotes(id, {
    query: { enabled: !!id, queryKey: getListPropertyQuotesQueryKey(id) },
  });
  const { data: propertyMedia, refetch: refetchPropertyMedia } = useListPropertyMedia(id, {
    query: { enabled: !!id, queryKey: getListPropertyMediaQueryKey(id) },
  });
  // includeArchived: true — this property page is the one place archived blueprints (from a completed
  // job or a declined estimate) stay visible and reusable, even though they're hidden from the main list.
  const { data: propertyBlueprints } = useListBlueprints(
    { propertyId: id, includeArchived: true } as Parameters<typeof useListBlueprints>[0],
    { query: { enabled: !!id, queryKey: getListBlueprintsQueryKey({ propertyId: id, includeArchived: true } as Parameters<typeof useListBlueprints>[0]) } },
  );
  const { data: tenantSettings } = useGetTenantSettings();

  // ── Repair log data ────────────────────────────────────────────────────
  const repairLogsQuery = { propertyId: id } as Parameters<typeof useListRepairLogs>[0];
  const { data: repairLogs, refetch: refetchRepairLogs } = useListRepairLogs(repairLogsQuery, {
    query: { enabled: !!id, queryKey: getListRepairLogsQueryKey(repairLogsQuery) },
  });
  const { data: repairSummary } = useGetRepairLogSummary(
    { propertyId: id } as Parameters<typeof useGetRepairLogSummary>[0],
    { query: { enabled: !!id, queryKey: getGetRepairLogSummaryQueryKey({ propertyId: id } as Parameters<typeof useGetRepairLogSummary>[0]) } },
  );
  const { data: allUsers } = useListUsers({
    query: { queryKey: getListUsersQueryKey() },
  });
  const createRepairLog = useCreateRepairLog();
  const deleteRepairLog = useDeleteRepairLog();

  const preferredAreaUnit = (tenantSettings?.preferredAreaUnit as 'sqft' | 'acres') ?? 'sqft';
  const ZONE_COLORS = ['#3B82F6','#10B981','#F59E0B','#EF4444','#8B5CF6','#06B6D4','#84CC16','#F97316','#EC4899','#6366F1'];
  const rawZoneTypes = (tenantSettings as any)?.measurementZoneTypes as Array<{ id: string; name: string; color: string }> | undefined;
  const zoneTypes = rawZoneTypes && rawZoneTypes.length > 0
    ? rawZoneTypes
    : ((tenantSettings?.measurementZoneLabels as string[] | undefined) ?? ['Front Lawn', 'Back Yard', 'Bed Areas', 'Side Yard', 'Common Area'])
        .map((name, i) => ({ id: String(i + 1), name, color: ZONE_COLORS[i % ZONE_COLORS.length] }));
  const defaultGeofenceRadius = tenantSettings?.defaultGeofenceRadius ?? 100;

  const updateProperty = useUpdateProperty();
  const updateGeofence = useUpdateGeofencePin();
  const transferProperty = useTransferProperty();
  const updateMeasurements = useUpdatePropertyMeasurements();
  const updateBlueprint = useUpdateBlueprint();

  const handleUnarchiveBlueprint = (e: React.MouseEvent, bpId: number) => {
    e.stopPropagation();
    updateBlueprint.mutate(
      { id: bpId, data: { isArchived: false } },
      {
        onSuccess: () => {
          toast.success('Blueprint restored');
          qc.invalidateQueries({ queryKey: getListBlueprintsQueryKey({ propertyId: id, includeArchived: true } as Parameters<typeof useListBlueprints>[0]) });
        },
        onError: () => toast.error('Failed to restore blueprint'),
      },
    );
  };

  React.useEffect(() => {
    if (property) {
      setForm({
        address: property.address ?? '',
        city: property.city ?? '',
        state: property.state ?? '',
        zip: property.zip ?? '',
        type: property.type ?? '',
        notes: property.notes ?? '',
        size: property.size != null ? String(property.size) : '',
        sizeUnit: property.sizeUnit ?? 'sqft',
      });
      if (property.geofenceLat) {
        setGeoInput({
          lat: property.geofenceLat.toString(),
          lng: (property.geofenceLng ?? '').toString(),
          radius: (property.geofenceRadius ?? 50).toString(),
        });
      }
    }
  }, [property]);

  const loadOwnershipHistory = async () => {
    if (ownershipHistory.length > 0) return;
    setOwnershipLoading(true);
    try {
      const data = await customFetch<OwnershipRecord[]>(`/api/properties/${id}/ownership-history`);
      setOwnershipHistory(data);
    } catch {
      // silently fail
    } finally {
      setOwnershipLoading(false);
    }
  };

  const handleSaveEdit = () => {
    const sizeVal = form.size !== '' ? parseFloat(form.size) : undefined;
    const payload = {
      ...form,
      size: sizeVal != null && !isNaN(sizeVal) ? sizeVal : undefined,
    } as Parameters<typeof updateProperty.mutate>[0]['data'];
    updateProperty.mutate(
      { id, data: payload },
      {
        onSuccess: (result) => {
          const status = (result as unknown as { geocodeStatus?: string }).geocodeStatus;
          if (status === 'failed') {
            setGeocodeFailed(true);
          } else {
            setGeocodeFailed(false);
            toast.success('Property updated');
          }
          qc.invalidateQueries({ queryKey: getGetPropertyQueryKey(id) });
          setEditing(false);
        },
        onError: () => toast.error('Failed to update property'),
      },
    );
  };

  const handleSaveGeofence = () => {
    const lat = parseFloat(geoInput.lat);
    const lng = parseFloat(geoInput.lng);
    const radius = parseFloat(geoInput.radius);
    if (isNaN(lat) || isNaN(lng)) { toast.error('Invalid coordinates'); return; }
    updateGeofence.mutate(
      { id, data: { lat, lng, radius } },
      {
        onSuccess: () => { toast.success('Geofence updated'); qc.invalidateQueries({ queryKey: getGetPropertyQueryKey(id) }); },
        onError: () => toast.error('Failed to update geofence'),
      },
    );
  };

  const handleTransfer = () => {
    if (!transferForm.newCustomerId) { toast.error('Please select a customer'); return; }
    transferProperty.mutate(
      { id, data: { newCustomerId: Number(transferForm.newCustomerId), notes: transferForm.notes || undefined } as Parameters<typeof transferProperty.mutate>[0]['data'] },
      {
        onSuccess: (updated) => {
          toast.success(`Property transferred to ${updated.customerName}`);
          qc.invalidateQueries({ queryKey: getGetPropertyQueryKey(id) });
          setOwnershipHistory([]);
          setTransferOpen(false);
          setTransferForm({ newCustomerId: '', notes: '', customerSearch: '' });
        },
        onError: () => toast.error('Transfer failed'),
      },
    );
  };

  const handleMeasurementsChange = (zones: MeasurementZone[], totalSqft: number) => {
    setSavingMeasurements(true);
    updateMeasurements.mutate(
      {
        id,
        data: {
          measurementPolygons: zones,
          serviceableAreaSqft: totalSqft || undefined,
        },
      },
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: getGetPropertyQueryKey(id) });
          setSavingMeasurements(false);
        },
        onError: () => {
          toast.error('Failed to save measurements');
          setSavingMeasurements(false);
        },
      },
    );
  };

  const handlePinChange = (lat: number, lng: number) => {
    updateProperty.mutate(
      { id, data: { lat, lng } },
      {
        onSuccess: () => qc.invalidateQueries({ queryKey: getGetPropertyQueryKey(id) }),
      },
    );
  };

  const handleGeofenceChange = (lat: number, lng: number, radius: number) => {
    updateGeofence.mutate(
      { id, data: { lat, lng, radius } },
      {
        onSuccess: () => {
          toast.success('Geofence saved');
          qc.invalidateQueries({ queryKey: getGetPropertyQueryKey(id) });
        },
        onError: () => toast.error('Failed to save geofence'),
      },
    );
  };

  const handleAutoMeasure = async () => {
    try {
      const result = await customFetch<{ lat: number; lng: number; boundaryPolygon?: [number, number][] | null }>(
        `/api/properties/${id}/geocode`
      );
      if (result.lat && result.lng) {
        await updateProperty.mutateAsync({ id, data: { lat: result.lat, lng: result.lng } });
        qc.invalidateQueries({ queryKey: getGetPropertyQueryKey(id) });
        toast.success('Location detected! Adjust the pin if needed.');
      }
    } catch {
      toast.error('Could not detect location automatically');
    }
  };

  const copyQuoteLink = (token: string) => {
    const url = `${window.location.origin}${import.meta.env.BASE_URL.replace(/\/$/, '')}/quote/${token}`;
    navigator.clipboard.writeText(url).then(() => toast.success('Quote link copied!'));
  };

  const openQuoteLink = (token: string) => {
    const url = `${window.location.origin}${import.meta.env.BASE_URL.replace(/\/$/, '')}/quote/${token}`;
    window.open(url, '_blank');
  };

  const selectedCustomer = allCustomers?.items.find(c => String(c.id) === transferForm.newCustomerId);
  const filteredCustomers = (allCustomers?.items ?? []).filter(c =>
    String(c.id) !== String(property?.customerId) &&
    (c.name.toLowerCase().includes(transferForm.customerSearch.toLowerCase()) ||
      (c.company ?? '').toLowerCase().includes(transferForm.customerSearch.toLowerCase()))
  );

  const currentZones = (property?.measurementPolygons ?? []) as MeasurementZone[];

  if (isLoading) return <div className="p-8 text-center text-muted-foreground">Loading...</div>;
  if (!property) return <div className="p-8 text-center text-muted-foreground">Property not found.</div>;

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      {/* Header */}
      <div className="flex items-start gap-4">
        <Button variant="ghost" size="icon" onClick={() => setLocation('/properties')}>
          <ArrowLeft className="w-5 h-5" />
        </Button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3">
            <MapPin className="w-6 h-6 text-primary shrink-0" />
            <h1 className="text-3xl font-bold tracking-tight truncate">{property.address}</h1>
          </div>
          <div className="flex items-center gap-4 mt-2 text-sm text-muted-foreground flex-wrap">
            <span>{[property.city, property.state, property.zip].filter(Boolean).join(', ')}</span>
            {property.type && <Badge variant="secondary" className="capitalize">{property.type}</Badge>}
            {property.serviceableAreaSqft && (
              <span className="flex items-center gap-1">
                <Ruler className="w-3.5 h-3.5" />
                {property.serviceableAreaSqft.toLocaleString(undefined, { maximumFractionDigits: 0 })} sqft
              </span>
            )}
            <span>
              Owner:{' '}
              <button
                className="text-primary hover:underline font-medium"
                onClick={() => setLocation(`/customers/${property.customerId}`)}
              >
                {property.customerName}
              </button>
            </span>
          </div>
        </div>
        <div className="flex gap-2 shrink-0 flex-wrap">
          <Button variant="outline" onClick={() => setTransferOpen(true)} className="gap-2">
            <GitMerge className="w-4 h-4" /> Transfer
          </Button>
          <Button onClick={() => setEditing(true)} className="gap-2">
            <Edit className="w-4 h-4" /> Edit
          </Button>
        </div>
      </div>

      {geocodeFailed && (
        <div className="flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
          <div className="flex-1">
            <p className="font-medium">Address not found on the map</p>
            <p className="mt-0.5 text-amber-800 dark:text-amber-300">
              The address could not be geocoded — the map pin is missing. Check for typos or an incomplete address, then save again.{' '}
              <button
                className="font-medium underline underline-offset-2 hover:text-amber-900 dark:hover:text-amber-100"
                onClick={() => { setActiveTab('satellite'); setGeocodeFailed(false); }}
              >
                Place pin manually on Satellite Map →
              </button>
            </p>
          </div>
          <button
            aria-label="Dismiss"
            className="text-amber-600 hover:text-amber-900 dark:text-amber-400 dark:hover:text-amber-100"
            onClick={() => setGeocodeFailed(false)}
          >
            ✕
          </button>
        </div>
      )}

      <Tabs value={activeTab} className="w-full" onValueChange={v => { setActiveTab(v); if (v === 'history') loadOwnershipHistory(); }}>
        <TabsList className="mb-4 flex flex-wrap h-auto gap-1">
          <TabsTrigger value="satellite" className="gap-1.5">
            <Satellite className="w-4 h-4" /> Satellite Map
          </TabsTrigger>
          <TabsTrigger value="quote" className="gap-1.5">
            <Calculator className="w-4 h-4" /> Quick Quote
          </TabsTrigger>
          <TabsTrigger value="details">Details & Geofence</TabsTrigger>
          <TabsTrigger value="jobs">Jobs ({jobs?.length ?? 0})</TabsTrigger>
          <TabsTrigger value="quotes">Quotes ({quotes?.length ?? 0})</TabsTrigger>
          <TabsTrigger value="blueprints" className="gap-1.5">
            <DraftingCompass className="w-4 h-4" /> Blueprints ({propertyBlueprints?.length ?? 0})
          </TabsTrigger>
          <TabsTrigger value="media" className="gap-1.5">
            <Images className="w-4 h-4" /> Media ({propertyMedia?.length ?? 0})
          </TabsTrigger>
          <TabsTrigger value="repairs" className="gap-1.5">
            <Wrench className="w-4 h-4" /> Repairs ({repairLogs?.length ?? 0})
          </TabsTrigger>
          <TabsTrigger value="history">Ownership History</TabsTrigger>
        </TabsList>

        {/* ── Satellite Map tab ── */}
        <TabsContent value="satellite" className="focus-visible:outline-none space-y-4">
          <Card>
            <CardHeader>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <Satellite className="w-5 h-5 text-primary" /> Satellite View & Measurements
                  </CardTitle>
                  <CardDescription>
                    Draw labeled zones on the satellite map to measure serviceable areas. Drag the pin to set the property location.
                    {savingMeasurements && <span className="ml-2 text-primary animate-pulse">Saving...</span>}
                  </CardDescription>
                </div>
                {(!property.lat || !property.lng) && (
                  <Button size="sm" variant="outline" onClick={handleAutoMeasure} className="gap-2 shrink-0">
                    <MapPin className="w-4 h-4" /> Auto-Detect Location
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent>
              <Suspense fallback={<div className="h-80 flex items-center justify-center text-muted-foreground">Loading map...</div>}>
                <PropertySatelliteMap
                  lat={property.lat}
                  lng={property.lng}
                  address={property.address}
                  measurementPolygons={currentZones as import('@/components/map/PropertySatelliteMap').MeasurementZone[]}
                  geofenceRadius={property.geofenceRadius ?? defaultGeofenceRadius}
                  geofenceLat={property.geofenceLat}
                  geofenceLng={property.geofenceLng}
                  preferredAreaUnit={preferredAreaUnit}
                  zoneTypes={zoneTypes}
                  onPinChange={handlePinChange}
                  onMeasurementsChange={handleMeasurementsChange}
                  onGeofenceChange={handleGeofenceChange}
                />
              </Suspense>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Quick Quote tab ── */}
        <TabsContent value="quote" className="focus-visible:outline-none space-y-4">
          {currentZones.length === 0 && (
            <div className="rounded-lg border border-dashed p-6 text-center text-muted-foreground">
              <Ruler className="w-8 h-8 mx-auto mb-2 opacity-30" />
              <p className="text-sm">No measurement zones yet. Go to the <strong>Satellite Map</strong> tab to draw zones first.</p>
            </div>
          )}
          <Suspense fallback={<div className="h-40 flex items-center justify-center text-muted-foreground">Loading...</div>}>
            <QuickQuotePanel
              propertyId={id}
              zones={currentZones}
              preferredAreaUnit={preferredAreaUnit}
            />
          </Suspense>

          {/* Embed widget info */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Website Embed Widget</CardTitle>
              <CardDescription>
                Drop this snippet into your website so prospects can get an instant quote without calling in.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="rounded-md bg-muted/50 border p-3 font-mono text-xs overflow-x-auto whitespace-nowrap">
                {`<iframe src="${window.location.origin}${import.meta.env.BASE_URL.replace(/\/$/, '')}/widget/quote?address=${encodeURIComponent(property.address)}" width="420" height="600" frameborder="0" style="border-radius:12px;box-shadow:0 4px 24px rgba(0,0,0,0.12)"></iframe>`}
              </div>
              <Button
                size="sm"
                variant="outline"
                className="mt-3 gap-2 text-xs"
                onClick={() => {
                  const snippet = `<iframe src="${window.location.origin}${import.meta.env.BASE_URL.replace(/\/$/, '')}/widget/quote?address=${encodeURIComponent(property.address)}" width="420" height="600" frameborder="0" style="border-radius:12px;box-shadow:0 4px 24px rgba(0,0,0,0.12)"></iframe>`;
                  navigator.clipboard.writeText(snippet).then(() => toast.success('Embed code copied!'));
                }}
              >
                <Copy className="w-3 h-3" /> Copy Embed Code
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Details tab ── */}
        <TabsContent value="details" className="focus-visible:outline-none space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card>
              <CardHeader><CardTitle>Property Information</CardTitle></CardHeader>
              <CardContent className="space-y-3 text-sm">
                <Row label="Address" value={property.address} />
                <Row label="City" value={property.city} />
                <Row label="State" value={property.state} />
                <Row label="ZIP" value={property.zip} />
                <Row label="Type" value={property.type} />
                {property.lat && <Row label="Coordinates" value={`${property.lat?.toFixed(5)}, ${property.lng?.toFixed(5)}`} />}
                {property.serviceableAreaSqft && (
                  <Row label="Serviceable Area" value={`${property.serviceableAreaSqft.toLocaleString(undefined, { maximumFractionDigits: 0 })} sqft`} />
                )}
                {property.size != null && (
                  <Row label="Property Size" value={`${property.size.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${property.sizeUnit ?? 'sqft'}`} />
                )}
                {property.notes && (
                  <div>
                    <p className="text-muted-foreground mb-1">Notes</p>
                    <p className="whitespace-pre-wrap">{property.notes}</p>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Navigation className="w-5 h-5 text-primary" /> Geofence
                </CardTitle>
                <CardDescription>Set coordinates and radius to detect technician arrivals.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="w-full h-40 bg-muted/50 rounded-md border border-dashed flex items-center justify-center relative mb-4 overflow-hidden">
                  <svg width="100%" height="100%" className="absolute inset-0 opacity-10 pointer-events-none">
                    <defs>
                      <pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse">
                        <path d="M 20 0 L 0 0 0 20" fill="none" stroke="currentColor" strokeWidth="1" />
                      </pattern>
                    </defs>
                    <rect width="100%" height="100%" fill="url(#grid)" />
                  </svg>
                  {property.geofenceLat ? (
                    <div className="flex flex-col items-center z-10">
                      <div className="w-20 h-20 rounded-full bg-primary/20 border-2 border-primary/40 flex items-center justify-center">
                        <div className="w-3 h-3 bg-primary rounded-full" />
                      </div>
                      <span className="mt-2 font-mono text-xs text-muted-foreground bg-background px-2 py-0.5 rounded border shadow-sm">
                        {property.geofenceLat.toFixed(4)}, {property.geofenceLng?.toFixed(4)} · {property.geofenceRadius}m
                      </span>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center text-muted-foreground z-10">
                      <MapPin className="w-8 h-8 mb-1 opacity-40" />
                      <span className="text-sm">No pin set</span>
                    </div>
                  )}
                </div>
                <div className="grid grid-cols-3 gap-3 mb-3">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium">Latitude</label>
                    <Input placeholder="34.0522" value={geoInput.lat} onChange={e => setGeoInput(g => ({ ...g, lat: e.target.value }))} />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium">Longitude</label>
                    <Input placeholder="-118.2437" value={geoInput.lng} onChange={e => setGeoInput(g => ({ ...g, lng: e.target.value }))} />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium">Radius (m)</label>
                    <Input type="number" placeholder="50" value={geoInput.radius} onChange={e => setGeoInput(g => ({ ...g, radius: e.target.value }))} />
                  </div>
                </div>
                <Button onClick={handleSaveGeofence} disabled={updateGeofence.isPending} className="w-full">
                  {updateGeofence.isPending ? 'Saving...' : 'Set Geofence Pin'}
                </Button>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ── Jobs tab ── */}
        <TabsContent value="jobs" className="focus-visible:outline-none">
          <Card>
            <CardHeader><CardTitle>Job History at This Property</CardTitle></CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Title</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Scheduled</TableHead>
                    <TableHead>Assignee</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(jobs ?? []).map(job => (
                    <TableRow key={job.id} className="hover:bg-muted/50">
                      <TableCell className="font-medium">{job.title}</TableCell>
                      <TableCell>
                        <Badge className={`capitalize ${STATUS_COLORS[job.status] ?? ''}`}>
                          {job.status.replace(/_/g, ' ')}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {new Date(job.scheduledAt).toLocaleDateString()}
                      </TableCell>
                      <TableCell className="text-sm">{job.assigneeName ?? '-'}</TableCell>
                      <TableCell className="text-right font-medium">${(job.totalAmount ?? 0).toLocaleString()}</TableCell>
                    </TableRow>
                  ))}
                  {!jobs?.length && (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center py-12 text-muted-foreground">
                        <Calendar className="w-8 h-8 mx-auto mb-2 opacity-30" />
                        No jobs recorded at this property.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Quotes tab ── */}
        <TabsContent value="quotes" className="focus-visible:outline-none">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Calculator className="w-5 h-5" /> Instant Quotes
              </CardTitle>
              <CardDescription>All generated quotes for this property. Click a link to share with the customer.</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Service</TableHead>
                    <TableHead>Area</TableHead>
                    <TableHead>Price</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead className="text-right">Link</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(quotes ?? []).map((q: Quote) => (
                    <TableRow key={q.id}>
                      <TableCell className="font-medium">{q.serviceName}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {q.totalAreaSqft ? `${q.totalAreaSqft.toLocaleString(undefined, { maximumFractionDigits: 0 })} sqft` : '—'}
                      </TableCell>
                      <TableCell className="font-medium">${q.calculatedPrice.toFixed(2)}</TableCell>
                      <TableCell>
                        <Badge className={`capitalize ${QUOTE_STATUS_COLORS[q.status] ?? ''}`}>
                          {q.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {new Date(q.createdAt).toLocaleDateString()}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center gap-1 justify-end">
                          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => copyQuoteLink(q.token)}>
                            <Copy className="w-3 h-3" />
                          </Button>
                          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => openQuoteLink(q.token)}>
                            <ExternalLink className="w-3 h-3" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                  {!quotes?.length && (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center py-12 text-muted-foreground">
                        <Calculator className="w-8 h-8 mx-auto mb-2 opacity-30" />
                        No quotes generated yet. Use the Quick Quote tab to create one.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Blueprints tab ── */}
        <TabsContent value="blueprints" className="focus-visible:outline-none">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <DraftingCompass className="w-5 h-5" /> Blueprints
              </CardTitle>
              <CardDescription>
                Every canvas design created for this property, including archived ones. A blueprint is archived
                automatically once its job is completed or its estimate is declined — it drops off the main
                Blueprints list but stays here and remains fully reusable.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Mode</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead className="text-right">Estimate</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(propertyBlueprints ?? []).map(bp => (
                    <TableRow
                      key={bp.id}
                      className="hover:bg-muted/50 cursor-pointer"
                      onClick={() => setLocation(`/blueprints/${bp.id}`)}
                    >
                      <TableCell className="font-medium">{bp.name}</TableCell>
                      <TableCell><Badge variant="outline" className="capitalize text-[10px]">{bp.mode}</Badge></TableCell>
                      <TableCell>
                        {bp.isArchived ? (
                          <Badge variant="outline" className="gap-1 text-[10px] text-muted-foreground">
                            <Archive className="w-2.5 h-2.5" /> Archived
                          </Badge>
                        ) : (
                          <Badge className="bg-emerald-500/10 text-emerald-700 border-transparent text-[10px]">Active</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {new Date(bp.createdAt).toLocaleDateString()}
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {bp.totalEstimate != null ? `${bp.totalEstimate.toLocaleString()}` : '—'}
                      </TableCell>
                      <TableCell className="text-right">
                        {bp.isArchived && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="gap-1.5 text-xs h-7"
                            disabled={updateBlueprint.isPending}
                            onClick={e => handleUnarchiveBlueprint(e, bp.id)}
                          >
                            <ArchiveRestore className="w-3 h-3" /> Unarchive
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                  {!propertyBlueprints?.length && (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center py-12 text-muted-foreground">
                        <DraftingCompass className="w-8 h-8 mx-auto mb-2 opacity-30" />
                        No blueprints created for this property yet.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Media tab ── */}
        <TabsContent value="media" className="focus-visible:outline-none">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Images className="w-5 h-5 text-primary" /> Property Photos & Videos
              </CardTitle>
              <CardDescription>
                Upload before/after photos, damage documentation, and seasonal images. Star a photo to set it as the cover image.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <MediaGallery
                entityType="property"
                entityId={id}
                media={propertyMedia ?? []}
                onMediaAdded={() => refetchPropertyMedia()}
                onMediaDeleted={() => refetchPropertyMedia()}
                allowCover={true}
              />
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Ownership History tab ── */}
        <TabsContent value="history" className="focus-visible:outline-none">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Clock className="w-5 h-5" /> Ownership History
              </CardTitle>
              <CardDescription>
                Full record of every customer who has owned this property.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {ownershipLoading ? (
                <div className="text-center py-8 text-muted-foreground">Loading history...</div>
              ) : ownershipHistory.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  <Clock className="w-8 h-8 mx-auto mb-2 opacity-30" />
                  <p>No transfer history. This property has always been owned by{' '}
                    <button className="text-primary hover:underline" onClick={() => setLocation(`/customers/${property.customerId}`)}>
                      {property.customerName}
                    </button>.
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-center gap-4 p-4 rounded-lg border border-primary/20 bg-primary/5">
                    <div className="w-2.5 h-2.5 rounded-full bg-primary shrink-0" />
                    <div className="flex-1">
                      <p className="font-medium">
                        <button className="text-primary hover:underline" onClick={() => setLocation(`/customers/${property.customerId}`)}>
                          {property.customerName}
                        </button>
                      </p>
                      <p className="text-xs text-muted-foreground">Current owner</p>
                    </div>
                    <Badge variant="secondary">Current</Badge>
                  </div>
                  {ownershipHistory.map(h => (
                    <div key={h.id} className="flex items-start gap-4 p-4 rounded-lg border bg-muted/30">
                      <ArrowRight className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
                      <div className="flex-1 space-y-1">
                        <div className="flex items-center gap-2 text-sm">
                          <button className="font-medium hover:text-primary hover:underline" onClick={() => setLocation(`/customers/${h.previousCustomerId}`)}>
                            {h.previousCustomerName ?? 'Unknown'}
                          </button>
                          <ArrowRight className="w-3 h-3 text-muted-foreground" />
                          <button className="font-medium hover:text-primary hover:underline" onClick={() => setLocation(`/customers/${h.newCustomerId}`)}>
                            {h.newCustomerName ?? 'Unknown'}
                          </button>
                        </div>
                        {h.notes && <p className="text-xs text-muted-foreground">{h.notes}</p>}
                        <p className="text-xs text-muted-foreground">
                          {new Date(h.transferredAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Repairs tab ── */}
        <TabsContent value="repairs" className="focus-visible:outline-none space-y-4">
          {/* Summary cards */}
          {repairSummary && (
            <div className="grid grid-cols-3 gap-3">
              <Card>
                <CardContent className="pt-4 pb-3">
                  <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1"><DollarSign className="w-3.5 h-3.5" /> Total Spent</div>
                  <p className="text-2xl font-bold">${repairSummary.totalCost.toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
                  <p className="text-xs text-muted-foreground">{repairSummary.count} repair{repairSummary.count !== 1 ? 's' : ''}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4 pb-3">
                  <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1"><TrendingUp className="w-3.5 h-3.5" /> Parts Cost</div>
                  <p className="text-2xl font-bold">${repairSummary.totalPartsCost.toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
                  <p className="text-xs text-muted-foreground">Labor: ${repairSummary.totalLaborCost.toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4 pb-3">
                  <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1"><BarChart3 className="w-3.5 h-3.5" /> This Year</div>
                  <p className="text-2xl font-bold">
                    ${(repairSummary.byYear?.find(y => y.year === new Date().getFullYear())?.totalCost ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    vs. ${(repairSummary.byYear?.find(y => y.year === new Date().getFullYear() - 1)?.totalCost ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2 })} last year
                  </p>
                </CardContent>
              </Card>
            </div>
          )}

          {/* Header with Log Repair button */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-medium">Repair History</h3>
              {repairFilterElementId && (
                <Badge variant="secondary" className="gap-1 text-xs cursor-pointer" onClick={() => setRepairFilterElementId(null)}>
                  Element: {repairFilterElementId} ✕
                </Badge>
              )}
            </div>
            <Button size="sm" className="gap-1.5" onClick={() => { setRepairForm(EMPTY_REPAIR); setRepairDialogOpen(true); }}>
              <Plus className="w-3.5 h-3.5" /> Log Repair
            </Button>
          </div>

          {/* Repair log table */}
          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Component</TableHead>
                  <TableHead>Replaced</TableHead>
                  <TableHead>With</TableHead>
                  <TableHead className="text-right">Cost</TableHead>
                  <TableHead className="w-8" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {(repairFilterElementId
                  ? repairLogs?.filter(r => r.elementId === repairFilterElementId)
                  : repairLogs
                )?.map(r => (
                  <TableRow key={r.id} className="cursor-pointer hover:bg-muted/40" onClick={() => setRepairFilterElementId(r.elementId ?? null)}>
                    <TableCell className="text-sm">{new Date(r.performedAt).toLocaleDateString()}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="capitalize text-xs">{r.componentType}</Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{r.replacedWhat ?? '—'}</TableCell>
                    <TableCell className="text-sm">
                      {r.replacedWithName ?? '—'}
                      {r.nozzleBrand && <span className="text-xs text-muted-foreground ml-1">({r.nozzleBrand})</span>}
                    </TableCell>
                    <TableCell className="text-right font-medium text-sm">${r.totalCost.toFixed(2)}</TableCell>
                    <TableCell>
                      <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
                        onClick={e => {
                          e.stopPropagation();
                          if (!window.confirm('Delete this repair log?')) return;
                          deleteRepairLog.mutate({ id: r.id }, {
                            onSuccess: () => { toast.success('Repair log deleted'); refetchRepairLogs(); },
                            onError: () => toast.error('Failed to delete'),
                          });
                        }}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                {!repairLogs?.length && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                      No repairs logged yet. Click "Log Repair" to record the first one.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>
      </Tabs>

      {/* ── Log Repair Dialog ── */}
      <Dialog open={repairDialogOpen} onOpenChange={setRepairDialogOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Wrench className="w-4 h-4" /> Log Irrigation Repair</DialogTitle>
            <DialogDescription>Record a repair or replacement made on this property's irrigation system.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1 col-span-2">
                <Label className="text-xs">Component Type</Label>
                <Select value={repairForm.componentType} onValueChange={v => setRepairForm(f => ({ ...f, componentType: v }))}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="sprinkler">Sprinkler Head</SelectItem>
                    <SelectItem value="valve">Valve / Valve Box</SelectItem>
                    <SelectItem value="controller">Controller</SelectItem>
                    <SelectItem value="pipe">Pipe / Lateral Line</SelectItem>
                    <SelectItem value="fitting">Fitting / Coupler</SelectItem>
                    <SelectItem value="backflow">Backflow Preventer</SelectItem>
                    <SelectItem value="wiring">Wiring</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1 col-span-2">
                <Label className="text-xs">What was replaced / repaired?</Label>
                <Input className="h-9" placeholder="e.g. Broken rotor head, leaking valve body" value={repairForm.replacedWhat} onChange={e => setRepairForm(f => ({ ...f, replacedWhat: e.target.value }))} />
              </div>
              <div className="space-y-1 col-span-2">
                <Label className="text-xs">Replaced with (name / model)</Label>
                <Input className="h-9" placeholder="e.g. Hunter PGP Ultra, Rain Bird 5000" value={repairForm.replacedWithName} onChange={e => setRepairForm(f => ({ ...f, replacedWithName: e.target.value }))} />
              </div>
            </div>
            {(repairForm.componentType === 'sprinkler') && (
              <div className="rounded-lg border p-3 space-y-3 bg-muted/20">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Nozzle Details (optional)</p>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label className="text-xs">Brand</Label>
                    <Input className="h-8" placeholder="Hunter, Rain Bird…" value={repairForm.nozzleBrand} onChange={e => setRepairForm(f => ({ ...f, nozzleBrand: e.target.value }))} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Type</Label>
                    <Select value={repairForm.nozzleType} onValueChange={v => setRepairForm(f => ({ ...f, nozzleType: v }))}>
                      <SelectTrigger className="h-8"><SelectValue placeholder="Type" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="rotor">Rotor</SelectItem>
                        <SelectItem value="popup">Popup / Fixed Spray</SelectItem>
                        <SelectItem value="drip">Drip</SelectItem>
                        <SelectItem value="bubbler">Bubbler</SelectItem>
                        <SelectItem value="other">Other</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">GPM</Label>
                    <Input type="number" step="0.01" className="h-8" placeholder="0.00" value={repairForm.nozzleGpm} onChange={e => setRepairForm(f => ({ ...f, nozzleGpm: e.target.value }))} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Radius (ft)</Label>
                    <Input type="number" step="0.5" className="h-8" placeholder="12" value={repairForm.nozzleRadiusFt} onChange={e => setRepairForm(f => ({ ...f, nozzleRadiusFt: e.target.value }))} />
                  </div>
                </div>
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Parts Cost ($)</Label>
                <Input type="number" step="0.01" min="0" className="h-9" placeholder="0.00" value={repairForm.partsCost} onChange={e => setRepairForm(f => ({ ...f, partsCost: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Labor Cost ($)</Label>
                <Input type="number" step="0.01" min="0" className="h-9" placeholder="0.00" value={repairForm.laborCost} onChange={e => setRepairForm(f => ({ ...f, laborCost: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Date Performed</Label>
                <Input type="date" className="h-9" value={repairForm.performedAt} onChange={e => setRepairForm(f => ({ ...f, performedAt: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Performed By</Label>
                <Select value="" onValueChange={() => {}}>
                  <SelectTrigger className="h-9"><SelectValue placeholder="Any staff" /></SelectTrigger>
                  <SelectContent>
                    {allUsers?.map(u => <SelectItem key={u.id} value={String(u.id)}>{u.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1 col-span-2">
                <Label className="text-xs">Notes</Label>
                <Textarea className="text-sm" rows={2} placeholder="Describe what was done…" value={repairForm.notes} onChange={e => setRepairForm(f => ({ ...f, notes: e.target.value }))} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRepairDialogOpen(false)}>Cancel</Button>
            <Button disabled={createRepairLog.isPending} onClick={() => {
              createRepairLog.mutate({
                data: {
                  propertyId: id,
                  componentType: repairForm.componentType,
                  replacedWhat: repairForm.replacedWhat || undefined,
                  replacedWithName: repairForm.replacedWithName || undefined,
                  nozzleBrand: repairForm.nozzleBrand || undefined,
                  nozzleType: repairForm.nozzleType || undefined,
                  nozzleGpm: repairForm.nozzleGpm ? Number(repairForm.nozzleGpm) : undefined,
                  nozzleRadiusFt: repairForm.nozzleRadiusFt ? Number(repairForm.nozzleRadiusFt) : undefined,
                  partsCost: Number(repairForm.partsCost) || 0,
                  laborCost: Number(repairForm.laborCost) || 0,
                  notes: repairForm.notes || undefined,
                  performedAt: repairForm.performedAt ? new Date(repairForm.performedAt).toISOString() : new Date().toISOString(),
                },
              }, {
                onSuccess: () => {
                  toast.success('Repair logged');
                  setRepairDialogOpen(false);
                  setRepairForm(EMPTY_REPAIR);
                  refetchRepairLogs();
                  qc.invalidateQueries({ queryKey: getGetRepairLogSummaryQueryKey({ propertyId: id } as Parameters<typeof useGetRepairLogSummary>[0]) });
                },
                onError: () => toast.error('Failed to log repair'),
              });
            }}>
              {createRepairLog.isPending ? 'Saving…' : 'Log Repair'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Property Sheet */}
      <Sheet open={editing} onOpenChange={setEditing}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          <SheetHeader className="pb-4">
            <SheetTitle>Edit Property</SheetTitle>
            <SheetDescription>Update property details and address information.</SheetDescription>
          </SheetHeader>
          <div className="space-y-4 pb-6">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Street Address <span className="text-destructive">*</span></label>
              <Input value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} placeholder="123 Main St" />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-1 space-y-1.5">
                <label className="text-sm font-medium">City</label>
                <Input value={form.city} onChange={e => setForm(f => ({ ...f, city: e.target.value }))} placeholder="Los Angeles" />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">State</label>
                <Input value={form.state} onChange={e => setForm(f => ({ ...f, state: e.target.value }))} placeholder="CA" maxLength={2} />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">ZIP</label>
                <Input value={form.zip} onChange={e => setForm(f => ({ ...f, zip: e.target.value }))} placeholder="90210" />
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Property Type</label>
              <Select value={form.type} onValueChange={v => setForm(f => ({ ...f, type: v }))}>
                <SelectTrigger><SelectValue placeholder="Select type..." /></SelectTrigger>
                <SelectContent>
                  {['residential', 'commercial', 'hoa', 'industrial', 'other'].map(t => (
                    <SelectItem key={t} value={t} className="capitalize">{t}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Property Size</label>
              <div className="flex gap-2">
                <Input
                  type="number"
                  min="0"
                  step="any"
                  value={form.size}
                  onChange={e => setForm(f => ({ ...f, size: e.target.value }))}
                  placeholder="e.g. 5000"
                  className="flex-1"
                />
                <Select value={form.sizeUnit || 'sqft'} onValueChange={v => setForm(f => ({ ...f, sizeUnit: v }))}>
                  <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="sqft">sqft</SelectItem>
                    <SelectItem value="acres">acres</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <p className="text-xs text-muted-foreground">Used to calculate chemical application rates per acre / per 1,000 sqft.</p>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Notes</label>
              <Textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Gate code, access instructions, special notes..." className="min-h-[100px]" />
            </div>
            <Separator />
            <div className="flex gap-3 justify-end">
              <Button variant="outline" onClick={() => setEditing(false)}>Cancel</Button>
              <Button onClick={handleSaveEdit} disabled={updateProperty.isPending} className="gap-2">
                <Save className="w-4 h-4" />
                {updateProperty.isPending ? 'Saving...' : 'Save Changes'}
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      {/* Transfer Property Sheet */}
      <Sheet open={transferOpen} onOpenChange={setTransferOpen}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          <SheetHeader className="pb-4">
            <SheetTitle className="flex items-center gap-2">
              <GitMerge className="w-5 h-5" /> Transfer Property
            </SheetTitle>
            <SheetDescription>
              Move this property to a different customer. All job history will be preserved on the property record.
            </SheetDescription>
          </SheetHeader>
          <div className="space-y-5 pb-6">
            <div className="rounded-lg border p-4 bg-muted/30 space-y-1">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Current Owner</p>
              <p className="font-semibold">{property.customerName}</p>
            </div>

            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <div className="flex-1 border-t" />
              <ArrowRight className="w-4 h-4 shrink-0" />
              <div className="flex-1 border-t" />
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium">Transfer To <span className="text-destructive">*</span></label>
              <Popover open={customerPickerOpen} onOpenChange={setCustomerPickerOpen}>
                <PopoverTrigger asChild>
                  <Button variant="outline" role="combobox" className="w-full justify-between font-normal">
                    {selectedCustomer ? (
                      <span>
                        {selectedCustomer.name}
                        {selectedCustomer.company && <span className="text-muted-foreground ml-2">· {selectedCustomer.company}</span>}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">Search for a customer...</span>
                    )}
                    <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-full p-0" align="start">
                  <Command>
                    <CommandInput
                      placeholder="Search customers..."
                      value={transferForm.customerSearch}
                      onValueChange={v => setTransferForm(f => ({ ...f, customerSearch: v }))}
                    />
                    <CommandEmpty>No customers found.</CommandEmpty>
                    <CommandGroup className="max-h-60 overflow-y-auto">
                      {filteredCustomers.slice(0, 50).map(c => (
                        <CommandItem
                          key={c.id}
                          value={String(c.id)}
                          onSelect={() => {
                            setTransferForm(f => ({ ...f, newCustomerId: String(c.id), customerSearch: '' }));
                            setCustomerPickerOpen(false);
                          }}
                        >
                          <Check className={cn("mr-2 h-4 w-4", transferForm.newCustomerId === String(c.id) ? 'opacity-100' : 'opacity-0')} />
                          <div>
                            <div className="font-medium">{c.name}</div>
                            {c.company && <div className="text-xs text-muted-foreground">{c.company}</div>}
                          </div>
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium">Transfer Notes</label>
              <Textarea
                value={transferForm.notes}
                onChange={e => setTransferForm(f => ({ ...f, notes: e.target.value }))}
                placeholder="Reason for transfer, sale details, etc..."
                className="min-h-[80px]"
              />
            </div>

            <div className="flex gap-3 rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800 p-3">
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <p className="text-xs text-amber-700 dark:text-amber-400">
                This action will reassign the property to the new customer. All existing jobs and history remain linked to this property.
              </p>
            </div>

            <Separator />
            <div className="flex gap-3 justify-end">
              <Button variant="outline" onClick={() => setTransferOpen(false)}>Cancel</Button>
              <Button
                onClick={handleTransfer}
                disabled={!transferForm.newCustomerId || transferProperty.isPending}
                className="gap-2"
              >
                <GitMerge className="w-4 h-4" />
                {transferProperty.isPending ? 'Transferring...' : 'Confirm Transfer'}
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div className="flex gap-2">
      <span className="text-muted-foreground min-w-[100px] shrink-0">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}
