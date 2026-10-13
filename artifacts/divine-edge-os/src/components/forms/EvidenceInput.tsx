import { useEffect, useRef, useState } from 'react';
import { customFetch } from '@workspace/api-client-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import type { EvidenceAnswer } from '@/lib/jobForms';

export interface EvidenceTarget { scope: 'job' | 'assignment' | 'employee'; scopeId: number; employeeId?: number }
export function EvidencePreview({ value }: { value: EvidenceAnswer }) {
  const [url, setUrl] = useState('');
  const [error, setError] = useState(false);
  useEffect(() => {
    let active = true, objectUrl = '';
    setUrl(''); setError(false);
    customFetch<Blob>(`/api/form-evidence/${value.evidenceId}`, { responseType: 'blob' })
      .then(blob => { if (active) { objectUrl = URL.createObjectURL(blob); setUrl(objectUrl); } })
      .catch(() => { if (active) setError(true); });
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [value.evidenceId]);
  return <div className="space-y-1">
    {url ? <a href={url} target="_blank" rel="noreferrer"><img src={url} alt={value.kind === 'signature' ? 'Submitted signature' : 'Submitted photo'} className="max-h-48 rounded border bg-white" /></a> : <p className="text-xs text-muted-foreground">{error ? 'Could not load evidence. Reopen the form to retry.' : 'Loading evidence…'}</p>}
    <p className="text-xs text-muted-foreground">{value.fileName ?? 'Image evidence'}{value.actorId ? ` · Uploaded by staff #${value.actorId}` : ''}{value.capturedAt ? ` · ${new Date(value.capturedAt).toLocaleString()}` : ''}</p>
  </div>;
}
export function EvidenceInput({ kind, fieldId, target, value, onChange, disabled, onUploading }: {
  kind: 'photo' | 'signature'; fieldId: string; target?: EvidenceTarget; value?: EvidenceAnswer | null;
  onChange: (value: EvidenceAnswer | null) => void; disabled?: boolean;
  onUploading?: (delta: number) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [ink, setInk] = useState(false);
  const [busy, setBusy] = useState(false);
  const upload = async (file: File) => {
    if (!target) { toast.error('Open an assigned form to upload evidence'); return; }
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 10 * 1024 * 1024) { toast.error('Choose a PNG, JPG, or WebP image up to 10 MB'); return; }
    setBusy(true);
    onUploading?.(1);
    try {
      const request = await customFetch<{ evidenceId: number; uploadURL: string }>('/api/form-evidence/uploads', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...target, fieldId, fileName: file.name, mimeType: file.type }) });
      const result = await fetch(request.uploadURL, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file });
      if (!result.ok) throw new Error('Image upload failed');
      const evidence = await customFetch<EvidenceAnswer>(`/api/form-evidence/${request.evidenceId}/finalize`, { method: 'POST' });
      onChange(evidence);
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not upload evidence'); }
    finally { setBusy(false); onUploading?.(-1); }
  };
  return <div className="space-y-2">
    {value && <EvidencePreview value={value} />}
    {kind === 'signature' && <p className="text-xs text-muted-foreground">A signature records the mark and question shown. It does not automatically mean agreement or legal certification.</p>}
    {!disabled && target && <>
      {kind === 'signature' && <>
        <canvas ref={canvas} width={600} height={180} aria-label="Draw signature" className="w-full max-w-xl h-[180px] border rounded bg-white touch-none"
          onPointerDown={e => { if (busy) return; e.currentTarget.setPointerCapture(e.pointerId); drawing.current = true; const r = e.currentTarget.getBoundingClientRect(); const ctx = e.currentTarget.getContext('2d')!; ctx.beginPath(); ctx.moveTo((e.clientX-r.left)*600/r.width,(e.clientY-r.top)*180/r.height); }}
          onPointerMove={e => { if (!drawing.current) return; const r=e.currentTarget.getBoundingClientRect(),ctx=e.currentTarget.getContext('2d')!; ctx.lineWidth=3; ctx.strokeStyle='#111'; ctx.lineCap='round'; ctx.lineTo((e.clientX-r.left)*600/r.width,(e.clientY-r.top)*180/r.height); ctx.stroke(); setInk(true); }}
          onPointerUp={() => { drawing.current=false; }} onPointerCancel={() => { drawing.current=false; }} />
        <div className="flex gap-2"><Button type="button" variant="outline" disabled={busy} onClick={() => { canvas.current?.getContext('2d')?.clearRect(0,0,600,180); setInk(false); }}>Clear drawing</Button>
          <Button type="button" disabled={!ink || busy} onClick={() => canvas.current?.toBlob(blob => { if(blob) void upload(new File([blob],'signature.png',{type:'image/png'})); })}>{busy ? 'Uploading…' : 'Save signature image'}</Button></div>
      </>}
      <label className="block text-sm">{kind === 'signature' ? 'Or upload a signature image' : 'Attach photo'}
        <input aria-label={kind === 'signature' ? 'Upload signature image' : 'Attach photo'} type="file" accept="image/png,image/jpeg,image/webp" disabled={busy} onChange={e => { const file=e.target.files?.[0]; if(file) void upload(file); e.target.value=''; }} />
      </label>
      {busy && <p role="status" className="text-xs">Uploading and preserving evidence…</p>}
      {value && <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => onChange(null)}>Remove from this answer</Button>}
    </>}
  </div>;
}
