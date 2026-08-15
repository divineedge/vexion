import React, { useState, useMemo } from 'react';
import {
  useListEmployeeHistory,
  useCreateEmployeeHistoryEntry,
  useListEmployeeFormTemplates,
  useCreateEmployeeFormTemplate,
  getListEmployeeHistoryQueryKey,
  getListEmployeeFormTemplatesQueryKey,
  useListUsers,
  getListUsersQueryKey,
  useListJobs, getListJobsQueryKey,
} from '@workspace/api-client-react';
import type { EmployeeFormTemplate, EmployeeHistoryEntry } from '@workspace/api-client-react';
import { useParams, useLocation } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Separator } from '@/components/ui/separator';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  ArrowLeft, Plus, User, FileText, Star, AlertTriangle, Phone, MessageSquare,
  ClipboardList, Settings, Trash2, Briefcase, BarChart2,
  Copy,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { customFetch } from '@workspace/api-client-react';
import { format } from 'date-fns';

const ENTRY_TYPE_CONFIG: Record<string, { label: string; icon: React.ReactNode; color: string }> = {
  review: { label: 'Review', icon: <Star className="w-3.5 h-3.5" />, color: 'bg-amber-500/10 text-amber-700 border-transparent' },
  complaint: { label: 'Complaint', icon: <AlertTriangle className="w-3.5 h-3.5" />, color: 'bg-red-500/10 text-red-700 border-transparent' },
  callback: { label: 'Callback', icon: <Phone className="w-3.5 h-3.5" />, color: 'bg-blue-500/10 text-blue-700 border-transparent' },
  custom_form: { label: 'Form', icon: <ClipboardList className="w-3.5 h-3.5" />, color: 'bg-purple-500/10 text-purple-700 border-transparent' },
};

interface FormField {
  id: string;
  label: string;
  type: 'text' | 'number' | 'textarea' | 'select' | 'date';
  options?: string[];
  required?: boolean;
  [key: string]: unknown;
}

function HourlyRateEditor({ userId, currentRate }: { userId: number; currentRate: number | null }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(currentRate != null ? String(currentRate) : '');
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    try {
      await customFetch(`/api/settings/users/${userId}`, { method: 'PATCH', body: JSON.stringify({ hourlyRate: val ? parseFloat(val) : null }), headers: { 'Content-Type': 'application/json' } });
      qc.invalidateQueries({ queryKey: getListUsersQueryKey() });
      toast.success('Hourly rate updated');
      setEditing(false);
    } catch { toast.error('Failed to update rate'); }
    finally { setSaving(false); }
  };
  if (!editing) {
    return (
      <div className="flex items-center gap-2">
        <p className="font-medium">{currentRate != null ? `$${currentRate.toFixed(2)}/hr` : '—'}</p>
        <button type="button" title="Edit this employee's hourly rate" className="text-xs text-primary hover:underline" onClick={() => { setVal(currentRate != null ? String(currentRate) : ''); setEditing(true); }}>Edit</button>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2">
      <Input type="number" step="0.01" min="0" title="Hourly rate in dollars" value={val} onChange={e => setVal(e.target.value)} className="h-7 w-24 text-sm" />
      <Button size="sm" title="Save the updated hourly rate" className="h-7 text-xs" onClick={save} disabled={saving}>{saving ? '…' : 'Save'}</Button>
      <Button size="sm" variant="ghost" title="Discard hourly rate changes" className="h-7 text-xs" onClick={() => setEditing(false)}>Cancel</Button>
    </div>
  );
}

const BLANK_ENTRY = { type: 'review' as 'review' | 'complaint' | 'callback' | 'custom_form', title: '', notes: '', formTemplateId: '', formData: {} as Record<string, string> };
const BLANK_TEMPLATE = { name: '', description: '' };
const BLANK_FIELD: Partial<FormField> = { label: '', type: 'text', required: false };

