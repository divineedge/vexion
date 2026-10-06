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

  const { data: tanks = [], refetch: refetchTanks } = useListBulkFuelTanks(
    { includeInactive: false },
    { query: { queryKey: getListBulkFuelTanksQueryKey({ includeInactive: false }), enabled: open, refetchInterval: open ? 30_000 : false } }
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
  // Line meter entry: prior reading is snapshotted on tank selection and only replaced by explicit confirmation.
  const [meterMode, setMeterMode] = useState<'meter' | 'manual'>('meter');
  const [meterReading, setMeterReading] = useState('');
  const [expectedMeterReading, setExpectedMeterReading] = useState<number | null>(null);
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
      setMeterMode('meter');
      setMeterReading('');
      setExpectedMeterReading(null);
      setIdempotencyKey(crypto.randomUUID());
    }
  }, [open, todayStr]);

  const handleFieldChange = (setter: any, val: any) => {
    setter(val);
    setIdempotencyKey(crypto.randomUUID());
  };

  const selectedTank = tanks.find(t => t.id === Number(bulkFuelTankId));
  const isBulk = fuelSource === 'bulk_tank';
  const meterActive = isBulk && !!selectedTank && meterMode === 'meter' && expectedMeterReading != null;
  const meterStale = meterActive && selectedTank?.currentMeterReading != null && selectedTank.currentMeterReading !== expectedMeterReading;
  const meterValue = parseFloat(meterReading);
  const meterTooLow = meterActive && meterReading !== '' && !isNaN(meterValue) && meterValue <= (expectedMeterReading as number);
  const meterGallons = meterActive && meterReading !== '' && !isNaN(meterValue) && !meterTooLow
    ? Math.round((meterValue - (expectedMeterReading as number)) * 1000) / 1000
    : null;
  const fmtMeter = (v: number) => v.toLocaleString(undefined, { maximumFractionDigits: 3 });

  const resetMeterForTank = (tankIdStr: string) => {
    const tank = tanks.find(t => t.id === Number(tankIdStr));
    setMeterReading('');
    setGallons('');
    setExpectedMeterReading(tank?.currentMeterReading ?? null);
    setMeterMode(tank && tank.currentMeterReading != null ? 'meter' : 'manual');
  };

  const handleSourceChange = (v: 'purchased' | 'bulk_tank') => {
    handleFieldChange(setFuelSource, v);
    setBulkFuelTankId('');
    resetMeterForTank('');
  };

  const handleTankChange = (v: string) => {
    handleFieldChange(setBulkFuelTankId, v);
    resetMeterForTank(v);
  };

  const handleMeterChange = (v: string) => {
    handleFieldChange(setMeterReading, v);
    const n = parseFloat(v);
    const delta = expectedMeterReading != null && !isNaN(n) ? Math.round((n - expectedMeterReading) * 1000) / 1000 : 0;
    setGallons(delta > 0 ? String(delta) : '');
  };

  const confirmLatestReading = () => {
    if (selectedTank?.currentMeterReading == null) return;
    const latest = selectedTank.currentMeterReading;
    setExpectedMeterReading(latest);
    setIdempotencyKey(crypto.randomUUID());
    const n = parseFloat(meterReading);
    const delta = !isNaN(n) ? Math.round((n - latest) * 1000) / 1000 : 0;
    setGallons(delta > 0 ? String(delta) : '');
  };

  const switchMeterMode = (mode: 'meter' | 'manual') => {
    setMeterMode(mode);
    setMeterReading('');
    setGallons('');
    if (mode === 'meter') setExpectedMeterReading(selectedTank?.currentMeterReading ?? null);
    setIdempotencyKey(crypto.randomUUID());
  };

  const handleSave = () => {
    if (!date) { toast.error('Date is required'); return; }
    
    if (meterActive) {
      if (!meterReading || isNaN(meterValue)) { toast.error('Enter the current line meter reading'); return; }
      if (meterTooLow) { toast.error(`Meter reading must be greater than the previous reading (${fmtMeter(expectedMeterReading as number)})`); return; }
      if (meterStale) { toast.error('The previous meter reading changed. Confirm the new previous reading before saving.'); return; }
    }
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
        ...(meterActive ? { meterReading: meterValue, expectedMeterReading: expectedMeterReading as number } : {}),
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
        // Keep the entry; refresh tanks so a changed previous reading surfaces for explicit confirmation.
        void refetchTanks();
        toast.error(err?.response?.data?.message || err?.data?.message || 'Failed to add fuel log. Your entry is kept.');
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
              <Select value={fuelSource} onValueChange={handleSourceChange}>
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
              <Select value={bulkFuelTankId} onValueChange={handleTankChange}>
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
                  {selectedTank.currentMeterReading != null && <> · Line meter {fmtMeter(selectedTank.currentMeterReading)}</>}
                </p>
              )}
              {selectedTank && selectedTank.currentMeterReading == null && expectedMeterReading == null && (
                <p className="text-xs text-muted-foreground mt-2 border-t pt-2">
                  No starting line meter reading is set for this tank. Set one in Bulk Fuel tank settings to enable meter entry. Enter gallons manually for now.
                </p>
              )}
              {meterActive && (
                <div className="space-y-2 mt-2 border-t pt-3">
                  <label className="text-sm font-medium">Line Meter Reading Now *</label>
                  <Input
                    type="number" step="0.001"
                    placeholder={`More than ${fmtMeter(expectedMeterReading as number)}`}
                    value={meterReading}
                    onChange={e => handleMeterChange(e.target.value)}
                    aria-invalid={meterTooLow}
                    data-testid="input-fuel-meter-reading"
                  />
                  {meterTooLow && (
                    <p className="text-xs text-destructive">Must be greater than the previous reading ({fmtMeter(expectedMeterReading as number)}).</p>
                  )}
                  <div className="grid grid-cols-3 gap-2 text-xs rounded-md border bg-card p-2">
                    <div><p className="text-muted-foreground uppercase text-[10px] font-semibold">Previous</p><p className="font-mono">{fmtMeter(expectedMeterReading as number)}</p></div>
                    <div><p className="text-muted-foreground uppercase text-[10px] font-semibold">Gallons</p><p className="font-mono text-primary">{meterGallons != null ? fmtMeter(meterGallons) : '—'}</p></div>
                    <div><p className="text-muted-foreground uppercase text-[10px] font-semibold">Est. Cost</p><p className="font-mono">{meterGallons != null ? `$${(meterGallons * selectedTank!.unitCostPerGallon).toFixed(2)}` : '—'}</p></div>
                  </div>
                  {meterStale && (
                    <div className="text-xs rounded-md border border-destructive/40 bg-destructive/5 p-2 space-y-1.5">
                      <p>Fuel was recorded from this tank since you selected it. The line meter is now {fmtMeter(selectedTank!.currentMeterReading as number)}, not {fmtMeter(expectedMeterReading as number)}.</p>
                      <Button type="button" size="sm" variant="outline" className="h-7" onClick={confirmLatestReading}>Use {fmtMeter(selectedTank!.currentMeterReading as number)} as previous</Button>
                    </div>
                  )}
                  <div className="flex gap-3">
                    {!meterStale && <button type="button" className="text-[11px] text-primary hover:underline" onClick={() => void refetchTanks()}>Check for newer reading</button>}
                    <button type="button" className="text-[11px] text-muted-foreground hover:underline" onClick={() => switchMeterMode('manual')}>Enter gallons manually instead</button>
                  </div>
                </div>
              )}
              {isBulk && selectedTank && meterMode === 'manual' && selectedTank.currentMeterReading != null && (
                <button type="button" className="text-[11px] text-primary hover:underline mt-1" onClick={() => switchMeterMode('meter')}>Use line meter reading instead</button>
              )}
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Gallons Added *</label>
              <Input type="number" step="0.001" min="0.001" placeholder={meterActive ? 'From meter' : 'e.g. 15.5'} value={gallons} readOnly={meterActive} className={meterActive ? 'bg-muted/30' : undefined} onChange={e => handleFieldChange(setGallons, e.target.value)} />
            </div>
            
            {isBulk ? (
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-muted-foreground">Estimated Total</label>
                <div className="h-9 px-3 py-1 border rounded-md bg-muted/30 flex items-center font-mono">
                  {gallons && selectedTank ? `$${(parseFloat(gallons) * selectedTank.unitCostPerGallon).toFixed(2)}` : '—'}
                </div>
                <p className="text-[10px] text-muted-foreground italic">Client estimate. Server confirms final cost.</p>
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
              <label className="text-sm font-medium text-muted-foreground">Hours / Odometer</label>
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
