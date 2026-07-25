import React, { useState } from 'react';
import { useLocation } from 'wouter';
import { Settings2, GripVertical, X, Plus } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import { useGetTenantSettings, useUpdateTenantSettings, getGetTenantSettingsQueryKey } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  SHORTCUT_CATALOG,
  DEFAULT_SHORTCUTS,
  MAX_SHORTCUTS,
  getCatalogEntry,
  type ShortcutDef,
} from './shortcutCatalog';

// ── Single shortcut button ─────────────────────────────────────────────────────
function ShortcutButton({ def, onNavigate }: { def: ShortcutDef; onNavigate: (to: string) => void }) {
  const Icon = def.icon;
  function handleClick() {
    onNavigate(def.action.to);
  }
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          onClick={handleClick}
          className="h-8 w-8 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          aria-label={def.label}
        >
          <Icon className="h-4 w-4" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="text-xs">
        {def.label}
      </TooltipContent>
    </Tooltip>
  );
}

// ── Customize panel ────────────────────────────────────────────────────────────
function CustomizePanel({
  open,
  onClose,
  activeIds,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  activeIds: string[];
  onSave: (ids: string[]) => void;
}) {
  const [draft, setDraft] = useState<string[]>(activeIds);
  const [dragging, setDragging] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);

  // Reset draft when panel opens
  React.useEffect(() => {
    if (open) setDraft(activeIds);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const availableToAdd = SHORTCUT_CATALOG.filter(s => !draft.includes(s.id));

  function remove(id: string) {
    setDraft(d => d.filter(x => x !== id));
  }

  function add(id: string) {
    if (draft.length >= MAX_SHORTCUTS) return;
    setDraft(d => [...d, id]);
  }

  // Drag-and-drop reorder within active list
  function onDragStart(id: string) { setDragging(id); }
  function onDragEnter(id: string) { setDragOver(id); }
  function onDragEnd() {
    if (dragging && dragOver && dragging !== dragOver) {
      setDraft(prev => {
        const next = [...prev];
        const fromIdx = next.indexOf(dragging);
        const toIdx = next.indexOf(dragOver);
        next.splice(fromIdx, 1);
        next.splice(toIdx, 0, dragging);
        return next;
      });
    }
    setDragging(null);
    setDragOver(null);
  }

  return (
    <Sheet open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <SheetContent side="right" className="w-[380px] sm:w-[420px] flex flex-col gap-0 p-0">
        <SheetHeader className="px-6 py-5 border-b border-border shrink-0">
          <SheetTitle className="text-base">Customize Shortcuts</SheetTitle>
          <p className="text-xs text-muted-foreground mt-0.5">
            Pin up to {MAX_SHORTCUTS} shortcuts to the header bar. Drag to reorder.
          </p>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-6">
          {/* Active shortcuts */}
          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
              Active ({draft.length}/{MAX_SHORTCUTS})
            </p>
            {draft.length === 0 ? (
              <p className="text-sm text-muted-foreground italic py-4 text-center border border-dashed rounded-md">
                No shortcuts pinned yet
              </p>
            ) : (
              <div className="space-y-1.5">
                {draft.map(id => {
                  const def = getCatalogEntry(id);
                  if (!def) return null;
                  const Icon = def.icon;
                  const isDraggedOver = dragOver === id && dragging !== id;
                  return (
                    <div
                      key={id}
                      draggable
                      onDragStart={() => onDragStart(id)}
                      onDragEnter={() => onDragEnter(id)}
                      onDragOver={e => e.preventDefault()}
                      onDragEnd={onDragEnd}
                      className={cn(
                        'flex items-center gap-3 px-3 py-2.5 rounded-md border bg-background transition-colors cursor-grab active:cursor-grabbing',
                        isDraggedOver ? 'border-primary bg-accent' : 'border-border hover:border-border/80',
                        dragging === id && 'opacity-40'
                      )}
                    >
                      <GripVertical className="h-4 w-4 text-muted-foreground shrink-0" />
                      <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
                      <span className="flex-1 text-sm font-medium">{def.label}</span>
                      <button
                        onClick={() => remove(id)}
                        title={`Remove ${def.label} from shortcuts`}
                        className="text-muted-foreground hover:text-destructive transition-colors"
                        aria-label={`Remove ${def.label}`}
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Catalog to add */}
          {availableToAdd.length > 0 && (
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
                Available to add
              </p>
              <div className="grid grid-cols-2 gap-2">
                {availableToAdd.map(def => {
                  const Icon = def.icon;
                  const canAdd = draft.length < MAX_SHORTCUTS;
                  return (
                    <button
                      key={def.id}
                      onClick={() => add(def.id)}
                      disabled={!canAdd}
                      className={cn(
                        'flex items-center gap-2 px-3 py-2.5 rounded-md border text-sm text-left transition-colors',
                        canAdd
                          ? 'border-border hover:border-primary hover:bg-accent cursor-pointer'
                          : 'border-border/40 text-muted-foreground/50 cursor-not-allowed'
                      )}
                    >
                      <Icon className="h-4 w-4 shrink-0" />
                      <span className="flex-1 font-medium leading-tight">{def.label}</span>
                      {canAdd && <Plus className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <SheetFooter className="px-6 py-4 border-t border-border shrink-0 flex gap-2">
          <Button variant="outline" title="Discard shortcut changes" onClick={onClose} className="flex-1">
            Cancel
          </Button>
          <Button title="Save your quick-add shortcut layout" onClick={() => onSave(draft)} className="flex-1">
            Save shortcuts
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────
export function QuickAddBar({ canCustomize }: { canCustomize: boolean }) {
  const [, setLocation] = useLocation();
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const qc = useQueryClient();

  const { data: settings } = useGetTenantSettings();
  const { mutate: updateSettings } = useUpdateTenantSettings();

  const activeIds: string[] = (settings?.quickShortcuts as string[] | null | undefined) ?? DEFAULT_SHORTCUTS;
  const activeDefs = activeIds
    .map(id => getCatalogEntry(id))
    .filter((d): d is ShortcutDef => !!d)
    .slice(0, MAX_SHORTCUTS);

  function handleSave(ids: string[]) {
    updateSettings(
      { data: { quickShortcuts: ids } },
      {
        onSuccess: (updated) => {
          // Immediately update the cached tenant settings so the bar re-renders
          qc.setQueryData(getGetTenantSettingsQueryKey(), updated);
          toast.success('Shortcuts saved');
          setCustomizeOpen(false);
        },
        onError: () => toast.error('Failed to save shortcuts'),
      }
    );
  }

  return (
    <div className="flex items-center gap-1">
      {activeDefs.map(def => (
        <ShortcutButton key={def.id} def={def} onNavigate={setLocation} />
      ))}

      {canCustomize && (
        <>
          {/* Divider */}
          {activeDefs.length > 0 && (
            <div className="h-4 w-px bg-border mx-1" aria-hidden />
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => setCustomizeOpen(true)}
                className="h-8 w-8 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                aria-label="Customize shortcuts"
              >
                <Settings2 className="h-4 w-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-xs">
              Customize shortcuts
            </TooltipContent>
          </Tooltip>

          <CustomizePanel
            open={customizeOpen}
            onClose={() => setCustomizeOpen(false)}
            activeIds={activeIds}
            onSave={handleSave}
          />
        </>
      )}
    </div>
  );
}
