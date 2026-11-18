import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';

type Props = {
  file: File | null;
  fileUrl: string;
  fileType: string;
  fileName: string;
};

/** Shows the uploaded invoice beside the review form, with zoom and page changes. */
export function InvoiceFileView({ file, fileUrl, fileType, fileName }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const docRef = useRef<{ numPages: number; getPage: (page: number) => Promise<{ getViewport: (opts: { scale: number }) => { width: number; height: number }; render: (opts: { canvasContext: CanvasRenderingContext2D; viewport: { width: number; height: number } }) => { promise: Promise<void> } }> } | null>(null);
  const [page, setPage] = useState(1);
  const [pageCount, setPageCount] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [ready, setReady] = useState(0);
  const [error, setError] = useState('');

  useEffect(() => {
    setPage(1);
    setZoom(1);
    setError('');
    docRef.current = null;
    if (fileType !== 'pdf') {
      setPageCount(1);
      return;
    }
    let cancel = false;
    (async () => {
      try {
        const pdfjs = await import('pdfjs-dist');
        const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
        pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
        const bytes = file ? await file.arrayBuffer() : await fetch(fileUrl).then(response => {
          if (!response.ok) throw new Error('Could not open this PDF.');
          return response.arrayBuffer();
        });
        const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes) }).promise;
        if (cancel) return;
        docRef.current = doc;
        setPageCount(doc.numPages);
        setReady(value => value + 1);
      } catch (cause) {
        if (!cancel) setError(cause instanceof Error ? cause.message : 'Could not open this PDF.');
      }
    })();
    return () => { cancel = true; };
  }, [file, fileType, fileUrl]);

  useEffect(() => {
    if (fileType !== 'pdf') return;
    const doc = docRef.current;
    const canvas = canvasRef.current;
    const frame = frameRef.current;
    if (!doc || !canvas || !frame) return;
    let cancel = false;
    (async () => {
      const pdfPage = await doc.getPage(Math.min(page, doc.numPages));
      const base = pdfPage.getViewport({ scale: 1 });
      const fit = Math.max(0.4, ((frame.clientWidth || 640) - 16) / base.width);
      const viewport = pdfPage.getViewport({ scale: fit * zoom });
      if (cancel) return;
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      await pdfPage.render({ canvasContext: ctx, viewport }).promise;
    })().catch(() => {
      if (!cancel) setError('Could not draw this page.');
    });
    return () => { cancel = true; };
  }, [page, zoom, ready, fileType]);

  return (
    <div className="overflow-hidden rounded-lg border bg-muted/30">
      <div className="flex flex-wrap items-center gap-2 border-b bg-background p-2">
        <Button type="button" variant="outline" size="sm" data-testid="invoice-zoom-out" onClick={() => setZoom(value => Math.max(0.5, Math.round((value - 0.25) * 100) / 100))}>Zoom out</Button>
        <Button type="button" variant="outline" size="sm" data-testid="invoice-zoom-in" onClick={() => setZoom(value => Math.min(3, Math.round((value + 0.25) * 100) / 100))}>Zoom in</Button>
        <span className="text-xs text-muted-foreground" data-testid="invoice-zoom-level">{Math.round(zoom * 100)}%</span>
        <Button type="button" variant="outline" size="sm" data-testid="invoice-page-prev" disabled={page <= 1} onClick={() => setPage(value => Math.max(1, value - 1))}>Previous page</Button>
        <Button type="button" variant="outline" size="sm" data-testid="invoice-page-next" disabled={page >= pageCount} onClick={() => setPage(value => Math.min(pageCount, value + 1))}>Next page</Button>
        <span className="text-xs text-muted-foreground" data-testid="invoice-page-label">Page {page} of {pageCount}</span>
      </div>
      <div ref={frameRef} className="h-[68vh] overflow-auto p-2" data-testid="invoice-document">
        {error && <p className="text-sm text-red-700">{error}</p>}
        {fileType === 'pdf'
          ? <canvas ref={canvasRef} data-testid="invoice-canvas" className="mx-auto bg-white shadow" />
          : <img alt={fileName} src={fileUrl} data-testid="invoice-image" className="mx-auto bg-white shadow" style={{ width: `${Math.round(zoom * 100)}%`, maxWidth: 'none' }} />}
      </div>
    </div>
  );
}