export default function EmployeeDetailPage() {
  const params = useParams();
  const userId = Number(params.id);
  const [, setLocation] = useLocation();
  const { canManageOffice, isOwner } = useAuth();
  const qc = useQueryClient();

  const [empJobFilter, setEmpJobFilter] = useState<'all' | 'scheduled' | 'in_progress' | 'completed'>('all');

  // History entry state
  const [addEntryOpen, setAddEntryOpen] = useState(false);
  const [entryForm, setEntryForm] = useState(BLANK_ENTRY);
  const [selectedTemplate, setSelectedTemplate] = useState<EmployeeFormTemplate | null>(null);

  // Template creation state
  const [addTemplateOpen, setAddTemplateOpen] = useState(false);
  const [templateForm, setTemplateForm] = useState(BLANK_TEMPLATE);
  const [templateFields, setTemplateFields] = useState<FormField[]>([]);
  const [newField, setNewField] = useState<Partial<FormField>>(BLANK_FIELD);
  const [newFieldOptions, setNewFieldOptions] = useState('');

  // Fetch data
  const { data: users } = useListUsers({ query: { queryKey: getListUsersQueryKey() } });
  const employee = (users ?? []).find(u => u.id === userId);

  const { data: history, isLoading: histLoading } = useListEmployeeHistory(userId, {
    query: { enabled: !!userId, queryKey: getListEmployeeHistoryQueryKey(userId) },
  });
  const { data: templates } = useListEmployeeFormTemplates({
    query: { queryKey: getListEmployeeFormTemplatesQueryKey() },
  });

  const { data: recentJobs = [] } = useListJobs(
    { assigneeId: userId },
    { query: { enabled: !!userId, queryKey: getListJobsQueryKey({ assigneeId: userId }) } },
  );

  const createEntry = useCreateEmployeeHistoryEntry();
  const createTemplate = useCreateEmployeeFormTemplate();

  const openAddEntry = () => {
    setEntryForm(BLANK_ENTRY);
    setSelectedTemplate(null);
    setAddEntryOpen(true);
  };

  const handleTemplateSelect = (templateId: string) => {
    const tmpl = (templates ?? []).find(t => String(t.id) === templateId) ?? null;
    setSelectedTemplate(tmpl);
    setEntryForm(f => ({ ...f, formTemplateId: templateId, formData: {} }));
  };

  const handleEntryFieldChange = (fieldId: string, value: string) => {
    setEntryForm(f => ({ ...f, formData: { ...f.formData, [fieldId]: value } }));
  };

  const handleAddEntry = () => {
    if (!entryForm.title.trim()) { toast.error('Title is required'); return; }
    createEntry.mutate(
      {
        userId,
        data: {
          type: entryForm.type,
          title: entryForm.title,
          notes: entryForm.notes || undefined,
          formTemplateId: entryForm.formTemplateId ? Number(entryForm.formTemplateId) : undefined,
          formData: Object.keys(entryForm.formData).length > 0 ? entryForm.formData : undefined,
        },
      },
      {
        onSuccess: () => {
          toast.success('Entry added to employee file');
          qc.invalidateQueries({ queryKey: getListEmployeeHistoryQueryKey(userId) });
          setAddEntryOpen(false);
          setEntryForm(BLANK_ENTRY);
          setSelectedTemplate(null);
        },
        onError: () => toast.error('Failed to add entry'),
      }
    );
  };

  const addTemplateField = () => {
    if (!newField.label?.trim()) { toast.error('Field label is required'); return; }
    const field: FormField = {
      id: newField.label!.replace(/\s+/g, '_').toLowerCase(),
      label: newField.label!,
      type: (newField.type as FormField['type']) ?? 'text',
      required: newField.required ?? false,
      options: newField.type === 'select' ? newFieldOptions.split(',').map(s => s.trim()).filter(Boolean) : undefined,
    };
    setTemplateFields(f => [...f, field]);
    setNewField(BLANK_FIELD);
    setNewFieldOptions('');
  };

  const removeTemplateField = (id: string) => setTemplateFields(f => f.filter(x => x.id !== id));

  const handleCreateTemplate = () => {
    if (!templateForm.name.trim()) { toast.error('Template name is required'); return; }
    createTemplate.mutate(
      {
        data: {
          name: templateForm.name,
          description: templateForm.description || undefined,
          fields: templateFields as unknown as Record<string, unknown>[],
        },
      },
      {
        onSuccess: () => {
          toast.success('Form template created');
          qc.invalidateQueries({ queryKey: getListEmployeeFormTemplatesQueryKey() });
          setAddTemplateOpen(false);
          setTemplateForm(BLANK_TEMPLATE);
          setTemplateFields([]);
        },
        onError: () => toast.error('Failed to create template'),
      }
    );
  };

  if (!employee) {
    return (
      <div className="p-8 text-center text-muted-foreground">
        {histLoading ? 'Loading…' : 'Employee not found.'}
      </div>
    );
  }

  const roleLabel = employee.role.replace(/_/g, ' ');

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => setLocation('/settings?tab=users')}>
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <div className="flex items-center gap-3 flex-1">
          <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
            <User className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-semibold">{employee.name}</h1>
            <p className="text-sm text-muted-foreground">{employee.email}</p>
          </div>
        </div>
      </div>

      {/* Employee Info */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <User className="w-4 h-4 text-primary" /> Employee Info
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-x-8 gap-y-3 text-sm">
            <div className="space-y-0.5">
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Role</p>
              <Badge variant="secondary" className="capitalize" title={`Role: ${roleLabel}`}>{roleLabel}</Badge>
            </div>
            <div className="space-y-0.5">
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Status</p>
              {employee.isActive !== false
                ? <Badge className="bg-emerald-500/10 text-emerald-700 border-transparent">Active</Badge>
                : <Badge variant="outline" className="text-muted-foreground">Inactive</Badge>
              }
            </div>
            <div className="space-y-0.5">
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Hourly Rate</p>
              {canManageOffice ? (
                <HourlyRateEditor userId={userId} currentRate={(employee as any).hourlyRate ?? null} />
              ) : (
                <p className="font-medium">{(employee as any).hourlyRate != null ? `$${(employee as any).hourlyRate.toFixed(2)}/hr` : '—'}</p>
              )}
            </div>
            <div className="space-y-0.5">
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Hire Date</p>
              <p className="font-medium">
                <span title={(employee as any).hireDate ? `Hire date: ${format(new Date((employee as any).hireDate), 'EEEE, MMMM d, yyyy')}` : 'No hire date set'}>
                  {(employee as any).hireDate
                    ? format(new Date((employee as any).hireDate), 'MMM d, yyyy')
                    : '—'}
                </span>
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Admin: Form Templates management */}
      {canManageOffice && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <Settings className="w-4 h-4 text-primary" /> Employee Form Templates
              </CardTitle>
              <CardDescription className="mt-0.5">Admin-defined forms used when logging custom entries.</CardDescription>
            </div>
            <Button size="sm" variant="outline" title="Create a new custom form template for employee file entries" className="gap-1.5 shrink-0" onClick={() => setAddTemplateOpen(true)}>
              <Plus className="w-3.5 h-3.5" /> New Template
            </Button>
          </CardHeader>
          <CardContent>
            {(templates ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground py-2">No templates yet. Create one to enable custom form entries.</p>
            ) : (
              <div className="space-y-1.5">
                {(templates ?? []).map(t => (
                  <div key={t.id} className="flex items-center justify-between px-3 py-2 rounded-lg border bg-muted/30 text-sm">
                    <div>
                      <span className="font-medium">{t.name}</span>
                      {t.description && <span className="text-muted-foreground ml-2">— {t.description}</span>}
                    </div>
                    <Badge variant="outline" className="text-xs">{(t.fields as unknown as FormField[])?.length ?? 0} fields</Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Performance stats */}
      {recentJobs.length > 0 && (() => {
        const completedJobs = recentJobs.filter((j: any) => j.status === 'completed');
        const totalRevenue = completedJobs.reduce((sum: number, j: any) => sum + (j.totalAmount ?? 0), 0);
        const now = new Date();
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
        const thisMonthCompleted = completedJobs.filter((j: any) => j.completedAt ? new Date(j.completedAt) >= monthStart : new Date(j.scheduledAt) >= monthStart);
        return (
          <div className="grid grid-cols-3 gap-3">
            <Card><CardContent className="p-4 text-center">
              <p className="text-2xl font-bold" title={`Total jobs: ${recentJobs.length}`}>{recentJobs.length}</p>
              <p className="text-xs text-muted-foreground mt-0.5">Total Jobs</p>
            </CardContent></Card>
            <Card><CardContent className="p-4 text-center">
              <p className="text-2xl font-bold text-emerald-600" title={`Completed this month: ${thisMonthCompleted.length}`}>{thisMonthCompleted.length}</p>
              <p className="text-xs text-muted-foreground mt-0.5">Completed This Month</p>
            </CardContent></Card>
            <Card><CardContent className="p-4 text-center">
              <p className="text-2xl font-bold" title={`Total revenue: $${totalRevenue.toLocaleString(undefined, { maximumFractionDigits: 2 })}`}>${totalRevenue.toLocaleString(undefined, { maximumFractionDigits: 0 })}</p>
              <p className="text-xs text-muted-foreground mt-0.5">Total Revenue</p>
            </CardContent></Card>
          </div>
        );
      })()}

      {/* Efficiency link */}
      {employee && (
        <a
          href={`${import.meta.env.BASE_URL}efficiency`}
          className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
        >
          <BarChart2 className="w-4 h-4" /> View efficiency metrics →
        </a>
      )}

      {/* Recent Jobs */}
      {recentJobs.length > 0 && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2 flex-wrap gap-2">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <Briefcase className="w-4 h-4 text-primary" /> Jobs
              </CardTitle>
              <CardDescription>Jobs assigned to this employee.</CardDescription>
            </div>
            <div className="flex gap-1.5">
              {(['all', 'scheduled', 'in_progress', 'completed'] as const).map(s => (
                <button key={s} onClick={() => setEmpJobFilter(s)} className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${empJobFilter === s ? 'bg-primary text-primary-foreground border-primary' : 'border-border hover:bg-muted'}`}>
                  {s === 'all' ? 'All' : s === 'in_progress' ? 'In Progress' : s.charAt(0).toUpperCase() + s.slice(1)}
                </button>
              ))}
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Title</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Scheduled</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recentJobs.filter((job: any) => empJobFilter === 'all' || job.status === empJobFilter).slice(0, 20).map((job: any) => (
                  <TableRow key={job.id} className="cursor-pointer hover:bg-muted/50" onClick={() => setLocation(`/schedule?jobId=${job.id}`)}>
                    <TableCell className="font-medium">{job.title}</TableCell>
                    <TableCell><Badge variant="outline" className="capitalize text-xs">{job.status.replace(/_/g, ' ')}</Badge></TableCell>
                    <TableCell className="text-sm text-muted-foreground">{new Date(job.scheduledAt).toLocaleDateString()}</TableCell>
                    <TableCell className="text-right font-medium">${(job.totalAmount ?? 0).toLocaleString()}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* History Section */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <FileText className="w-4 h-4 text-primary" /> Employee File
            </CardTitle>
            <CardDescription className="mt-0.5">Reviews, complaints, callbacks, and form submissions. Append-only log.</CardDescription>
          </div>
          {canManageOffice && (
            <Button size="sm" className="gap-1.5 shrink-0" onClick={openAddEntry}>
              <Plus className="w-3.5 h-3.5" /> Add Entry
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {histLoading ? (
            <p className="text-sm text-muted-foreground py-4 text-center">Loading history…</p>
          ) : (history ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">No history entries yet.</p>
          ) : (
            <div className="space-y-3">
              {(history ?? []).map((entry: EmployeeHistoryEntry) => {
                const cfg = ENTRY_TYPE_CONFIG[entry.type] ?? ENTRY_TYPE_CONFIG.custom_form;
                return (
                  <div key={entry.id} className="rounded-lg border p-4 space-y-2">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge className={`gap-1 ${cfg.color}`} title={`Entry type: ${cfg.label}`}>
                          {cfg.icon} {cfg.label}
                        </Badge>
                        <span className="font-medium text-sm" title={entry.title}>{entry.title}</span>
                        {(entry as any).formTemplateName && (
                          <span className="text-xs text-muted-foreground">({(entry as any).formTemplateName})</span>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {entry.notes && (
                          <button
                            className="text-xs text-muted-foreground hover:text-foreground transition-colors p-0.5 rounded"
                            title="Copy note"
                            onClick={() => { navigator.clipboard.writeText(entry.notes!); toast.success('Copied'); }}
                          >
                            <Copy className="w-3 h-3" />
                          </button>
                        )}
                        <span className="text-xs text-muted-foreground">
                          {format(new Date(entry.createdAt), 'MMM d, yyyy')}
                        </span>
                      </div>
                    </div>
                    {entry.notes && (
                      <p className="text-sm text-muted-foreground whitespace-pre-wrap">{entry.notes}</p>
                    )}
                    {entry.formData && Object.keys(entry.formData as Record<string, unknown>).length > 0 && (
                      <div className="pt-1 space-y-1">
                        {Object.entries(entry.formData as Record<string, string>).map(([k, v]) => (
                          <div key={k} className="text-xs flex gap-2">
                            <span className="text-muted-foreground capitalize min-w-[100px]">{k.replace(/_/g, ' ')}:</span>
                            <span>{String(v)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    {(entry as any).createdByName && (
                      <p className="text-xs text-muted-foreground pt-1 border-t mt-2">
                        Logged by {(entry as any).createdByName}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Add History Entry Sheet */}
      <Sheet open={addEntryOpen} onOpenChange={setAddEntryOpen}>
        <SheetContent className="w-full sm:max-w-[66vw]">
          <SheetHeader className="pb-4">
            <SheetTitle>Add to Employee File</SheetTitle>
            <SheetDescription>Log a review, complaint, callback, or custom form for {employee.name}.</SheetDescription>
          </SheetHeader>
          <div className="space-y-4 pb-6">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Entry Type <span className="text-destructive">*</span></label>
              <Select value={entryForm.type} onValueChange={v => setEntryForm(f => ({ ...f, type: v as typeof entryForm.type, formTemplateId: '', formData: {} }))}>
                <SelectTrigger title="Select the type of employee file entry"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="review">Review</SelectItem>
                  <SelectItem value="complaint">Complaint</SelectItem>
                  <SelectItem value="callback">Callback</SelectItem>
                  <SelectItem value="custom_form">Custom Form</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {entryForm.type === 'custom_form' && (
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Form Template</label>
                <Select value={entryForm.formTemplateId} onValueChange={handleTemplateSelect}>
                  <SelectTrigger title="Choose a custom form template to fill in for this entry"><SelectValue placeholder="Select a template…" /></SelectTrigger>
                  <SelectContent>
                    {(templates ?? []).map(t => (
                      <SelectItem key={t.id} value={String(t.id)}>{t.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-1.5">
              <label className="text-sm font-medium">Title / Summary <span className="text-destructive">*</span></label>
              <Input
                title="Short summary or title of this file entry"
                placeholder="e.g. Q2 Performance Review"
                value={entryForm.title}
                onChange={e => setEntryForm(f => ({ ...f, title: e.target.value }))}
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium">Notes / Details</label>
              <Textarea
                title="Detailed notes or observations for this file entry"
                placeholder="Add any free-text notes here…"
                value={entryForm.notes}
                onChange={e => setEntryForm(f => ({ ...f, notes: e.target.value }))}
                rows={4}
              />
            </div>

            {/* Dynamic form fields for custom_form type */}
            {selectedTemplate && (selectedTemplate.fields as unknown as FormField[])?.length > 0 && (
              <div className="space-y-3 rounded-lg border p-3 bg-muted/20">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Form Fields</p>
                {(selectedTemplate.fields as unknown as FormField[]).map(field => (
                  <div key={field.id} className="space-y-1.5">
                    <label className="text-sm font-medium">
                      {field.label}
                      {field.required && <span className="text-destructive ml-1">*</span>}
                    </label>
                    {field.type === 'textarea' ? (
                      <Textarea
                        title={field.label}
                        value={entryForm.formData[field.id] ?? ''}
                        onChange={e => handleEntryFieldChange(field.id, e.target.value)}
                        rows={3}
                      />
                    ) : field.type === 'select' && field.options ? (
                      <Select value={entryForm.formData[field.id] ?? ''} onValueChange={v => handleEntryFieldChange(field.id, v)}>
                        <SelectTrigger title={field.label}><SelectValue placeholder="Select…" /></SelectTrigger>
                        <SelectContent>
                          {field.options.map(opt => (
                            <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Input
                        title={field.label}
                        type={field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text'}
                        value={entryForm.formData[field.id] ?? ''}
                        onChange={e => handleEntryFieldChange(field.id, e.target.value)}
                      />
                    )}
                  </div>
                ))}
              </div>
            )}

            <Separator />
            <div className="flex gap-3 justify-end">
              <Button variant="outline" title="Discard this file entry" onClick={() => setAddEntryOpen(false)}>Cancel</Button>
              <Button title="Save this employee file entry" onClick={handleAddEntry} disabled={createEntry.isPending}>
                {createEntry.isPending ? 'Saving…' : 'Add Entry'}
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      {/* Create Form Template Sheet (admin only) */}
      {canManageOffice && (
        <Sheet open={addTemplateOpen} onOpenChange={setAddTemplateOpen}>
          <SheetContent className="w-full sm:max-w-[66vw]">
            <SheetHeader className="pb-4">
              <SheetTitle>Create Form Template</SheetTitle>
              <SheetDescription>Define a reusable form schema for employee file entries.</SheetDescription>
            </SheetHeader>
            <div className="space-y-4 pb-6 overflow-y-auto max-h-[calc(100vh-160px)]">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Template Name <span className="text-destructive">*</span></label>
                <Input
                  placeholder="e.g. Performance Review Q2"
                  value={templateForm.name}
                  onChange={e => setTemplateForm(f => ({ ...f, name: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Description</label>
                <Input
                  placeholder="Optional description"
                  value={templateForm.description}
                  onChange={e => setTemplateForm(f => ({ ...f, description: e.target.value }))}
                />
              </div>

              <Separator />
              <p className="text-sm font-semibold">Form Fields</p>

              {templateFields.length > 0 && (
                <div className="space-y-1.5">
                  {templateFields.map(f => (
                    <div key={f.id} className="flex items-center justify-between px-3 py-2 rounded-lg border bg-muted/30 text-sm">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium">{f.label}</span>
                        <Badge variant="outline" className="text-xs capitalize">{f.type}</Badge>
                        {f.required && <Badge variant="outline" className="text-xs text-amber-600 border-amber-300">Required</Badge>}
                      </div>
                      <Button variant="ghost" size="icon" title="Remove this field from the template" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={() => removeTemplateField(f.id)}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}

              {/* Add new field */}
              <div className="rounded-lg border p-3 space-y-3 bg-muted/10">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Add a Field</p>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Label</label>
                  <Input
                    placeholder="e.g. Performance Score"
                    value={newField.label ?? ''}
                    onChange={e => setNewField(f => ({ ...f, label: e.target.value }))}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Type</label>
                  <Select value={newField.type ?? 'text'} onValueChange={v => setNewField(f => ({ ...f, type: v as FormField['type'] }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="text">Text</SelectItem>
                      <SelectItem value="number">Number</SelectItem>
                      <SelectItem value="textarea">Long Text</SelectItem>
                      <SelectItem value="date">Date</SelectItem>
                      <SelectItem value="select">Dropdown</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {newField.type === 'select' && (
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">Options</label>
                    <Input
                      placeholder="Option 1, Option 2, Option 3"
                      value={newFieldOptions}
                      onChange={e => setNewFieldOptions(e.target.value)}
                    />
                    <p className="text-xs text-muted-foreground">Comma-separated list.</p>
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="field-required"
                    checked={newField.required ?? false}
                    onChange={e => setNewField(f => ({ ...f, required: e.target.checked }))}
                    className="rounded"
                  />
                  <label htmlFor="field-required" className="text-sm">Required field</label>
                </div>
                <Button size="sm" variant="outline" className="w-full gap-1.5" onClick={addTemplateField}>
                  <Plus className="w-3.5 h-3.5" /> Add Field
                </Button>
              </div>

              <Separator />
              <div className="flex gap-3 justify-end">
                <Button variant="outline" title="Discard this template" onClick={() => setAddTemplateOpen(false)}>Cancel</Button>
                <Button title="Create this custom form template" onClick={handleCreateTemplate} disabled={createTemplate.isPending}>
                  {createTemplate.isPending ? 'Creating…' : 'Create Template'}
                </Button>
              </div>
            </div>
          </SheetContent>
        </Sheet>
      )}
    </div>
  );
}
