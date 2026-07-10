import React, { useState } from 'react';
import { useListInventoryItems, getListInventoryItemsQueryKey, useGetInventorySummary, getGetInventorySummaryQueryKey } from '@workspace/api-client-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Search, Plus, AlertTriangle, Package, DollarSign } from 'lucide-react';
import { useDebounce } from '@/hooks/use-debounce';

export default function InventoryPage() {
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 300);

  const { data: summary } = useGetInventorySummary({ query: { queryKey: getGetInventorySummaryQueryKey() }});
  const { data: items, isLoading } = useListInventoryItems(
    { q: debouncedSearch || undefined }, 
    { query: { queryKey: getListInventoryItemsQueryKey({ q: debouncedSearch || undefined }) } }
  );

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Inventory</h1>
          <p className="text-muted-foreground mt-1">Manage parts, tools, and materials.</p>
        </div>
        <Button className="gap-2">
          <Plus className="w-4 h-4" /> Add Item
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-6 flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-muted-foreground">Total Value</p>
              <p className="text-3xl font-bold">${summary?.totalValue?.toLocaleString() || 0}</p>
            </div>
            <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary">
              <DollarSign className="w-5 h-5" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6 flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-muted-foreground">Total Items</p>
              <p className="text-3xl font-bold">{summary?.totalItems || 0}</p>
            </div>
            <div className="w-10 h-10 rounded-full bg-blue-500/10 flex items-center justify-center text-blue-500">
              <Package className="w-5 h-5" />
            </div>
          </CardContent>
        </Card>
        <Card className={summary?.lowStockCount && summary.lowStockCount > 0 ? "border-destructive/50 bg-destructive/5" : ""}>
          <CardContent className="p-6 flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-destructive">Low Stock Alerts</p>
              <p className="text-3xl font-bold text-destructive">{summary?.lowStockCount || 0}</p>
            </div>
            <div className="w-10 h-10 rounded-full bg-destructive/10 flex items-center justify-center text-destructive">
              <AlertTriangle className="w-5 h-5" />
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="p-4 border-b flex items-center gap-4">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input 
                placeholder="Search by SKU or name..." 
                className="pl-9"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Item</TableHead>
                <TableHead>SKU</TableHead>
                <TableHead>Category</TableHead>
                <TableHead className="text-right">Unit Price</TableHead>
                <TableHead className="text-right">Quantity</TableHead>
                <TableHead className="w-[50px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">Loading inventory...</TableCell>
                </TableRow>
              ) : items?.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">No items found.</TableCell>
                </TableRow>
              ) : (
                items?.map((item) => (
                  <TableRow 
                    key={item.id} 
                    className={item.isLowStock ? "bg-destructive/5 hover:bg-destructive/10" : "hover:bg-muted/50"}
                  >
                    <TableCell className="font-medium">{item.name}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{item.sku}</TableCell>
                    <TableCell>
                      {item.category && <Badge variant="outline">{item.category}</Badge>}
                    </TableCell>
                    <TableCell className="text-right">${item.unitPrice.toFixed(2)}</TableCell>
                    <TableCell className="text-right">
                      <span className={`font-medium ${item.isLowStock ? 'text-destructive' : ''}`}>
                        {item.quantity} {item.unit || ''}
                      </span>
                    </TableCell>
                    <TableCell>
                      {item.isLowStock && <AlertTriangle className="w-4 h-4 text-destructive" />}
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
