import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Monitor, Printer } from 'lucide-react';
import { DocumentPreviewDialog, type PreviewView } from './DocumentPreviewDialog';

/**
 * Two always-visible buttons, "Customer Preview" and "Print Preview", that open
 * the read-only preview dialog on the matching view. Content is built lazily
 * from the caller's current (possibly unsaved) state each time it opens.
 */
export function PreviewActions({ title, description, sampleNotice, renderCustomerView, buildPrintDocument, size = 'sm', className, disabled, testIdPrefix = 'preview' }: {
  title: string;
  description?: string;
  sampleNotice?: string;
  renderCustomerView: () => React.ReactNode;
  buildPrintDocument: () => string;
  size?: 'sm' | 'default';
  className?: string;
  disabled?: boolean;
  testIdPrefix?: string;
}) {
  const [view, setView] = useState<PreviewView | null>(null);
  return (
    <>
      <div className={`flex flex-wrap items-center gap-2 ${className ?? ''}`}>
        <Button type="button" size={size} variant="outline" className="gap-1.5 border-primary/40 text-primary hover:bg-primary/5" onClick={() => setView('customer')} disabled={disabled} data-testid={`${testIdPrefix}-customer`}>
          <Monitor className="w-3.5 h-3.5" /> Customer Preview
        </Button>
        <Button type="button" size={size} variant="outline" className="gap-1.5 border-primary/40 text-primary hover:bg-primary/5" onClick={() => setView('print')} disabled={disabled} data-testid={`${testIdPrefix}-print`}>
          <Printer className="w-3.5 h-3.5" /> Print Preview
        </Button>
      </div>
      {view && (
        <DocumentPreviewDialog
          open
          initialView={view}
          onClose={() => setView(null)}
          title={title}
          description={description}
          sampleNotice={sampleNotice}
          customerView={renderCustomerView()}
          printDocument={buildPrintDocument()}
        />
      )}
    </>
  );
}

export const SAMPLE_NOTICE = 'Template preview with a sample customer. Not saved and not sent.';
