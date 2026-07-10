import React, { useState } from 'react';
import {
  useListBlueprints, getListBlueprintsQueryKey,
  useUpdateBlueprint, getGetBlueprintQueryKey,
  customFetch,
} from '@workspace/api-client-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Plus, DraftingCompass, Percent } from 'lucide-react';
import { useLocation } from 'wouter';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';

export default function BlueprintsPage() {
  const [, setLocation] = useLocation();
  const { canManageOffice } = useAuth();
  const qc = useQueryClient();

  const { data: blueprints, isLoading } = useListBlueprints({ query: { queryKey: getListBlueprintsQueryKey() } });

  // Inline P4P edit state: blueprintId → draft value
  const [p4pEditing, setP4pEditing] = useState<Record<number, string>>({});
  const [p4pOpen, setP4pOpen] = useState<Record<number, boolean>>({});
  const updateBlueprint = useUpdateBlueprint();

  // Fetch global P4P rate for "using global" label
  const { data: settings } = useQuery<{ p4pMasterPercentage?: number }>({
    queryKey: ['settings-p4p'],
    queryFn: () => customFetch<{ p4pMasterPercentage?: number }>('/api/settings'),
  });
  const globalPct = (settings as any)?.p4pMasterPercentage ?? 0;

  const saveP4p = (bpId: number, val: string) => {
    const parsed = val.trim() === '' ? null : parseFloat(val);
    updateBlueprint.mutate(
      { id: bpId, data: { p4pPercentage: parsed } as any },
      {
        onSuccess: () => {
          toast.success(parsed == null ? 'P4P override removed — using global rate' : `P4P set to ${parsed}%`);
          qc.invalidateQueries({ queryKey: getListBlueprintsQueryKey() });
          setP4pOpen(prev => ({ ...prev, [bpId]: false }));
        },
        onError: () => toast.error('Failed to save P4P percentage'),
      },
    );
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Blueprints</h1>
          <p className="text-muted-foreground mt-1">Interactive schematics and material estimation. Set a per-service P4P rate on each blueprint.</p>
        </div>
        <Button className="gap-2" onClick={() => setLocation('/blueprints/new')}>
          <Plus className="w-4 h-4" /> New Blueprint
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {isLoading ? (
          <div className="col-span-full text-center py-12 text-muted-foreground">Loading blueprints...</div>
        ) : blueprints?.map((bp) => {
          const bpPct = (bp as any).p4pPercentage as number | null | undefined;
          const hasOverride = bpPct != null;
          const displayPct = hasOverride ? bpPct : globalPct;

          return (
            <Card key={bp.id} className="group hover:border-primary/50 transition-colors overflow-hidden flex flex-col">
              {/* Canvas preview area — click navigates */}
              <div
                className="h-32 bg-muted flex items-center justify-center border-b group-hover:bg-primary/5 transition-colors cursor-pointer"
                onClick={() => setLocation(`/blueprints/${bp.id}`)}
              >
                <DraftingCompass className="w-12 h-12 text-muted-foreground group-hover:text-primary/40 transition-colors" />
              </div>

              <CardContent className="p-5 flex-1 flex flex-col gap-2">
                <div
                  className="flex justify-between items-start cursor-pointer"
                  onClick={() => setLocation(`/blueprints/${bp.id}`)}
                >
                  <h3 className="font-semibold text-lg line-clamp-1 group-hover:text-primary transition-colors">{bp.name}</h3>
                  <Badge variant="outline" className="capitalize text-[10px] shrink-0 ml-2">{bp.mode}</Badge>
                </div>

                <p className="text-xs text-muted-foreground mt-auto">
                  Created {format(new Date(bp.createdAt), 'MMM d, yyyy')}
                </p>

                {bp.totalEstimate !== undefined && bp.totalEstimate !== null && (
                  <p className="text-sm font-medium">Est: ${bp.totalEstimate.toLocaleString()}</p>
                )}

                {/* P4P rate badge + popover editor */}
                <div className="flex items-center justify-between pt-2 border-t mt-1">
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Percent className="w-3 h-3" />
                    <span>P4P:</span>
                    {displayPct > 0 ? (
                      <Badge variant="outline" className={`text-[11px] px-1.5 py-0 ${hasOverride ? 'text-primary border-primary/40' : 'text-muted-foreground'}`}>
                        {displayPct}%{hasOverride ? '' : ' (global)'}
                      </Badge>
                    ) : (
                      <span className="text-muted-foreground/60 italic text-[11px]">not set</span>
                    )}
                  </div>

                  {canManageOffice && (
                    <Popover
                      open={!!p4pOpen[bp.id]}
                      onOpenChange={open => {
                        setP4pOpen(prev => ({ ...prev, [bp.id]: open }));
                        if (open) setP4pEditing(prev => ({ ...prev, [bp.id]: bpPct != null ? String(bpPct) : '' }));
                      }}
                    >
                      <PopoverTrigger asChild>
                        <Button variant="ghost" size="sm" className="h-6 text-xs px-2">
                          {hasOverride ? 'Edit' : 'Set rate'}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-64 p-3" align="end">
                        <p className="text-sm font-medium mb-1">Service P4P Percentage</p>
                        <p className="text-xs text-muted-foreground mb-2">
                          Override the global rate ({globalPct}%) for this service. Leave blank to use the global rate.
                        </p>
                        <div className="flex items-center gap-2">
                          <Input
                            type="number"
                            min={0}
                            max={100}
                            step={0.5}
                            placeholder={`${globalPct} (global)`}
                            className="w-24 text-right"
                            value={p4pEditing[bp.id] ?? ''}
                            onChange={e => setP4pEditing(prev => ({ ...prev, [bp.id]: e.target.value }))}
                            onKeyDown={e => { if (e.key === 'Enter') saveP4p(bp.id, p4pEditing[bp.id] ?? ''); }}
                          />
                          <span className="text-sm text-muted-foreground">%</span>
                        </div>
                        <div className="flex gap-2 mt-3">
                          <Button size="sm" className="flex-1" onClick={() => saveP4p(bp.id, p4pEditing[bp.id] ?? '')} disabled={updateBlueprint.isPending}>
                            Save
                          </Button>
                          {hasOverride && (
                            <Button size="sm" variant="outline" onClick={() => saveP4p(bp.id, '')} disabled={updateBlueprint.isPending}>
                              Clear
                            </Button>
                          )}
                        </div>
                      </PopoverContent>
                    </Popover>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
        {!isLoading && blueprints?.length === 0 && (
          <div className="col-span-full text-center py-12 border-2 border-dashed rounded-xl text-muted-foreground">
            No blueprints created yet.
          </div>
        )}
      </div>
    </div>
  );
}
