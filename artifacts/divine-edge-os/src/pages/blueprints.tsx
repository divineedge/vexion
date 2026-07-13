import React, { useState } from 'react';
import {
  useListBlueprints, getListBlueprintsQueryKey,
  useUpdateBlueprint, getGetBlueprintQueryKey,
  useCreateBlueprint,
  useGetBlueprintSuggestedParts, getGetBlueprintSuggestedPartsQueryKey,
  useUpdateBlueprintSuggestedParts,
  useListInventoryItems, getListInventoryItemsQueryKey,
  useListProperties, getListPropertiesQueryKey,
  useListBlueprintTemplates, getListBlueprintTemplatesQueryKey,
  useApplyBlueprintTemplate,
  useGenerateBlueprintFromAi,
  customFetch,
} from '@workspace/api-client-react';
import type { BlueprintInputMode } from '@workspace/api-client-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Plus, DraftingCompass, Percent, Package, AlertTriangle, Trash2, Wand2, Library, CopyPlus } from 'lucide-react';
import { useLocation } from 'wouter';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';

export default function BlueprintsPage() {
  const [, setLocation] = useLocation();
  const { canManageOffice } = useAuth();
  const qc = useQueryClient();

  const { data: blueprints, isLoading } = useListBlueprints({ query: { queryKey: getListBlueprintsQueryKey() } });

  // New Blueprint dialog
  const [newBpOpen, setNewBpOpen] = useState(false);
  const [newBpName, setNewBpName] = useState('');
  const [newBpMode, setNewBpMode] = useState<BlueprintInputMode>('landscape');
  const [newBpPropertyId, setNewBpPropertyId] = useState('');
  const [newBpIsTemplate, setNewBpIsTemplate] = useState(false);
  const createBlueprint = useCreateBlueprint();
  const { data: properties } = useListProperties({}, { query: { enabled: newBpOpen, queryKey: getListPropertiesQueryKey({}) } });

  const handleCreateBlueprint = () => {
    if (!newBpName.trim()) { toast.error('Name is required'); return; }
    createBlueprint.mutate(
      {
        data: {
          name: newBpName.trim(),
          mode: newBpMode,
          propertyId: newBpPropertyId ? parseInt(newBpPropertyId, 10) : undefined,
          isTemplate: newBpIsTemplate,
        },
      },
      {
        onSuccess: (bp) => {
          toast.success('Blueprint created');
          qc.invalidateQueries({ queryKey: getListBlueprintsQueryKey() });
          qc.invalidateQueries({ queryKey: getListBlueprintTemplatesQueryKey() });
          setNewBpOpen(false);
          setNewBpName('');
          setNewBpMode('landscape');
          setNewBpPropertyId('');
          setNewBpIsTemplate(false);
          setLocation(`/blueprints/${bp.id}`);
        },
        onError: () => toast.error('Failed to create blueprint'),
      },
    );
  };

  // Inline P4P edit state: blueprintId → draft value
  const [p4pEditing, setP4pEditing] = useState<Record<number, string>>({});
  const [p4pOpen, setP4pOpen] = useState<Record<number, boolean>>({});
  const updateBlueprint = useUpdateBlueprint();

  // Suggested parts panel
  const [suggestedPartsOpen, setSuggestedPartsOpen] = useState(false);
  const [suggestedPartsBpId, setSuggestedPartsBpId] = useState<number | null>(null);
  const [partItemId, setPartItemId] = useState('');
  const [partQty, setPartQty] = useState('1');
  const updateSuggestedParts = useUpdateBlueprintSuggestedParts();
  const { data: suggestedParts, refetch: refetchSuggested } = useGetBlueprintSuggestedParts(
    suggestedPartsBpId ?? 0,
    { query: { enabled: suggestedPartsBpId != null, queryKey: getGetBlueprintSuggestedPartsQueryKey(suggestedPartsBpId ?? 0) } }
  );
  const { data: inventoryItems } = useListInventoryItems({}, { query: { enabled: suggestedPartsOpen, queryKey: getListInventoryItemsQueryKey({}) } });

  // Fetch global P4P rate
  const { data: settings } = useQuery<{ p4pMasterPercentage?: number }>({
    queryKey: ['settings-p4p'],
    queryFn: () => customFetch<{ p4pMasterPercentage?: number }>('/api/settings'),
  });
  const globalPct = (settings as any)?.p4pMasterPercentage ?? 0;

  // ── Template browser ─────────────────────────────────────────────────────────
  const [templateBrowserOpen, setTemplateBrowserOpen] = useState(false);
  const { data: templates, isLoading: templatesLoading } = useListBlueprintTemplates({
    query: { enabled: templateBrowserOpen, queryKey: getListBlueprintTemplatesQueryKey() },
  });
  const applyTemplate = useApplyBlueprintTemplate();
  const [applyingTemplateId, setApplyingTemplateId] = useState<number | null>(null);
  const [applyPropertyId, setApplyPropertyId] = useState('');
  const [applyDialogOpen, setApplyDialogOpen] = useState(false);
  const { data: applyProperties } = useListProperties({}, { query: { enabled: applyDialogOpen, queryKey: getListPropertiesQueryKey({}) } });

  const handleApplyTemplate = () => {
    if (!applyingTemplateId) return;
    applyTemplate.mutate(
      {
        id: applyingTemplateId,
        data: { propertyId: applyPropertyId ? parseInt(applyPropertyId, 10) : undefined },
      },
      {
        onSuccess: (bp) => {
          toast.success('Blueprint instance created from template');
          qc.invalidateQueries({ queryKey: getListBlueprintsQueryKey() });
          setApplyDialogOpen(false);
          setApplyingTemplateId(null);
          setApplyPropertyId('');
          setTemplateBrowserOpen(false);
          setLocation(`/blueprints/${bp.id}`);
        },
        onError: () => toast.error('Failed to apply template'),
      },
    );
  };

  // ── AI Generation ────────────────────────────────────────────────────────────
  const [aiDialogOpen, setAiDialogOpen] = useState(false);
  const [aiDescription, setAiDescription] = useState('');
  const [aiMode, setAiMode] = useState<BlueprintInputMode>('landscape');
  const [aiPropertyId, setAiPropertyId] = useState('');
  const generateAi = useGenerateBlueprintFromAi();
  const { data: aiProperties } = useListProperties({}, { query: { enabled: aiDialogOpen, queryKey: getListPropertiesQueryKey({}) } });

  const handleGenerateAi = () => {
    if (!aiDescription.trim()) { toast.error('Description is required'); return; }
    generateAi.mutate(
      {
        data: {
          description: aiDescription.trim(),
          mode: aiMode,
          propertyId: aiPropertyId ? parseInt(aiPropertyId, 10) : undefined,
        },
      },
      {
        onSuccess: (bp) => {
          toast.success('AI layout generated!');
          qc.invalidateQueries({ queryKey: getListBlueprintsQueryKey() });
          setAiDialogOpen(false);
          setAiDescription('');
          setAiMode('landscape');
          setAiPropertyId('');
          setLocation(`/blueprints/${bp.id}`);
        },
        onError: () => toast.error('Failed to generate layout'),
      },
    );
  };

  const handleAddSuggestedPart = () => {
    if (!suggestedPartsBpId || !partItemId) { toast.error('Select an inventory item'); return; }
    const qty = parseFloat(partQty) || 1;
    const existing = (suggestedParts ?? []).filter(p => p.inventoryItemId !== parseInt(partItemId, 10));
    const newParts = [...existing, { inventoryItemId: parseInt(partItemId, 10), estimatedQuantity: qty }];
    updateSuggestedParts.mutate(
      { id: suggestedPartsBpId, data: { parts: newParts } },
      {
        onSuccess: () => {
          toast.success('Suggested part added');
          refetchSuggested();
          setPartItemId('');
          setPartQty('1');
        },
        onError: () => toast.error('Failed to save'),
      }
    );
  };

  const handleRemoveSuggestedPart = (inventoryItemId: number) => {
    if (!suggestedPartsBpId) return;
    const newParts = (suggestedParts ?? []).filter(p => p.inventoryItemId !== inventoryItemId).map(p => ({ inventoryItemId: p.inventoryItemId, estimatedQuantity: p.estimatedQuantity }));
    updateSuggestedParts.mutate(
      { id: suggestedPartsBpId, data: { parts: newParts } },
      { onSuccess: () => refetchSuggested(), onError: () => toast.error('Failed to remove') }
    );
  };

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

  const handleToggleTemplate = (bpId: number, current: boolean) => {
    updateBlueprint.mutate(
      { id: bpId, data: { isTemplate: !current } as any },
      {
        onSuccess: () => {
          toast.success(!current ? 'Marked as template' : 'Removed template status');
          qc.invalidateQueries({ queryKey: getListBlueprintsQueryKey() });
          qc.invalidateQueries({ queryKey: getListBlueprintTemplatesQueryKey() });
        },
        onError: () => toast.error('Failed to update'),
      },
    );
  };

  // All blueprints (non-templates shown in main list, but user can tab)
  const instanceBlueprints = (blueprints ?? []).filter(bp => !(bp as any).isTemplate);
  const templateBlueprints = (blueprints ?? []).filter(bp => (bp as any).isTemplate);

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Blueprints</h1>
          <p className="text-muted-foreground mt-1">Interactive schematics and material estimation. Set a per-service P4P rate on each blueprint.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" className="gap-2" onClick={() => setTemplateBrowserOpen(true)}>
            <Library className="w-4 h-4" /> Browse Templates
          </Button>
          <Button variant="outline" className="gap-2" onClick={() => setAiDialogOpen(true)}>
            <Wand2 className="w-4 h-4" /> Generate with AI
          </Button>
          <Button className="gap-2" onClick={() => setNewBpOpen(true)}>
            <Plus className="w-4 h-4" /> New Blueprint
          </Button>
        </div>
      </div>

      <Tabs defaultValue="instances">
        <TabsList>
          <TabsTrigger value="instances">Blueprints ({instanceBlueprints.length})</TabsTrigger>
          <TabsTrigger value="templates">Templates ({templateBlueprints.length})</TabsTrigger>
        </TabsList>

        {/* ── Instance blueprints ── */}
        <TabsContent value="instances" className="mt-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {isLoading ? (
              <div className="col-span-full text-center py-12 text-muted-foreground">Loading blueprints...</div>
            ) : instanceBlueprints.map((bp) => <BlueprintCard key={bp.id} bp={bp} globalPct={globalPct} p4pEditing={p4pEditing} p4pOpen={p4pOpen} setP4pEditing={setP4pEditing} setP4pOpen={setP4pOpen} saveP4p={saveP4p} updateBlueprint={updateBlueprint} setSuggestedPartsBpId={setSuggestedPartsBpId} setSuggestedPartsOpen={setSuggestedPartsOpen} canManageOffice={canManageOffice} setLocation={setLocation} handleToggleTemplate={handleToggleTemplate} />)}
            {!isLoading && instanceBlueprints.length === 0 && (
              <div className="col-span-full text-center py-12 border-2 border-dashed rounded-xl text-muted-foreground">
                No blueprints yet. Create one or apply a template.
              </div>
            )}
          </div>
        </TabsContent>

        {/* ── Template blueprints ── */}
        <TabsContent value="templates" className="mt-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {isLoading ? (
              <div className="col-span-full text-center py-12 text-muted-foreground">Loading...</div>
            ) : templateBlueprints.map((bp) => <BlueprintCard key={bp.id} bp={bp} globalPct={globalPct} p4pEditing={p4pEditing} p4pOpen={p4pOpen} setP4pEditing={setP4pEditing} setP4pOpen={setP4pOpen} saveP4p={saveP4p} updateBlueprint={updateBlueprint} setSuggestedPartsBpId={setSuggestedPartsBpId} setSuggestedPartsOpen={setSuggestedPartsOpen} canManageOffice={canManageOffice} setLocation={setLocation} handleToggleTemplate={handleToggleTemplate}
              extraAction={
                <Button size="sm" variant="outline" className="w-full gap-1.5 text-xs h-7 mt-1"
                  onClick={e => { e.stopPropagation(); setApplyingTemplateId(bp.id); setApplyDialogOpen(true); }}>
                  <CopyPlus className="w-3 h-3" /> Apply to Job/Property
                </Button>
              }
            />)}
            {!isLoading && templateBlueprints.length === 0 && (
              <div className="col-span-full text-center py-12 border-2 border-dashed rounded-xl text-muted-foreground">
                No templates yet. Mark a blueprint as a template to reuse it across jobs.
              </div>
            )}
          </div>
        </TabsContent>
      </Tabs>

      {/* Suggested Parts Sheet */}
      <Sheet open={suggestedPartsOpen} onOpenChange={open => { if (!open) { setSuggestedPartsOpen(false); setSuggestedPartsBpId(null); } }}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          <SheetHeader className="pb-4">
            <SheetTitle className="flex items-center gap-2">
              <Package className="w-5 h-5 text-primary" /> Suggested Parts
            </SheetTitle>
            <SheetDescription>
              Tag parts that are typically needed for this blueprint type. Stock levels update in real time.
            </SheetDescription>
          </SheetHeader>

          <div className="space-y-5">
            {canManageOffice && (
              <div className="rounded-lg border p-4 space-y-3 bg-muted/30">
                <p className="text-sm font-medium">Add Suggested Part</p>
                <div className="grid grid-cols-3 gap-2">
                  <div className="col-span-2 space-y-1">
                    <label className="text-xs text-muted-foreground">Inventory Item</label>
                    <Select value={partItemId} onValueChange={setPartItemId}>
                      <SelectTrigger><SelectValue placeholder="Select item..." /></SelectTrigger>
                      <SelectContent>
                        {inventoryItems?.map(item => (
                          <SelectItem key={item.id} value={String(item.id)}>{item.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">Est. Qty</label>
                    <Input type="number" min={0.1} step={0.5} value={partQty} onChange={e => setPartQty(e.target.value)} />
                  </div>
                </div>
                <Button size="sm" onClick={handleAddSuggestedPart} disabled={updateSuggestedParts.isPending} className="gap-1.5">
                  <Plus className="w-3.5 h-3.5" /> Add Part
                </Button>
              </div>
            )}

            {suggestedParts && suggestedParts.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Part</TableHead>
                    <TableHead className="text-right">Est. Qty</TableHead>
                    <TableHead className="text-right">In Stock</TableHead>
                    <TableHead className="text-right">Status</TableHead>
                    {canManageOffice && <TableHead className="w-[40px]" />}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {suggestedParts.map(part => (
                    <TableRow key={part.inventoryItemId}>
                      <TableCell>
                        <div className="font-medium text-sm">{part.name}</div>
                        <div className="text-xs text-muted-foreground font-mono">{part.sku}</div>
                      </TableCell>
                      <TableCell className="text-right">{part.estimatedQuantity} {part.unit}</TableCell>
                      <TableCell className="text-right">{part.warehouseStock} {part.unit}</TableCell>
                      <TableCell className="text-right">
                        {part.orderNeeded ? (
                          <Badge variant="destructive" className="gap-1 text-[10px]">
                            <AlertTriangle className="w-3 h-3" /> Order Needed
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-emerald-600 border-emerald-300 text-[10px]">In Stock</Badge>
                        )}
                      </TableCell>
                      {canManageOffice && (
                        <TableCell>
                          <button className="text-muted-foreground/40 hover:text-destructive transition-colors" onClick={() => handleRemoveSuggestedPart(part.inventoryItemId)}>
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <div className="text-center py-8 text-muted-foreground text-sm">
                No suggested parts yet. Add parts above to help with pre-job planning.
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>

      {/* New Blueprint Dialog */}
      <Dialog open={newBpOpen} onOpenChange={setNewBpOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New Blueprint</DialogTitle>
            <DialogDescription>Start a new schematic. You can draw the layout and measure the area on the next screen.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Name <span className="text-destructive">*</span></label>
              <Input value={newBpName} onChange={e => setNewBpName(e.target.value)} placeholder="e.g. Smith Front Yard Irrigation" onKeyDown={e => { if (e.key === 'Enter') handleCreateBlueprint(); }} />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Type</label>
              <Select value={newBpMode} onValueChange={v => setNewBpMode(v as BlueprintInputMode)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="landscape">Landscape</SelectItem>
                  <SelectItem value="irrigation">Irrigation</SelectItem>
                  <SelectItem value="concrete">Concrete</SelectItem>
                  <SelectItem value="general">General</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Property (optional)</label>
              <Select value={newBpPropertyId || '__none__'} onValueChange={v => setNewBpPropertyId(v === '__none__' ? '' : v)}>
                <SelectTrigger><SelectValue placeholder="Link to a property" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">No property</SelectItem>
                  {properties?.map(p => (<SelectItem key={p.id} value={String(p.id)}>{p.address}</SelectItem>))}
                </SelectContent>
              </Select>
            </div>
            {canManageOffice && (
              <div className="flex items-center justify-between rounded-lg border p-3 bg-muted/20">
                <div>
                  <p className="text-sm font-medium">Save as reusable template</p>
                  <p className="text-xs text-muted-foreground">Templates can be applied to any job/property later.</p>
                </div>
                <Switch checked={newBpIsTemplate} onCheckedChange={setNewBpIsTemplate} />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewBpOpen(false)}>Cancel</Button>
            <Button onClick={handleCreateBlueprint} disabled={createBlueprint.isPending}>
              {createBlueprint.isPending ? 'Creating...' : 'Create Blueprint'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Template Browser Sheet */}
      <Sheet open={templateBrowserOpen} onOpenChange={setTemplateBrowserOpen}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          <SheetHeader className="pb-4">
            <SheetTitle className="flex items-center gap-2"><Library className="w-5 h-5 text-primary" /> Blueprint Templates</SheetTitle>
            <SheetDescription>Reusable design-rule sets. Apply one to a job or property to create a customizable instance.</SheetDescription>
          </SheetHeader>
          {templatesLoading ? (
            <div className="text-center py-8 text-muted-foreground">Loading templates...</div>
          ) : !templates || templates.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-sm">No templates yet. Mark a blueprint as a template to see it here.</div>
          ) : (
            <div className="space-y-3">
              {templates.map(t => (
                <div key={t.id} className="rounded-lg border p-4 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium text-sm truncate">{t.name}</p>
                    <p className="text-xs text-muted-foreground capitalize">{t.mode}</p>
                  </div>
                  <Button size="sm" variant="outline" className="shrink-0 gap-1.5"
                    onClick={() => { setApplyingTemplateId(t.id); setApplyDialogOpen(true); }}>
                    <CopyPlus className="w-3.5 h-3.5" /> Apply
                  </Button>
                </div>
              ))}
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* Apply Template Dialog */}
      <Dialog open={applyDialogOpen} onOpenChange={open => { if (!open) { setApplyDialogOpen(false); setApplyingTemplateId(null); setApplyPropertyId(''); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Apply Template</DialogTitle>
            <DialogDescription>Create a new blueprint instance from this template. Optionally link it to a property.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <label className="text-sm font-medium">Property (optional)</label>
            <Select value={applyPropertyId || '__none__'} onValueChange={v => setApplyPropertyId(v === '__none__' ? '' : v)}>
              <SelectTrigger><SelectValue placeholder="Link to a property" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">No property</SelectItem>
                {applyProperties?.map(p => (<SelectItem key={p.id} value={String(p.id)}>{p.address}</SelectItem>))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setApplyDialogOpen(false); setApplyingTemplateId(null); setApplyPropertyId(''); }}>Cancel</Button>
            <Button onClick={handleApplyTemplate} disabled={applyTemplate.isPending}>
              {applyTemplate.isPending ? 'Creating...' : 'Create Instance'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* AI Generation Dialog */}
      <Dialog open={aiDialogOpen} onOpenChange={setAiDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Wand2 className="w-5 h-5" /> Generate Blueprint with AI</DialogTitle>
            <DialogDescription>
              Describe your layout and we'll generate a starter blueprint. This uses a keyword-based heuristic generator — not a live LLM — so results are proportional to the description and mode.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Description <span className="text-destructive">*</span></label>
              <Textarea
                value={aiDescription}
                onChange={e => setAiDescription(e.target.value)}
                placeholder="e.g. Front lawn with two flower beds and a walkway, backyard with shrubs along the fence"
                rows={3}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Blueprint Type</label>
              <Select value={aiMode} onValueChange={v => setAiMode(v as BlueprintInputMode)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="landscape">Landscape</SelectItem>
                  <SelectItem value="irrigation">Irrigation</SelectItem>
                  <SelectItem value="concrete">Concrete</SelectItem>
                  <SelectItem value="general">General</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Property (optional)</label>
              <Select value={aiPropertyId || '__none__'} onValueChange={v => setAiPropertyId(v === '__none__' ? '' : v)}>
                <SelectTrigger><SelectValue placeholder="Link to a property" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">No property</SelectItem>
                  {aiProperties?.map(p => (<SelectItem key={p.id} value={String(p.id)}>{p.address}</SelectItem>))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAiDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleGenerateAi} disabled={generateAi.isPending} className="gap-2">
              <Wand2 className="w-4 h-4" />
              {generateAi.isPending ? 'Generating...' : 'Generate Layout'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Blueprint Card (extracted for reuse in both tabs) ─────────────────────────

interface BlueprintCardProps {
  bp: any;
  globalPct: number;
  p4pEditing: Record<number, string>;
  p4pOpen: Record<number, boolean>;
  setP4pEditing: React.Dispatch<React.SetStateAction<Record<number, string>>>;
  setP4pOpen: React.Dispatch<React.SetStateAction<Record<number, boolean>>>;
  saveP4p: (bpId: number, val: string) => void;
  updateBlueprint: ReturnType<typeof useUpdateBlueprint>;
  setSuggestedPartsBpId: (id: number) => void;
  setSuggestedPartsOpen: (open: boolean) => void;
  canManageOffice: boolean;
  setLocation: (path: string) => void;
  handleToggleTemplate: (bpId: number, current: boolean) => void;
  extraAction?: React.ReactNode;
}

function BlueprintCard({ bp, globalPct, p4pEditing, p4pOpen, setP4pEditing, setP4pOpen, saveP4p, updateBlueprint, setSuggestedPartsBpId, setSuggestedPartsOpen, canManageOffice, setLocation, handleToggleTemplate, extraAction }: BlueprintCardProps) {
  const bpPct = bp.p4pPercentage as number | null | undefined;
  const hasOverride = bpPct != null;
  const displayPct = hasOverride ? bpPct : globalPct;
  const isTemplate = !!bp.isTemplate;

  return (
    <Card className="group hover:border-primary/50 transition-colors overflow-hidden flex flex-col">
      <div
        className="h-32 bg-muted flex items-center justify-center border-b group-hover:bg-primary/5 transition-colors cursor-pointer relative"
        onClick={() => setLocation(`/blueprints/${bp.id}`)}
      >
        <DraftingCompass className="w-12 h-12 text-muted-foreground group-hover:text-primary/40 transition-colors" />
        {isTemplate && (
          <Badge variant="outline" className="absolute top-2 right-2 text-primary border-primary/40 text-[10px]">Template</Badge>
        )}
      </div>

      <CardContent className="p-5 flex-1 flex flex-col gap-2">
        <div className="flex justify-between items-start cursor-pointer" onClick={() => setLocation(`/blueprints/${bp.id}`)}>
          <h3 className="font-semibold text-lg line-clamp-1 group-hover:text-primary transition-colors">{bp.name}</h3>
          <Badge variant="outline" className="capitalize text-[10px] shrink-0 ml-2">{bp.mode}</Badge>
        </div>

        <p className="text-xs text-muted-foreground mt-auto">
          Created {format(new Date(bp.createdAt), 'MMM d, yyyy')}
        </p>

        {bp.totalEstimate !== undefined && bp.totalEstimate !== null && (
          <p className="text-sm font-medium">Est: ${bp.totalEstimate.toLocaleString()}</p>
        )}

        {/* Suggested Parts button */}
        {canManageOffice && (
          <Button size="sm" variant="outline" className="w-full gap-1.5 text-xs h-7 mt-1"
            onClick={e => { e.stopPropagation(); setSuggestedPartsBpId(bp.id); setSuggestedPartsOpen(true); }}>
            <Package className="w-3 h-3" /> Suggested Parts
          </Button>
        )}

        {/* Extra action (e.g. Apply Template) */}
        {extraAction}

        {/* Template toggle */}
        {canManageOffice && (
          <div className="flex items-center justify-between pt-1">
            <span className="text-xs text-muted-foreground">Reusable template</span>
            <Switch
              checked={isTemplate}
              onCheckedChange={() => handleToggleTemplate(bp.id, isTemplate)}
              onClick={e => e.stopPropagation()}
            />
          </div>
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
                    type="number" min={0} max={100} step={0.5}
                    placeholder={`${globalPct} (global)`}
                    className="w-24 text-right"
                    value={p4pEditing[bp.id] ?? ''}
                    onChange={e => setP4pEditing(prev => ({ ...prev, [bp.id]: e.target.value }))}
                    onKeyDown={e => { if (e.key === 'Enter') saveP4p(bp.id, p4pEditing[bp.id] ?? ''); }}
                  />
                  <span className="text-sm text-muted-foreground">%</span>
                </div>
                <div className="flex gap-2 mt-3">
                  <Button size="sm" className="flex-1" onClick={() => saveP4p(bp.id, p4pEditing[bp.id] ?? '')} disabled={updateBlueprint.isPending}>Save</Button>
                  {hasOverride && (
                    <Button size="sm" variant="outline" onClick={() => saveP4p(bp.id, '')} disabled={updateBlueprint.isPending}>Clear</Button>
                  )}
                </div>
              </PopoverContent>
            </Popover>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
