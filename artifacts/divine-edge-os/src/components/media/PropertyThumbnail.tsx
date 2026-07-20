import React, { useEffect, useState } from 'react';
import { MapPin } from 'lucide-react';
import { customFetch } from '@workspace/api-client-react';

interface PropertyThumbnailProps {
  profilePhotoUrl?: string | null;
  size?: 'sm' | 'md';
}

/**
 * Shows a small square thumbnail for a property cover photo.
 * Falls back to a MapPin icon when no photo is set.
 */
export default function PropertyThumbnail({ profilePhotoUrl, size = 'sm' }: PropertyThumbnailProps) {
  const [signedUrl, setSignedUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!profilePhotoUrl) {
      setSignedUrl(null);
      return;
    }
    let cancelled = false;
    customFetch<{ signedUrl: string }>(
      `/api/storage/read-url?objectPath=${encodeURIComponent(profilePhotoUrl)}`,
    )
      .then(({ signedUrl: url }) => {
        if (!cancelled) setSignedUrl(url);
      })
      .catch(() => {
        if (!cancelled) {
          const base = import.meta.env.BASE_URL.replace(/\/$/, '');
          setSignedUrl(`${base}/api/storage${profilePhotoUrl}`);
        }
      });
    return () => { cancelled = true; };
  }, [profilePhotoUrl]);

  const dim = size === 'md' ? 'w-10 h-10' : 'w-8 h-8';

  if (signedUrl) {
    return (
      <img
        src={signedUrl}
        alt="Property cover"
        className={`${dim} rounded object-cover shrink-0 border border-border`}
      />
    );
  }

  return <MapPin className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />;
}
