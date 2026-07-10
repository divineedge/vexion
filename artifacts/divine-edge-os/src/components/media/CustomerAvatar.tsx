import React, { useRef, useState, useEffect } from 'react';
import { Camera, Loader2, User } from 'lucide-react';
import { toast } from 'sonner';
import { customFetch } from '@workspace/api-client-react';

interface CustomerAvatarProps {
  customerId: number;
  name: string;
  profilePhotoUrl?: string | null;
  size?: 'sm' | 'md' | 'lg';
  onUpdated?: (fileUrl: string) => void;
  readOnly?: boolean;
}

export default function CustomerAvatar({
  customerId,
  name,
  profilePhotoUrl,
  size = 'md',
  onUpdated,
  readOnly = false,
}: CustomerAvatarProps) {
  const [uploading, setUploading] = useState(false);
  const [signedPhotoUrl, setSignedPhotoUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const sizeClasses = {
    sm: 'w-10 h-10 text-sm',
    md: 'w-16 h-16 text-xl',
    lg: 'w-24 h-24 text-3xl',
  }[size];

  const initials = name
    .split(' ')
    .map(n => n[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  // Fetch a signed read URL whenever the stored objectPath changes.
  // Falls back to the proxy route if the sidecar is unavailable (local dev).
  useEffect(() => {
    if (!profilePhotoUrl) {
      setSignedPhotoUrl(null);
      return;
    }
    let cancelled = false;
    customFetch<{ signedUrl: string }>(
      `/api/storage/read-url?objectPath=${encodeURIComponent(profilePhotoUrl)}`,
    )
      .then(({ signedUrl }) => {
        if (!cancelled) setSignedPhotoUrl(signedUrl);
      })
      .catch(() => {
        if (!cancelled) {
          const base = import.meta.env.BASE_URL.replace(/\/$/, '');
          setSignedPhotoUrl(`${base}/api/storage${profilePhotoUrl}`);
        }
      });
    return () => { cancelled = true; };
  }, [profilePhotoUrl]);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      toast.error('Only images are allowed for profile photos');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast.error('Image must be under 10 MB');
      return;
    }

    setUploading(true);
    try {
      const { uploadURL, objectPath } = await customFetch<{ uploadURL: string; objectPath: string }>(
        '/api/storage/uploads/request-url',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: file.name, size: file.size, contentType: file.type }),
        },
      );

      const uploadRes = await fetch(uploadURL, {
        method: 'PUT',
        body: file,
        headers: { 'Content-Type': file.type },
      });
      if (!uploadRes.ok) throw new Error('Upload failed');

      await customFetch(`/api/customers/${customerId}/profile-photo`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileUrl: objectPath, mimeType: file.type, sizeBytes: file.size }),
      });

      // Optimistically fetch a signed URL for the new photo so the avatar
      // updates immediately without waiting for the parent to refetch the customer.
      try {
        const { signedUrl } = await customFetch<{ signedUrl: string }>(
          `/api/storage/read-url?objectPath=${encodeURIComponent(objectPath)}`,
        );
        setSignedPhotoUrl(signedUrl);
      } catch {
        const base = import.meta.env.BASE_URL.replace(/\/$/, '');
        setSignedPhotoUrl(`${base}/api/storage${objectPath}`);
      }

      toast.success('Profile photo updated');
      onUpdated?.(objectPath);
    } catch {
      toast.error('Failed to update profile photo');
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  return (
    <div className="relative group inline-block">
      <div
        className={`${sizeClasses} rounded-full overflow-hidden bg-primary/10 border-2 border-primary/20 flex items-center justify-center font-bold text-primary`}
      >
        {signedPhotoUrl ? (
          <img
            src={signedPhotoUrl}
            alt={name}
            className="w-full h-full object-cover"
          />
        ) : (
          <span>{initials || <User className="w-1/2 h-1/2" />}</span>
        )}
      </div>
      {!readOnly && (
        <>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleFileSelect}
          />
          <button
            className="absolute inset-0 rounded-full bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center cursor-pointer"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            title="Change photo"
          >
            {uploading ? (
              <Loader2 className="w-1/3 h-1/3 text-white animate-spin" />
            ) : (
              <Camera className="w-1/3 h-1/3 text-white" />
            )}
          </button>
        </>
      )}
    </div>
  );
}
