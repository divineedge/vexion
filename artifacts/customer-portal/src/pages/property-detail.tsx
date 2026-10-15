import { useRef, useState } from "react";
import { useRoute, Link } from "wouter";
import {
  usePortalListPropertyMedia,
  usePortalAddPropertyMedia,
  usePortalRequestUploadUrl,
  usePortalListProperties,
  MediaAttachment,
} from "@workspace/api-client-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch, type MeasurementZone } from "@workspace/api-client-react";
import { Checkbox } from "@/components/ui/checkbox";
import { usePortalTenantInfo } from "@/lib/tenantInfo";
import { MeasurementZonesView } from "@/components/MeasurementZonesView";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import {
  ArrowLeft,
  Upload,
  ImageIcon,
  Home,
  Building2,
  TreeDeciduous,
  MapPin,
  X,
  User,
  Wrench,
  Ruler,
  ExternalLink,
} from "lucide-react";
import { getPortalListPropertyMediaQueryKey } from "@workspace/api-client-react";

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

function getPropertyIcon(type?: string | null) {
  switch (type?.toLowerCase()) {
    case "residential":
      return <Home className="w-5 h-5 text-primary" />;
    case "commercial":
      return <Building2 className="w-5 h-5 text-primary" />;
    default:
      return <TreeDeciduous className="w-5 h-5 text-primary" />;
  }
}

