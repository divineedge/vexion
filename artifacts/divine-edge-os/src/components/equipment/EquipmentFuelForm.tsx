import React, { useState, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  useCreateEquipmentFuelLog,
  useListBulkFuelTanks,
  getListBulkFuelTanksQueryKey,
  getListEquipmentFuelLogsQueryKey,
  getListEquipmentQueryKey,
  useListJobs,
  getListJobsQueryKey,
} from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { toast } from 'sonner';
import type { EquipmentFuelLogInput, EquipmentFuelLogInputFuelSource } from '@workspace/api-client-react';

export function EquipmentFuelForm({ 
  equipmentId, 
  open, 
  onOpenChange 
}: { 
  equipmentId: number; 
  open: boolean; 
  onOpenChange: (open: boolean) => void;
}) {
  const qc = useQueryClient();
  const createFuelLog = useCreateEquipmentFuelLog();

  const { data: tanks = [] } = useListBulkFuelTanks(
    { includeInactive: false },
    { query: { queryKey: getListBulkFuelTanksQueryKey({ includeInactive: false }), enabled: open } }
  );

  const { data: recentJobs = [] } = useListJobs(
    undefined,
    { query: { queryKey: getListJobsQueryKey(), enabled: open } },
  );

  const todayStr = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState(todayStr);
  const [gallons, setGallons] = useState('');
  const [fuelSource, setFuelSource] = useState<'purchased' | 'bulk_tank'>('purchased');
  const [bulkFuelTankId, setBulkFuelTankId] = useState('');
  
  // Purchased fields
  const [costPerGallon, setCostPerGallon] = useState('');
  const [cost, setCost] = useState('');
  
  const [odometerReading, setOdometerReading] = useState('');
  const [jobId, setJobId] = useState('');
  const [idempotencyKey, setIdempotencyKey] = useState('');

  // Reset idempotency when form opens or core fields change
  useEffect(() => {
    if (open) {
      setDate(todayStr);
      setGallons('');
      setCostPerGallon('');
      setCost('');
      setOdometerReading('');
      setJobId('');
      setFuelSource('purchased');
      setBulkFuelTankId('');
      setIdempotencyKey(crypto.randomUUID());
    }
  }, [open, todayStr]);

  const handleFieldChange = (setter: any, val: any) => {
    setter(val);
    setIdempotencyKey(crypto.randomUUID());
  };

  const selectedTank = tanks.find(t => t.id === Number(bulkFuelTankId));
  const isBulk = fuelSource === 'bulk_tank';

  const handleSave = () => {
    if (!date) { toast.error('Date is required'); return; }
    
    const parsedGallons = parseFloat(gallons);
    if (isNaN(parsedGallons) || parsedGallons <= 0) {
      toast.error('Valid positive gallons required');
      return;
    }

    if (isBulk && !bulkFuelTankId) {
      toast.error('Select a bulk tank');
      return;
    }

    if (isBulk && selectedTank && parsedGallons > selectedTank.availableGallons) {
      toast.error('Insufficient inventory in selected tank');
      return;
    }

    let finalCost = 0;
    let finalCpg: number | undefined = undefined;

    if (isBulk) {
       // Bulk price is calculated server-side, we don't pass it here. 
       // Just pass undefined so the server uses its current weighted cost.
    } else {
       const parsedCpg = costPerGallon ? parseFloat(costPerGallon) : null;
       finalCost = cost ? parseFloat(cost) : (parsedCpg ? parsedGallons * parsedCpg : 0);
       finalCpg = parsedCpg ?? undefined;
    }

    createFuelLog.mutate({
      id: equipmentId,
      data: {
        date,
        gallons: parsedGallons,
        costPerGallon: finalCpg,
        cost: isBulk ? undefined : finalCost,
        odometerReading: odometerReading ? parseFloat(odometerReading) : undefined,
        jobId: jobId ? parseInt(jobId, 10) : undefined,
        fuelSource: fuelSource as EquipmentFuelLogInputFuelSource,
        bulkFuelTankId: isBulk ? Number(bulkFuelTankId) : undefined,
        idempotencyKey,
      },
    }, {
      onSuccess: () => {
        toast.success('Fuel log added');
        qc.invalidateQueries({ queryKey: getListEquipmentFuelLogsQueryKey(equipmentId) });
        qc.invalidateQueries({ predicate: q => q.queryKey[0] === getListEquipmentQueryKey()[0] });
        qc.invalidateQueries({ predicate: q => q.queryKey[0] === getListBulkFuelTanksQueryKey()[0] });
        // After invalidating, also invalidate reports
        qc.invalidateQueries({ predicate: q => String(q.queryKey[0]).includes('/reports/equipment-fuel-usage') });
        onOpenChange(false);
      },
      onError: (err: any) => {
        toast.error(err?.response?.data?.message || 'Failed to add fuel log');
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Log Fuel Fill</DialogTitle>
          <DialogDescription>
            Record fuel dispensed into this equipment.
          </DialogDescription>
        </DialogHeader>
        
        <div className="space-y-4 py-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Source</label>
              <Select value={fuelSource} onValueChange={(v: 'purchased' | 'bulk_tank') => handleFieldChange(setFuelSource, v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="purchased">Station / Purchased</SelectItem>
                  <SelectItem value="bulk_tank">Bulk Tank</SelectItem>
                </SelectContent>
              </Select>
            </div>
            
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Date</label>
              <Input type="date" value={date} onChange={e => handleFieldChange(setDate, e.target.value)} />
            </div>
          </div>

          {isBulk && (
            <div className="space-y-1.5 p-3 border rounded-lg bg-muted/20">
              <label className="text-sm font-medium">Bulk Tank</label>
              <Select value={bulkFuelTankId} onValueChange={v => handleFieldChange(setBulkFuelTankId, v)}>
                <SelectTrigger><SelectValue placeholder="Select active tank..." /></SelectTrigger>
                <SelectContent>
                  {tanks.length === 0 && <SelectItem value="none" disabled>No active tanks available</SelectItem>}
                  {tanks.map(t => (
                    <SelectItem key={t.id} value={String(t.id)}>
                      {t.name} — {t.availableGallons.toLocaleString(undefined, { maximumFractionDigits: 1 })} gal available
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              
              {selectedTank && (
                <p className="text-xs text-muted-foreground mt-1">
                  Current blended cost: ${(selectedTank.unitCostPerGallon).toFixed(2)}/gal
                </p>
              )}
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Gallons Added *</label>
              <Input type="number" step="0.001" min="0.001" placeholder="e.g. 15.5" value={gallons} onChange={e => handleFieldChange(setGallons, e.target.value)} />
            </div>
            
            {isBulk ? (
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-muted-foreground">Estimated Total</label>
                <div className="h-9 px-3 py-1 border rounded-md bg-muted/30 flex items-center font-mono">
                  {gallons && selectedTank ? `$${(parseFloat(gallons) * selectedTank.unitCostPerGallon).toFixed(2)}` : '—'}
                </div>
                <p className="text-[10px] text-muted-foreground italic">Finalized on save</p>
              </div>
            ) : (
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Total Cost ($)</label>
                <Input type="number" step="0.01" min="0" placeholder="e.g. 50.00" value={cost} onChange={e => handleFieldChange(setCost, e.target.value)} />
              </div>
            )}
          </div>

          {!isBulk && (
             <div className="space-y-1.5">
               <label className="text-sm font-medium text-muted-foreground">Or Cost per Gallon ($)</label>
               <Input type="number" step="0.001" min="0" placeholder="e.g. 3.49" value={costPerGallon} onChange={e => handleFieldChange(setCostPerGallon, e.target.value)} />
             </div>
          )}

          <div className="grid grid-cols-2 gap-4 pt-2">
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-muted-foreground">Meter Reading</label>
              <Input type="number" placeholder="Optional" value={odometerReading} onChange={e => handleFieldChange(setOdometerReading, e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-muted-foreground">Linked Job</label>
              <Select value={jobId || 'none'} onValueChange={v => handleFieldChange(setJobId, v === 'none' ? '' : v)}>
                <SelectTrigger><SelectValue placeholder="No job" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No job</SelectItem>
                  {recentJobs.slice(0, 20).map(j => (
                    <SelectItem key={j.id} value={String(j.id)}>Job #{j.id} - {j.propertyAddress?.split(',')[0]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
        
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={createFuelLog.isPending}>
            {createFuelLog.isPending ? 'Saving...' : 'Save Fuel Log'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
