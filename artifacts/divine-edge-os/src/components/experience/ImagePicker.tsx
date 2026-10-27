import { useEffect, useRef, useState } from 'react';
import { ImagePlus, Loader2, X } from 'lucide-react';
import { fetchBlob, uploadImage, validateImage } from '@/lib/experience';

export interface UploadedImage { id: string; name: string }

interface Props {
  uploadUrl: string;
  value: UploadedImage[];
  onChange: (next: UploadedImage[]) => void;
  max?: number;
  label?: string;
  testId?: string;
}

/** Explicit image picker: PNG/JPEG/WebP, 5 MiB max, uploads immediately and keeps per-file errors. */
export function ImagePicker({ uploadUrl, value, onChange, max = 3, label = 'Add photos', testId = 'image-picker' }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  async function handleFiles(files: FileList | null) {
    if (!files?.length) return;
    const errs: string[] = [];
    let next = [...value];
    setBusy(true);
    for (const file of Array.from(files)) {
      if (next.length >= max) { errs.push(`Only ${max} photos allowed.`); break; }
      const invalid = validateImage(file);
      if (invalid) { errs.push(invalid); continue; }
      try {
        const up = await uploadImage(uploadUrl, file);
        next = [...next, { id: up.id, name: up.name ?? file.name }];
        onChange(next);
      } catch {
        errs.push(`${file.name}: upload failed. Try again.`);
      }
    }
    setBusy(false);
    setErrors(errs);
    if (inputRef.current) inputRef.current.value = '';
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {value.map(img => (
          <span key={img.id} className="inline-flex items-center gap-1.5 rounded-md border bg-muted/50 px-2 py-1 text-xs" data-testid={`chip-upload-${img.id}`}>
            <span className="max-w-[10rem] truncate">{img.name}</span>
            <button type="button" aria-label={`Remove ${img.name}`} onClick={() => onChange(value.filter(v => v.id !== img.id))} className="text-muted-foreground hover:text-foreground">
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
        {value.length < max && (
          <button type="button" disabled={busy} onClick={() => inputRef.current?.click()} data-testid={`button-${testId}`}
            className="inline-flex items-center gap-1.5 rounded-md border border-dashed px-3 py-1.5 text-xs font-medium text-muted-foreground hover:border-primary hover:text-primary disabled:opacity-60">
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImagePlus className="h-3.5 w-3.5" />}
            {busy ? 'Uploading...' : `${label} (${value.length}/${max})`}
          </button>
        )}
        <input ref={inputRef} type="file" accept="image/png,image/jpeg,image/webp" multiple className="hidden"
          onChange={e => void handleFiles(e.target.files)} data-testid={`input-${testId}`} />
      </div>
      <p className="text-[11px] text-muted-foreground">PNG, JPEG or WebP, up to 5 MiB each. Optional.</p>
      {errors.length > 0 && (
        <ul className="text-xs text-destructive space-y-0.5" data-testid={`error-${testId}`}>
          {errors.map((e, i) => <li key={i}>{e}</li>)}
        </ul>
      )}
    </div>
  );
}

/** Loads an authorized image as a blob (never a public URL). */
export function AuthedImage({ url, alt, className }: { url: string; alt: string; className?: string }) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let href: string | null = null;
    let live = true;
    setFailed(false);
    fetchBlob(url).then(b => {
      if (!live) return;
      href = URL.createObjectURL(b);
      setSrc(href);
    }).catch(() => live && setFailed(true));
    return () => { live = false; if (href) URL.revokeObjectURL(href); };
  }, [url]);
  if (failed) return <div className={`grid place-items-center bg-muted text-[11px] text-muted-foreground ${className ?? ''}`}>Unavailable</div>;
  if (!src) return <div className={`animate-pulse bg-muted ${className ?? ''}`} />;
  return (
    <a href={src} target="_blank" rel="noopener noreferrer">
      <img src={src} alt={alt} className={`object-cover ${className ?? ''}`} />
    </a>
  );
}
