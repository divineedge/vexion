import React, { useState } from 'react';
import { useListProperties, getListPropertiesQueryKey } from '@workspace/api-client-react';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Search, Plus, MapPin, Navigation } from 'lucide-react';
import { useLocation } from 'wouter';
import { useDebounce } from '@/hooks/use-debounce';
import { Badge } from '@/components/ui/badge';

export default function PropertiesPage() {
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 300);
  const [, setLocation] = useLocation();

  const { data, isLoading } = useListProperties(
    { q: debouncedSearch || undefined }, 
    { query: { queryKey: getListPropertiesQueryKey({ q: debouncedSearch || undefined }) } }
  );

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Properties</h1>
          <p className="text-muted-foreground mt-1">Manage job sites and geofences.</p>
        </div>
        <Button onClick={() => setLocation('/properties/new')} className="gap-2">
          <Plus className="w-4 h-4" /> Add Property
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="p-4 border-b flex items-center gap-4">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input 
                placeholder="Search by address or customer..." 
                className="pl-9"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Address</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Geofence</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-center py-8 text-muted-foreground">Loading properties...</TableCell>
                </TableRow>
              ) : data?.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-center py-8 text-muted-foreground">No properties found.</TableCell>
                </TableRow>
              ) : (
                data?.map((property) => (
                  <TableRow 
                    key={property.id} 
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => setLocation(`/properties/${property.id}`)}
                  >
                    <TableCell>
                      <div className="flex items-start gap-2">
                        <MapPin className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
                        <div>
                          <div className="font-medium">{property.address}</div>
                          <div className="text-xs text-muted-foreground">{property.city}, {property.state} {property.zip}</div>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <span className="text-primary hover:underline" onClick={(e) => { e.stopPropagation(); setLocation(`/customers/${property.customerId}`); }}>
                        {property.customerName}
                      </span>
                    </TableCell>
                    <TableCell>
                      {property.type ? <Badge variant="secondary" className="capitalize">{property.type}</Badge> : '-'}
                    </TableCell>
                    <TableCell>
                      {property.geofenceLat ? (
                        <div className="flex items-center gap-1 text-sm text-emerald-600 font-medium">
                          <Navigation className="w-3 h-3" /> Set ({property.geofenceRadius}m)
                        </div>
                      ) : (
                        <span className="text-sm text-muted-foreground">Not set</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
