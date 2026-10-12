import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Monitor, Printer } from 'lucide-react';

/**
 * Read-only preview of a document as the customer sees it online and as the
 * printed copy. Contains no send, approve or pay actions.
 */
export function DocumentPreviewDialog({ open, onClose, title, description, customerView, printDocument }: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  customerView: React.ReactNode;
  printDocument: string;
}) {
  const [view, setView] = useState<'customer' | 'print'>('customer');

  const openPrint = () => {
    const win = window.open('', '_blank', 'width=860,height=750');
    if (!win) return;
    win.document.write(printDocument);
    win.document.close();
    win.onload = () => { win.focus(); win.print(); };
  };

  return (
    <Dialog open={open} onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="max-w-3xl max-h-[92vh] overflow-hidden flex flex-col p-0 gap-0">
        <DialogHeader className="px-5 pt-5 pb-3 border-b">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description ?? 'Read-only preview. Nothing is sent from here.'}</DialogDescription>
        </DialogHeader>
        <Tabs value={view} onValueChange={v => setView(v as 'customer' | 'print')} className="flex-1 min-h-0 flex flex-col">
          <div className="flex items-center justify-between gap-2 px-5 py-2 border-b">
            <TabsList className="h-8">
              <TabsTrigger value="customer" className="text-xs gap-1.5"><Monitor className="w-3.5 h-3.5" />Customer view</TabsTrigger>
              <TabsTrigger value="print" className="text-xs gap-1.5"><Printer className="w-3.5 h-3.5" />Printed copy</TabsTrigger>
            </TabsList>
            {view === 'print' && (
              <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs" onClick={openPrint}>
                <Printer className="w-3.5 h-3.5" /> Print / Save PDF
              </Button>
            )}
          </div>
          <TabsContent value="customer" className="flex-1 min-h-0 overflow-y-auto m-0 focus-visible:outline-none">
            <div className="pointer-events-auto">{customerView}</div>
          </TabsContent>
          <TabsContent value="print" className="flex-1 min-h-0 m-0 bg-muted/40 p-4 focus-visible:outline-none">
            <iframe
              title="Printed copy preview"
              srcDoc={printDocument}
              sandbox="allow-same-origin"
              className="w-full h-[68vh] rounded-md border bg-card shadow-sm"
            />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
