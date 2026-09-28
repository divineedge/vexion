import React, { useEffect, useRef, useState } from 'react';
import {
  useListChemicalApplications, useListUsers, getListChemicalApplicationsQueryKey,
  useListChemicalProducts, getListChemicalProductsQueryKey,
  useCreateChemicalProduct, useUpdateChemicalProduct, useDeleteChemicalProduct,
  useListChemicalMixtures, getListChemicalMixturesQueryKey,
  useCreateChemicalMixture, useUpdateChemicalMixture, useDeleteChemicalMixture,
  useGetTenantSettings, getGetTenantSettingsQueryKey, useUpdateTenantSettings,
  useListChemicalDocuments, getListChemicalDocumentsQueryKey,
  useUploadChemicalDocument, useDeleteChemicalDocument, useGetChemicalDocumentReadUrl,
} from '@workspace/api-client-react';
import type { ChemicalProduct, ChemicalMixture, ChemicalMixtureItem, ChemicalDocument } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { FlaskConical, Download, Filter, ChevronDown, ChevronRight, Plus, Pencil, Trash2, X, ShieldCheck, Save, FileText, ExternalLink } from 'lucide-react';
import {
  CHEMICAL_REQUIREMENT_GROUPS,
  normalizeChemicalRecordRequirements,
  type ChemicalRequirementKey,
} from '@/lib/chemicalRequirements';

const MAX_SAFETY_SHEET_BYTES = 20 * 1024 * 1024;

function safeHttpUrl(value: string, allowRelative = false): string | null {
  try {
    if (allowRelative && value.startsWith('/') && !value.startsWith('//')) {
      return new URL(value, window.location.origin).href;
    }
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
  } catch {
    return null;
  }
}

