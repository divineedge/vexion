import React from 'react';
import { useGetCustomer, getGetCustomerQueryKey, useListProperties, getListPropertiesQueryKey, useListJobs, getListJobsQueryKey } from '@workspace/api-client-react';
import { useParams, useLocation } from 'wouter';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, Building, Phone, Mail, Edit, Plus, Calendar, MapPin } from 'lucide-react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

export default function CustomerDetailPage() {
  const params = useParams();
  const id = Number(params.id);
  const [, setLocation] = useLocation();

  const { data: customer, isLoading } = useGetCustomer(id, { query: { enabled: !!id, queryKey: getGetCustomerQueryKey(id) } });
  const { data: properties } = useListProperties({ customerId: id }, { query: { enabled: !!id, queryKey: getListPropertiesQueryKey({ customerId: id }) } });
  const { data: jobs } = useListJobs({ customerId: id }, { query: { enabled: !!id, queryKey: getListJobsQueryKey({ customerId: id }) } });

  if (isLoading) return <div className="p-8 text-center text-muted-foreground">Loading...</div>;
  if (!customer && !isLoading) return <div className="p-8 text-center text-muted-foreground">Customer not found.</div>;

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => setLocation('/customers')}>
          <ArrowLeft className="w-5 h-5" />
        </Button>
        <div className="flex-1">
          <h1 className="text-3xl font-bold tracking-tight">{customer?.name}</h1>
          <div className="flex gap-4 mt-2 text-sm text-muted-foreground">
            {customer?.company && <span className="flex items-center gap-1"><Building className="w-4 h-4" /> {customer.company}</span>}
            <span className="flex items-center gap-1"><Phone className="w-4 h-4" /> {customer?.phone}</span>
            <span className="flex items-center gap-1"><Mail className="w-4 h-4" /> {customer?.email}</span>
          </div>
        </div>
        <Button variant="outline" className="gap-2">
          <Edit className="w-4 h-4" /> Edit
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Customer Overview</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <p className="text-sm font-medium text-muted-foreground mb-1">Total Spend</p>
                <p className="text-2xl font-bold">${customer?.totalSpend?.toLocaleString() || '0'}</p>
              </div>
              {customer?.tags && customer.tags.length > 0 && (
                <div>
                  <p className="text-sm font-medium text-muted-foreground mb-2">Tags</p>
                  <div className="flex flex-wrap gap-2">
                    {customer.tags.map(tag => (
                      <Badge key={tag} variant="secondary">{tag}</Badge>
                    ))}
                  </div>
                </div>
              )}
              {customer?.notes && (
                <div>
                  <p className="text-sm font-medium text-muted-foreground mb-1">Notes</p>
                  <p className="text-sm">{customer.notes}</p>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-lg">Properties</CardTitle>
              <Button variant="ghost" size="icon"><Plus className="w-4 h-4" /></Button>
            </CardHeader>
            <CardContent>
              <div className="space-y-3 mt-2">
                {properties?.map(property => (
                  <div key={property.id} className="flex items-start gap-3 p-3 rounded-lg border hover:bg-muted/50 cursor-pointer transition-colors" onClick={() => setLocation(`/properties/${property.id}`)}>
                    <MapPin className="w-5 h-5 text-muted-foreground mt-0.5 shrink-0" />
                    <div>
                      <p className="font-medium text-sm leading-none">{property.address}</p>
                      <p className="text-xs text-muted-foreground mt-1">{property.city}, {property.state} {property.zip}</p>
                    </div>
                  </div>
                ))}
                {!properties?.length && <p className="text-sm text-muted-foreground py-2 text-center">No properties found.</p>}
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="lg:col-span-2">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Job History</CardTitle>
              <Button size="sm" variant="outline" className="gap-2"><Plus className="w-4 h-4" /> New Job</Button>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Title</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
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
                      <TableCell className="text-right">${job.totalAmount?.toLocaleString() || '0'}</TableCell>
                    </TableRow>
                  ))}
                  {!jobs?.length && (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center py-8 text-muted-foreground">No jobs found.</TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
