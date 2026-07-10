import React, { useState } from 'react';
import { useListCustomers, getListCustomersQueryKey } from '@workspace/api-client-react';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Search, Plus, Building, Phone, Mail } from 'lucide-react';
import { useLocation } from 'wouter';
import { useDebounce } from '@/hooks/use-debounce';

export default function CustomersPage() {
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 300);
  const [, setLocation] = useLocation();

  const { data, isLoading } = useListCustomers(
    { q: debouncedSearch || undefined, limit: 50 }, 
    { query: { queryKey: getListCustomersQueryKey({ q: debouncedSearch || undefined, limit: 50 }) } }
  );

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Customers</h1>
          <p className="text-muted-foreground mt-1">Manage your client base and their properties.</p>
        </div>
        <Button onClick={() => setLocation('/customers/new')} className="gap-2">
          <Plus className="w-4 h-4" /> Add Customer
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="p-4 border-b flex items-center gap-4">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input 
                placeholder="Search customers..." 
                className="pl-9"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Contact</TableHead>
                <TableHead>Properties</TableHead>
                <TableHead className="text-right">Total Spend</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-center py-8 text-muted-foreground">Loading customers...</TableCell>
                </TableRow>
              ) : data?.items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-center py-8 text-muted-foreground">No customers found.</TableCell>
                </TableRow>
              ) : (
                data?.items.map((customer) => (
                  <TableRow 
                    key={customer.id} 
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => setLocation(`/customers/${customer.id}`)}
                  >
                    <TableCell>
                      <div className="font-medium">{customer.name}</div>
                      {customer.company && <div className="text-xs text-muted-foreground flex items-center gap-1 mt-1"><Building className="w-3 h-3" /> {customer.company}</div>}
                    </TableCell>
                    <TableCell>
                      <div className="text-sm flex flex-col gap-1">
                        <div className="flex items-center gap-2 text-muted-foreground"><Phone className="w-3 h-3" /> {customer.phone}</div>
                        <div className="flex items-center gap-2 text-muted-foreground"><Mail className="w-3 h-3" /> {customer.email}</div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">{customer.propertyCount || 0}</Badge>
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      ${customer.totalSpend?.toLocaleString() || '0'}
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
