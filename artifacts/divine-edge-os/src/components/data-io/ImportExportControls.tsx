import React, { useRef, useState } from 'react';
import {
  exportEntity,
  usePreviewEntityImport,
  useCommitEntityImport,
  type ImportExportEntity,
  type ImportPreviewResult,
  type ImportCommitResult,
} from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Download, Upload, FileSpreadsheet, AlertTriangle, CheckCircle2, Loader2, History } from 'lucide-react';
import { toast } from 'sonner';
import { ImportHistoryDialog } from './ImportHistoryDialog';
import { cn } from '@/lib/utils';

interface ImportExportControlsProps {
  entity: ImportExportEntity;
  entityLabel: string;
  /** Filters mirroring the current list view; passed through to the export endpoint. */
  exportQuery?: Record<string, string | undefined>;
  onImportComplete?: () => void;
}

type WizardStep = 'upload' | 'mapping' | 'result';
const columnKey = (index: number) => `__column_${index}`;

export function ImportExportControls({ entity, entityLabel, exportQuery = {}, onImportComplete }: ImportExportControlsProps) {
  const [exporting, setExporting] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [step, setStep] = useState<WizardStep>('upload');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportPreviewResult | null>(null);
  const [mapping, setMapping] = useState<Record<string, string | null>>({});
  const [result, setResult] = useState<ImportCommitResult | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const previewImport = usePreviewEntityImport();
  const commitImport = useCommitEntityImport();

  const handleExport = async (format: 'csv' | 'xlsx') => {
    setExporting(true);
    try {
      await exportEntity(entity, format, exportQuery);
      toast.success(`Exported ${entityLabel.toLowerCase()} as ${format.toUpperCase()}`);
    } catch (err) {
      toast.error(`Failed to export ${entityLabel.toLowerCase()}`);
    } finally {
      setExporting(false);
    }
  };

  const resetWizard = () => {
    setStep('upload');
    setFile(null);
    setPreview(null);
    setMapping({});
    setResult(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const openWizard = () => {
    resetWizard();
    setWizardOpen(true);
  };

  const handleFileSelected = (selected: File) => {
    setFile(selected);
    previewImport.mutate(
      { entity, file: selected },
      {
        onSuccess: (data) => {
          setPreview(data);
          setMapping(Object.fromEntries(
            Object.entries(data.suggestedMapping).map(([fieldKey, header]) => {
              const index = header == null ? -1 : data.headers.indexOf(header);
              return [fieldKey, index >= 0 ? columnKey(index) : null];
            }),
          ));
          setStep('mapping');
        },
        onError: () => toast.error('Could not read that file. Make sure it is a CSV or XLSX file.'),
      },
    );
  };

  const handleCommit = () => {
    if (!file) return;
    commitImport.mutate(
      { entity, file, mapping },
      {
        onSuccess: (data) => {
          setResult(data);
          setStep('result');
          onImportComplete?.();
        },
        onError: () => toast.error('Import failed. Please check the file and try again.'),
      },
    );
  };

  const requiredFields = preview?.fields.filter((f) => f.required) || [];
  const isFieldMapped = (fieldKey: string) => Boolean(mapping[fieldKey] && mapping[fieldKey] !== '__none__');
  const usesFlexibleCustomerName = entity === 'customers'
    && Boolean(preview?.fields.some((field) => field.key === 'firstName'));
  const customerNameMapped = !usesFlexibleCustomerName
    || isFieldMapped('name')
    || (isFieldMapped('firstName') && isFieldMapped('lastName'));
  const mappedStandardRequiredCount = requiredFields.filter((field) => isFieldMapped(field.key)).length;
  const requiredRequirementCount = requiredFields.length;
  const mappedRequiredCount = mappedStandardRequiredCount;
  const allRequiredMapped = mappedRequiredCount === requiredRequirementCount;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" className="gap-2" title="Export data as CSV or Excel" disabled={exporting} data-testid="button-export">
            {exporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            Export
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => handleExport('csv')} data-testid="menuitem-export-csv">Export as CSV</DropdownMenuItem>
          <DropdownMenuItem onClick={() => handleExport('xlsx')} data-testid="menuitem-export-xlsx">Export as Excel (.xlsx)</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Button variant="outline" className="gap-2" title="Import records from a CSV or Excel file" onClick={openWizard} data-testid="button-import">
        <Upload className="w-4 h-4" /> Import
      </Button>

      <Button variant="outline" className="gap-2" title="View previous import batches and undo them if needed" onClick={() => setHistoryOpen(true)} data-testid="button-import-history">
        <History className="w-4 h-4" /> Import History
      </Button>

      <ImportHistoryDialog
        entity={entity}
        entityLabel={entityLabel}
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        onRolledBack={onImportComplete}
      />

      <Dialog open={wizardOpen} onOpenChange={setWizardOpen}>
        <DialogContent className="sm:max-w-[90vw] md:max-w-4xl lg:max-w-6xl h-[90vh] md:h-[85vh] p-0 flex flex-col overflow-hidden gap-0 bg-background" data-testid="dialog-import-wizard">
          <div className="px-8 py-6 shrink-0 border-b">
            <DialogHeader>
              <DialogTitle className="text-2xl">Import {entityLabel}</DialogTitle>
              <DialogDescription className="text-base mt-2">
                {step === 'upload' && `Upload a CSV or Excel file with ${entityLabel.toLowerCase()} records to begin.`}
                {step === 'mapping' && 'Match the columns from your uploaded file to the corresponding system fields.'}
                {step === 'result' && 'Import process complete. Review the summary below.'}
              </DialogDescription>
            </DialogHeader>
          </div>

          <div className="flex-1 overflow-y-auto bg-muted/10">
            {step === 'upload' && (
              <div className="h-full flex items-center justify-center p-8">
                <div
                  className={cn(
                    "border-2 border-dashed rounded-2xl p-16 w-full max-w-2xl text-center cursor-pointer transition-all duration-200 flex flex-col items-center justify-center bg-background shadow-sm hover:shadow-md",
                    previewImport.isPending ? "border-primary/50 opacity-70 pointer-events-none" : "border-muted-foreground/20 hover:border-primary/50 hover:bg-muted/5"
                  )}
                  onClick={() => fileInputRef.current?.click()}
                  data-testid="dropzone-upload"
                >
                  <div className="w-20 h-20 bg-muted/30 border rounded-full flex items-center justify-center mb-6">
                    {previewImport.isPending ? (
                      <Loader2 className="w-10 h-10 text-primary animate-spin" />
                    ) : (
                      <FileSpreadsheet className="w-10 h-10 text-muted-foreground" />
                    )}
                  </div>
                  <h3 className="text-2xl font-semibold mb-3">
                    {previewImport.isPending ? "Reading file..." : "Upload your spreadsheet"}
                  </h3>
                  <p className="text-muted-foreground text-lg max-w-md mx-auto mb-8">
                    Select a CSV or Excel (.xlsx) file containing {entityLabel.toLowerCase()} records. Maximum file size is 10MB.
                  </p>
                  <Button variant="secondary" size="lg" disabled={previewImport.isPending} className="pointer-events-none text-base px-8 h-12">
                    Choose File
                  </Button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".csv,.xlsx"
                    className="hidden"
                    data-testid="input-file-upload"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) handleFileSelected(f);
                    }}
                  />
                </div>
              </div>
            )}

            {step === 'mapping' && preview && (
              <div className="p-8 max-w-6xl mx-auto w-full">
                <div className="flex flex-col md:flex-row items-start md:items-center justify-between bg-background p-5 rounded-xl border shadow-sm mb-6 gap-4" data-testid="mapping-summary">
                  <div className="flex items-center gap-4">
                    <div className="w-14 h-14 bg-primary/10 rounded-xl flex items-center justify-center shrink-0">
                      <FileSpreadsheet className="w-7 h-7 text-primary" />
                    </div>
                    <div>
                      <h4 className="font-semibold text-lg">{file?.name}</h4>
                      <p className="text-sm text-muted-foreground flex items-center gap-1.5 mt-1">
                        <span className="font-medium text-foreground">{preview.totalRows.toLocaleString()}</span> records detected
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-6 md:text-right">
                    <div>
                      <div className="text-sm font-semibold flex items-center md:justify-end gap-2 mb-1.5">
                        {allRequiredMapped ? (
                          <span className="text-emerald-600 dark:text-emerald-500 flex items-center gap-1.5">
                            <CheckCircle2 className="w-4 h-4" /> All required fields mapped
                          </span>
                        ) : (
                          <span className="text-destructive flex items-center gap-1.5">
                            <AlertTriangle className="w-4 h-4" /> Action required
                          </span>
                        )}
                      </div>
                      <div className="text-sm text-muted-foreground">
                        <span className={cn("font-medium", !allRequiredMapped ? "text-foreground" : "")}>{mappedRequiredCount}</span> of {requiredRequirementCount} required fields matched
                      </div>
                    </div>
                  </div>
                </div>

                {usesFlexibleCustomerName && (
                  <div
                    className={cn(
                      "mb-6 rounded-xl border px-5 py-4 text-sm",
                      customerNameMapped
                        ? "border-emerald-500/30 bg-emerald-500/5"
                        : "border-amber-500/40 bg-amber-500/10",
                    )}
                    data-testid="status-customer-name-mapping"
                  >
                    <div className="font-semibold">
                      {customerNameMapped ? "Customer name columns are ready" : "Customer names are optional for historical imports"}
                    </div>
                    <div className="mt-1 text-muted-foreground">
                      Map <span className="font-medium text-foreground">Name</span>, or map both <span className="font-medium text-foreground">First Name</span> and <span className="font-medium text-foreground">Last Name</span>. Separate names will be joined automatically. If no name is available, the company name or an “Imported Customer” label will be used.
                    </div>
                  </div>
                )}

                <div className="border rounded-xl bg-background shadow-sm overflow-hidden">
                  <Table className="border-b" data-testid="table-mapping">
                    <TableHeader className="sticky top-0 bg-background/95 backdrop-blur z-10 shadow-[0_1px_0_0_hsl(var(--border))]">
                      <TableRow className="hover:bg-transparent">
                        <TableHead className="w-[30%] font-semibold text-sm">Target Field</TableHead>
                        <TableHead className="w-[30%] font-semibold text-sm">Column in File</TableHead>
                        <TableHead className="w-[40%] font-semibold text-sm">Sample Data from File</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {preview.fields.map((field) => {
                        const mappedVal = mapping[field.key] ?? '__none__';
                        const isMapped = mappedVal !== '__none__';
                        const isMissingRequired = field.required && !isMapped;

                        let headerName = '';
                        if (isMapped) {
                          const idx = parseInt(mappedVal.replace('__column_', ''), 10);
                          headerName = preview.headers[idx];
                        }

                        const samples = headerName
                          ? preview.sampleRows.map(r => r[headerName]).filter(v => v !== null && v !== undefined && v !== '')
                          : [];

                        return (
                          <TableRow
                            key={field.key}
                            className={cn("group transition-colors", isMissingRequired && "bg-destructive/5 hover:bg-destructive/10")}
                            data-testid={`row-mapping-${field.key}`}
                          >
                            <TableCell className="align-top py-5">
                              <div className="flex items-center gap-2 mb-1.5">
                                <span className="font-semibold text-base">{field.header}</span>
                                {field.required && (
                                  <Badge
                                    variant={isMissingRequired ? "destructive" : "secondary"}
                                    className="text-[10px] uppercase tracking-wider py-0 px-1.5 h-4.5 font-bold"
                                    data-testid={`badge-required-${field.key}`}
                                  >
                                    Required
                                  </Badge>
                                )}
                              </div>
                              {field.hint && <div className="text-sm text-muted-foreground leading-relaxed pr-6">{field.hint}</div>}
                            </TableCell>
                            <TableCell className="align-top py-5">
                              <Select
                                value={mappedVal}
                                onValueChange={(v) => setMapping((m) => ({ ...m, [field.key]: v === '__none__' ? null : v }))}
                              >
                                <SelectTrigger
                                  className={cn("w-full bg-background transition-colors h-11 text-base", isMissingRequired && "border-destructive/40 focus:ring-destructive/30 ring-1 ring-destructive/10")}
                                  data-testid={`select-mapping-${field.key}`}
                                >
                                  <SelectValue placeholder="Do not import" />
                                </SelectTrigger>
                                <SelectContent className="max-h-[350px]">
                                  <SelectItem value="__none__" className="text-muted-foreground italic font-medium">Do not import</SelectItem>
                                  {preview.headers.map((h, index) => (
                                    <SelectItem key={columnKey(index)} value={columnKey(index)} className="text-base py-2">
                                      {h || `Column ${index + 1}`}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </TableCell>
                            <TableCell className="align-top py-5">
                              {isMapped ? (
                                samples.length > 0 ? (
                                  <div className="flex flex-wrap gap-2">
                                    {samples.slice(0, 3).map((s, i) => (
                                      <span
                                        key={i}
                                        className="inline-flex items-center bg-muted/60 text-muted-foreground px-2.5 py-1 rounded-md text-sm border shadow-sm max-w-[220px] truncate"
                                        title={String(s)}
                                        data-testid={`badge-sample-${field.key}-${i}`}
                                      >
                                        {String(s)}
                                      </span>
                                    ))}
                                    {samples.length > 3 && (
                                      <span className="text-sm text-muted-foreground/70 self-center pl-1 font-medium">
                                        +{samples.length - 3} more
                                      </span>
                                    )}
                                  </div>
                                ) : (
                                  <span className="text-sm text-muted-foreground italic flex items-center h-11">Empty in sample rows</span>
                                )
                              ) : (
                                <span className="text-sm text-muted-foreground/50 italic flex items-center h-11">Select a column to preview data</span>
                              )}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              </div>
            )}

            {step === 'result' && result && (
              <div className="p-8 max-w-4xl mx-auto w-full py-12" data-testid="import-result-summary">
                <div className="flex flex-col items-center justify-center text-center mb-12">
                  {result.failed === 0 ? (
                    <div className="w-24 h-24 bg-emerald-100 dark:bg-emerald-900/40 rounded-full flex items-center justify-center mb-6 text-emerald-600 dark:text-emerald-500 shadow-sm ring-1 ring-emerald-600/20">
                      <CheckCircle2 className="w-12 h-12" />
                    </div>
                  ) : (
                    <div className="w-24 h-24 bg-amber-100 dark:bg-amber-900/40 rounded-full flex items-center justify-center mb-6 text-amber-600 dark:text-amber-500 shadow-sm ring-1 ring-amber-600/20">
                      <AlertTriangle className="w-12 h-12" />
                    </div>
                  )}
                  <h3 className="text-3xl font-bold mb-4 tracking-tight">
                    {result.failed === 0 ? 'Import Successful' : 'Import Complete with Errors'}
                  </h3>
                  <p className="text-lg text-muted-foreground max-w-lg mx-auto">
                    Processed {(result.created + result.updated + result.skipped + result.failed).toLocaleString()} rows from <span className="font-medium text-foreground">{file?.name}</span>.
                  </p>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-6 w-full max-w-3xl mx-auto">
                  <div className="rounded-2xl border bg-background p-6 shadow-sm text-center" data-testid="stat-created">
                    <div className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-2">Created</div>
                    <div className="text-4xl font-bold text-foreground">{result.created.toLocaleString()}</div>
                  </div>
                  <div className="rounded-2xl border bg-background p-6 shadow-sm text-center" data-testid="stat-updated">
                    <div className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-2">Updated</div>
                    <div className="text-4xl font-bold text-foreground">{result.updated.toLocaleString()}</div>
                  </div>
                  <div className="rounded-2xl border bg-background p-6 shadow-sm text-center" data-testid="stat-skipped">
                    <div className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-2">Skipped</div>
                    <div className="text-4xl font-bold text-foreground">{result.skipped.toLocaleString()}</div>
                  </div>
                  <div className={cn("rounded-2xl border bg-background p-6 shadow-sm text-center", result.failed > 0 && "border-destructive/40 bg-destructive/5 ring-1 ring-destructive/20")} data-testid="stat-failed">
                    <div className={cn("text-sm font-semibold uppercase tracking-wider mb-2", result.failed > 0 ? "text-destructive" : "text-muted-foreground")}>Failed</div>
                    <div className={cn("text-4xl font-bold", result.failed > 0 ? "text-destructive" : "text-foreground")}>{result.failed.toLocaleString()}</div>
                  </div>
                </div>

                {result.failed > 0 && (
                  <div className="mt-12 text-left max-w-3xl mx-auto">
                    <h4 className="font-semibold text-xl flex items-center gap-2.5 mb-5">
                      <AlertTriangle className="w-6 h-6 text-destructive" />
                      Error Details
                    </h4>
                    <div className="border rounded-xl bg-background shadow-sm overflow-hidden">
                      <div className="max-h-[400px] overflow-y-auto">
                        <Table data-testid="table-result-errors">
                          <TableHeader className="sticky top-0 bg-background/95 backdrop-blur z-10 shadow-[0_1px_0_0_hsl(var(--border))]">
                            <TableRow className="hover:bg-transparent">
                              <TableHead className="w-32 font-semibold text-sm">Row Number</TableHead>
                              <TableHead className="font-semibold text-sm">Issues Found</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {result.errors.map((e, idx) => (
                              <TableRow key={idx}>
                                <TableCell className="align-top py-4">
                                  <Badge variant="outline" className="font-mono bg-muted/40 font-medium px-2 py-1 text-sm">Row {e.row}</Badge>
                                </TableCell>
                                <TableCell className="align-top py-4 text-sm text-destructive font-medium leading-relaxed">
                                  {e.errors.join(' • ')}
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {(step === 'mapping' || step === 'result') && (
            <div className="px-8 py-5 shrink-0 border-t bg-background flex items-center justify-between shadow-[0_-1px_3px_rgba(0,0,0,0.02)]">
              {step === 'mapping' && (
                <>
                  <Button variant="ghost" size="lg" onClick={() => setStep('upload')} data-testid="button-mapping-back" className="text-base">
                    Back to upload
                  </Button>
                  <div className="flex items-center gap-6">
                    {!allRequiredMapped && (
                      <span className="text-sm font-medium text-destructive flex items-center gap-2">
                        <AlertTriangle className="w-4.5 h-4.5" />
                        Map all required fields
                      </span>
                    )}
                    <Button
                      size="lg"
                      onClick={handleCommit}
                      disabled={!allRequiredMapped || commitImport.isPending}
                      data-testid="button-mapping-commit"
                      className="min-w-[160px] text-base h-12"
                    >
                      {commitImport.isPending ? <Loader2 className="w-5 h-5 animate-spin mr-2" /> : null}
                      Import {preview?.totalRows.toLocaleString()} {preview?.totalRows === 1 ? 'record' : 'records'}
                    </Button>
                  </div>
                </>
              )}
              {step === 'result' && (
                <>
                  <div className="text-base text-muted-foreground">
                    You can always undo this batch later from <button type="button" className="underline font-medium hover:text-foreground transition-colors" onClick={() => { setWizardOpen(false); setHistoryOpen(true); }} data-testid="link-result-history">Import History</button>.
                  </div>
                  <Button size="lg" onClick={() => setWizardOpen(false)} data-testid="button-result-done" className="text-base h-12 px-8">Done</Button>
                </>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
