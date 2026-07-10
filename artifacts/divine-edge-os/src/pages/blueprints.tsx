import React, { useState } from 'react';
import { useListBlueprints, getListBlueprintsQueryKey } from '@workspace/api-client-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Plus, DraftingCompass, Settings, ArrowRight } from 'lucide-react';
import { useLocation } from 'wouter';
import { Badge } from '@/components/ui/badge';
import { format } from 'date-fns';

export default function BlueprintsPage() {
  const [, setLocation] = useLocation();
  const { data: blueprints, isLoading } = useListBlueprints({ query: { queryKey: getListBlueprintsQueryKey() }});

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Blueprints</h1>
          <p className="text-muted-foreground mt-1">Interactive schematics and material estimation.</p>
        </div>
        <Button className="gap-2" onClick={() => setLocation('/blueprints/new')}>
          <Plus className="w-4 h-4" /> New Blueprint
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {isLoading ? (
          <div className="col-span-full text-center py-12 text-muted-foreground">Loading blueprints...</div>
        ) : blueprints?.map((bp) => (
          <Card key={bp.id} className="group hover:border-primary/50 transition-colors cursor-pointer overflow-hidden flex flex-col" onClick={() => setLocation(`/blueprints/${bp.id}`)}>
            <div className="h-32 bg-muted flex items-center justify-center border-b group-hover:bg-primary/5 transition-colors">
              <DraftingCompass className="w-12 h-12 text-muted-foreground group-hover:text-primary/40 transition-colors" />
            </div>
            <CardContent className="p-5 flex-1 flex flex-col">
              <div className="flex justify-between items-start mb-2">
                <h3 className="font-semibold text-lg line-clamp-1 group-hover:text-primary transition-colors">{bp.name}</h3>
                <Badge variant="outline" className="capitalize text-[10px] shrink-0">{bp.mode}</Badge>
              </div>
              <p className="text-xs text-muted-foreground mt-auto">
                Created {format(new Date(bp.createdAt), 'MMM d, yyyy')}
              </p>
              {bp.totalEstimate !== undefined && bp.totalEstimate !== null && (
                <p className="text-sm font-medium mt-2">Est: ${bp.totalEstimate.toLocaleString()}</p>
              )}
            </CardContent>
          </Card>
        ))}
        {blueprints?.length === 0 && (
          <div className="col-span-full text-center py-12 border-2 border-dashed rounded-xl text-muted-foreground">
            No blueprints created yet.
          </div>
        )}
      </div>
    </div>
  );
}
