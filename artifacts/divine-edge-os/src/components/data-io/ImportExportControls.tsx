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
  DialogFooter,
} from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Download, Upload, FileSpreadsheet, AlertTriangle, CheckCircle2, Loader2, History } from 'lucide-react';
import { toast } from 'sonner';
import { ImportHistoryDialog } from './ImportHistoryDialog';

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

  const requiredFieldsMapped = preview
    ? preview.fields.filter((f) => f.required).every((f) => mapping[f.key])
    : false;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" className="gap-2" title="Export data as CSV or Excel" disabled={exporting}>
            {exporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            Export
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => handleExport('csv')}>Export as CSV</DropdownMenuItem>
          <DropdownMenuItem onClick={() => handleExport('xlsx')}>Export as Excel (.xlsx)</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Button variant="outline" className="gap-2" title="Import records from a CSV or Excel file" onClick={openWizard}>
        <Upload className="w-4 h-4" /> Import
      </Button>

      <Button variant="outline" className="gap-2" title="View previous import batches and undo them if needed" onClick={() => setHistoryOpen(true)}>
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
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Import {entityLabel}</DialogTitle>
            <DialogDescription>
              {step === 'upload' && `Upload a CSV or Excel file with ${entityLabel.toLowerCase()} data.`}
              {step === 'mapping' && 'Match each column in your file to the right field, then confirm.'}
              {step === 'result' && 'Import complete.'}
            </DialogDescription>
          </DialogHeader>

          {step === 'upload' && (
            <div
              className="border-2 border-dashed rounded-lg p-10 text-center cursor-pointer hover:border-primary/50 transition-colors"
              onClick={() => fileInputRef.current?.click()}
            >
              <FileSpreadsheet className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
              <p className="text-sm font-medium">Click to choose a file</p>
              <p className="text-xs text-muted-foreground mt-1">.csv or .xlsx, up to 10MB</p>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.xlsx"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleFileSelected(f);
                }}
              />
              {previewImport.isPending && (
                <p className="text-sm text-muted-foreground mt-4 flex items-center justify-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" /> Reading file...
                </p>
              )}
            </div>
          )}

          {step === 'mapping' && preview && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                {preview.totalRows} row{preview.totalRows === 1 ? '' : 's'} found in {file?.name}.
              </p>
              <div className="max-h-64 overflow-y-auto border rounded-md">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-1/3">Field</TableHead>
                      <TableHead>Column in your file</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {preview.fields.map((field) => (
                      <TableRow key={field.key}>
                        <TableCell>
                          <div className="font-medium text-sm">
                            {field.header}
                            {field.required && <span className="text-destructive ml-1">*</span>}
                          </div>
                          {field.hint && <div className="text-xs text-muted-foreground">{field.hint}</div>}
                        </TableCell>
                        <TableCell>
                          <Select
                            value={mapping[field.key] ?? '__none__'}
                            onValueChange={(v) => setMapping((m) => ({ ...m, [field.key]: v === '__none__' ? null : v }))}
                          >
                            <SelectTrigger title="Choose which CSV column maps to this field" className="w-full">
                              <SelectValue placeholder="Not mapped" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="__none__">Don't import</SelectItem>
                               {preview.headers.map((h, index) => (
                                 <SelectItem key={columnKey(index)} value={columnKey(index)}>
                                   {h || `Column ${index + 1}`}
                                 </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {preview.sampleRows.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-1">Preview (first {preview.sampleRows.length} rows)</p>
                  <div className="max-h-40 overflow-auto border rounded-md text-xs">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          {preview.headers.map((h) => <TableHead key={h}>{h}</TableHead>)}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {preview.sampleRows.map((row, i) => (
                          <TableRow key={i}>
                            {preview.headers.map((h) => <TableCell key={h}>{row[h]}</TableCell>)}
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              )}

              {!requiredFieldsMapped && (
                <p className="text-xs text-destructive flex items-center gap-1">
                  <AlertTriangle className="w-3.5 h-3.5" /> Map all required fields to continue.
                </p>
              )}
            </div>
          )}

          {step === 'result' && result && (
            <div className="space-y-4">
              <div className="grid grid-cols-4 gap-3 text-center">
                <div className="rounded-lg border p-3">
                  <div className="text-2xl font-bold">{result.created}</div>
                  <div className="text-xs text-muted-foreground">Created</div>
                </div>
                <div className="rounded-lg border p-3">
                  <div className="text-2xl font-bold">{result.updated}</div>
                  <div className="text-xs text-muted-foreground">Updated</div>
                </div>
                <div className="rounded-lg border p-3">
                  <div className="text-2xl font-bold">{result.skipped}</div>
                  <div className="text-xs text-muted-foreground">Skipped</div>
                </div>
                <div className="rounded-lg border p-3">
                  <div className="text-2xl font-bold text-destructive">{result.failed}</div>
                  <div className="text-xs text-muted-foreground">Failed</div>
                </div>
              </div>

              <p className="text-xs text-muted-foreground">
                Import #{result.batchId} — made a mistake? Undo it anytime from{' '}
                <button type="button" title="View all past imports and undo options" className="underline underline-offset-2" onClick={() => { setWizardOpen(false); setHistoryOpen(true); }}>
                  Import History
                </button>.
              </p>

              {result.failed === 0 ? (
                <p className="text-sm text-emerald-600 flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4" /> All rows processed successfully.
                </p>
              ) : (
                <div className="max-h-48 overflow-y-auto border rounded-md">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-16">Row</TableHead>
                        <TableHead>Errors</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {result.errors.map((e) => (
                        <TableRow key={e.row}>
                          <TableCell><Badge variant="destructive">{e.row}</Badge></TableCell>
                          <TableCell className="text-xs">{e.errors.join('; ')}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            {step === 'mapping' && (
              <>
                <Button variant="outline" title="Go back to re-upload the file" onClick={() => setStep('upload')}>Back</Button>
                <Button title="Commit the import using the current field mapping" onClick={handleCommit} disabled={!requiredFieldsMapped || commitImport.isPending}>
                  {commitImport.isPending && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
                  Import {preview?.totalRows} row{preview?.totalRows === 1 ? '' : 's'}
                </Button>
              </>
            )}
            {step === 'result' && (
              <Button title="Close this dialog" onClick={() => setWizardOpen(false)}>Done</Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
