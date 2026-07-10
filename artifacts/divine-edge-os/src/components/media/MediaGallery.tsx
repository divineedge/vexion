import React, { useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Upload, X, Star, Image, Video, Loader2, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { customFetch } from '@workspace/api-client-react';

interface MediaItem {
  id: number;
  fileKey: string;
  fileUrl: string;
  /** Signed GCS read URL returned by the API. Falls back to proxy route. */
  signedUrl?: string | null;
  mimeType: string;
  sizeBytes: number;
  caption?: string | null;
  isCover: boolean;
  createdAt: string;
}

interface MediaGalleryProps {
  entityType: 'property' | 'job';
  entityId: number;
  media: MediaItem[];
  onMediaAdded: () => void;
  onMediaDeleted: () => void;
  allowCover?: boolean;
  maxImageBytes?: number;
  maxVideoBytes?: number;
  readOnly?: boolean;
}

/** Prefer a pre-signed GCS URL; fall back to the proxy route (dev / no sidecar). */
function resolveUrl(item: MediaItem): string {
  if (item.signedUrl) return item.signedUrl;
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  return `${base}/api/storage${item.fileUrl}`;
}

export default function MediaGallery({
  entityType,
  entityId,
  media,
  onMediaAdded,
  onMediaDeleted,
  allowCover = false,
  maxImageBytes = 10 * 1024 * 1024,  // 10 MB
  maxVideoBytes = 100 * 1024 * 1024, // 100 MB
  readOnly = false,
}: MediaGalleryProps) {
  const [lightboxItem, setLightboxItem] = useState<MediaItem | null>(null);
  const [uploading, setUploading] = useState(false);
  const [editCaption, setEditCaption] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const isVideo = file.type.startsWith('video/');
    const maxBytes = isVideo ? maxVideoBytes : maxImageBytes;

    if (file.size > maxBytes) {
      toast.error(`File too large. Max ${isVideo ? '100 MB' : '10 MB'} allowed.`);
      e.target.value = '';
      return;
    }

    setUploading(true);
    try {
      // Step 1: get presigned URL
      const { uploadURL, objectPath } = await customFetch<{ uploadURL: string; objectPath: string }>(
        '/api/storage/uploads/request-url',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: file.name, size: file.size, contentType: file.type }),
        }
      );

      // Step 2: upload directly to GCS
      const uploadRes = await fetch(uploadURL, {
        method: 'PUT',
        body: file,
        headers: { 'Content-Type': file.type },
      });
      if (!uploadRes.ok) throw new Error('Upload to storage failed');

      // Step 3: save attachment record
      const endpoint = entityType === 'property' ? `/api/properties/${entityId}/media` : `/api/jobs/${entityId}/media`;
      await customFetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileKey: objectPath,
          fileUrl: objectPath,
          mimeType: file.type,
          sizeBytes: file.size,
          isCover: media.length === 0 && allowCover, // auto-cover first upload
        }),
      });

      toast.success('Media uploaded');
      onMediaAdded();
    } catch {
      toast.error('Upload failed');
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  const handleDelete = async (item: MediaItem) => {
    setDeletingId(item.id);
    try {
      const endpoint = entityType === 'property'
        ? `/api/properties/${entityId}/media/${item.id}`
        : `/api/jobs/${entityId}/media/${item.id}`;
      await customFetch(endpoint, { method: 'DELETE' });
      toast.success('Removed');
      onMediaDeleted();
    } catch {
      toast.error('Failed to remove');
    } finally {
      setDeletingId(null);
    }
  };

  const handleSetCover = async (item: MediaItem) => {
    try {
      // PATCH the existing attachment's isCover state — never insert a duplicate row
      await customFetch(`/api/properties/${entityId}/media/${item.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isCover: true }),
      });
      // Also persist on the property record
      await customFetch(`/api/properties/${entityId}/profile-photo`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileUrl: item.fileUrl }),
      });
      toast.success('Cover photo set');
      onMediaAdded();
    } catch {
      toast.error('Failed to set cover');
    }
  };

  return (
    <div className="space-y-4">
      {!readOnly && (
        <div className="flex items-center gap-3">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,video/*"
            className="hidden"
            onChange={handleFileSelect}
          />
          <Button
            variant="outline"
            size="sm"
            className="gap-2"
            disabled={uploading}
            onClick={() => fileInputRef.current?.click()}
          >
            {uploading ? (
              <><Loader2 className="w-4 h-4 animate-spin" /> Uploading...</>
            ) : (
              <><Upload className="w-4 h-4" /> Upload Photo / Video</>
            )}
          </Button>
          <span className="text-xs text-muted-foreground">Images ≤ 10 MB · Videos ≤ 100 MB</span>
        </div>
      )}

      {media.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-muted-foreground">
          <Image className="w-8 h-8 mx-auto mb-2 opacity-30" />
          <p className="text-sm">No media uploaded yet.</p>
          {!readOnly && (
            <Button
              variant="outline"
              size="sm"
              className="mt-3 gap-2"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
            >
              <Upload className="w-4 h-4" /> Add First Photo
            </Button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
          {media.map(item => {
            const isVideo = item.mimeType.startsWith('video/');
            const serveUrl = resolveUrl(item);
            return (
              <div
                key={item.id}
                className="relative group rounded-lg overflow-hidden border bg-muted aspect-square cursor-pointer"
                onClick={() => setLightboxItem(item)}
              >
                {isVideo ? (
                  <div className="w-full h-full flex items-center justify-center bg-slate-800">
                    <Video className="w-8 h-8 text-white opacity-70" />
                    <Badge className="absolute bottom-2 left-2 text-xs" variant="secondary">Video</Badge>
                  </div>
                ) : (
                  <img
                    src={serveUrl}
                    alt={item.caption ?? 'Property photo'}
                    className="w-full h-full object-cover"
                    loading="lazy"
                  />
                )}
                {item.isCover && (
                  <div className="absolute top-2 left-2">
                    <Badge className="gap-1 text-xs bg-amber-500 text-white border-transparent">
                      <Star className="w-2.5 h-2.5 fill-current" /> Cover
                    </Badge>
                  </div>
                )}
                {!readOnly && (
                  <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                    {allowCover && !item.isCover && !isVideo && (
                      <Button
                        size="icon"
                        variant="secondary"
                        className="w-8 h-8"
                        onClick={e => { e.stopPropagation(); handleSetCover(item); }}
                        title="Set as cover"
                      >
                        <Star className="w-4 h-4" />
                      </Button>
                    )}
                    <Button
                      size="icon"
                      variant="destructive"
                      className="w-8 h-8"
                      disabled={deletingId === item.id}
                      onClick={e => { e.stopPropagation(); handleDelete(item); }}
                    >
                      {deletingId === item.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                    </Button>
                  </div>
                )}
                {item.caption && (
                  <div className="absolute bottom-0 left-0 right-0 bg-black/60 text-white text-xs px-2 py-1 truncate">
                    {item.caption}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Lightbox */}
      <Dialog open={!!lightboxItem} onOpenChange={open => { if (!open) setLightboxItem(null); }}>
        <DialogContent className="max-w-3xl w-full p-4">
          <DialogHeader>
            <DialogTitle>{lightboxItem?.caption ?? (lightboxItem?.mimeType?.startsWith('video/') ? 'Video' : 'Photo')}</DialogTitle>
          </DialogHeader>
          {lightboxItem && (
            <div className="mt-2">
              {lightboxItem.mimeType.startsWith('video/') ? (
                <video
                  src={resolveUrl(lightboxItem)}
                  controls
                  className="w-full rounded-lg max-h-[70vh]"
                />
              ) : (
                <img
                  src={resolveUrl(lightboxItem)}
                  alt={lightboxItem.caption ?? 'Photo'}
                  className="w-full rounded-lg max-h-[70vh] object-contain"
                />
              )}
              <div className="mt-3 flex items-center justify-between text-sm text-muted-foreground">
                <span>{new Date(lightboxItem.createdAt).toLocaleDateString()}</span>
                <span>{(lightboxItem.sizeBytes / 1024).toFixed(0)} KB · {lightboxItem.mimeType}</span>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
