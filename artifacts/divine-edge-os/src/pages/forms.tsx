import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { useListServices, getListServicesQueryKey } from '@workspace/api-client-react';
import { Plus, Trash2, ArrowUp, ArrowDown, ClipboardCheck, Archive, RotateCcw, Pencil, Eye } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  useFormTemplates, useSaveFormTemplate, FORM_FIELD_TYPES, newFieldId, apiErrorMessage,
  type FormTemplate, type FormTemplateInput, type FormField, type FormFieldType,
} from '@/lib/jobForms';

const EMPTY: FormTemplateInput = { name: '', description: '', fields: [], assignment: 'manual', serviceIds: [], required: false, active: true };
const typeLabel = (t: FormFieldType) => FORM_FIELD_TYPES.find(x => x.value === t)?.label ?? t;
const needsOptions = (t: FormFieldType) => t === 'select' || t === 'multi_select';

function assignmentText(t: FormTemplate | FormTemplateInput, svcName: (id: number) => string) {
  if (t.assignment === 'all_jobs') return 'Every job';
  if (t.assignment === 'services') return t.serviceIds.length ? t.serviceIds.map(svcName).join(', ') : 'No services picked';
  return 'Added by office per job';
}

export default function FormsPage() {
  const { data, isLoading, isError, refetch } = useFormTemplates();
  const save = useSaveFormTemplate();
  const { data: servicesRaw } = useListServices(undefined, { query: { queryKey: getListServicesQueryKey() } });
  const services = useMemo(() => ((Array.isArray(servicesRaw) ? servicesRaw : (servicesRaw as any)?.items ?? []) as Array<{ id: number; name: string }>), [servicesRaw]);
  const svcName = (id: number) => services.find(s => s.id === id)?.name ?? `Service #${id}`;
  const canManage = !!data?.canManage;
  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState<{ id?: number; form: FormTemplateInput; readOnly: boolean } | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<FormTemplate | null>(null);
  const [optionDrafts, setOptionDrafts] = useState<Record<string, string>>({});

  const templates = (data?.templates ?? []).filter(t => showArchived ? !t.active : t.active);
  const archivedCount = (data?.templates ?? []).filter(t => !t.active).length;

  const open = (t?: FormTemplate, readOnly = false) => {
    setOptionDrafts({});
    setEditing(t ? { id: t.id, readOnly, form: { name: t.name, description: t.description ?? '', fields: t.fields.map(f => ({ ...f, options: f.options ? [...f.options] : undefined })), assignment: t.assignment, serviceIds: [...t.serviceIds], required: t.required, active: t.active } } : { form: { ...EMPTY, fields: [] }, readOnly: false });
  };
  const setForm = (p: Partial<FormTemplateInput>) => setEditing(e => e ? { ...e, form: { ...e.form, ...p } } : e);
  const setField = (id: string, p: Partial<FormField>) => setEditing(e => e ? { ...e, form: { ...e.form, fields: e.form.fields.map(f => f.id === id ? { ...f, ...p } : f) } } : e);
  const moveField = (i: number, d: -1 | 1) => setEditing(e => {
    if (!e) return e; const j = i + d; if (j < 0 || j >= e.form.fields.length) return e;
    const fields = [...e.form.fields]; [fields[i], fields[j]] = [fields[j], fields[i]]; return { ...e, form: { ...e.form, fields } };
  });

  const submit = () => {
    if (!editing) return;
    const f = editing.form;
    if (!f.name.trim()) { toast.error('Give the form a name'); return; }
    if (f.fields.length === 0) { toast.error('Add at least one question'); return; }
    const bad = f.fields.find(x => !x.label.trim());
    if (bad) { toast.error('Every question needs a label'); return; }
    const noOpts = f.fields.find(x => needsOptions(x.type) && (x.options ?? []).filter(o => o.trim()).length < 2);
    if (noOpts) { toast.error(`"${noOpts.label}" needs at least two choices`); return; }
    if (f.assignment === 'services' && f.serviceIds.length === 0) { toast.error('Pick at least one service'); return; }
    const payload: FormTemplateInput = {
      ...f, name: f.name.trim(), description: f.description?.trim() || null,
      serviceIds: f.assignment === 'services' ? f.serviceIds : [],
      fields: f.fields.map(x => ({ id: x.id, label: x.label.trim(), type: x.type, required: x.required, ...(needsOptions(x.type) ? { options: (x.options ?? []).map(o => o.trim()).filter(Boolean) } : {}) })),
    };
    save.mutate({ id: editing.id, data: payload }, {
      onSuccess: () => { toast.success(editing.id ? 'Form template saved. Forms already on jobs keep their original questions.' : 'Form template created'); setEditing(null); },
      onError: e => toast.error(apiErrorMessage(e, 'Could not save form template')),
    });
  };
  const setActive = (t: FormTemplate, active: boolean) => save.mutate({ id: t.id, data: { active } }, {
    onSuccess: () => toast.success(active ? `${t.name} restored` : `${t.name} archived. Existing job responses are kept.`),
    onError: e => toast.error(apiErrorMessage(e, 'Could not update form template')),
  });

  const ro = editing?.readOnly ?? true;
  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Forms</h1>
          <p className="text-muted-foreground mt-1">Reusable checklists and questions crews fill out on jobs. Required forms must be submitted before a job can be completed.</p>
        </div>
        {canManage && <Button className="gap-2" onClick={() => open()} data-testid="button-new-form-template"><Plus className="w-4 h-4" /> New Form Template</Button>}
      </div>

      <div className="flex items-center gap-2">
        <Button size="sm" variant={showArchived ? 'ghost' : 'secondary'} onClick={() => setShowArchived(false)}>Active</Button>
        <Button size="sm" variant={showArchived ? 'secondary' : 'ghost'} onClick={() => setShowArchived(true)}>Archived{archivedCount ? ` (${archivedCount})` : ''}</Button>
        {!canManage && data && <span className="text-xs text-muted-foreground ml-auto">View only. Office staff manage form templates.</span>}
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="divide-y">{[0, 1, 2].map(i => <div key={i} className="p-5 space-y-2"><Skeleton className="h-4 w-48" /><Skeleton className="h-3 w-80" /></div>)}</div>
          ) : isError ? (
            <div className="p-8 text-center space-y-3"><p className="text-sm text-destructive">Could not load form templates.</p><Button size="sm" variant="outline" onClick={() => refetch()}>Retry</Button></div>
          ) : templates.length === 0 ? (
            <div className="p-12 text-center space-y-3">
              <ClipboardCheck className="w-10 h-10 mx-auto text-muted-foreground/50" />
              <p className="font-medium">{showArchived ? 'No archived forms' : 'No form templates yet'}</p>
              <p className="text-sm text-muted-foreground max-w-md mx-auto">{showArchived ? 'Archived templates appear here. Their past job responses are kept.' : 'Build a pre-service checklist, safety sign-off or site survey once and attach it to every job, specific services, or individual jobs.'}</p>
              {canManage && !showArchived && <Button size="sm" className="gap-2" onClick={() => open()}><Plus className="w-4 h-4" /> New Form Template</Button>}
            </div>
          ) : (
            <div className="divide-y">
              {templates.map(t => (
                <div key={t.id} className="flex items-center gap-4 px-5 py-4 hover:bg-muted/40 cursor-pointer transition-colors" onClick={() => open(t, !canManage || !t.active)} data-testid={`form-template-${t.id}`}>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium truncate">{t.name}</span>
                      {t.required && <Badge variant="outline" className="text-xs bg-rose-50 text-rose-700 border-rose-200">Required to complete</Badge>}
                      {!t.active && <Badge variant="outline" className="text-xs">Archived</Badge>}
                    </div>
                    <div className="text-sm text-muted-foreground mt-1 flex flex-wrap gap-x-4">
                      <span>{t.fields.length} question{t.fields.length === 1 ? '' : 's'}</span>
                      <span className="truncate">{assignmentText(t, svcName)}</span>
                      {t.description && <span className="truncate max-w-md">{t.description}</span>}
                    </div>
                  </div>
                  {canManage ? (
                    <div className="flex gap-1" onClick={e => e.stopPropagation()}>
                      {t.active ? <>
                        <Button size="sm" variant="ghost" className="gap-1.5" onClick={() => open(t)}><Pencil className="w-3.5 h-3.5" /> Edit</Button>
                        <Button size="sm" variant="ghost" className="gap-1.5 text-muted-foreground" onClick={() => setArchiveTarget(t)}><Archive className="w-3.5 h-3.5" /> Archive</Button>
                      </> : <Button size="sm" variant="ghost" className="gap-1.5" disabled={save.isPending} onClick={() => setActive(t, true)}><RotateCcw className="w-3.5 h-3.5" /> Restore</Button>}
                    </div>
                  ) : <Eye className="w-4 h-4 text-muted-foreground" />}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Sheet open={!!editing} onOpenChange={o => { if (!o) setEditing(null); }}>
        <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
          {editing && <>
            <SheetHeader className="mb-5">
              <SheetTitle>{ro ? editing.form.name : editing.id ? 'Edit form template' : 'New form template'}</SheetTitle>
              <SheetDescription>{ro ? 'Read-only view of this form definition.' : 'Changes apply to forms attached from now on. Forms already on jobs keep the questions they were created with.'}</SheetDescription>
            </SheetHeader>
            <div className="space-y-6">
              <div className="space-y-3">
                <div className="space-y-1.5"><label className="text-sm font-medium">Name</label><Input value={editing.form.name} disabled={ro} onChange={e => setForm({ name: e.target.value })} placeholder="Pre-service safety check" data-testid="input-form-name" /></div>
                <div className="space-y-1.5"><label className="text-sm font-medium">Description</label><Textarea rows={2} value={editing.form.description ?? ''} disabled={ro} onChange={e => setForm({ description: e.target.value })} placeholder="What crews should know before filling this out" /></div>
              </div>

              <div className="space-y-3 rounded-lg border p-4">
                <p className="text-sm font-medium">Which jobs get this form</p>
                <Select value={editing.form.assignment} disabled={ro} onValueChange={v => setForm({ assignment: v as FormTemplateInput['assignment'] })}>
                  <SelectTrigger data-testid="select-form-assignment"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="manual">Only when office adds it to a job</SelectItem>
                    <SelectItem value="all_jobs">Every scheduled job</SelectItem>
                    <SelectItem value="services">Jobs with selected services</SelectItem>
                  </SelectContent>
                </Select>
                {editing.form.assignment === 'services' && (
                  <div className="grid sm:grid-cols-2 gap-2 max-h-48 overflow-y-auto rounded-md border p-2">
                    {services.length === 0 && <p className="text-xs text-muted-foreground">No services yet.</p>}
                    {services.map(s => (
                      <label key={s.id} className="flex items-center gap-2 text-sm">
                        <Checkbox disabled={ro} checked={editing.form.serviceIds.includes(s.id)} onCheckedChange={c => setForm({ serviceIds: c ? [...editing.form.serviceIds, s.id] : editing.form.serviceIds.filter(x => x !== s.id) })} />
                        {s.name}
                      </label>
                    ))}
                  </div>
                )}
                <label className="flex items-center justify-between gap-3 pt-1">
                  <span><span className="text-sm font-medium block">Required to complete the job</span><span className="text-xs text-muted-foreground">Jobs can't be marked complete until this form is submitted. Office can change this on a single job.</span></span>
                  <Switch disabled={ro} checked={editing.form.required} onCheckedChange={v => setForm({ required: v })} data-testid="switch-form-required" />
                </label>
                <p className="text-xs text-muted-foreground">Forms are added to scheduled and in-progress jobs. Completed jobs are never changed.</p>
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between"><p className="text-sm font-medium">Questions</p><span className="text-xs text-muted-foreground">{editing.form.fields.length} total</span></div>
                {editing.form.fields.length === 0 && <p className="text-sm text-muted-foreground rounded-md border border-dashed p-4 text-center">No questions yet.</p>}
                {editing.form.fields.map((f, i) => (
                  <div key={f.id} className="rounded-lg border p-3 space-y-2 bg-muted/20" data-testid={`form-field-${i}`}>
                    <div className="flex gap-2 items-start">
                      <span className="text-xs text-muted-foreground tabular-nums pt-2.5 w-5">{i + 1}.</span>
                      <Input className="flex-1" value={f.label} disabled={ro} placeholder="Question" onChange={e => setField(f.id, { label: e.target.value })} />
                      <Select value={f.type} disabled={ro} onValueChange={v => setField(f.id, { type: v as FormFieldType, options: needsOptions(v as FormFieldType) ? (f.options ?? []) : undefined })}>
                        <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                        <SelectContent>{FORM_FIELD_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                    {needsOptions(f.type) && (
                      <div className="pl-7 space-y-1.5">
                        <div className="flex flex-wrap gap-1.5">
                          {(f.options ?? []).map((o, oi) => (
                            <Badge key={oi} variant="secondary" className="gap-1">{o}{!ro && <button type="button" aria-label={`Remove ${o}`} onClick={() => setField(f.id, { options: (f.options ?? []).filter((_, k) => k !== oi) })}><Trash2 className="w-3 h-3" /></button>}</Badge>
                          ))}
                        </div>
                        {!ro && <div className="flex gap-2">
                          <Input className="h-8" placeholder="Add a choice and press Enter" value={optionDrafts[f.id] ?? ''} onChange={e => setOptionDrafts(d => ({ ...d, [f.id]: e.target.value }))}
                            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); const v = (optionDrafts[f.id] ?? '').trim(); if (v && !(f.options ?? []).includes(v)) setField(f.id, { options: [...(f.options ?? []), v] }); setOptionDrafts(d => ({ ...d, [f.id]: '' })); } }} />
                        </div>}
                      </div>
                    )}
                    <div className="pl-7 flex items-center justify-between">
                      <label className="flex items-center gap-2 text-xs"><Switch disabled={ro} checked={f.required} onCheckedChange={v => setField(f.id, { required: v })} /> Required answer · {typeLabel(f.type)}</label>
                      {!ro && <div className="flex">
                        <Button size="icon" variant="ghost" className="h-7 w-7" disabled={i === 0} onClick={() => moveField(i, -1)} aria-label="Move up"><ArrowUp className="w-3.5 h-3.5" /></Button>
                        <Button size="icon" variant="ghost" className="h-7 w-7" disabled={i === editing.form.fields.length - 1} onClick={() => moveField(i, 1)} aria-label="Move down"><ArrowDown className="w-3.5 h-3.5" /></Button>
                        <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => setForm({ fields: editing.form.fields.filter(x => x.id !== f.id) })} aria-label="Remove question"><Trash2 className="w-3.5 h-3.5" /></Button>
                      </div>}
                    </div>
                  </div>
                ))}
                {!ro && <Button variant="outline" size="sm" className="gap-2 w-full" onClick={() => setForm({ fields: [...editing.form.fields, { id: newFieldId(), label: '', type: 'text', required: false }] })} data-testid="button-add-form-field"><Plus className="w-4 h-4" /> Add question</Button>}
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t">
                <Button variant="outline" onClick={() => setEditing(null)}>{ro ? 'Close' : 'Cancel'}</Button>
                {!ro && <Button onClick={submit} disabled={save.isPending} data-testid="button-save-form-template">{save.isPending ? 'Saving…' : editing.id ? 'Save template' : 'Create template'}</Button>}
              </div>
            </div>
          </>}
        </SheetContent>
      </Sheet>

      <AlertDialog open={!!archiveTarget} onOpenChange={o => { if (!o) setArchiveTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive {archiveTarget?.name}?</AlertDialogTitle>
            <AlertDialogDescription>It stops being added to new jobs. Responses already filled out on jobs are kept, and you can restore it later.</AlertDialogDescription>
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