function ChemicalSafetySheets({ product, canManage, onClose }: { product: ChemicalProduct; canManage: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const [documentType, setDocumentType] = useState<'sds' | 'msds'>('sds');
  const [file, setFile] = useState<File | null>(null);
  const [uploadError, setUploadError] = useState('');
  const [openingId, setOpeningId] = useState<number | null>(null);
  const [removing, setRemoving] = useState<ChemicalDocument | null>(null);
  const { data: documents, isLoading, isError, error, refetch } = useListChemicalDocuments(product.id, {
    query: { queryKey: getListChemicalDocumentsQueryKey(product.id), refetchOnMount: 'always' },
  });
  const upload = useUploadChemicalDocument();
  const remove = useDeleteChemicalDocument();
  const getReadUrl = useGetChemicalDocumentReadUrl();

  const selectFile = (selected: File | null) => {
    setUploadError('');
    setFile(null);
    if (!selected) return;
    if (!/\.pdf$/i.test(selected.name) || (selected.type && selected.type !== 'application/pdf')) {
      setUploadError('Select a PDF file.');
      if (fileInput.current) fileInput.current.value = '';
      return;
    }
    if (selected.size > MAX_SAFETY_SHEET_BYTES) {
      setUploadError('PDF files must be 20 MB or smaller.');
      if (fileInput.current) fileInput.current.value = '';
      return;
    }
    if (!selected.size) {
      setUploadError('The selected PDF is empty.');
      if (fileInput.current) fileInput.current.value = '';
      return;
    }
    setFile(selected);
  };

  const uploadFile = () => {
    if (!file || upload.isPending) return;
    setUploadError('');
    upload.mutate({ id: product.id, data: { file, documentType } }, {
      onSuccess: () => {
        setFile(null);
        if (fileInput.current) fileInput.current.value = '';
        qc.invalidateQueries({ queryKey: getListChemicalDocumentsQueryKey(product.id) });
        toast.success('Safety sheet uploaded');
      },
      onError: error => setUploadError(error.message || 'Upload failed. Please try again.'),
    });
  };

  const openDocument = (documentId: number) => {
    // Reserve the tab during the click: opening it after the signed URL request may be blocked.
    const tab = window.open('', '_blank');
    if (!tab) { toast.error('Allow pop-ups to open this safety sheet.'); return; }
    setOpeningId(documentId);
    getReadUrl.mutate({ id: product.id, documentId }, {
      onSuccess: ({ url }) => {
        const safeUrl = safeHttpUrl(url, true);
        if (!safeUrl) {
          tab.close();
          toast.error('The safety sheet link is invalid.');
          return;
        }
        tab.opener = null;
        tab.location.replace(safeUrl);
      },
      onError: error => {
        tab.close();
        toast.error(error.message || 'Could not open the safety sheet. Try again.');
      },
      onSettled: () => setOpeningId(null),
    });
  };

  const openExternalLink = () => {
    const url = safeHttpUrl(product.labelSdsUrl ?? '');
    if (!url) { toast.error('The external label / SDS URL must start with http:// or https://.'); return; }
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  return (
    <Sheet open onOpenChange={open => { if (!open && !upload.isPending && !remove.isPending) onClose(); }}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader className="pb-4">
          <SheetTitle>Safety Sheets · {product.name}</SheetTitle>
          <SheetDescription>Stored SDS and MSDS PDFs for this chemical product.</SheetDescription>
        </SheetHeader>
        <div className="space-y-5 pb-6">
          {product.labelSdsUrl && (
            <div className="rounded-md border p-3 text-sm">
              <p className="text-xs text-muted-foreground mb-1">External label / SDS URL (not a stored PDF)</p>
              <Button variant="link" className="h-auto p-0 gap-1 max-w-full" onClick={openExternalLink}>
                <ExternalLink className="h-3.5 w-3.5 shrink-0" /> Open external link
              </Button>
            </div>
          )}
          {canManage && (
            <div className="rounded-md border p-4 space-y-3">
              <p className="text-sm font-medium">Upload a safety sheet</p>
              <div className="flex items-center gap-2">
                <label htmlFor="chemical-document-type" className="text-sm">Type</label>
                <Select value={documentType} onValueChange={value => setDocumentType(value as 'sds' | 'msds')} disabled={upload.isPending}>
                  <SelectTrigger id="chemical-document-type" className="w-28"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="sds">SDS</SelectItem><SelectItem value="msds">MSDS</SelectItem></SelectContent>
                </Select>
              </div>
              <Input ref={fileInput} type="file" accept=".pdf,application/pdf" aria-label="Choose safety sheet PDF" disabled={upload.isPending} onChange={e => selectFile(e.target.files?.[0] ?? null)} />
              <p className="text-xs text-muted-foreground">PDF only · maximum 20 MB. Multiple sheets can be stored per product.</p>
              {uploadError && <p role="alert" className="text-sm text-destructive">{uploadError}</p>}
              <Button size="sm" disabled={!file || upload.isPending} onClick={uploadFile}>
                {upload.isPending ? 'Uploading…' : uploadError && file ? 'Retry upload' : 'Upload PDF'}
              </Button>
            </div>
          )}
          <div className="space-y-2">
            <h3 className="text-sm font-medium">Stored PDFs</h3>
            {isLoading ? <p className="text-sm text-muted-foreground">Loading safety sheets…</p>
              : isError ? <div className="text-sm text-destructive" role="alert">
                  Could not load safety sheets: {error.message}
                  <Button variant="link" size="sm" onClick={() => refetch()}>Retry</Button>
                </div>
              : !documents?.length ? <p className="text-sm text-muted-foreground">No safety sheets uploaded yet.</p>
              : documents.map(doc => (
                <div key={doc.id} className="flex items-center gap-2 rounded-md border p-3">
                  <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium break-words">{doc.fileName}</p>
                    <p className="text-xs text-muted-foreground">
                      {doc.documentType.toUpperCase()} · {(doc.sizeBytes / 1024 / 1024).toFixed(2)} MB · {format(new Date(doc.createdAt), 'MMM d, yyyy')}
                    </p>
                  </div>
                  <Button variant="outline" size="sm" disabled={openingId !== null} onClick={() => openDocument(doc.id)}>
                    {openingId === doc.id ? 'Opening…' : 'Open'}
                  </Button>
                  {canManage && <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-destructive" aria-label={`Remove ${doc.fileName}`} onClick={() => setRemoving(doc)}><Trash2 className="h-4 w-4" /></Button>}
                </div>
              ))}
          </div>
        </div>
        <AlertDialog open={!!removing} onOpenChange={open => { if (!open && !remove.isPending) setRemoving(null); }}>
          <AlertDialogContent className="z-[1003]">
            <AlertDialogHeader>
              <AlertDialogTitle>Remove safety sheet?</AlertDialogTitle>
              <AlertDialogDescription>This permanently removes {removing?.fileName} from this product.</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={remove.isPending}>Cancel</AlertDialogCancel>
              <AlertDialogAction disabled={remove.isPending} onClick={event => {
                event.preventDefault();
                if (!removing || !canManage) return;
                remove.mutate({ id: product.id, documentId: removing.id }, {
                  onSuccess: () => {
                    setRemoving(null);
                    qc.invalidateQueries({ queryKey: getListChemicalDocumentsQueryKey(product.id) });
                    toast.success('Safety sheet removed');
                  },
                  onError: error => toast.error(error.message || 'Could not remove safety sheet. Try again.'),
                });
              }}>{remove.isPending ? 'Removing…' : 'Remove'}</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </SheetContent>
    </Sheet>
  );
}

export default function ChemicalsPage() {
  const { canManageOffice } = useAuth();
  const qc = useQueryClient();

  const { data: tenantSettings, isLoading: requirementsLoading } = useGetTenantSettings({
    query: { queryKey: getGetTenantSettingsQueryKey() },
  });
  const updateTenantSettings = useUpdateTenantSettings();
  const [chemicalRequirements, setChemicalRequirements] = useState(() => normalizeChemicalRecordRequirements(null));

  useEffect(() => {
    if (tenantSettings) {
      setChemicalRequirements(normalizeChemicalRecordRequirements(tenantSettings.chemicalRecordRequirements));
    }
  }, [tenantSettings]);

  const toggleChemicalRequirement = (key: ChemicalRequirementKey) => {
    setChemicalRequirements(current => ({ ...current, [key]: !current[key] }));
  };

  const saveChemicalRequirements = () => {
    updateTenantSettings.mutate(
      { data: { chemicalRecordRequirements: chemicalRequirements } },
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: getGetTenantSettingsQueryKey() });
          toast.success('Chemical record requirements saved');
        },
        onError: () => toast.error('Could not save chemical record requirements'),
      },
    );
  };

  // ── Application records state ───────────────────────────────────────────────
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [applicatorId, setApplicatorId] = useState('');
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const params: Record<string, string | number | undefined> = {};
  if (startDate) params.startDate = startDate;
  if (endDate) params.endDate = endDate;
  if (applicatorId && applicatorId !== 'all') params.applicatorId = parseInt(applicatorId, 10);

  const { data: applications, isLoading } = useListChemicalApplications(
    Object.keys(params).length ? params : undefined,
    { query: { queryKey: getListChemicalApplicationsQueryKey(Object.keys(params).length ? params : undefined) } }
  );
  const { data: users } = useListUsers();

  // ── Products state ──────────────────────────────────────────────────────────
  const { data: chemProducts } = useListChemicalProducts({ query: { queryKey: getListChemicalProductsQueryKey() } });
  const createChemProduct = useCreateChemicalProduct();
  const updateChemProduct = useUpdateChemicalProduct();
  const deleteChemProduct = useDeleteChemicalProduct();

  const [prodFormOpen, setProdFormOpen] = useState(false);
  const [editingProd, setEditingProd] = useState<ChemicalProduct | null>(null);
  const [safetyProd, setSafetyProd] = useState<ChemicalProduct | null>(null);
  const [prodForm, setProdForm] = useState({ name: '', epaRegNumber: '', activeIngredients: '', signalWord: '', rei: '', phi: '', labelSdsUrl: '', unit: 'oz', rainfastHours: '' });

  const openAddProd = () => {
    setEditingProd(null);
    setProdForm({ name: '', epaRegNumber: '', activeIngredients: '', signalWord: '', rei: '', phi: '', labelSdsUrl: '', unit: 'oz', rainfastHours: '' });
    setProdFormOpen(true);
  };
  const openEditProd = (p: ChemicalProduct) => {
    setEditingProd(p);
    setProdForm({ name: p.name, epaRegNumber: p.epaRegNumber ?? '', activeIngredients: p.activeIngredients ?? '', signalWord: p.signalWord ?? '', rei: p.rei != null ? String(p.rei) : '', phi: p.phi != null ? String(p.phi) : '', labelSdsUrl: p.labelSdsUrl ?? '', unit: p.unit, rainfastHours: (p as any).rainfastHours != null ? String((p as any).rainfastHours) : '' });
    setProdFormOpen(true);
  };
  const saveProd = () => {
    if (!prodForm.name) { toast.error('Name is required'); return; }
    const data = {
      name: prodForm.name,
      epaRegNumber: prodForm.epaRegNumber || undefined,
      activeIngredients: prodForm.activeIngredients || undefined,
      signalWord: (prodForm.signalWord && prodForm.signalWord !== 'none') ? prodForm.signalWord as 'CAUTION' | 'WARNING' | 'DANGER' : undefined,
      rei: prodForm.rei ? parseInt(prodForm.rei, 10) : undefined,
      phi: prodForm.phi ? parseInt(prodForm.phi, 10) : undefined,
      labelSdsUrl: prodForm.labelSdsUrl.trim() || (editingProd ? null : undefined),
      unit: prodForm.unit,
      rainfastHours: prodForm.rainfastHours ? parseFloat(prodForm.rainfastHours) : undefined,
    } as any;
    if (editingProd) {
      updateChemProduct.mutate({ id: editingProd.id, data }, {
        onSuccess: () => { toast.success('Product updated'); qc.invalidateQueries({ queryKey: getListChemicalProductsQueryKey() }); setProdFormOpen(false); },
        onError: () => toast.error('Failed to update'),
      });
    } else {
      createChemProduct.mutate({ data }, {
        onSuccess: product => {
          toast.success('Product added. You can now upload safety sheets.');
          qc.invalidateQueries({ queryKey: getListChemicalProductsQueryKey() });
          setProdFormOpen(false);
          setSafetyProd(product);
        },
        onError: () => toast.error('Failed to add product'),
      });
    }
  };

  // ── Mixtures state ──────────────────────────────────────────────────────────
  const { data: chemMixtures } = useListChemicalMixtures({ query: { queryKey: getListChemicalMixturesQueryKey() } });
  const createChemMixture = useCreateChemicalMixture();
  const updateChemMixture = useUpdateChemicalMixture();
  const deleteChemMixture = useDeleteChemicalMixture();

  const [mixFormOpen, setMixFormOpen] = useState(false);
  const [editingMix, setEditingMix] = useState<ChemicalMixture | null>(null);
  const [mixForm, setMixForm] = useState({ name: '', description: '' });
  const [mixItems, setMixItems] = useState<Array<{ productId: string; ratioAmount: string; ratioUnit: string }>>([]);

  const openAddMix = () => {
    setEditingMix(null);
    setMixForm({ name: '', description: '' });
    setMixItems([]);
    setMixFormOpen(true);
  };
  const openEditMix = (m: ChemicalMixture) => {
    setEditingMix(m);
    setMixForm({ name: m.name, description: m.description ?? '' });
    setMixItems(m.items.map((i: ChemicalMixtureItem) => ({ productId: String(i.productId), ratioAmount: String(i.ratioAmount), ratioUnit: i.ratioUnit })));
    setMixFormOpen(true);
  };
  const saveMix = () => {
    if (!mixForm.name) { toast.error('Name is required'); return; }
    const data = {
      name: mixForm.name,
      description: mixForm.description || undefined,
      items: mixItems.filter(i => i.productId && i.ratioAmount).map(i => ({
        productId: parseInt(i.productId, 10),
        ratioAmount: parseFloat(i.ratioAmount),
        ratioUnit: i.ratioUnit,
      })),
    };
    if (editingMix) {
      updateChemMixture.mutate({ id: editingMix.id, data }, {
        onSuccess: () => { toast.success('Mixture updated'); qc.invalidateQueries({ queryKey: getListChemicalMixturesQueryKey() }); setMixFormOpen(false); },
        onError: () => toast.error('Failed to update'),
      });
    } else {
      createChemMixture.mutate({ data }, {
        onSuccess: () => { toast.success('Mixture created'); qc.invalidateQueries({ queryKey: getListChemicalMixturesQueryKey() }); setMixFormOpen(false); },
        onError: () => toast.error('Failed to create'),
      });
    }
  };

  // ── Helpers ─────────────────────────────────────────────────────────────────
  const handleExportPDF = () => window.print();
  const handleExportCSV = () => {
    const base = `${window.location.origin}/api/chemical-applications/export`;
    const qs = new URLSearchParams();
    if (startDate) qs.set('startDate', startDate);
    if (endDate) qs.set('endDate', endDate);
    if (applicatorId && applicatorId !== 'all') qs.set('applicatorId', applicatorId);
    const url = qs.toString() ? `${base}?${qs}` : base;
    const a = document.createElement('a');
    a.href = url; a.download = '';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
  };

  const SIGNAL_COLORS: Record<string, string> = {
    CAUTION: 'bg-yellow-100 text-yellow-800 border-yellow-200',
    WARNING: 'bg-orange-100 text-orange-800 border-orange-200',
    DANGER: 'bg-red-100 text-red-800 border-red-200',
  };
  type BreakdownItem = { productName?: string | null; activeIngredients?: string | null; epaRegNumber?: string | null; amountApplied: number; unit: string; ratePerAcre?: number | null; ratePer1000Sqft?: number | null; };
  const hasAnyRate = (applications ?? []).some(app => Array.isArray(app.breakdown) && (app.breakdown as BreakdownItem[]).some(b => b.ratePerAcre != null || b.ratePer1000Sqft != null));
  const getSummaryRate = (breakdown: unknown[]): string | null => {
    const items = breakdown as BreakdownItem[];
    const withAcre = items.find(b => b.ratePerAcre != null);
    if (withAcre) return `${withAcre.ratePerAcre!.toFixed(3)}/ac`;
    const with1k = items.find(b => b.ratePer1000Sqft != null);
    if (with1k) return `${with1k.ratePer1000Sqft!.toFixed(3)}/ksqft`;
    return null;
  };

  const SIGNAL_LABEL_COLORS: Record<string, string> = {
    CAUTION: 'bg-yellow-50 text-yellow-700 border-yellow-200',
    WARNING: 'bg-orange-50 text-orange-700 border-orange-200',
    DANGER: 'bg-red-50 text-red-700 border-red-200',
  };

  return (
    <div className="space-y-6 max-w-6xl mx-auto animate-in fade-in duration-500">
      {/* Page header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-500/10 text-emerald-600 flex items-center justify-center">
            <FlaskConical className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Chemicals</h1>
            <p className="text-sm text-muted-foreground">Application records, product library, and tank mixtures.</p>
          </div>
        </div>
      </div>

      <Tabs defaultValue="applications" className="space-y-6">
        <TabsList>
          <TabsTrigger value="applications">Applications</TabsTrigger>
          <TabsTrigger value="products">Products</TabsTrigger>
          <TabsTrigger value="mixtures">Tank Mixtures</TabsTrigger>
          {canManageOffice && <TabsTrigger value="required-information">Required Information</TabsTrigger>}
        </TabsList>

        {/* ── Applications tab ─────────────────────────────────────────────── */}
        <TabsContent value="applications" className="space-y-4 focus-visible:outline-none">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold">Application Records</h2>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" className="gap-1.5" onClick={handleExportCSV} title="Download application records as CSV">
                <Download className="w-3.5 h-3.5" /> CSV
              </Button>
              <Button variant="outline" size="sm" className="gap-1.5" onClick={handleExportPDF} title="Print application records">
                <Download className="w-3.5 h-3.5" /> PDF
              </Button>
            </div>
          </div>

          {/* Filters */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-sm font-medium"><Filter className="w-4 h-4" /> Filters</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-4 items-end">
                <div className="space-y-1.5">
                  <label className="text-xs text-muted-foreground font-medium">Start Date</label>
                  <Input type="date" className="h-8 text-sm w-40" value={startDate} onChange={e => setStartDate(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs text-muted-foreground font-medium">End Date</label>
                  <Input type="date" className="h-8 text-sm w-40" value={endDate} onChange={e => setEndDate(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs text-muted-foreground font-medium">Applicator</label>
                  <Select value={applicatorId || 'all'} onValueChange={v => setApplicatorId(v === 'all' ? '' : v)}>
                    <SelectTrigger className="h-8 text-sm w-44"><SelectValue placeholder="All applicators" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All applicators</SelectItem>
                      {(users ?? []).map(u => (
                        <SelectItem key={u.id} value={String(u.id)}>{u.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {(startDate || endDate || applicatorId) && (
                  <Button variant="ghost" size="sm" className="h-8 text-xs gap-1" onClick={() => { setStartDate(''); setEndDate(''); setApplicatorId(''); }}>
                    <X className="w-3 h-3" /> Clear
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Records */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-medium">
                  {isLoading ? 'Loading…' : `${(applications ?? []).length} record${(applications ?? []).length !== 1 ? 's' : ''}`}
                </CardTitle>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {isLoading ? (
                <div className="px-6 py-8 text-center text-sm text-muted-foreground">Loading application records…</div>
              ) : (applications ?? []).length === 0 ? (
                <div className="px-6 py-8 text-center text-sm text-muted-foreground">No application records found. Records appear here after chemical applications are logged on jobs.</div>
              ) : (
                <div className="divide-y">
                  {(applications ?? []).map(app => {
                    const isExpanded = expandedId === app.id;
                    const breakdown = Array.isArray(app.breakdown) ? app.breakdown as BreakdownItem[] : [];
                    const summaryRate = breakdown.length ? getSummaryRate(breakdown) : null;
                    return (
                      <div key={app.id}>
                        <button
                          className="w-full text-left px-6 py-3 hover:bg-muted/50 transition-colors"
                          onClick={() => setExpandedId(isExpanded ? null : app.id)}
                        >
                          <div className="flex items-center justify-between gap-4">
                            <div className="flex items-center gap-2 min-w-0">
                              {isExpanded ? <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" /> : <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />}
                              <div className="min-w-0">
                                <p className="text-sm font-medium truncate">
                                  {app.mixtureName ?? app.productName ?? 'Application'}
                                </p>
                                <p className="text-xs text-muted-foreground">Job #{app.jobId} · {app.propertyAddress ?? 'Unknown property'}</p>
                              </div>
                            </div>
                            <div className="flex items-center gap-4 text-xs text-muted-foreground shrink-0">
                              <span>{app.volumeApplied} {app.volumeUnit} applied</span>
                              {(app as any).areaOfTreatment && <span>{(app as any).areaOfTreatment.toLocaleString()} sqft</span>}
                              {summaryRate && hasAnyRate && <span>{summaryRate}</span>}
                              <span>{app.appliedAt ? format(new Date(app.appliedAt), 'MMM d, yyyy') : '—'}</span>
                              <span>{app.applicatorName ?? '—'}</span>
                              {app.applicationMethod && (
                                <Badge variant="outline" className="text-[10px] px-1.5 capitalize">{app.applicationMethod.replace(/_/g, ' ')}</Badge>
                              )}
                            </div>
                          </div>
                        </button>

                        {isExpanded && (
                          <div className="px-6 pb-4 pt-1 bg-muted/30 space-y-4">
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                              {app.targetPest && <div><p className="text-xs text-muted-foreground">Target Pest</p><p className="font-medium">{app.targetPest}</p></div>}
                              {app.propertyAddress && <div><p className="text-xs text-muted-foreground">Property</p><p className="font-medium">{app.propertyAddress}</p></div>}
                              {app.temperature != null && <div><p className="text-xs text-muted-foreground">Temperature</p><p className="font-medium">{app.temperature}°F</p></div>}
                              {app.windSpeed != null && <div><p className="text-xs text-muted-foreground">Wind Speed</p><p className="font-medium">{app.windSpeed} mph</p></div>}
                              {app.applicatorLicenseNumber && <div><p className="text-xs text-muted-foreground">License #</p><p className="font-medium">{app.applicatorLicenseNumber}</p></div>}
                            </div>

                            {breakdown.length > 0 && (
                              <div>
                                <p className="text-xs font-medium text-muted-foreground mb-2">Product Breakdown</p>
                                <Table>
                                  <TableHeader>
                                    <TableRow>
                                      <TableHead className="text-xs h-7">Product</TableHead>
                                      <TableHead className="text-xs h-7">Active Ingredients</TableHead>
                                      <TableHead className="text-xs h-7">EPA Reg #</TableHead>
                                      <TableHead className="text-xs h-7 text-right">Amount</TableHead>
                                      {hasAnyRate && <TableHead className="text-xs h-7 text-right">Rate</TableHead>}
                                    </TableRow>
                                  </TableHeader>
                                  <TableBody>
                                    {breakdown.map((b, i) => (
                                      <TableRow key={i}>
                                        <TableCell className="text-xs py-1.5">{b.productName ?? '—'}</TableCell>
                                        <TableCell className="text-xs py-1.5 text-muted-foreground">{b.activeIngredients ?? '—'}</TableCell>
                                        <TableCell className="text-xs py-1.5 text-muted-foreground">{b.epaRegNumber ?? '—'}</TableCell>
                                        <TableCell className="text-xs py-1.5 text-right">{b.amountApplied} {b.unit}</TableCell>
                                        {hasAnyRate && (
                                          <TableCell className="text-xs py-1.5 text-right text-muted-foreground">
                                            {b.ratePerAcre != null ? `${b.ratePerAcre.toFixed(3)}/ac` : b.ratePer1000Sqft != null ? `${b.ratePer1000Sqft.toFixed(3)}/ksqft` : '—'}
                                          </TableCell>
                                        )}
                                      </TableRow>
                                    ))}
                                  </TableBody>
                                </Table>
                              </div>
                            )}

                            {app.notes && (
                              <div>
                                <p className="text-xs text-muted-foreground font-medium">Notes</p>
                                <p className="text-sm mt-0.5">{app.notes}</p>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Products tab ─────────────────────────────────────────────────── */}
        <TabsContent value="products" className="focus-visible:outline-none">
          <Card>
            <CardHeader className="flex flex-row items-start justify-between pb-2">
              <div>
                <CardTitle className="flex items-center gap-2"><FlaskConical className="w-5 h-5" /> Chemical Products</CardTitle>
                <CardDescription>Pesticides, herbicides, and fertilizers with EPA registration and safety data.</CardDescription>
              </div>
              {canManageOffice && <Button size="sm" className="gap-2 ml-4 shrink-0" onClick={openAddProd}>
                <Plus className="w-4 h-4" /> Add Product
              </Button>}
            </CardHeader>
            <CardContent className="p-0">
              {(chemProducts ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground px-6 py-4">No chemical products yet. Add your first product to build your library.</p>
              ) : (
                <div className="divide-y">
                  {(chemProducts ?? []).map(p => (
                    <div key={p.id} className={`flex items-start gap-4 px-6 py-3 ${!p.isActive ? 'opacity-50' : ''}`}>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium text-sm">{p.name}</span>
                          {p.signalWord && (
                            <Badge variant="outline" className={`text-[10px] px-1.5 ${SIGNAL_LABEL_COLORS[p.signalWord] ?? ''}`}>
                              {p.signalWord}
                            </Badge>
                          )}
                          {!p.isActive && <Badge variant="outline" className="text-[10px] px-1.5">Inactive</Badge>}
                        </div>
                        {p.epaRegNumber && <p className="text-xs text-muted-foreground mt-0.5">EPA #{p.epaRegNumber}</p>}
                        {p.activeIngredients && <p className="text-xs text-muted-foreground">{p.activeIngredients}</p>}
                        <div className="flex items-center gap-3 mt-0.5 text-xs text-muted-foreground">
                          <span>Unit: {p.unit}</span>
                          {(p as any).rainfastHours != null && <span>Rainfast: {(p as any).rainfastHours}h</span>}
                          {p.rei != null && <span>REI: {p.rei}h</span>}
                          {p.phi != null && <span>PHI: {p.phi}d</span>}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setSafetyProd(p)}>
                          <FileText className="w-3.5 h-3.5" /> Safety Sheets
                        </Button>
                        {canManageOffice && <>
                        <Button variant="ghost" size="icon" className="w-7 h-7" onClick={() => openEditProd(p)}>
                          <Pencil className="w-3.5 h-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="w-7 h-7 text-muted-foreground hover:text-destructive" onClick={() => {
                          deleteChemProduct.mutate({ id: p.id }, {
                            onSuccess: () => { toast.success('Product deleted'); qc.invalidateQueries({ queryKey: getListChemicalProductsQueryKey() }); },
                            onError: () => toast.error('Failed to delete'),
                          });
                        }}>
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                        </>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Product Form Sheet */}
          <Sheet open={prodFormOpen} onOpenChange={open => { if (!open) { setProdFormOpen(false); setEditingProd(null); } }}>
            <SheetContent className="w-full sm:max-w-md overflow-y-auto">
              <SheetHeader className="pb-4">
                <SheetTitle>{editingProd ? 'Edit Product' : 'Add Chemical Product'}</SheetTitle>
                <SheetDescription>Fill in the product details for your chemical library.</SheetDescription>
              </SheetHeader>
              <div className="space-y-4 pb-6">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Product Name <span className="text-destructive">*</span></label>
                  <Input placeholder="e.g. RoundUp Pro Concentrate" value={prodForm.name} onChange={e => setProdForm(f => ({ ...f, name: e.target.value }))} />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">EPA Reg #</label>
                    <Input placeholder="524-343" value={prodForm.epaRegNumber} onChange={e => setProdForm(f => ({ ...f, epaRegNumber: e.target.value }))} />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">Signal Word</label>
                    <Select value={prodForm.signalWord} onValueChange={v => setProdForm(f => ({ ...f, signalWord: v }))}>
                      <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">None</SelectItem>
                        <SelectItem value="CAUTION">CAUTION</SelectItem>
                        <SelectItem value="WARNING">WARNING</SelectItem>
                        <SelectItem value="DANGER">DANGER</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Active Ingredients</label>
                  <Input placeholder="e.g. Glyphosate 41%" value={prodForm.activeIngredients} onChange={e => setProdForm(f => ({ ...f, activeIngredients: e.target.value }))} />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">Unit</label>
                    <Select value={prodForm.unit} onValueChange={v => setProdForm(f => ({ ...f, unit: v }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="oz">oz</SelectItem>
                        <SelectItem value="fl oz">fl oz</SelectItem>
                        <SelectItem value="lb">lb</SelectItem>
                        <SelectItem value="gal">gal</SelectItem>
                        <SelectItem value="l">L</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">PHI (days)</label>
                    <Input type="number" min={0} placeholder="0" value={prodForm.phi} onChange={e => setProdForm(f => ({ ...f, phi: e.target.value }))} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">Rainfast hours</label>
                    <p className="text-xs text-muted-foreground">Hours until rain won't affect the application</p>
                    <Input type="number" min={0} step="0.5" placeholder="e.g. 2" value={prodForm.rainfastHours} onChange={e => setProdForm(f => ({ ...f, rainfastHours: e.target.value }))} />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">Re-entry interval (hrs)</label>
                    <p className="text-xs text-muted-foreground">Hours people must stay out after application</p>
                    <Input type="number" min={0} placeholder="4" value={prodForm.rei} onChange={e => setProdForm(f => ({ ...f, rei: e.target.value }))} />
                  </div>
                </div>
                <div className="space-y-1.5">
                   <label className="text-sm font-medium">External label / SDS URL</label>
                  <Input placeholder="https://…" value={prodForm.labelSdsUrl} onChange={e => setProdForm(f => ({ ...f, labelSdsUrl: e.target.value }))} />
                   <p className="text-xs text-muted-foreground">This is an external link, not an uploaded safety sheet.</p>
                </div>
                {editingProd ? (
                  <div className="space-y-1">
                    <Button variant="outline" className="gap-2" onClick={() => { setProdFormOpen(false); setSafetyProd(editingProd); }}>
                      <FileText className="h-4 w-4" /> Manage Safety Sheets
                    </Button>
                    <p className="text-xs text-muted-foreground">Save changes above first; opening Safety Sheets closes this form.</p>
                  </div>
                ) : <p className="text-xs text-muted-foreground">Save the product first, then upload SDS or MSDS PDFs in Safety Sheets.</p>}
                <Separator />
                <div className="flex gap-3 justify-end">
                  <Button variant="outline" onClick={() => setProdFormOpen(false)}>Cancel</Button>
                  <Button onClick={saveProd} disabled={createChemProduct.isPending || updateChemProduct.isPending}>
                    {editingProd ? 'Save Changes' : 'Add Product'}
                  </Button>
                </div>
              </div>
            </SheetContent>
          </Sheet>
          {safetyProd && <ChemicalSafetySheets key={safetyProd.id} product={safetyProd} canManage={canManageOffice} onClose={() => setSafetyProd(null)} />}
        </TabsContent>

        {/* ── Mixtures tab ─────────────────────────────────────────────────── */}
        <TabsContent value="mixtures" className="focus-visible:outline-none">
          <Card>
            <CardHeader className="flex flex-row items-start justify-between pb-2">
              <div>
                <CardTitle>Tank Mixtures</CardTitle>
                <CardDescription>Named mixes (e.g. "Broadleaf Control Mix") that auto-expand to per-product breakdown when applied.</CardDescription>
              </div>
              <Button size="sm" className="gap-2 ml-4 shrink-0" onClick={openAddMix}>
                <Plus className="w-4 h-4" /> Add Mixture
              </Button>
            </CardHeader>
            <CardContent className="p-0">
              {(chemMixtures ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground px-6 py-4">No mixtures yet. Create a mixture to let field staff log complex applications as a single entry.</p>
              ) : (
                <div className="divide-y">
                  {(chemMixtures ?? []).map(m => (
                    <div key={m.id} className={`px-6 py-3 ${!m.isActive ? 'opacity-50' : ''}`}>
                      <div className="flex items-start gap-4">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-sm">{m.name}</span>
                            {!m.isActive && <Badge variant="outline" className="text-[10px] px-1.5">Inactive</Badge>}
                          </div>
                          {m.description && <p className="text-xs text-muted-foreground mt-0.5">{m.description}</p>}
                          {m.items.length > 0 && (
                            <div className="mt-1.5 space-y-0.5">
                              {m.items.map((item: ChemicalMixtureItem) => (
                                <p key={item.id} className="text-xs text-muted-foreground">
                                  {item.productName ?? `Product #${item.productId}`}: {item.ratioAmount} {item.ratioUnit} per gal
                                </p>
                              ))}
                            </div>
                          )}
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <Button variant="ghost" size="icon" className="w-7 h-7" onClick={() => openEditMix(m)}>
                            <Pencil className="w-3.5 h-3.5" />
                          </Button>
                          <Button variant="ghost" size="icon" className="w-7 h-7 text-muted-foreground hover:text-destructive" onClick={() => {
                            deleteChemMixture.mutate({ id: m.id }, {
                              onSuccess: () => { toast.success('Mixture deleted'); qc.invalidateQueries({ queryKey: getListChemicalMixturesQueryKey() }); },
                              onError: () => toast.error('Failed to delete'),
                            });
                          }}>
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Mixture Form Sheet */}
          <Sheet open={mixFormOpen} onOpenChange={open => { if (!open) { setMixFormOpen(false); setEditingMix(null); } }}>
            <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
              <SheetHeader className="pb-4">
                <SheetTitle>{editingMix ? 'Edit Mixture' : 'Add Tank Mixture'}</SheetTitle>
                <SheetDescription>Define a named mix by specifying how much of each product goes into a gallon of solution.</SheetDescription>
              </SheetHeader>
              <div className="space-y-4 pb-6">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Mixture Name <span className="text-destructive">*</span></label>
                  <Input placeholder="e.g. Broadleaf Control Mix" value={mixForm.name} onChange={e => setMixForm(f => ({ ...f, name: e.target.value }))} />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Description</label>
                  <Input placeholder="What is this mixture used for?" value={mixForm.description} onChange={e => setMixForm(f => ({ ...f, description: e.target.value }))} />
                </div>
                <Separator />
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium">Products in this mixture</p>
                  <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={() => setMixItems(items => [...items, { productId: '', ratioAmount: '', ratioUnit: 'oz' }])}>
                    <Plus className="w-3 h-3" /> Add Product
                  </Button>
                </div>
                {mixItems.length === 0 && <p className="text-sm text-muted-foreground">Add at least one product to define the mixture ratio.</p>}
                <div className="space-y-3">
                  {mixItems.map((item, i) => (
                    <div key={i} className="flex gap-2 items-end">
                      <div className="flex-1 space-y-1">
                        <label className="text-xs text-muted-foreground">Product</label>
                        <Select value={item.productId} onValueChange={v => setMixItems(items => items.map((x, j) => j === i ? { ...x, productId: v } : x))}>
                          <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="Select…" /></SelectTrigger>
                          <SelectContent>
                            {(chemProducts ?? []).filter(p => p.isActive).map(p => (
                              <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="w-20 space-y-1">
                        <label className="text-xs text-muted-foreground">Amount</label>
                        <Input className="h-8 text-sm" type="number" min={0} step={0.1} placeholder="2" value={item.ratioAmount} onChange={e => setMixItems(items => items.map((x, j) => j === i ? { ...x, ratioAmount: e.target.value } : x))} />
                      </div>
                      <div className="w-24 space-y-1">
                        <label className="text-xs text-muted-foreground">Unit/gal</label>
                        <Select value={item.ratioUnit} onValueChange={v => setMixItems(items => items.map((x, j) => j === i ? { ...x, ratioUnit: v } : x))}>
                          <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="oz">oz</SelectItem>
                            <SelectItem value="fl oz">fl oz</SelectItem>
                            <SelectItem value="lb">lb</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive mb-0.5" onClick={() => setMixItems(items => items.filter((_, j) => j !== i))}>
                        <X className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  ))}
                </div>
                <Separator />
                <div className="flex gap-3 justify-end">
                  <Button variant="outline" onClick={() => setMixFormOpen(false)}>Cancel</Button>
                  <Button onClick={saveMix} disabled={createChemMixture.isPending || updateChemMixture.isPending}>
                    {editingMix ? 'Save Changes' : 'Create Mixture'}
                  </Button>
                </div>
              </div>
            </SheetContent>
          </Sheet>
        </TabsContent>

        {canManageOffice && (
          <TabsContent value="required-information" className="space-y-4 focus-visible:outline-none">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <ShieldCheck className="h-5 w-5 text-emerald-600" />
                  Required Chemical Record Information
                </CardTitle>
                <CardDescription>
                  Choose what staff must complete before a new chemical application can be saved. These changes do not affect existing records.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="rounded-lg border border-emerald-200 bg-emerald-50/70 p-4">
                  <p className="text-sm font-semibold text-emerald-900">Always required</p>
                  <p className="mt-1 text-xs text-emerald-800">
                    Product or tank mixture, amount applied, amount unit, and application date/time are the minimum information for every new record.
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {['Product or mixture', 'Amount applied', 'Amount unit', 'Application date/time'].map(label => (
                      <Badge key={label} variant="outline" className="border-emerald-300 bg-white text-emerald-800">
                        {label}
                      </Badge>
                    ))}
                  </div>
                </div>

                {requirementsLoading ? (
                  <p className="py-6 text-center text-sm text-muted-foreground">Loading requirements…</p>
                ) : (
                  <div className="space-y-5">
                    {CHEMICAL_REQUIREMENT_GROUPS.map(group => (
                      <section key={group.title} className="space-y-2">
                        <div>
                          <h3 className="text-sm font-semibold">{group.title}</h3>
                          <p className="text-xs text-muted-foreground">{group.description}</p>
                        </div>
                        <div className="divide-y rounded-lg border">
                          {group.fields.map(field => (
                            <div key={field.key} className="flex items-center justify-between gap-5 px-4 py-3">
                              <div className="min-w-0">
                                <label htmlFor={`chemical-requirement-${field.key}`} className="text-sm font-medium">
                                  {field.label}
                                </label>
                                <p className="text-xs text-muted-foreground">{field.description}</p>
                              </div>
                              <div className="flex shrink-0 items-center gap-2">
                                <span className="text-xs font-medium text-muted-foreground">
                                  {chemicalRequirements[field.key] ? 'Required' : 'Optional'}
                                </span>
                                <Switch
                                  id={`chemical-requirement-${field.key}`}
                                  checked={chemicalRequirements[field.key]}
                                  onCheckedChange={() => toggleChemicalRequirement(field.key)}
                                  aria-label={`Make ${field.label.toLowerCase()} required`}
                                />
                              </div>
                            </div>
                          ))}
                        </div>
                      </section>
                    ))}
                  </div>
                )}

                <div className="flex justify-end border-t pt-4">
                  <Button
                    onClick={saveChemicalRequirements}
                    disabled={requirementsLoading || updateTenantSettings.isPending}
                    className="gap-2"
                  >
                    <Save className="h-4 w-4" />
                    {updateTenantSettings.isPending ? 'Saving…' : 'Save Required Information'}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