function PhotoGrid({ media, isLoading }: { media?: MediaAttachment[]; isLoading: boolean }) {
  const [lightbox, setLightbox] = useState<string | null>(null);

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {Array(6)
          .fill(0)
          .map((_, i) => (
            <Skeleton key={i} className="aspect-square rounded-xl" />
          ))}
      </div>
    );
  }

  if (!media || media.length === 0) {
    return (
      <Card className="border-dashed shadow-none bg-muted/20">
        <CardContent className="p-12 text-center">
          <ImageIcon className="w-12 h-12 text-muted-foreground mx-auto mb-4 opacity-40" />
          <p className="text-muted-foreground text-sm">No photos yet. Upload the first one below.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {media.map((item) => {
          const src = (item as any).signedUrl ?? item.fileUrl;
          return (
            <div
              key={item.id}
              className="relative group aspect-square rounded-xl overflow-hidden bg-muted border border-border/50 cursor-pointer"
              onClick={() => setLightbox(src)}
            >
              <img
                src={src}
                alt={item.caption ?? "Property photo"}
                className="w-full h-full object-cover transition-transform group-hover:scale-105"
                loading="lazy"
              />
              {/* Source badge */}
              <div className="absolute top-2 left-2">
                {(item as any).source === "customer" ? (
                  <Badge className="bg-blue-600/90 text-white text-xs gap-1 py-0.5">
                    <User className="w-3 h-3" /> You
                  </Badge>
                ) : (
                  <Badge className="bg-zinc-700/80 text-white text-xs gap-1 py-0.5">
                    <Wrench className="w-3 h-3" /> Staff
                  </Badge>
                )}
              </div>
              {item.caption && (
                <div className="absolute bottom-0 left-0 right-0 bg-black/50 px-2 py-1 text-white text-xs truncate">
                  {item.caption}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Simple lightbox */}
      {lightbox && (
        <div
          className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4"
          onClick={() => setLightbox(null)}
        >
          <button
            className="absolute top-4 right-4 text-white/80 hover:text-white"
            onClick={() => setLightbox(null)}
          >
            <X className="w-8 h-8" />
          </button>
          <img
            src={lightbox}
            alt="Full size"
            className="max-h-[90vh] max-w-[90vw] object-contain rounded-lg"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </>
  );
}

function UploadSection({ propertyId }: { propertyId: number }) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [caption, setCaption] = useState("");
  const queryClient = useQueryClient();

  const requestUrl = usePortalRequestUploadUrl();
  const addMedia = usePortalAddPropertyMedia();

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      toast.error("Only image files are supported.");
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      toast.error("File must be 10 MB or smaller.");
      return;
    }

    setUploading(true);
    try {
      // Step 1: Request presigned upload URL
      const urlData = await requestUrl.mutateAsync({
        data: { name: file.name, size: file.size, contentType: file.type },
      });

      // Step 2: PUT file directly to presigned URL
      const putRes = await fetch(urlData.uploadURL, {
        method: "PUT",
        body: file,
        headers: { "Content-Type": file.type },
      });
      if (!putRes.ok) throw new Error("File upload failed");

      // Step 3: Register the media attachment
      await addMedia.mutateAsync({
        id: propertyId,
        data: {
          fileKey: urlData.objectPath,
          fileUrl: urlData.objectPath,
          mimeType: file.type,
          sizeBytes: file.size,
          caption: caption.trim() || undefined,
        },
      });

      toast.success("Photo uploaded successfully!");
      setCaption("");
      if (fileInputRef.current) fileInputRef.current.value = "";

      // Refresh the media list
      queryClient.invalidateQueries({
        queryKey: getPortalListPropertyMediaQueryKey(propertyId),
      });
    } catch (err) {
      console.error(err);
      toast.error("Upload failed. Please try again.");
    } finally {
      setUploading(false);
    }
  }

  return (
    <Card className="border-dashed border-2 border-primary/30 bg-primary/5 shadow-none">
      <CardContent className="p-6">
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
          <div className="flex-1 space-y-2">
            <h3 className="font-semibold text-foreground flex items-center gap-2">
              <Upload className="w-4 h-4 text-primary" />
              Upload a Photo
            </h3>
            <p className="text-sm text-muted-foreground">
              Images only · Max 10 MB. Photos you upload are visible to our staff.
            </p>
            <input
              type="text"
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              placeholder="Optional caption (e.g. 'Back gate damage')"
              className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
              maxLength={200}
              disabled={uploading}
            />
          </div>
          <div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="sr-only"
              onChange={handleFileChange}
              disabled={uploading}
            />
            <Button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="gap-2 whitespace-nowrap"
            >
              {uploading ? (
                <>
                  <span className="animate-spin rounded-full h-4 w-4 border-2 border-current border-t-transparent" />
                  Uploading…
                </>
              ) : (
                <>
                  <Upload className="w-4 h-4" />
                  Choose Photo
                </>
              )}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function PropertyDetail() {
  const [, params] = useRoute("/properties/:id");
  const propertyId = params?.id ? parseInt(params.id, 10) : null;

  const { data: properties, isLoading: propsLoading } = usePortalListProperties();
  const property = properties?.find((p) => p.id === propertyId);

  const tenantInfo = usePortalTenantInfo();
  const measurementsAllowed = tenantInfo.data?.portalShowMeasurements === true;
  const [showMeasurements, setShowMeasurements] = useState(false);
  const zonesQ = useQuery({
    queryKey: ["portal-property-measurements", propertyId],
    enabled: !!propertyId && measurementsAllowed && showMeasurements,
    queryFn: () => customFetch<{ id: number; portalShowMeasurements?: boolean; measurementZones?: MeasurementZone[] | null }>(`/api/portal/property/${propertyId}`),
  });

  const { data: media, isLoading: mediaLoading } = usePortalListPropertyMedia(
    propertyId ?? 0,
  );

  if (!propertyId) {
    return (
      <div className="text-center py-20 text-muted-foreground">Invalid property.</div>
    );
  }

  const staffPhotos = media?.filter((m) => (m as any).source !== "customer") ?? [];
  const myPhotos = media?.filter((m) => (m as any).source === "customer") ?? [];

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      {/* Back link */}
      <div>
        <Link href="/properties">
          <Button variant="ghost" size="sm" className="gap-2 -ml-2 text-muted-foreground">
            <ArrowLeft className="w-4 h-4" />
            Service Locations
          </Button>
        </Link>
      </div>

      {/* Property header */}
      {propsLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-5 w-40" />
        </div>
      ) : property ? (
        <div className="flex items-start gap-4">
          <div className="p-3 bg-muted border rounded-xl shadow-sm">
            {getPropertyIcon(property.type)}
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">{property.address}</h1>
            <p className="text-muted-foreground flex items-center gap-1 mt-0.5">
              <MapPin className="w-3.5 h-3.5" />
              {[property.city, property.state, property.zip].filter(Boolean).join(", ")}
            </p>
            {property.type && (
              <Badge variant="secondary" className="mt-2 bg-secondary/50">
                {property.type} Property
              </Badge>
            )}
          </div>
        </div>
      ) : (
        <div className="text-muted-foreground">Property not found.</div>
      )}

      {/* Satellite view & measurements */}
      {property && ((property as any).lat || (measurementsAllowed && (property as any).serviceableAreaSqft)) && (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold tracking-tight">Property Information</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {measurementsAllowed && (property as any).serviceableAreaSqft && (
              <Card className="shadow-none">
                <CardContent className="p-4 flex items-center gap-3">
                  <div className="p-2.5 bg-primary/10 rounded-xl">
                    <Ruler className="w-5 h-5 text-primary" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground uppercase tracking-wide">Serviceable Area</p>
                    <p className="text-xl font-bold text-foreground">
                      {Number((property as any).serviceableAreaSqft).toLocaleString()}
                      <span className="text-sm font-normal text-muted-foreground ml-1">
                        {(property as any).sizeUnit === "acres" ? "acres" : "sq ft"}
                      </span>
                    </p>
                  </div>
                </CardContent>
              </Card>
            )}
            {(property as any).lat && (property as any).lng && (
              <Card className={`overflow-hidden shadow-none ${measurementsAllowed && (property as any).serviceableAreaSqft ? '' : 'sm:col-span-2'}`}>
                <iframe
                  title="Satellite view"
                  src={`https://maps.google.com/maps?q=${(property as any).lat},${(property as any).lng}&t=k&z=19&output=embed`}
                  width="100%"
                  height="260"
                  style={{ border: 0, display: 'block' }}
                  loading="lazy"
                  allowFullScreen
                />
                <CardContent className="p-3 flex items-center justify-between border-t">
                  <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                    <MapPin className="w-3.5 h-3.5" /> Satellite view
                  </p>
                  <a
                    href={`https://maps.google.com/?q=${(property as any).lat},${(property as any).lng}&t=k`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-primary hover:underline flex items-center gap-1"
                  >
                    Open in Maps <ExternalLink className="w-3 h-3" />
                  </a>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      )}

      {property && measurementsAllowed && (
        <div className="space-y-3" data-testid="section-portal-measurements">
          <label className="flex items-center gap-2 text-sm font-medium cursor-pointer">
            <Checkbox checked={showMeasurements} onCheckedChange={v => setShowMeasurements(v === true)} data-testid="checkbox-show-measurements" />
            Show measurements
          </label>
          {showMeasurements && (zonesQ.isLoading ? <Skeleton className="h-48 rounded-xl" />
            : zonesQ.isError ? (
              <div className="text-sm text-destructive flex items-center gap-2">Couldn't load measurements.
                <Button size="sm" variant="outline" onClick={() => zonesQ.refetch()} data-testid="button-retry-measurements">Retry</Button></div>
            ) : zonesQ.data?.portalShowMeasurements === false ? <p className="text-sm text-muted-foreground">Measurements aren't shared for this property.</p> : <MeasurementZonesView zones={zonesQ.data?.measurementZones ?? []} />)}
        </div>
      )}

      {/* Upload section */}
      <div className="space-y-2">
        <h2 className="text-lg font-semibold tracking-tight">Upload a Photo</h2>
        <UploadSection propertyId={propertyId} />
      </div>

      {/* Photo gallery */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold tracking-tight">All Photos</h2>
          {media && media.length > 0 && (
            <span className="text-sm text-muted-foreground">
              {media.length} photo{media.length !== 1 ? "s" : ""}
            </span>
          )}
        </div>
        <PhotoGrid media={media} isLoading={mediaLoading} />
      </div>

      {/* My uploads / staff breakdown — only show if there's at least one of each */}
      {!mediaLoading && myPhotos.length > 0 && staffPhotos.length > 0 && (
        <div className="grid sm:grid-cols-2 gap-6">
          <div className="space-y-3">
            <h3 className="font-medium text-sm text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
              <User className="w-3.5 h-3.5" /> Your uploads ({myPhotos.length})
            </h3>
            <div className="grid grid-cols-2 gap-2">
              {myPhotos.map((item) => {
                const src = (item as any).signedUrl ?? item.fileUrl;
                return (
                  <div key={item.id} className="aspect-square rounded-lg overflow-hidden bg-muted border">
                    <img src={src} alt={item.caption ?? "Your photo"} className="w-full h-full object-cover" loading="lazy" />
                  </div>
                );
              })}
            </div>
          </div>
          <div className="space-y-3">
            <h3 className="font-medium text-sm text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
              <Wrench className="w-3.5 h-3.5" /> Staff photos ({staffPhotos.length})
            </h3>
            <div className="grid grid-cols-2 gap-2">
              {staffPhotos.map((item) => {
                const src = (item as any).signedUrl ?? item.fileUrl;
                return (
                  <div key={item.id} className="aspect-square rounded-lg overflow-hidden bg-muted border">
                    <img src={src} alt={item.caption ?? "Staff photo"} className="w-full h-full object-cover" loading="lazy" />
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
