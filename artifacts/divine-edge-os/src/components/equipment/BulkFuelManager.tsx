import React, { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  useListBulkFuelTanks,
  getListBulkFuelTanksQueryKey,
  useCreateBulkFuelTank,
  useUpdateBulkFuelTank,
  useListBulkFuelTransactions,
  getListBulkFuelTransactionsQueryKey,
  useCreateBulkFuelIntake,
} from '@workspace/api-client-react';
import type { BulkFuelTank, BulkFuelTransaction, BulkFuelIntakeInputKind, BulkFuelIntakeResult } from '@workspace/api-client-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Plus, Settings, History, Droplet, Scale } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { BulkFuelReconcileDialog } from './BulkFuelReconcileDialog';

function fmt$(v: number | null | undefined) {
  if (v == null) return '—';
  return `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function BulkFuelManager() {
  const qc = useQueryClient();
  const { canManageOffice } = useAuth();
  const { data: tanks, isLoading } = useListBulkFuelTanks(
    { includeInactive: true },
    {
      query: {
        queryKey: getListBulkFuelTanksQueryKey({ includeInactive: true }),
        refetchInterval: 30_000,
        staleTime: 15_000,
      },
    }
  );

  const [formOpen, setFormOpen] = useState(false);
  const [editingTank, setEditingTank] = useState<BulkFuelTank | null>(null);
  const [name, setName] = useState('');
  const [fuelType, setFuelType] = useState('diesel');
  const [capacityGallons, setCapacityGallons] = useState('');
  const [isActive, setIsActive] = useState(true);

  const createTank = useCreateBulkFuelTank();
  const updateTank = useUpdateBulkFuelTank();

  const openCreate = () => {
    setEditingTank(null);
    setName('');
    setFuelType('diesel');
    setCapacityGallons('');
    setIsActive(true);
    setFormOpen(true);
  };

  const openEdit = (tank: BulkFuelTank) => {
    setEditingTank(tank);
    setName(tank.name);
    setFuelType(tank.fuelType);
    setCapacityGallons(tank.capacityGallons ? String(tank.capacityGallons) : '');
    setIsActive(tank.isActive);
    setFormOpen(true);
  };

  const handleSaveTank = () => {
    if (!name.trim()) {
      toast.error('Tank name is required');
      return;
    }
    const data = {
      name: name.trim(),
      fuelType,
      capacityGallons: capacityGallons ? parseFloat(capacityGallons) : null,
      isActive,
    };

    if (editingTank) {
      updateTank.mutate({ id: editingTank.id, data }, {
        onSuccess: () => {
          toast.success('Tank updated');
          qc.invalidateQueries({ predicate: q => q.queryKey[0] === getListBulkFuelTanksQueryKey()[0] });
          setFormOpen(false);
        },
        onError: () => toast.error('Failed to update tank'),
      });
    } else {
      createTank.mutate({ data }, {
        onSuccess: () => {
          toast.success('Tank created');
          qc.invalidateQueries({ predicate: q => q.queryKey[0] === getListBulkFuelTanksQueryKey()[0] });
          setFormOpen(false);
        },
        onError: () => toast.error('Failed to create tank'),
      });
    }
  };

  const [intakeOpen, setIntakeOpen] = useState(false);
  const [intakeTank, setIntakeTank] = useState<BulkFuelTank | null>(null);
  const [intakeIdempotencyKey, setIntakeIdempotencyKey] = useState('');

  const openIntake = (tank: BulkFuelTank) => {
    setIntakeTank(tank);
    setIntakeIdempotencyKey(crypto.randomUUID());
    setIntakeOpen(true);
  };

  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyTank, setHistoryTank] = useState<BulkFuelTank | null>(null);

  const openHistory = (tank: BulkFuelTank) => {
    setHistoryTank(tank);
    setHistoryOpen(true);
  };

  const [reconcileOpen, setReconcileOpen] = useState(false);
  const [reconcileTank, setReconcileTank] = useState<BulkFuelTank | null>(null);

  const openReconcile = (tank: BulkFuelTank) => {
    setReconcileTank(tank);
    setReconcileOpen(true);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">Bulk Fuel Tanks</h3>
          <p className="text-sm text-muted-foreground">Manage inventory and costs for bulk fuel purchases</p>
        </div>
        <Button onClick={openCreate} size="sm" className="gap-2">
          <Plus className="w-4 h-4" /> Add Tank
        </Button>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground py-4 text-center">Loading tanks...</p>
      ) : tanks && tanks.length > 0 ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {tanks.map(tank => (
            <Card key={tank.id} className={!tank.isActive ? 'opacity-60 bg-muted/50' : ''}>
              <CardHeader className="pb-2">
                <div className="flex justify-between items-start">
                  <div className="min-w-0 pr-2">
                    <CardTitle className="text-base truncate" title={tank.name}>{tank.name}</CardTitle>
                    <CardDescription className="capitalize mt-1">{tank.fuelType.replace('_', ' ')}</CardDescription>
                  </div>
                  {!tank.isActive && <Badge variant="secondary">Inactive</Badge>}
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-3 text-sm border-t border-b py-3 my-1">
                  <div>
                    <p className="text-muted-foreground text-[11px] uppercase font-semibold">Available</p>
                    <p className="font-medium text-lg font-mono text-primary mt-0.5">{tank.availableGallons.toLocaleString(undefined, { maximumFractionDigits: 1 })} <span className="text-xs text-muted-foreground">gal</span></p>
                  </div>
                  <div>
                    <p className="text-muted-foreground text-[11px] uppercase font-semibold">Capacity</p>
                    <p className="font-medium mt-0.5">{tank.capacityGallons ? `${tank.capacityGallons.toLocaleString()} gal` : 'Unlimited'}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground text-[11px] uppercase font-semibold">Inventory Value</p>
                    <p className="font-medium font-mono mt-0.5">{fmt$(tank.inventoryValue)}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground text-[11px] uppercase font-semibold">Blended Cost</p>
                    <p className="font-medium font-mono mt-0.5">{fmt$(tank.unitCostPerGallon)}<span className="text-xs text-muted-foreground">/gal</span></p>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2 pt-1">
                  {tank.isActive && (
                    <Button variant="outline" size="sm" onClick={() => openIntake(tank)} className="flex-1 min-w-[100px] gap-1.5 h-8">
                      <Droplet className="w-3.5 h-3.5" /> Intake
                    </Button>
                  )}
                  {tank.isActive && canManageOffice && (
                    <Button
                      data-testid={`button-reconcile-tank-${tank.id}`}
                      variant="outline"
                      size="sm"
                      onClick={() => openReconcile(tank)}
                      className="flex-1 min-w-[100px] gap-1.5 h-8"
                    >
                      <Scale className="w-3.5 h-3.5" /> Reconcile
                    </Button>
                  )}
                  <Button variant="outline" size="sm" onClick={() => openHistory(tank)} className="flex-1 min-w-[100px] gap-1.5 h-8">
                    <History className="w-3.5 h-3.5" /> History
                  </Button>
                  <Button variant="ghost" size="icon" className="w-8 h-8 shrink-0" onClick={() => openEdit(tank)}>
                    <Settings className="w-4 h-4 text-muted-foreground" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <div className="text-center py-12 border rounded-xl bg-muted/30 border-dashed">
          <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mx-auto mb-4">
            <Droplet className="w-6 h-6 text-muted-foreground" />
          </div>
          <p className="text-sm font-medium">No bulk fuel tanks created yet</p>
          <p className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto">Create a tank to track bulk fuel purchases and accurately attribute costs to equipment consumption.</p>
        </div>
      )}

      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editingTank ? 'Edit Tank' : 'Add Bulk Fuel Tank'}</DialogTitle>
            <DialogDescription>
              Tanks track fuel deliveries and calculate weighted average cost per gallon.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Tank Name</label>
              <Input placeholder="e.g. Main Shop Diesel" value={name} onChange={e => setName(e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Fuel Type</label>
                <Select value={fuelType} onValueChange={setFuelType}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="diesel">Diesel</SelectItem>
                    <SelectItem value="unleaded">Unleaded (Gasoline)</SelectItem>
                    <SelectItem value="mixed">Mixed (2-Cycle)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Capacity (Gallons)</label>
                <Input type="number" placeholder="Optional" value={capacityGallons} onChange={e => setCapacityGallons(e.target.value)} />
              </div>
            </div>
            {editingTank && (
              <div className="flex items-center gap-2 pt-2 border-t mt-4">
                <input
                  type="checkbox"
                  id="isActive"
                  checked={isActive}
                  onChange={(e) => setIsActive(e.target.checked)}
                  disabled={editingTank.availableGallons > 0 && !isActive}
                  title={editingTank.availableGallons > 0 ? "Empty tank to deactivate" : ""}
                  className="rounded border-input"
                />
                <label htmlFor="isActive" className="text-sm font-medium">Active Tank</label>
                {editingTank.availableGallons > 0 && (
                  <span className="text-xs text-muted-foreground ml-2">(Cannot deactivate while tank has fuel)</span>
                )}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFormOpen(false)}>Cancel</Button>
            <Button onClick={handleSaveTank} disabled={createTank.isPending || updateTank.isPending}>
              {createTank.isPending || updateTank.isPending ? 'Saving...' : 'Save Tank'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {intakeTank && (
        <BulkFuelIntakeDialog 
          tank={intakeTank} 
          open={intakeOpen} 
          onOpenChange={setIntakeOpen} 
          idempotencyKey={intakeIdempotencyKey}
          onResetIdempotencyKey={() => setIntakeIdempotencyKey(crypto.randomUUID())}
        />
      )}

      {historyTank && (
        <BulkFuelHistoryDialog tank={historyTank} open={historyOpen} onOpenChange={setHistoryOpen} />
      )}

      {reconcileTank && (
        <BulkFuelReconcileDialog
          tank={reconcileTank}
          open={reconcileOpen}
          onOpenChange={setReconcileOpen}
        />
      )}
    </div>
  );
}

function BulkFuelIntakeDialog({ tank, open, onOpenChange, idempotencyKey, onResetIdempotencyKey }: { tank: BulkFuelTank, open: boolean, onOpenChange: (open: boolean) => void, idempotencyKey: string, onResetIdempotencyKey: () => void }) {
  const qc = useQueryClient();
  const createIntake = useCreateBulkFuelIntake();

  const todayStr = new Date().toISOString().slice(0, 10);
  const [kind, setKind] = useState<'delivery' | 'opening_balance'>('delivery');
  const [date, setDate] = useState(todayStr);
  const [gallons, setGallons] = useState('');
  const [priceMode, setPriceMode] = useState<'total' | 'per_gallon'>('total');
  const [totalCost, setTotalCost] = useState('');
  const [pricePerGallon, setPricePerGallon] = useState('');
  const [supplier, setSupplier] = useState('');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');

  // When form changes, if we previously failed/succeeded, reset idempotency to allow fresh submit
  const handleInputChange = (setter: any, val: any) => {
    setter(val);
    onResetIdempotencyKey();
  };

  const handlePriceModeChange = (mode: 'total' | 'per_gallon') => {
    setPriceMode(mode);
    onResetIdempotencyKey();
  };

  const parsedGallons = parseFloat(gallons) || 0;
  const parsedCost = priceMode === 'total' 
    ? parseFloat(totalCost) 
    : Math.round(parsedGallons * (parseFloat(pricePerGallon) || 0) * 100) / 100;

  const handleSubmit = () => {
    if (!date || isNaN(parsedGallons) || parsedGallons <= 0 || isNaN(parsedCost) || parsedCost < 0) {
      toast.error('Valid date, positive gallons, and non-negative cost are required');
      return;
    }

    createIntake.mutate({
      id: tank.id,
      data: {
        kind,
        date,
        gallons: parsedGallons,
        totalCost: parsedCost,
        supplier: supplier || undefined,
        reference: reference || undefined,
        notes: notes || undefined,
        idempotencyKey,
      },
    }, {
      onSuccess: (res: unknown) => {
        const result = res as BulkFuelIntakeResult;
        if (result.duplicate) {
           toast.info('This intake was already recorded.');
        } else {
           toast.success(`Recorded ${kind === 'delivery' ? 'delivery' : 'opening balance'}`);
        }
        qc.invalidateQueries({ predicate: q => q.queryKey[0] === getListBulkFuelTanksQueryKey()[0] });
        qc.invalidateQueries({ queryKey: getListBulkFuelTransactionsQueryKey(tank.id) });
        // Reset form
        setDate(todayStr);
        setGallons('');
        setTotalCost('');
        setPricePerGallon('');
        setSupplier('');
        setReference('');
        setNotes('');
        onOpenChange(false);
      },
      onError: (err: any) => {
        toast.error(err?.response?.data?.message || 'Failed to record intake. Check capacity limits.');
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Record Intake: {tank.name}</DialogTitle>
          <DialogDescription>
            Add fuel to this tank. The new inventory will be blended with existing stock to update the weighted average cost.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Type</label>
              <Select value={kind} onValueChange={(val: 'delivery' | 'opening_balance') => handleInputChange(setKind, val)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="delivery">Delivery</SelectItem>
                  <SelectItem value="opening_balance">Opening Balance</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Date</label>
              <Input type="date" value={date} onChange={e => handleInputChange(setDate, e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Gallons Added</label>
              <Input type="number" step="0.001" min="0.001" placeholder="e.g. 500" value={gallons} onChange={e => handleInputChange(setGallons, e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium">
                  {priceMode === 'total' ? 'Total Cost ($)' : 'Price per Gallon ($)'}
                </label>
                <button
                  className="text-[10px] text-primary font-medium hover:underline"
                  onClick={() => handlePriceModeChange(priceMode === 'total' ? 'per_gallon' : 'total')}
                >
                  Enter {priceMode === 'total' ? 'price/gal' : 'total'}
                </button>
              </div>
              {priceMode === 'total' ? (
                <Input type="number" step="0.01" min="0" placeholder="e.g. 1500.00" value={totalCost} onChange={e => handleInputChange(setTotalCost, e.target.value)} />
              ) : (
                <Input type="number" step="0.001" min="0" placeholder="e.g. 3.15" value={pricePerGallon} onChange={e => handleInputChange(setPricePerGallon, e.target.value)} />
              )}
            </div>
          </div>
          
          {kind === 'opening_balance' && (
            <div className="bg-amber-500/10 border border-amber-500/30 text-amber-700 dark:text-amber-400 p-3 rounded-md text-sm">
              <span className="font-semibold block mb-1">Starting fuel</span>
              Use opening balance only for fuel already in the tank before tracking started.
            </div>
          )}

          {parsedGallons > 0 && parsedCost >= 0 && (
             <div className="text-sm text-muted-foreground flex justify-between bg-muted/50 p-2.5 rounded-md border border-muted">
               <span className="font-medium">
                 {priceMode === 'total' ? 'Calculated per gallon:' : 'Computed total cost:'}
               </span>
               <span className="font-mono text-primary font-medium">
                 {priceMode === 'total' 
                   ? `${fmt$(parsedCost / parsedGallons)}/gal`
                   : fmt$(parsedCost)}
               </span>
             </div>
          )}

          <div className="grid grid-cols-2 gap-4 pt-2">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Supplier (Optional)</label>
              <Input placeholder="e.g. Sunoco" value={supplier} onChange={e => handleInputChange(setSupplier, e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Invoice / Ref (Optional)</label>
              <Input placeholder="e.g. INV-12345" value={reference} onChange={e => handleInputChange(setReference, e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Notes (Optional)</label>
            <Input placeholder="Additional details..." value={notes} onChange={e => handleInputChange(setNotes, e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={createIntake.isPending}>
            {createIntake.isPending ? 'Saving...' : 'Record Intake'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function BulkFuelHistoryDialog({ tank, open, onOpenChange }: { tank: BulkFuelTank, open: boolean, onOpenChange: (open: boolean) => void }) {
  const { data: page, isLoading } = useListBulkFuelTransactions(
    tank.id,
    { limit: 100 },
    {
      query: {
        queryKey: getListBulkFuelTransactionsQueryKey(tank.id, { limit: 100 }),
        enabled: open,
        refetchInterval: open ? 30_000 : false,
        staleTime: 15_000,
      },
    }
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl h-[85vh] flex flex-col p-0 gap-0">
        <DialogHeader className="px-6 py-4 border-b shrink-0 bg-card">
          <DialogTitle>History: {tank.name}</DialogTitle>
          <DialogDescription>
            Audit log of all intakes, dispense events, reversals, and inventory adjustments for this tank.
          </DialogDescription>
        </DialogHeader>
        
        <div className="flex-1 overflow-auto p-0 bg-muted/10">
          {isLoading ? (
             <div className="p-8 text-center text-muted-foreground flex flex-col items-center">
               <History className="w-8 h-8 text-muted/30 mb-3 animate-pulse" />
               Loading history...
             </div>
          ) : (
            <Table>
              <TableHeader className="sticky top-0 bg-card z-10 shadow-sm">
                <TableRow>
                  <TableHead className="w-[120px]">Date</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="text-right">Gallons</TableHead>
                  <TableHead className="text-right">Unit Cost</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead>Source / Destination</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody className="bg-card">
                {page?.data?.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-muted-foreground py-16">
                      <div className="flex flex-col items-center">
                        <History className="w-8 h-8 text-muted/30 mb-3" />
                        No transactions found.
                      </div>
                    </TableCell>
                  </TableRow>
                )}
                {page?.data?.map((tx: BulkFuelTransaction) => (
                  <TableRow key={tx.id}>
                    <TableCell className="whitespace-nowrap text-xs">{tx.date}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={`capitalize text-[10px] py-0 border-none font-medium ${
                        tx.type === 'dispense' ? 'bg-orange-500/10 text-orange-700 dark:text-orange-400' :
                         tx.type === 'reversal' ? 'bg-blue-500/10 text-blue-700 dark:text-blue-400' :
                         tx.type === 'adjustment' ? 'bg-purple-500/10 text-purple-700 dark:text-purple-400' :
                        'bg-green-500/10 text-green-700 dark:text-green-400'
                      }`}>
                        {tx.type.replace('_', ' ')}
                      </Badge>
                    </TableCell>
                    <TableCell className={`text-right font-mono text-sm ${tx.gallons < 0 ? 'text-destructive' : 'text-green-600 dark:text-green-400'}`}>
                      {tx.gallons > 0 ? '+' : ''}{tx.gallons.toLocaleString(undefined, { maximumFractionDigits: 3 })}
                    </TableCell>
                    <TableCell className="text-right font-mono text-muted-foreground text-sm">
                      {fmt$(tx.costPerGallon)}
                    </TableCell>
                    <TableCell className="text-right font-mono font-medium text-sm">
                      {fmt$(Math.abs(tx.totalCost))}
                    </TableCell>
                    <TableCell className="text-xs">
                       {tx.type === 'adjustment' ? (
                         <div data-testid={`audit-adjustment-${tx.id}`} className="space-y-0.5">
                           <span className="font-medium">
                             {tx.actorName || (tx.actorId ? `Staff #${tx.actorId}` : 'Unknown staff')}
                           </span>
                           <span className="block text-muted-foreground">
                             {tx.reason || 'No reason recorded'} · {new Date(tx.createdAt).toLocaleString()}
                           </span>
                           {tx.beforeGallons != null && tx.afterGallons != null && (
                             <span className="block font-mono text-[10px]">
                               {tx.beforeGallons.toLocaleString(undefined, { maximumFractionDigits: 3 })} → {tx.afterGallons.toLocaleString(undefined, { maximumFractionDigits: 3 })} gal
                               {tx.beforeValue != null && tx.afterValue != null && ` · ${fmt$(tx.beforeValue)} → ${fmt$(tx.afterValue)}`}
                             </span>
                           )}
                         </div>
                       ) : tx.type === 'dispense' || tx.type === 'reversal' ? (
                         tx.equipmentName ? <span className="font-medium">EQ: {tx.equipmentName}</span> : <span className="text-muted-foreground italic">Unknown Equipment</span>
                      ) : (
                         tx.supplier ? <span className="font-medium">From: {tx.supplier}</span> : <span className="text-muted-foreground italic">Manual Entry</span>
                      )}
                      {tx.reference && <span className="block text-muted-foreground mt-0.5">Ref: {tx.reference}</span>}
                      {tx.notes && <span className="block text-muted-foreground opacity-70 mt-0.5 italic text-[10px]">{tx.notes}</span>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
