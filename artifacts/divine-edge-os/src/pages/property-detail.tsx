import React, { useState } from 'react';
import { useGetProperty, getGetPropertyQueryKey, useListJobs, getListJobsQueryKey, useUpdateGeofencePin } from '@workspace/api-client-react';
import { useParams, useLocation } from 'wouter';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, Edit, MapPin, Navigation, Calendar } from 'lucide-react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';

export default function PropertyDetailPage() {
  const params = useParams();
  const id = Number(params.id);
  const [, setLocation] = useLocation();

  const { data: property, isLoading } = useGetProperty(id, { query: { enabled: !!id, queryKey: getGetPropertyQueryKey(id) } });
  const { data: jobs } = useListJobs({ propertyId: id }, { query: { enabled: !!id, queryKey: getListJobsQueryKey({ propertyId: id }) } });
  const updateGeofence = useUpdateGeofencePin();

  const [geoInput, setGeoInput] = useState({ lat: '', lng: '', radius: '50' });

  React.useEffect(() => {
    if (property && property.geofenceLat) {
      setGeoInput({
        lat: property.geofenceLat.toString(),
        lng: property.geofenceLng?.toString() || '',
        radius: (property.geofenceRadius || 50).toString()
      });
    }
  }, [property]);

  const handleSaveGeofence = () => {
    const lat = parseFloat(geoInput.lat);
    const lng = parseFloat(geoInput.lng);
    const radius = parseFloat(geoInput.radius);

    if (isNaN(lat) || isNaN(lng)) {
      toast.error('Invalid coordinates');
      return;
    }

    updateGeofence.mutate({ id, data: { lat, lng, radius } }, {
      onSuccess: () => {
        toast.success('Geofence updated successfully');
      }
    });
  };

  if (isLoading) return <div className="p-8 text-center text-muted-foreground">Loading...</div>;
  if (!property && !isLoading) return <div className="p-8 text-center text-muted-foreground">Property not found.</div>;

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => setLocation('/properties')}>
          <ArrowLeft className="w-5 h-5" />
        </Button>
        <div className="flex-1">
          <h1 className="text-3xl font-bold tracking-tight">{property?.address}</h1>
          <div className="flex items-center gap-2 mt-2 text-sm text-muted-foreground">
            <span>{property?.city}, {property?.state} {property?.zip}</span>
            <span>•</span>
            <span>Customer: <button onClick={() => setLocation(`/customers/${property?.customerId}`)} className="text-primary hover:underline">{property?.customerName}</button></span>
          </div>
        </div>
        <Button variant="outline" className="gap-2">
          <Edit className="w-4 h-4" /> Edit
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Navigation className="w-5 h-5 text-primary" /> Geofence Configuration</CardTitle>
            <CardDescription>Set the coordinates and radius to automatically detect technician arrivals.</CardDescription>
          </CardHeader>
          <CardContent>
            {/* Visual representation using SVG instead of real map */}
            <div className="w-full h-48 bg-muted/50 rounded-md border border-dashed flex items-center justify-center relative mb-6 overflow-hidden">
              <svg width="100%" height="100%" className="absolute inset-0 pointer-events-none opacity-20">
                <defs>
                  <pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse">
                    <path d="M 20 0 L 0 0 0 20" fill="none" stroke="currentColor" strokeWidth="1"/>
                  </pattern>
                </defs>
                <rect width="100%" height="100%" fill="url(#grid)" />
              </svg>
              {property?.geofenceLat ? (
                <div className="flex flex-col items-center z-10 animate-in zoom-in">
                  <div className="w-24 h-24 rounded-full bg-primary/20 border border-primary/50 absolute flex items-center justify-center">
                    <div className="w-2 h-2 bg-primary rounded-full" />
                  </div>
                  <MapPin className="w-8 h-8 text-primary -mt-8" />
                  <span className="mt-6 font-mono text-xs text-muted-foreground bg-background px-2 py-1 rounded border shadow-sm">
                    {property.geofenceLat.toFixed(4)}, {property.geofenceLng?.toFixed(4)}
                  </span>
                </div>
              ) : (
                <div className="flex flex-col items-center text-muted-foreground z-10">
                  <MapPin className="w-8 h-8 mb-2 opacity-50" />
                  <span>No pin set</span>
                </div>
              )}
            </div>

            <div className="grid grid-cols-3 gap-4 mb-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Latitude</label>
                <Input placeholder="e.g. 34.0522" value={geoInput.lat} onChange={(e) => setGeoInput({ ...geoInput, lat: e.target.value })} />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Longitude</label>
                <Input placeholder="e.g. -118.2437" value={geoInput.lng} onChange={(e) => setGeoInput({ ...geoInput, lng: e.target.value })} />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Radius (m)</label>
                <Input type="number" placeholder="50" value={geoInput.radius} onChange={(e) => setGeoInput({ ...geoInput, radius: e.target.value })} />
              </div>
            </div>
            <Button onClick={handleSaveGeofence} disabled={updateGeofence.isPending} className="w-full">
              {updateGeofence.isPending ? "Saving..." : "Set Geofence Pin"}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Job History at Property</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Title</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {jobs?.map((job) => (
                  <TableRow key={job.id}>
                    <TableCell className="font-medium">{job.title}</TableCell>
                    <TableCell>
                      <Badge variant={job.status === 'completed' ? 'default' : 'secondary'} className="capitalize">
                        {job.status.replace('_', ' ')}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground flex items-center gap-2">
                      <Calendar className="w-3 h-3" /> {new Date(job.scheduledAt).toLocaleDateString()}
                    </TableCell>
                  </TableRow>
                ))}
                {!jobs?.length && (
                  <TableRow>
                    <TableCell colSpan={3} className="text-center py-8 text-muted-foreground">No jobs recorded for this property.</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
