import { useState } from 'react';
import { toast } from 'sonner';
import { Plus, Trash2, ArrowUp, ArrowDown, ClipboardList, Archive, RotateCcw, Pencil } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { newFieldId } from '@/lib/jobForms';
import {
  useEmployeeFormTemplates, useSaveEmployeeTemplate, templateActive, hrErr, LEGACY_FIELD_TYPES,
  type EmployeeFormTemplate, type EmpFormField, type LegacyFieldType,
} from '@/lib/hr';

type Draft = { name: string; description: string; fields: EmpFormField[] };
const typeLabel = (t: LegacyFieldType) => LEGACY_FIELD_TYPES.find(x => x.value === t)?.label ?? t;

/** HR-only employee form template builder (same layout as job Forms builder). */
export function EmployeeTemplatesPanel() {
  const { data, isLoading, isError, refetch } = useEmployeeFormTemplates(true);
  const save = useSaveEmployeeTemplate();
  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState<{ id?: number; form: Draft } | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<EmployeeFormTemplate | null>(null);
  const [optionDrafts, setOptionDrafts] = useState<Record<string, string>>({});
  const all = data ?? [];
  const list = all.filter(t => showArchived ? !templateActive(t) : templateActive(t));
  const archivedCount = all.filter(t => !templateActive(t)).length;

  const open = (t?: EmployeeFormTemplate) => {
    setOptionDrafts({});
    setEditing(t ? { id: t.id, form: { name: t.name, description: t.description ?? '', fields: (t.fields ?? []).map(f => ({ ...f, options: f.options ? [...f.options] : undefined })) } } : { form: { name: '', description: '', fields: [] } });
  };
  const setForm = (p: Partial<Draft>) => setEditing(e => e ? { ...e, form: { ...e.form, ...p } } : e);
  const setField = (id: string, p: Partial<EmpFormField>) => setEditing(e => e ? { ...e, form: { ...e.form, fields: e.form.fields.map(f => f.id === id ? { ...f, ...p } : f) } } : e);
  const moveField = (i: number, d: -1 | 1) => setEditing(e => {
    if (!e) return e; const j = i + d; if (j < 0 || j >= e.form.fields.length) return e;
    const fields = [...e.form.fields]; [fields[i], fields[j]] = [fields[j], fields[i]]; return { ...e, form: { ...e.form, fields } };
  });
  const submit = () => {
    if (!editing) return;
    const f = editing.form;
    if (!f.name.trim()) { toast.error('Give the form a name'); return; }
    if (!f.fields.length) { toast.error('Add at least one question'); return; }
    if (f.fields.some(x => !x.label.trim())) { toast.error('Every question needs a label'); return; }
    const noOpts = f.fields.find(x => x.type === 'select' && (x.options ?? []).length < 2);
    if (noOpts) { toast.error(`"${noOpts.label}" needs at least two choices`); return; }
    save.mutate({ id: editing.id, data: {
      name: f.name.trim(), description: f.description.trim() || null,
      fields: f.fields.map(x => ({ id: x.id, label: x.label.trim(), type: x.type, required: !!x.required, ...(x.type === 'select' ? { options: x.options ?? [] } : {}) })),
    } }, {
      onSuccess: () => { toast.success(editing.id ? 'Template saved. Forms already assigned keep their original questions.' : 'Template created'); setEditing(null); },
      onError: e => toast.error(hrErr(e, 'Could not save template')),
    });
  };
  const setActive = (t: EmployeeFormTemplate, active: boolean) => save.mutate({ id: t.id, data: { active } }, {
    onSuccess: () => toast.success(active ? `${t.name} restored` : `${t.name} archived. Responses are kept.`),
    onError: e => toast.error(hrErr(e, 'Could not update template')),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <Button size="sm" variant={showArchived ? 'ghost' : 'secondary'} onClick={() => setShowArchived(false)}>Active</Button>
        <Button size="sm" variant={showArchived ? 'secondary' : 'ghost'} onClick={() => setShowArchived(true)}>Archived{archivedCount ? ` (${archivedCount})` : ''}</Button>
        <Button size="sm" className="gap-2 ml-auto" onClick={() => open()} data-testid="button-new-employee-template"><Plus className="w-4 h-4" /> New Employee Form</Button>
      </div>
      <Card><CardContent className="p-0">
        {isLoading ? <div className="divide-y">{[0, 1].map(i => <div key={i} className="p-5 space-y-2"><Skeleton className="h-4 w-48" /><Skeleton className="h-3 w-72" /></div>)}</div>
        : isError ? <div className="p-8 text-center space-y-3"><p className="text-sm text-destructive">Could not load employee forms.</p><Button size="sm" variant="outline" onClick={() => refetch()}>Retry</Button></div>
        : list.length === 0 ? (
          <div className="p-10 text-center space-y-2">
            <ClipboardList className="w-10 h-10 mx-auto text-muted-foreground/50" />
            <p className="font-medium">{showArchived ? 'No archived employee forms' : 'No employee forms yet'}</p>
            <p className="text-sm text-muted-foreground max-w-md mx-auto">Build onboarding checklists, review forms or acknowledgements once, then assign them to employees.</p>
          </div>
        ) : (
          <div className="divide-y">
            {list.map(t => (
              <div key={t.id} className="flex items-center gap-4 px-5 py-4" data-testid={`employee-template-${t.id}`}>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2"><span className="font-medium truncate">{t.name}</span>{!templateActive(t) && <Badge variant="outline" className="text-xs">Archived</Badge>}</div>
                  <div className="text-sm text-muted-foreground mt-1 flex gap-4"><span>{(t.fields ?? []).length} question{(t.fields ?? []).length === 1 ? '' : 's'}</span>{t.description && <span className="truncate max-w-md">{t.description}</span>}</div>
                </div>
                {templateActive(t) ? <>
                  <Button size="sm" variant="ghost" className="gap-1.5" onClick={() => open(t)}><Pencil className="w-3.5 h-3.5" /> Edit</Button>
                  <Button size="sm" variant="ghost" className="gap-1.5 text-muted-foreground" onClick={() => setArchiveTarget(t)}><Archive className="w-3.5 h-3.5" /> Archive</Button>
                </> : <Button size="sm" variant="ghost" className="gap-1.5" disabled={save.isPending} onClick={() => setActive(t, true)}><RotateCcw className="w-3.5 h-3.5" /> Restore</Button>}
              </div>
            ))}
          </div>
        )}
      </CardContent></Card>

      <Sheet open={!!editing} onOpenChange={o => { if (!o) setEditing(null); }}>
        <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
          {editing && <>
            <SheetHeader className="mb-5">
              <SheetTitle>{editing.id ? 'Edit employee form' : 'New employee form'}</SheetTitle>
              <SheetDescription>Changes apply to forms assigned from now on. Assigned and submitted forms keep the questions they were created with.</SheetDescription>
            </SheetHeader>
            <div className="space-y-6">
              <div className="space-y-1.5"><label className="text-sm font-medium">Name</label><Input value={editing.form.name} onChange={e => setForm({ name: e.target.value })} placeholder="90-day review" data-testid="input-employee-template-name" /></div>
              <div className="space-y-1.5"><label className="text-sm font-medium">Description</label><Textarea rows={2} value={editing.form.description} onChange={e => setForm({ description: e.target.value })} /></div>
              <div className="space-y-3">
                <div className="flex items-center justify-between"><p className="text-sm font-medium">Questions</p><span className="text-xs text-muted-foreground">{editing.form.fields.length} total</span></div>
                {editing.form.fields.length === 0 && <p className="text-sm text-muted-foreground rounded-md border border-dashed p-4 text-center">No questions yet.</p>}
                {editing.form.fields.map((f, i) => (
                  <div key={f.id} className="rounded-lg border p-3 space-y-2 bg-muted/20">
                    <div className="flex gap-2 items-start">
                      <span className="text-xs text-muted-foreground tabular-nums pt-2.5 w-5">{i + 1}.</span>
                      <Input className="flex-1" value={f.label} placeholder="Question" onChange={e => setField(f.id, { label: e.target.value })} />
                      <Select value={f.type} onValueChange={v => setField(f.id, { type: v as LegacyFieldType, options: v === 'select' ? (f.options ?? []) : undefined })}>
                        <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                        <SelectContent>{LEGACY_FIELD_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                    {f.type === 'select' && (
                      <div className="pl-7 space-y-1.5">
                        <div className="flex flex-wrap gap-1.5">
                          {(f.options ?? []).map((o, oi) => <Badge key={oi} variant="secondary" className="gap-1">{o}<button type="button" aria-label={`Remove ${o}`} onClick={() => setField(f.id, { options: (f.options ?? []).filter((_, k) => k !== oi) })}><Trash2 className="w-3 h-3" /></button></Badge>)}
                        </div>
                        <Input className="h-8" placeholder="Add a choice and press Enter" value={optionDrafts[f.id] ?? ''} onChange={e => setOptionDrafts(d => ({ ...d, [f.id]: e.target.value }))}
                          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); const v = (optionDrafts[f.id] ?? '').trim(); if (v && !(f.options ?? []).includes(v)) setField(f.id, { options: [...(f.options ?? []), v] }); setOptionDrafts(d => ({ ...d, [f.id]: '' })); } }} />
                      </div>
                    )}
                    <div className="pl-7 flex items-center justify-between">
                      <label className="flex items-center gap-2 text-xs"><Switch checked={!!f.required} onCheckedChange={v => setField(f.id, { required: v })} /> Required answer · {typeLabel(f.type)}</label>
                      <div className="flex">
                        <Button size="icon" variant="ghost" className="h-7 w-7" disabled={i === 0} onClick={() => moveField(i, -1)} aria-label="Move up"><ArrowUp className="w-3.5 h-3.5" /></Button>
                        <Button size="icon" variant="ghost" className="h-7 w-7" disabled={i === editing.form.fields.length - 1} onClick={() => moveField(i, 1)} aria-label="Move down"><ArrowDown className="w-3.5 h-3.5" /></Button>
                        <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => setForm({ fields: editing.form.fields.filter(x => x.id !== f.id) })} aria-label="Remove question"><Trash2 className="w-3.5 h-3.5" /></Button>
                      </div>
                    </div>
                  </div>
                ))}
                <Button variant="outline" size="sm" className="gap-2 w-full" onClick={() => setForm({ fields: [...editing.form.fields, { id: newFieldId(), label: '', type: 'text', required: false }] })}><Plus className="w-4 h-4" /> Add question</Button>
              </div>
              <div className="flex justify-end gap-2 pt-2 border-t">
                <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
                <Button onClick={submit} disabled={save.isPending} data-testid="button-save-employee-template">{save.isPending ? 'Saving…' : editing.id ? 'Save template' : 'Create template'}</Button>
              </div>
            </div>
          </>}
        </SheetContent>
      </Sheet>

      <AlertDialog open={!!archiveTarget} onOpenChange={o => { if (!o) setArchiveTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive {archiveTarget?.name}?</AlertDialogTitle>
            <AlertDialogDescription>It can no longer be assigned. Forms already assigned and their responses are kept, and you can restore it later.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => { if (archiveTarget) setActive(archiveTarget, false); setArchiveTarget(null); }}>Archive</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
