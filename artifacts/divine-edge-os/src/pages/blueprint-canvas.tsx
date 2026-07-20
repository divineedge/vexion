import React, { useState, useRef, useEffect, useCallback, useMemo, MouseEvent } from 'react';
import { useParams, useLocation } from 'wouter';
import { 
  useGetBlueprint, getGetBlueprintQueryKey,
  useUpdateBlueprint, useCalculateBlueprintEstimate,
  useGetProperty, getGetPropertyQueryKey,
  useListInventoryItems, getListInventoryItemsQueryKey,
  useGenerateBlueprintAiZones,
  useListBlueprints, getListBlueprintsQueryKey,
  useDeleteBlueprint,
  customFetch,
} from '@workspace/api-client-react';
import type { EstimatedPart, InventoryItem } from '@workspace/api-client-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  ArrowLeft, Save, MousePointer2, PlusCircle, Minus, Trash2, Calculator, Ruler,
  ChevronDown, TreeDeciduous, Mountain, Waves, Hash, Layers, SprayCan, Link2,
  Wand2, Shapes, Sparkles, X, Check, ZoomIn, ZoomOut, Maximize, Square, HelpCircle, Library,
  Upload, FileText, Undo2, Shrub, Flower2, Sprout, Grid3x3, Milestone, BrickWall, AlertTriangle,
  PackageCheck, GitFork, Cpu, Droplets, Receipt,
} from 'lucide-react';
import { format } from 'date-fns';
import { Badge } from '@/components/ui/badge';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription,
  AlertDialogFooter, AlertDialogCancel, AlertDialogAction,
} from '@/components/ui/alert-dialog';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

/**
 * Specific fixture/material types placeable as points on the canvas, beyond the plain generic point.
 * 'dryRiverBed'/'gravel_*' and 'trench' remain in this union only so legacy blueprints saved before the
 * area/line rework still render correctly — new placements of those types go through AREA_PALETTE / the
 * trench line tool instead (see AreaElementType and the 'trench' LineElementType below).
 */
type PointElementType =
  | 'node' | 'sprinkler' | 'valve' | 'controller'
  | 'tree' | 'largeRock' | 'dryRiverBed'
  | 'gravel_1in' | 'gravel_2in' | 'gravel_3in' | 'gravel_4in' | 'trench'
  | 'canopyTree' | 'evergreenShrub' | 'perennialFlowers';

/** Ground-cover material types drawn as a bounded area (polygon) rather than a single point. */
type AreaElementType =
  | 'dryRiverBed' | 'gravel_1in' | 'gravel_2in' | 'gravel_3in' | 'gravel_4in' | 'largeRockBed'
  | 'patio' | 'walkway' | 'mulchBed' | 'paver' | 'turf';

/** Area types quantified by raw coverage (sq ft of material laid down) rather than fill volume — sod/turf
 * is sold and installed by the square foot, not by cubic yards of depth like gravel or mulch. */
const COVERAGE_AREA_TYPES = new Set<AreaElementType>(['turf']);

/** Default fill depth (inches) per ground-cover area type — drives the cubic-yard estimate; staff can override per-area.
 * Coverage-based types (see COVERAGE_AREA_TYPES) ignore depth entirely. */
function defaultDepthInches(elementType: AreaElementType): number {
  switch (elementType) {
    case 'gravel_1in': return 1;
    case 'gravel_2in': return 2;
    case 'gravel_3in': return 3;
    case 'gravel_4in': return 4;
    case 'dryRiverBed': return 3;
    case 'largeRockBed': return 4;
    case 'mulchBed': return 3;
    case 'patio': return 4;
    case 'walkway': return 4;
    case 'paver': return 2;
    case 'turf': return 0;
    default: return 3;
  }
}

/** Specific types for line segments, beyond the plain generic edge. */
type LineElementType = 'edge' | 'pipe' | 'trench' | 'retainingWall';

type Point = {
  id: string; x: number; y: number;
  /** Specific fixture/material type; omitted/'node' = plain generic point (legacy behavior). */
  elementType?: PointElementType;
  /** Free-text label, e.g. auto-numbered "Trench 1", "Trench 2"... */
  label?: string;
  /** Sprinkler head type, only meaningful when elementType === 'sprinkler'. */
  sprinklerHeadType?: string;
  /** Optional link to a flagged inventory item so materials can be pulled straight from inventory. */
  inventoryItemId?: number | null;
  /** Coverage radius in feet, only meaningful when elementType === 'sprinkler'. Drawn as a translucent circle. */
  coverageRadiusFt?: number | null;
  // ── Nozzle detail — stored per-head so repair history and design specs are always element-accurate ──
  /** Manufacturer brand of the installed nozzle, e.g. "Hunter", "Rain Bird", "Toro". */
  nozzleBrand?: string | null;
  /** Nozzle category: rotor = gear-driven; popup = fixed-spray popup body; drip/bubbler/other */
  nozzleType?: 'rotor' | 'popup' | 'drip' | 'bubbler' | 'other' | null;
  /** Rated flow in gallons per minute at operating pressure. */
  nozzleGpm?: number | null;
  /** Throw radius in feet. When set, overrides coverageRadiusFt for the drawn circle. */
  nozzleRadiusFt?: number | null;
  /** Arc in degrees (e.g. 90, 180, 270, 360). */
  nozzleArcDegrees?: number | null;
  /** For popup nozzles: the specific inventory SKU of the nozzle insert (different part from the body). */
  nozzleInventoryItemId?: number | null;
};

type Line = {
  id: string; startId: string; endId: string;
  /** Specific line type; omitted/'edge' = plain generic edge (legacy behavior). */
  elementType?: LineElementType;
  /** Pipe class/size, only meaningful when elementType === 'pipe'. */
  pipeType?: string;
  /** Free-text label, e.g. auto-numbered "Trench 1", "Trench 2"... only meaningful when elementType === 'trench'. */
  label?: string;
  /** Optional link to a flagged inventory item; quantity pulled is the real-world length in feet. */
  inventoryItemId?: number | null;
};

/** A bounded ground-cover area (gravel, dry river bed, etc.) — quantity is derived from its sq ft, not a point count. */
type Area = {
  id: string;
  elementType: AreaElementType;
  polygon: { x: number; y: number }[];
  label?: string;
  /** Optional link to a flagged inventory item; quantity pulled is real-world cubic yards (sq ft x depth). */
  inventoryItemId?: number | null;
  /** Fill depth in inches, used with the polygon's sq ft to derive a cubic-yard quantity. Defaults per elementType, editable per-area. */
  depthInches?: number;
};

type CanvasData = { points: Point[], lines: Line[], areas?: Area[] };

type ToolMode = 'select' | 'addNode' | 'addLine' | 'addArea' | 'delete' | 'calibrate' | 'zone';

/** A material/fixture chosen for a zone: either a generic palette type or one tied to a specific inventory item. */
type ZoneMaterial = { elementType: PointElementType | AreaElementType | LineElementType; inventoryItemId: number | null; pipeType?: string };

/** A user-drawn "needs design" area on the satellite map, with the materials AI should use inside it. */
type AiZone = { id: string; label: string; polygon: { x: number; y: number }[]; materials: ZoneMaterial[] };

/**
 * Point-placeable fixture types. Ground cover (gravel/dry river bed) and trenches are areas/lines — see AREA_PALETTE below.
 * `inventoryCategory` narrows the "Linked Inventory Item" picker to the matching inventory category (see inventory.ts
 * `category` field) so staff pick from a short, relevant parts list instead of the whole catalog.
 */
const POINT_PALETTE: { type: PointElementType; label: string; icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>; color: string; inventoryCategory?: string }[] = [
  { type: 'node', label: 'Generic Point', icon: PlusCircle, color: 'hsl(var(--muted-foreground))' },
  { type: 'sprinkler', label: 'Sprinkler Head', icon: SprayCan, color: '#38bdf8', inventoryCategory: 'Sprinkler Heads' },
  { type: 'valve', label: 'Valve / Valve Box', icon: GitFork, color: '#f59e0b', inventoryCategory: 'Irrigation' },
  { type: 'controller', label: 'Controller', icon: Cpu, color: '#8b5cf6', inventoryCategory: 'Irrigation' },
  { type: 'tree', label: 'Tree', icon: TreeDeciduous, color: '#16a34a', inventoryCategory: 'Landscape' },
  { type: 'largeRock', label: 'Large Rock', icon: Mountain, color: '#78716c', inventoryCategory: 'Landscape' },
  { type: 'canopyTree', label: 'Canopy Tree', icon: TreeDeciduous, color: '#15803d', inventoryCategory: 'Landscape' },
  { type: 'evergreenShrub', label: 'Evergreen Shrub', icon: Shrub, color: '#166534', inventoryCategory: 'Landscape' },
  { type: 'perennialFlowers', label: 'Perennial Flowers', icon: Flower2, color: '#db2777', inventoryCategory: 'Landscape' },
];

/** Ground-cover area types — drawn as a bounded polygon (sq ft), not a single dot. */
const AREA_PALETTE: { type: AreaElementType; label: string; icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>; color: string; inventoryCategory?: string }[] = [
  { type: 'dryRiverBed', label: 'Dry River Bed', icon: Waves, color: '#0891b2', inventoryCategory: 'Landscape' },
  { type: 'gravel_1in', label: 'Gravel (1")', icon: Layers, color: '#d6b98c', inventoryCategory: 'Landscape' },
  { type: 'gravel_2in', label: 'Gravel (2")', icon: Layers, color: '#c9a876', inventoryCategory: 'Landscape' },
  { type: 'gravel_3in', label: 'Gravel (3")', icon: Layers, color: '#bb9660', inventoryCategory: 'Landscape' },
  { type: 'gravel_4in', label: 'Gravel (4")', icon: Layers, color: '#ad844a', inventoryCategory: 'Landscape' },
  { type: 'largeRockBed', label: 'Large Rock (Bed)', icon: Mountain, color: '#78716c', inventoryCategory: 'Landscape' },
  { type: 'patio', label: 'Patio', icon: Square, color: '#94a3b8', inventoryCategory: 'Concrete' },
  { type: 'walkway', label: 'Walkway', icon: Milestone, color: '#cbd5e1', inventoryCategory: 'Concrete' },
  { type: 'mulchBed', label: 'Mulch Bed', icon: Sprout, color: '#92400e', inventoryCategory: 'Landscape' },
  { type: 'paver', label: 'Paver', icon: Grid3x3, color: '#a8a29e', inventoryCategory: 'Landscape' },
  { type: 'turf', label: 'Turf / Sod', icon: Sprout, color: '#65a30d', inventoryCategory: 'Landscape' },
];

function areaElementMeta(elementType: AreaElementType) {
  return AREA_PALETTE.find(a => a.type === elementType) ?? AREA_PALETTE[0];
}

/** Pipes/trenches on the canvas draw from the "Pipe & Fittings" inventory category. */
const LINE_INVENTORY_CATEGORY = 'Pipe & Fittings';

/** Narrows the full "available for blueprint" list down to the category relevant for this element type,
 * so staff pick from a handful of relevant parts instead of the whole catalog. Falls back to the full
 * list if nothing in inventory is tagged with that category yet, rather than showing a dead-end empty picker. */
function filteredInventoryItems(items: InventoryItem[] | undefined, category: string | undefined): InventoryItem[] {
  if (!items) return [];
  if (!category) return items;
  const matches = items.filter(i => i.category === category);
  return matches.length > 0 ? matches : items;
}

/**
 * Shared "Linked Inventory Item" control used in the point/line/area property panels. Beyond just letting
 * staff pick a SKU, it surfaces what's actually in stock and what the part is/how it's used — pulled
 * straight from the inventory item's on-hand quantity, low-stock flag, and description — so staff don't
 * have to tab over to the Inventory page to know what they have or what a part is for.
 */
function InventoryLinkField({
  items, category, value, onChange,
}: {
  items: InventoryItem[] | undefined;
  category?: string;
  value: number | null | undefined;
  onChange: (id: number | null) => void;
}) {
  const options = filteredInventoryItems(items, category);
  const selected = value != null ? items?.find(i => i.id === value) : undefined;
  return (
    <div className="space-y-1">
      <Label className="text-xs flex items-center gap-1"><Link2 className="w-3 h-3" /> Linked Inventory Item</Label>
      <Select value={value != null ? String(value) : 'none'} onValueChange={v => onChange(v === 'none' ? null : Number(v))}>
        <SelectTrigger className="h-8 w-56"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="none">None</SelectItem>
          {options.map(item => (
            <SelectItem key={item.id} value={String(item.id)}>
              {item.name} · {item.sku}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {selected && (
        <div className="max-w-[16rem] space-y-0.5">
          <div className="flex items-center gap-1.5 flex-wrap">
            <Badge variant={selected.isLowStock ? 'destructive' : 'outline'} className="text-[10px] px-1.5 py-0 gap-1">
              {selected.isLowStock ? <AlertTriangle className="w-3 h-3" /> : <PackageCheck className="w-3 h-3" />}
              {selected.quantity} {selected.unit ?? 'each'} on hand
            </Badge>
            {selected.isLowStock && <span className="text-[10px] text-destructive">Below reorder point — order more</span>}
          </div>
          {selected.description && (
            <p className="text-[11px] text-muted-foreground leading-snug">{selected.description}</p>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Full set of materials selectable per AI zone: point fixtures (excluding the plain generic point),
 * ground-cover areas, and the trench line — AI generation places each as the right element kind
 * (point, area, or line) even though they're all picked from one flat "materials" list here.
 */
const ZONE_MATERIAL_PALETTE: { type: PointElementType | AreaElementType | LineElementType; label: string; icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>; color: string; inventoryCategory?: string }[] = [
  ...POINT_PALETTE.filter(p => p.type !== 'node'),
  ...AREA_PALETTE,
  { type: 'trench', label: 'Trench (numbered line)', icon: Hash, color: '#f97316', inventoryCategory: LINE_INVENTORY_CATEGORY },
  { type: 'retainingWall', label: 'Retaining Wall', icon: BrickWall, color: '#57534e', inventoryCategory: 'Concrete' },
];

const SPRINKLER_HEAD_TYPES = ['Rotor', 'Spray', 'Drip / Micro', 'Bubbler', 'MP Rotator'];

/** Typical coverage radius (feet) by sprinkler head type, used as the default when a head is placed. */
const DEFAULT_SPRINKLER_RADIUS_FT: Record<string, number> = {
  Rotor: 25, Spray: 12, 'Drip / Micro': 3, Bubbler: 2, 'MP Rotator': 20,
};

/** Distinct outline colors cycled across drawn AI design zones so multiple zones stay visually distinguishable. */
const ZONE_COLORS = ['#f59e0b', '#3b82f6', '#10b981', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899'];

const PIPE_TYPES = [
  'PVC Sch40 1/2"', 'PVC Sch40 3/4"', 'PVC Sch40 1"',
  'PVC Class200 3/4"', 'PVC Class200 1"', 'PVC Class200 1.5"',
  'Poly 1/2"', 'Poly 3/4"', 'Copper 1/2"',
];

function pointElementMeta(elementType: PointElementType | undefined) {
  return POINT_PALETTE.find(p => p.type === (elementType ?? 'node')) ?? POINT_PALETTE[0];
}

/**
 * A point normalized from a legacy blueprint whose original free-text node type didn't match any current
 * palette entry (e.g. "valve", "corner") — normalizeCanvasData keeps the original type name as `label` but
 * leaves `elementType` undefined rather than dropping the point. These read identically to a plain new
 * generic point unless flagged here.
 */
function isLegacyUnknownPoint(point: Pick<Point, 'elementType' | 'label'>): boolean {
  return !point.elementType && !!point.label;
}

/** Distinct icon/color used for legacy-unknown points so they read as meaningfully different from a plain
 * generic point on the canvas and in the selected-point detail panel, not just differently labeled. */
const LEGACY_UNKNOWN_META = { type: 'node' as PointElementType, label: 'Unmapped Legacy Type', icon: HelpCircle, color: '#eab308' };

/** Resolves the icon/color/label metadata for an actual placed point, accounting for the legacy-unknown case. */
function resolvePointMeta(point: Pick<Point, 'elementType' | 'label'>) {
  if (isLegacyUnknownPoint(point)) return LEGACY_UNKNOWN_META;
  return pointElementMeta(point.elementType);
}

/** Real-world length of a line segment in feet, given the calibrated scale. Null if not calibrated. */
function lineLengthFt(p1: { x: number; y: number } | undefined, p2: { x: number; y: number } | undefined, scale: number | null | undefined): number | null {
  if (!p1 || !p2 || !scale || scale <= 0) return null;
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  return Math.sqrt(dx * dx + dy * dy) / scale;
}

/** Shoelace formula — area of a polygon from ordered vertices (px²) */
function polygonAreaPx(pts: { x: number; y: number }[]): number {
  if (pts.length < 3) return 0;
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    area += pts[i].x * pts[j].y;
    area -= pts[j].x * pts[i].y;
  }
  return Math.abs(area) / 2;
}

/** Convert px² → sq ft given scalePxPerFt */
function pxAreaToSqFt(areaPx: number, scale: number): number {
  return areaPx / (scale * scale);
}

/** Perimeter (px) of a closed polygon from ordered vertices. */
function polygonPerimeterPx(pts: { x: number; y: number }[]): number {
  if (pts.length < 2) return 0;
  let perimeter = 0;
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    perimeter += Math.hypot(pts[j].x - pts[i].x, pts[j].y - pts[i].y);
  }
  return perimeter;
}

/** Convert px perimeter → linear ft given scalePxPerFt */
function pxLengthToFt(lengthPx: number, scale: number): number {
  return lengthPx / scale;
}

const METERS_PER_FOOT = 0.3048;
const METERS_PER_DEGREE_LAT = 111320;
/** Placeholder real-world width (ft) assumed for a freshly-traced PDF page until the user calibrates it —
 * a PDF has no inherent geo-reference, so this just seeds a starting scale in a sane ballpark. */
const SATELLITE_SPAN_FT = 300;

/** Standard Web Mercator meters-per-pixel at a given zoom/latitude (Leaflet/Google Maps tile convention). */
function metersPerPixelAtZoom(lat: number, zoom: number): number {
  return (156543.03392 * Math.cos((lat * Math.PI) / 180)) / Math.pow(2, zoom);
}

/** Inverse of the above — the fractional zoom level whose tiles render at ~metersPerPixel at this latitude. */
function zoomForMetersPerPixel(lat: number, metersPerPixel: number): number {
  return Math.log2((156543.03392 * Math.cos((lat * Math.PI) / 180)) / metersPerPixel);
}

/** Georeference anchor tying one point in the canvas's local (pre-pan/zoom) coordinate space to a real
 * lat/lng, so every point/line/area drawn against the live map can be translated to/from real-world
 * coordinates. Established once per blueprint the moment the property's location is known. */
type MapAnchor = { lat: number; lng: number; localX: number; localY: number };

/** Local canvas coordinates → real lat/lng, using the anchor and the calibrated feet-per-local-unit scale. */
function localToLatLng(localX: number, localY: number, anchor: MapAnchor, scalePxPerFt: number): { lat: number; lng: number } {
  const dxFt = (localX - anchor.localX) / scalePxPerFt;
  const dyFt = (localY - anchor.localY) / scalePxPerFt;
  const dxM = dxFt * METERS_PER_FOOT;
  const dyM = dyFt * METERS_PER_FOOT;
  const metersPerDegreeLng = METERS_PER_DEGREE_LAT * Math.cos((anchor.lat * Math.PI) / 180);
  return {
    lat: anchor.lat - dyM / METERS_PER_DEGREE_LAT, // +y (screen down) = south = decreasing latitude
    lng: anchor.lng + dxM / metersPerDegreeLng,
  };
}

/** Compute rough total area: each connected component treated as a polygon */
function computeTotalAreaSqFt(points: Point[], lines: Line[], scale: number | null | undefined): number | null {
  if (!scale || scale <= 0 || points.length < 3) return null;
  // Build adjacency & find connected components
  const adj = new Map<string, string[]>();
  points.forEach(p => adj.set(p.id, []));
  lines.forEach(l => {
    adj.get(l.startId)?.push(l.endId);
    adj.get(l.endId)?.push(l.startId);
  });
  const visited = new Set<string>();
  let totalAreaPx = 0;
  points.forEach(startPt => {
    if (visited.has(startPt.id)) return;
    // BFS to find component
    const comp: string[] = [];
    const queue = [startPt.id];
    while (queue.length) {
      const cur = queue.shift()!;
      if (visited.has(cur)) continue;
      visited.add(cur);
      comp.push(cur);
      (adj.get(cur) ?? []).forEach(n => { if (!visited.has(n)) queue.push(n); });
    }
    if (comp.length >= 3) {
      const compPts = comp.map(id => points.find(p => p.id === id)!).filter(Boolean);
      totalAreaPx += polygonAreaPx(compPts);
    }
  });
  return pxAreaToSqFt(totalAreaPx, scale);
}

export default function BlueprintCanvasPage() {
  const params = useParams();
  const id = Number(params.id);
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();

  const { data: blueprint, isLoading } = useGetBlueprint(id, { query: { enabled: !!id, queryKey: getGetBlueprintQueryKey(id) } });
  const updateBlueprint = useUpdateBlueprint();
  const deleteBlueprintMutation = useDeleteBlueprint();
  const [deleteBlueprintOpen, setDeleteBlueprintOpen] = useState(false);
  const calcEstimate = useCalculateBlueprintEstimate();

  const svgRef = useRef<SVGSVGElement>(null);
  const canvasContainerRef = useRef<HTMLDivElement>(null);

  // ── Satellite backdrop ───────────────────────────────────────────────────────
  const propertyId = blueprint?.propertyId ?? 0;
  const { data: property } = useGetProperty(propertyId, {
    query: { enabled: !!blueprint?.propertyId, queryKey: getGetPropertyQueryKey(propertyId) },
  });
  // PDF trace-mode backdrop only now (see below) — the live property view uses a real Leaflet map instead.
  const [satelliteImage, setSatelliteImage] = useState<{ url: string; widthFt: number; heightFt: number } | null>(null);
  // Trace Mode: lets staff draw editable points/lines/areas over a rendered PDF page instead of just
  // viewing it. Reuses the satellite-image backdrop slot (same <image> render + scale-estimate logic) —
  // the rendered PDF page bitmap is a drop-in replacement for a satellite photo.
  const [traceMode, setTraceMode] = useState(false);

  // ── Live interactive map (real Esri World Imagery tiles via Leaflet, not a flat static export) ──────
  // The map itself is fully non-interactive (dragging/scroll-zoom disabled) and instead is driven
  // programmatically off the *same* viewTransform the SVG drawing layer already uses — so the existing
  // drag-to-pan / wheel-to-zoom handlers (unchanged) end up panning & zooming a real live map underneath,
  // one that keeps loading sharp tiles at any zoom and isn't cropped to a fixed real-world span.
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const leafletMapRef = useRef<L.Map | null>(null);
  const mapAnchorRef = useRef<MapAnchor | null>(null);
  const mapInitRef = useRef(false);
  const hasLiveMap = !traceMode && !!property && property.lat != null && property.lng != null;
  const pdfBuiltRef = useRef(false);
  const [pdfReplaceOpen, setPdfReplaceOpen] = useState(false);
  const [pdfReplaceFile, setPdfReplaceFile] = useState<File | null>(null);
  const [pdfReplaceUploading, setPdfReplaceUploading] = useState(false);

  const handleReplacePdf = async () => {
    if (!pdfReplaceFile) return;
    setPdfReplaceUploading(true);
    try {
      const { uploadURL, objectPath } = await customFetch<{ uploadURL: string; objectPath: string }>(
        '/api/storage/uploads/request-url',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: pdfReplaceFile.name, size: pdfReplaceFile.size, contentType: pdfReplaceFile.type }),
        },
      );
      const uploadRes = await fetch(uploadURL, { method: 'PUT', body: pdfReplaceFile, headers: { 'Content-Type': pdfReplaceFile.type } });
      if (!uploadRes.ok) throw new Error('Upload to storage failed');

      updateBlueprint.mutate(
        { id, data: { pdfObjectPath: objectPath, pdfFileName: pdfReplaceFile.name, pdfSizeBytes: pdfReplaceFile.size } },
        {
          onSuccess: () => {
            toast.success('PDF replaced');
            queryClient.invalidateQueries({ queryKey: getGetBlueprintQueryKey(id) });
            setPdfReplaceOpen(false);
            setPdfReplaceFile(null);
            pdfBuiltRef.current = false;
            setSatelliteImage(null);
          },
          onError: () => toast.error('Failed to replace PDF'),
        },
      );
    } catch {
      toast.error('Upload failed');
    } finally {
      setPdfReplaceUploading(false);
    }
  };
  const [satelliteFailed, setSatelliteFailed] = useState(false);
  const autoScaleAppliedRef = useRef(false);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  // Only true once the component has actually unmounted — NOT once per re-render. The container keeps
  // resizing for a bit after mount (e.g. sidebar layout settling), which changes `containerSize` and would
  // otherwise re-run the satellite-build effect below on every tick; using a per-effect-run `cancelled` local
  // there caused each new run's cleanup to cancel the one in-flight image request before it could ever resolve.
  const unmountedRef = useRef(false);
  useEffect(() => () => { unmountedRef.current = true; }, []);

  const [tool, setTool] = useState<ToolMode>('select');
  const [points, setPoints] = useState<Point[]>([]);
  const [lines, setLines] = useState<Line[]>([]);
  const [areas, setAreas] = useState<Area[]>([]);
  
  const [selectedPointId, setSelectedPointId] = useState<string | null>(null);
  const [selectedLineId, setSelectedLineId] = useState<string | null>(null);
  const [selectedAreaId, setSelectedAreaId] = useState<string | null>(null);

  // Shift-click multi-select of same-kind, same-elementType elements, for bulk-linking them all to one
  // inventory item in a single action instead of clicking through each element's properties panel.
  const [multiSelect, setMultiSelect] = useState<{ kind: 'point' | 'line' | 'area'; elementType?: string; ids: string[] } | null>(null);
  const [bulkLinkInventoryId, setBulkLinkInventoryId] = useState<string>('none');

  const clearMultiSelect = () => { setMultiSelect(null); setBulkLinkInventoryId('none'); };

  /** Shift-click toggle: starts/extends a multi-select set, restricted to one element kind + elementType at a time. */
  const shiftClickSelect = (kind: 'point' | 'line' | 'area', id: string, elementType: string | undefined) => {
    setMultiSelect(prev => {
      if (!prev || prev.kind !== kind || prev.elementType !== elementType) {
        return { kind, elementType, ids: [id] };
      }
      return prev.ids.includes(id)
        ? { ...prev, ids: prev.ids.filter(x => x !== id) }
        : { ...prev, ids: [...prev.ids, id] };
    });
    setSelectedPointId(null);
    setSelectedLineId(null);
    setSelectedAreaId(null);
  };

  const applyBulkLink = () => {
    if (!multiSelect || multiSelect.ids.length === 0) return;
    const inventoryItemId = bulkLinkInventoryId === 'none' ? null : Number(bulkLinkInventoryId);
    const { kind, ids } = multiSelect;
    if (kind === 'point') setPoints(pts => pts.map(p => ids.includes(p.id) ? { ...p, inventoryItemId } : p));
    else if (kind === 'line') setLines(ls => ls.map(l => ids.includes(l.id) ? { ...l, inventoryItemId } : l));
    else setAreas(ars => ars.map(a => ids.includes(a.id) ? { ...a, inventoryItemId } : a));
    toast.success(`Linked ${ids.length} item${ids.length > 1 ? 's' : ''} to inventory`);
    clearMultiSelect();
  };
  
  const [draggingPointId, setDraggingPointId] = useState<string | null>(null);
  const [drawingLineStartId, setDrawingLineStartId] = useState<string | null>(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });

  // ── Palette: which specific fixture/material type is placed by the current add tools ──────
  const [pendingPointType, setPendingPointType] = useState<PointElementType>('node');
  const [pendingLineType, setPendingLineType] = useState<LineElementType>('edge');
  const [pendingPipeType, setPendingPipeType] = useState<string>(PIPE_TYPES[0]);
  const [pendingAreaType, setPendingAreaType] = useState<AreaElementType>('gravel_1in');
  const [pointPaletteOpen, setPointPaletteOpen] = useState(false);
  const [linePaletteOpen, setLinePaletteOpen] = useState(false);
  const [areaPaletteOpen, setAreaPaletteOpen] = useState(false);

  // ── Area (ground-cover polygon) drawing ─────────────────────────────────────
  const [areaDraftPoints, setAreaDraftPoints] = useState<{ x: number; y: number }[]>([]);

  const startAreaDrawing = (type: AreaElementType) => {
    setPendingAreaType(type);
    setTool('addArea');
    setAreaDraftPoints([]);
    setDrawingLineStartId(null);
    setAreaPaletteOpen(false);
  };

  const cancelAreaDrawing = () => {
    setTool('select');
    setAreaDraftPoints([]);
  };

  const finishAreaDrawing = () => {
    if (areaDraftPoints.length < 3) return;
    const newArea: Area = { id: `a_${Date.now()}`, elementType: pendingAreaType, polygon: areaDraftPoints, depthInches: defaultDepthInches(pendingAreaType) };
    setAreas(prev => [...prev, newArea]);
    setAreaDraftPoints([]);
    setTool('select');
    setSelectedAreaId(newArea.id);
    toast.success(`${areaElementMeta(pendingAreaType).label} area added`);
  };

  // ── Pan & zoom ───────────────────────────────────────────────────────────────
  const [viewTransform, setViewTransform] = useState({ x: 0, y: 0, k: 1 });
  const [isPanning, setIsPanning] = useState(false);
  const panStartRef = useRef<{ clientX: number; clientY: number; tx: number; ty: number } | null>(null);

  const zoomBy = (factor: number, center?: { x: number; y: number }) => {
    setViewTransform(prev => {
      const newK = Math.min(8, Math.max(0.2, prev.k * factor));
      const cx = center?.x ?? containerSize.width / 2;
      const cy = center?.y ?? containerSize.height / 2;
      const logicalX = (cx - prev.x) / prev.k;
      const logicalY = (cy - prev.y) / prev.k;
      return { x: cx - logicalX * newK, y: cy - logicalY * newK, k: newK };
    });
  };
  const resetView = () => setViewTransform({ x: 0, y: 0, k: 1 });

  // ── Delete tool: drag a box to bulk-delete everything inside it ─────────────
  const [deleteBoxStart, setDeleteBoxStart] = useState<{ x: number; y: number } | null>(null);
  const [deleteBoxEnd, setDeleteBoxEnd] = useState<{ x: number; y: number } | null>(null);

  // Inventory items flagged as usable in the Blueprint canvas palette, for linking placed elements.
  const { data: blueprintInventoryItems } = useListInventoryItems(
    { availableForBlueprint: true },
    { query: { queryKey: getListInventoryItemsQueryKey({ availableForBlueprint: true }) } },
  );

  // Last calculated itemized estimate breakdown (parts list), shown alongside the total.
  const [estimateResult, setEstimateResult] = useState<{ parts: EstimatedPart[]; subtotal: number; overageAmount: number; total: number } | null>(null);

  const nextTrenchNumber = useMemo(
    () => lines.filter(l => l.elementType === 'trench').length + 1,
    [lines],
  );

  // ── Bulk migration of legacy-unknown points (Task 124 covers reassigning one at a time) ────
  const [bulkMigrateOpen, setBulkMigrateOpen] = useState(false);
  const [bulkGroupTargets, setBulkGroupTargets] = useState<Record<string, PointElementType>>({});
  const [bulkAllTarget, setBulkAllTarget] = useState<PointElementType | ''>('');

  const legacyGroups = useMemo(() => {
    const counts = new Map<string, number>();
    points.forEach(p => {
      if (isLegacyUnknownPoint(p)) counts.set(p.label!, (counts.get(p.label!) ?? 0) + 1);
    });
    return Array.from(counts.entries())
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count);
  }, [points]);
  const totalLegacyCount = useMemo(() => legacyGroups.reduce((sum, g) => sum + g.count, 0), [legacyGroups]);

  /** Builds the point patch for reassigning to a real fixture type, including sprinkler defaults. */
  const realTypeAssignmentPatch = (type: PointElementType): Partial<Point> => {
    const patch: Partial<Point> = { elementType: type };
    if (type === 'sprinkler') {
      patch.sprinklerHeadType = SPRINKLER_HEAD_TYPES[0];
      patch.coverageRadiusFt = DEFAULT_SPRINKLER_RADIUS_FT[SPRINKLER_HEAD_TYPES[0]];
    }
    return patch;
  };

  // Snapshot of the points affected by the most recent legacy-type reassignment — bulk (single group or
  // "migrate all") or a single point picked in the point detail panel — captured *before* the type/label
  // patch was applied, so staff can undo it before saving. A fresh reassignment replaces this — only the
  // single most recent action is undoable.
  const [lastMigration, setLastMigration] = useState<{ description: string; priorPoints: Point[] } | null>(null);

  const migrateLegacyGroup = (label: string, type: PointElementType) => {
    const patch = realTypeAssignmentPatch(type);
    const count = legacyGroups.find(g => g.label === label)?.count ?? 0;
    const priorPoints = points.filter(p => isLegacyUnknownPoint(p) && p.label === label).map(p => ({ ...p }));
    setPoints(pts => pts.map(p => (isLegacyUnknownPoint(p) && p.label === label) ? { ...p, ...patch } : p));
    setBulkGroupTargets(prev => { const next = { ...prev }; delete next[label]; return next; });
    setLastMigration({ description: `"${label}" → ${pointElementMeta(type).label}`, priorPoints });
    toast.success(`Migrated ${count} "${label}" point${count === 1 ? '' : 's'} to ${pointElementMeta(type).label}`);
  };

  const migrateAllLegacyPoints = (type: PointElementType) => {
    const patch = realTypeAssignmentPatch(type);
    const count = totalLegacyCount;
    const priorPoints = points.filter(isLegacyUnknownPoint).map(p => ({ ...p }));
    setPoints(pts => pts.map(p => isLegacyUnknownPoint(p) ? { ...p, ...patch } : p));
    setBulkAllTarget('');
    setBulkGroupTargets({});
    setBulkMigrateOpen(false);
    setLastMigration({ description: `all remaining legacy points → ${pointElementMeta(type).label}`, priorPoints });
    toast.success(`Migrated all ${count} remaining legacy point${count === 1 ? '' : 's'} to ${pointElementMeta(type).label}`);
  };

  /** Restores the exact prior elementType/label/etc. of every point touched by the last bulk migration. */
  const undoLastMigration = () => {
    if (!lastMigration) return;
    const priorById = new Map(lastMigration.priorPoints.map(p => [p.id, p]));
    setPoints(pts => pts.map(p => priorById.get(p.id) ?? p));
    toast.success(`Undid migration of ${lastMigration.priorPoints.length} point${lastMigration.priorPoints.length === 1 ? '' : 's'}`);
    setLastMigration(null);
  };

  // ── Calibration state ────────────────────────────────────────────────────────
  const [calibStart, setCalibStart] = useState<{ x: number; y: number } | null>(null);
  const [calibEnd, setCalibEnd] = useState<{ x: number; y: number } | null>(null);
  const [calibDialogOpen, setCalibDialogOpen] = useState(false);
  const [calibFeetInput, setCalibFeetInput] = useState('');
  const [scalePxPerFt, setScalePxPerFt] = useState<number | null>(null);

  // ── AI zone-based design workflow ────────────────────────────────────────────
  // Zones are a planning aid only (not saved to canvasData) — they exist to scope AI generation
  // to specific areas with specific materials, then get cleared once the design is placed.
  const [aiZones, setAiZones] = useState<AiZone[]>([]);
  const [zoneDraftPoints, setZoneDraftPoints] = useState<{ x: number; y: number }[]>([]);
  const [materialsDialogOpen, setMaterialsDialogOpen] = useState(false);
  const [editingZoneId, setEditingZoneId] = useState<string | null>(null); // null while defining a brand-new zone
  const [pendingZonePolygon, setPendingZonePolygon] = useState<{ x: number; y: number }[] | null>(null);
  const [zoneLabelDraft, setZoneLabelDraft] = useState('');
  const [zoneMaterialsDraft, setZoneMaterialsDraft] = useState<ZoneMaterial[]>([]);
  const generateAiZones = useGenerateBlueprintAiZones();

  // Preview-before-commit: generation results render as a ghost overlay until staff explicitly Accept
  // (which re-calls the same endpoint without preview, saving it) or Discard (which just clears it).
  const [aiPreview, setAiPreview] = useState<{ points: Point[]; lines: Line[]; areas: Area[] } | null>(null);

  // ── "Load from Template" — lets staff start a zone's materials from a saved template blueprint's ──
  // ── canvas, instead of picking every material by hand.
  const [loadingTemplateId, setLoadingTemplateId] = useState<number | null>(null);
  const { data: allBlueprints } = useListBlueprints(undefined, { query: { queryKey: getListBlueprintsQueryKey(), enabled: materialsDialogOpen } });
  const templateOptions = (allBlueprints ?? []).filter((b: any) => b.isTemplate && b.id !== Number(id));
  const { data: templateDetail } = useGetBlueprint(loadingTemplateId ?? 0, {
    query: { enabled: loadingTemplateId != null, queryKey: getGetBlueprintQueryKey(loadingTemplateId ?? 0) },
  });

  useEffect(() => {
    if (loadingTemplateId == null || !templateDetail) return;
    const data = (templateDetail.canvasData ?? {}) as unknown as CanvasData;
    const seen = new Set(zoneMaterialsDraft.map(m => m.elementType));
    const loaded: ZoneMaterial[] = [];
    for (const p of data.points ?? []) {
      const et = p.elementType && p.elementType !== 'node' ? p.elementType : undefined;
      if (!et || seen.has(et)) continue;
      seen.add(et);
      loaded.push({ elementType: et, inventoryItemId: p.inventoryItemId ?? null, pipeType: undefined });
    }
    for (const l of data.lines ?? []) {
      const et = l.elementType && l.elementType !== 'edge' ? l.elementType : undefined;
      if (!et || seen.has(et)) continue;
      seen.add(et);
      loaded.push({ elementType: et, inventoryItemId: l.inventoryItemId ?? null, pipeType: l.pipeType });
    }
    for (const a of data.areas ?? []) {
      if (seen.has(a.elementType)) continue;
      seen.add(a.elementType);
      loaded.push({ elementType: a.elementType, inventoryItemId: a.inventoryItemId ?? null });
    }
    if (loaded.length === 0) {
      toast.info('That template has no materials to load');
    } else {
      setZoneMaterialsDraft(prev => [...prev, ...loaded]);
      toast.success(`Loaded ${loaded.length} material${loaded.length > 1 ? 's' : ''} from template`);
    }
    setLoadingTemplateId(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templateDetail, loadingTemplateId]);

  const startZoneDrawing = () => {
    setTool('zone');
    setZoneDraftPoints([]);
    setDrawingLineStartId(null);
  };

  const cancelZoneDrawing = () => {
    setTool('select');
    setZoneDraftPoints([]);
  };

  const finishZoneDrawing = () => {
    if (zoneDraftPoints.length < 3) return;
    setPendingZonePolygon(zoneDraftPoints);
    setEditingZoneId(null);
    setZoneLabelDraft(`Zone ${aiZones.length + 1}`);
    setZoneMaterialsDraft([]);
    setMaterialsDialogOpen(true);
    setZoneDraftPoints([]);
    setTool('select');
  };

  const openEditZoneMaterials = (zone: AiZone) => {
    setEditingZoneId(zone.id);
    setPendingZonePolygon(zone.polygon);
    setZoneLabelDraft(zone.label);
    setZoneMaterialsDraft(zone.materials);
    setMaterialsDialogOpen(true);
  };

  const toggleZoneMaterial = (elementType: ZoneMaterial['elementType'], checked: boolean) => {
    setZoneMaterialsDraft(prev =>
      checked
        ? [...prev, { elementType, inventoryItemId: null, pipeType: elementType === 'sprinkler' ? PIPE_TYPES[0] : undefined }]
        : prev.filter(m => m.elementType !== elementType)
    );
  };

  const updateZoneMaterial = (elementType: ZoneMaterial['elementType'], patch: Partial<ZoneMaterial>) => {
    setZoneMaterialsDraft(prev => prev.map(m => m.elementType === elementType ? { ...m, ...patch } : m));
  };

  const saveZoneMaterials = () => {
    if (!pendingZonePolygon) return;
    if (zoneMaterialsDraft.length === 0) { toast.error('Pick at least one material for this zone'); return; }
    if (editingZoneId) {
      setAiZones(zones => zones.map(z => z.id === editingZoneId ? { ...z, label: zoneLabelDraft || z.label, materials: zoneMaterialsDraft } : z));
      toast.success('Zone materials updated');
    } else {
      const newZone: AiZone = {
        id: `zone_${Date.now()}`,
        label: zoneLabelDraft || `Zone ${aiZones.length + 1}`,
        polygon: pendingZonePolygon,
        materials: zoneMaterialsDraft,
      };
      setAiZones(zones => [...zones, newZone]);
      toast.success('Zone added — draw another or generate the design');
    }
    setMaterialsDialogOpen(false);
    setPendingZonePolygon(null);
    setEditingZoneId(null);
  };

  const removeZone = (zoneId: string) => setAiZones(zones => zones.filter(z => z.id !== zoneId));

  const handlePreviewAiZones = () => {
    if (aiZones.length === 0) return;
    generateAiZones.mutate(
      {
        id,
        data: {
          preview: true,
          zones: aiZones.map(z => ({
            id: z.id,
            label: z.label,
            polygon: z.polygon,
            materials: z.materials.map(m => ({ elementType: m.elementType, inventoryItemId: m.inventoryItemId, pipeType: m.pipeType ?? null })),
          })),
        },
      },
      {
        onSuccess: (previewResult) => {
          const data = (previewResult.canvasData ?? {}) as unknown as CanvasData;
          // Isolate just the newly-generated elements (their ids aren't in the current committed canvas
          // yet) so the overlay only highlights what would be added, not everything already on canvas.
          const existingPointIds = new Set(points.map(p => p.id));
          const existingLineIds = new Set(lines.map(l => l.id));
          const existingAreaIds = new Set(areas.map(a => a.id));
          setAiPreview({
            points: (data.points ?? []).filter(p => !existingPointIds.has(p.id)),
            lines: (data.lines ?? []).filter(l => !existingLineIds.has(l.id)),
            areas: (data.areas ?? []).filter(a => !existingAreaIds.has(a.id)),
          });
        },
        onError: () => toast.error('Failed to preview AI design for the selected zones'),
      },
    );
  };

  const handleAcceptAiPreview = () => {
    if (aiZones.length === 0) return;
    generateAiZones.mutate(
      {
        id,
        data: {
          zones: aiZones.map(z => ({
            id: z.id,
            label: z.label,
            polygon: z.polygon,
            materials: z.materials.map(m => ({ elementType: m.elementType, inventoryItemId: m.inventoryItemId, pipeType: m.pipeType ?? null })),
          })),
        },
      },
      {
        onSuccess: (updated) => {
          const data = (updated.canvasData ?? {}) as unknown as CanvasData;
          setPoints(data.points ?? []);
          setLines(data.lines ?? []);
          setAreas(data.areas ?? []);
          setAiZones([]);
          setAiPreview(null);
          toast.success(`AI design generated for ${aiZones.length} zone${aiZones.length > 1 ? 's' : ''}`);
          queryClient.invalidateQueries({ queryKey: getGetBlueprintQueryKey(id) });
        },
        onError: () => toast.error('Failed to generate AI design for the selected zones'),
      },
    );
  };

  const handleDiscardAiPreview = () => setAiPreview(null);

  // Init canvas data and scale from blueprint
  useEffect(() => {
    if (blueprint?.canvasData) {
      const data = blueprint.canvasData as unknown as CanvasData;
      if (data.points) setPoints(data.points);
      if (data.lines) setLines(data.lines);
      if (data.areas) setAreas(data.areas);
    }
    if (blueprint?.scalePxPerFt != null) {
      setScalePxPerFt(blueprint.scalePxPerFt);
    }
  }, [blueprint]);

  // Reset satellite/map backdrop state when switching blueprints/properties
  useEffect(() => {
    autoScaleAppliedRef.current = false;
    pdfBuiltRef.current = false;
    mapInitRef.current = false;
    mapAnchorRef.current = null;
    setSatelliteImage(null);
    setSatelliteFailed(false);
    if (leafletMapRef.current) {
      leafletMapRef.current.remove();
      leafletMapRef.current = null;
    }
  }, [blueprint?.id, blueprint?.propertyId]);

  // Build the Trace Mode backdrop: rasterize the PDF's first page client-side (pdfjs) and reuse it as
  // the same "satellite image" backdrop slot. Real-world scale is unknown from a PDF, so a placeholder
  // widthFt just seeds a starting scale — the Calibrate tool gets the user to a real one.
  useEffect(() => {
    if (!traceMode || blueprint?.sourceType !== 'pdf') return;
    if (pdfBuiltRef.current) return;
    const base = import.meta.env.BASE_URL.replace(/\/$/, '');
    const pdfViewUrl = blueprint.pdfSignedUrl ?? (blueprint.pdfObjectPath ? `${base}/api/storage${blueprint.pdfObjectPath}` : null);
    const widthPx = containerSize.width;
    const heightPx = containerSize.height;
    if (!pdfViewUrl || !widthPx || !heightPx) return;
    pdfBuiltRef.current = true;

    (async () => {
      try {
        const pdfjsLib = await import('pdfjs-dist');
        const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
        pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;
        const res = await fetch(pdfViewUrl, { credentials: 'include' });
        if (!res.ok) throw new Error('Failed to fetch PDF');
        const buf = await res.arrayBuffer();
        const doc = await pdfjsLib.getDocument({ data: buf }).promise;
        const page = await doc.getPage(1);
        const baseViewport = page.getViewport({ scale: 1 });
        const renderScale = Math.min(4, Math.max(1, widthPx / baseViewport.width) * 2);
        const viewport = page.getViewport({ scale: renderScale });
        const canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Canvas 2D context unavailable');
        await page.render({ canvasContext: ctx, viewport }).promise;
        if (unmountedRef.current) return;
        const dataUrl = canvas.toDataURL('image/png');
        // Placeholder assumed real-world width (ft) until the user calibrates — matches the typical
        // satellite-image span default so the initial estimated scale is in a sane ballpark.
        const assumedWidthFt = SATELLITE_SPAN_FT;
        const built = { url: dataUrl, widthFt: assumedWidthFt, heightFt: assumedWidthFt * (canvas.height / canvas.width) };
        setSatelliteImage(built);
        setSatelliteFailed(false);
        if (!autoScaleAppliedRef.current) {
          const estimatedScale = widthPx / built.widthFt;
          let applied = false;
          setScalePxPerFt((prev) => {
            if (prev != null) return prev;
            applied = true;
            return estimatedScale;
          });
          if (applied) {
            autoScaleAppliedRef.current = true;
            toast.message('Now tracing over the PDF page', {
              description: 'Use the Calibrate tool against a known dimension on the drawing to set a real scale.',
            });
          }
        }
      } catch {
        if (!unmountedRef.current) toast.error('Could not render the PDF page for tracing');
      }
    })();
  }, [traceMode, blueprint?.sourceType, blueprint?.pdfSignedUrl, blueprint?.pdfObjectPath, containerSize]);

  // Track the canvas container's pixel size so we can size/frame the satellite image to match.
  // The container <div> only mounts once `isLoading` flips false (it's behind an early-return while
  // the blueprint is loading), so this can't be a mount-once ([]) effect — it re-runs whenever
  // `isLoading` changes so it attaches the observer once the real container element actually exists.
  useEffect(() => {
    const container = canvasContainerRef.current;
    if (!container) return;
    const update = () => setContainerSize({ width: container.clientWidth, height: container.clientHeight });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(container);
    return () => observer.disconnect();
  }, [isLoading]);

  // Wheel-to-zoom on the canvas. Attached as a native (non-passive) listener so we can preventDefault
  // and stop the page from scrolling; the container only exists once `isLoading` flips false (same
  // mount-timing quirk as the ResizeObserver above), so this re-runs on that dependency too.
  useEffect(() => {
    const container = canvasContainerRef.current;
    if (!container) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = container.getBoundingClientRect();
      const center = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      setViewTransform(prev => {
        const newK = Math.min(8, Math.max(0.2, prev.k * factor));
        const logicalX = (center.x - prev.x) / prev.k;
        const logicalY = (center.y - prev.y) / prev.k;
        return { x: center.x - logicalX * newK, y: center.y - logicalY * newK, k: newK };
      });
    };
    container.addEventListener('wheel', onWheel, { passive: false });
    return () => container.removeEventListener('wheel', onWheel);
  }, [isLoading]);

  // Create the live Leaflet map + its georeference anchor once we know the property's location and the
  // canvas's pixel size. The map has all of its own interaction disabled (dragging/scrollWheelZoom/etc off) —
  // it's a pure rendering surface kept in sync with viewTransform by the effect below, so every existing
  // drag-to-pan / wheel-to-zoom gesture on the SVG ends up panning & zooming this real map underneath.
  useEffect(() => {
    if (!hasLiveMap) return;
    if (mapInitRef.current) return;
    if (!property || property.lat == null || property.lng == null) return;
    const widthPx = containerSize.width;
    const heightPx = containerSize.height;
    if (!widthPx || !heightPx || !mapContainerRef.current) return;

    mapInitRef.current = true;
    const map = L.map(mapContainerRef.current, {
      center: [property.lat, property.lng],
      zoom: 20,
      zoomSnap: 0,
      zoomDelta: 0,
      dragging: false,
      scrollWheelZoom: false,
      doubleClickZoom: false,
      boxZoom: false,
      keyboard: false,
      touchZoom: false,
      zoomControl: false,
      attributionControl: false,
      fadeAnimation: false,
    });
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 21,
      maxNativeZoom: 19,
    }).addTo(map);
    leafletMapRef.current = map;
    mapAnchorRef.current = { lat: property.lat, lng: property.lng, localX: widthPx / 2, localY: heightPx / 2 };

    // Seed a sensible starting scale (~150ft visible across the container at the default zoom) so the
    // Calibrate tool has a real-world baseline to fine-tune — never clobber a scale that's already set.
    if (!autoScaleAppliedRef.current) {
      let applied = false;
      setScalePxPerFt((prev) => {
        if (prev != null) return prev;
        applied = true;
        return widthPx / 150;
      });
      if (applied) {
        autoScaleAppliedRef.current = true;
        toast.message('Live map ready', {
          description: 'Use the Calibrate tool to set a real scale against a known distance.',
        });
      }
    }
  }, [hasLiveMap, property, containerSize]);

  // Keep the live map's center/zoom in lockstep with the SVG's own pan/zoom (viewTransform) — this is the
  // only thing that moves the map; it never receives direct user interaction itself.
  useEffect(() => {
    const map = leafletMapRef.current;
    const anchor = mapAnchorRef.current;
    if (!map || !anchor || !scalePxPerFt || !containerSize.width || !containerSize.height) return;
    map.invalidateSize();
    const screenCenter = { x: containerSize.width / 2, y: containerSize.height / 2 };
    const localCenter = {
      x: (screenCenter.x - viewTransform.x) / viewTransform.k,
      y: (screenCenter.y - viewTransform.y) / viewTransform.k,
    };
    const centerLatLng = localToLatLng(localCenter.x, localCenter.y, anchor, scalePxPerFt);
    const metersPerScreenPx = METERS_PER_FOOT / (scalePxPerFt * viewTransform.k);
    const zoom = zoomForMetersPerPixel(centerLatLng.lat, metersPerScreenPx);
    map.setView([centerLatLng.lat, centerLatLng.lng], zoom, { animate: false });
  }, [viewTransform, containerSize, scalePxPerFt]);

  useEffect(() => () => { leafletMapRef.current?.remove(); leafletMapRef.current = null; }, []);

  const handleSatelliteImageError = useCallback(() => {
    setSatelliteFailed(true);
    setSatelliteImage(null);
  }, []);

  // Converts a screen mouse event into *logical* canvas coordinates — i.e. inverts both the SVG's own
  // screen transform (getScreenCTM) and the pan/zoom view transform applied to the drawable <g>, so every
  // point/line/area keeps storing coordinates in one stable space regardless of how the view is panned/zoomed.
  const getCoordinates = (e: MouseEvent) => {
    if (!svgRef.current) return { x: 0, y: 0 };
    const CTM = svgRef.current.getScreenCTM();
    if (!CTM) return { x: 0, y: 0 };
    const svgX = (e.clientX - CTM.e) / CTM.a;
    const svgY = (e.clientY - CTM.f) / CTM.d;
    return {
      x: (svgX - viewTransform.x) / viewTransform.k,
      y: (svgY - viewTransform.y) / viewTransform.k,
    };
  };

  const handleSvgClick = (e: MouseEvent) => {
    const coords = getCoordinates(e);
    
    if (tool === 'addNode') {
      // Snap to any existing point/area-vertex within tolerance, matching the click-to-close convention
      // used for areas — keeps newly placed points precisely aligned with nearby geometry instead of a
      // few px off, which matters when e.g. anchoring a sprinkler to a corner.
      const SNAP_TOLERANCE_PX = 10;
      const toleranceWorld = SNAP_TOLERANCE_PX / viewTransform.k;
      const snapCandidates: { x: number; y: number }[] = [
        ...points.map(p => ({ x: p.x, y: p.y })),
        ...areas.flatMap(a => a.polygon),
      ];
      let snapCoords = coords;
      let bestDist = toleranceWorld;
      for (const c of snapCandidates) {
        const d = Math.hypot(c.x - coords.x, c.y - coords.y);
        if (d <= bestDist) {
          bestDist = d;
          snapCoords = { x: c.x, y: c.y };
        }
      }
      const newPoint: Point = { id: `p_${Date.now()}`, x: snapCoords.x, y: snapCoords.y, elementType: pendingPointType };
      if (pendingPointType === 'sprinkler') {
        newPoint.sprinklerHeadType = SPRINKLER_HEAD_TYPES[0];
        newPoint.coverageRadiusFt = DEFAULT_SPRINKLER_RADIUS_FT[SPRINKLER_HEAD_TYPES[0]];
      }
      setPoints([...points, newPoint]);
    } else if (tool === 'select') {
      setSelectedPointId(null);
      setSelectedLineId(null);
      setSelectedAreaId(null);
    } else if (tool === 'calibrate') {
      if (!calibStart) {
        setCalibStart(coords);
        setCalibEnd(null);
      } else {
        setCalibEnd(coords);
        setCalibDialogOpen(true);
      }
    } else if (tool === 'zone') {
      setZoneDraftPoints(pts => [...pts, coords]);
    } else if (tool === 'addArea') {
      // Click-to-close: clicking back on any already-placed vertex of the in-progress polygon (not just
      // the first one) completes the shape, matching the convention in most CAD/landscape design tools —
      // rather than requiring the separate "Finish Area" button.
      const CLOSE_TOLERANCE_PX = 10;
      const toleranceWorld = CLOSE_TOLERANCE_PX / viewTransform.k;
      const hitExisting = areaDraftPoints.length >= 2 && areaDraftPoints.some(
        p => Math.hypot(p.x - coords.x, p.y - coords.y) <= toleranceWorld
      );
      if (hitExisting) {
        finishAreaDrawing();
      } else {
        setAreaDraftPoints(pts => [...pts, coords]);
      }
    }
  };

  // Background-only mousedown (pointer-events:none on the grid/satellite means clicks on empty canvas
  // target the <svg> itself) — starts a pan drag in Select mode, or a delete-box drag in Delete mode.
  const handleSvgMouseDown = (e: MouseEvent) => {
    const target = e.target as SVGElement;
    if (target.tagName.toLowerCase() !== 'svg') return;
    if (tool === 'select') {
      if (!e.shiftKey) clearMultiSelect();
      setIsPanning(true);
      panStartRef.current = { clientX: e.clientX, clientY: e.clientY, tx: viewTransform.x, ty: viewTransform.y };
    } else if (tool === 'delete') {
      const coords = getCoordinates(e);
      setDeleteBoxStart(coords);
      setDeleteBoxEnd(coords);
    }
  };

  const handleSvgMouseMove = (e: MouseEvent) => {
    if (isPanning && panStartRef.current) {
      const dx = e.clientX - panStartRef.current.clientX;
      const dy = e.clientY - panStartRef.current.clientY;
      setViewTransform(prev => ({ ...prev, x: panStartRef.current!.tx + dx, y: panStartRef.current!.ty + dy }));
      return;
    }

    const coords = getCoordinates(e);
    setMousePos(coords);

    if (draggingPointId && tool === 'select') {
      setPoints(points.map(p => p.id === draggingPointId ? { ...p, x: coords.x, y: coords.y } : p));
    }
    if (deleteBoxStart && tool === 'delete') {
      setDeleteBoxEnd(coords);
    }
  };

  const handleSvgMouseUp = () => {
    setDraggingPointId(null);
    setIsPanning(false);
    panStartRef.current = null;

    if (deleteBoxStart && deleteBoxEnd) {
      const x1 = Math.min(deleteBoxStart.x, deleteBoxEnd.x), x2 = Math.max(deleteBoxStart.x, deleteBoxEnd.x);
      const y1 = Math.min(deleteBoxStart.y, deleteBoxEnd.y), y2 = Math.max(deleteBoxStart.y, deleteBoxEnd.y);
      // Require the drag to cover a meaningful area so an ordinary click-to-delete-one-element isn't
      // accidentally reinterpreted as an (empty) box delete.
      if (x2 - x1 > 4 || y2 - y1 > 4) {
        const inBox = (px: number, py: number) => px >= x1 && px <= x2 && py >= y1 && py <= y2;
        const deletedPointIds = points.filter(p => inBox(p.x, p.y)).map(p => p.id);
        const deletedAreaIds = areas.filter(a => a.polygon.some(v => inBox(v.x, v.y))).map(a => a.id);
        const deletedLineIds = lines
          .filter(l => deletedPointIds.includes(l.startId) || deletedPointIds.includes(l.endId))
          .map(l => l.id);
        const count = deletedPointIds.length + deletedAreaIds.length + deletedLineIds.length;
        if (count > 0) {
          setPoints(pts => pts.filter(p => !deletedPointIds.includes(p.id)));
          setLines(ls => ls.filter(l => !deletedLineIds.includes(l.id) && !deletedPointIds.includes(l.startId) && !deletedPointIds.includes(l.endId)));
          setAreas(ars => ars.filter(a => !deletedAreaIds.includes(a.id)));
          toast.success(`Deleted ${count} item${count > 1 ? 's' : ''}`);
        }
      }
    }
    setDeleteBoxStart(null);
    setDeleteBoxEnd(null);
  };

  const handlePointClick = (e: MouseEvent, pointId: string) => {
    e.stopPropagation();

    if (tool === 'select') {
      if (e.shiftKey) {
        const pt = points.find(p => p.id === pointId);
        shiftClickSelect('point', pointId, pt?.elementType ?? 'node');
        return;
      }
      clearMultiSelect();
      setSelectedPointId(pointId);
      setSelectedLineId(null);
      setSelectedAreaId(null);
    } else if (tool === 'delete') {
      setPoints(points.filter(p => p.id !== pointId));
      setLines(lines.filter(l => l.startId !== pointId && l.endId !== pointId));
    } else if (tool === 'addLine') {
      if (!drawingLineStartId) {
        setDrawingLineStartId(pointId);
      } else if (drawingLineStartId !== pointId) {
        const newLine: Line = { id: `l_${Date.now()}`, startId: drawingLineStartId, endId: pointId, elementType: pendingLineType };
        if (pendingLineType === 'pipe') newLine.pipeType = pendingPipeType;
        if (pendingLineType === 'trench') newLine.label = `Trench ${nextTrenchNumber}`;
        setLines([...lines, newLine]);
        setDrawingLineStartId(null);
      }
    }
  };

  const handlePointMouseDown = (e: MouseEvent, pointId: string) => {
    e.stopPropagation();
    if (tool === 'select') {
      setDraggingPointId(pointId);
    }
  };

  const handleLineClick = (e: MouseEvent, lineId: string) => {
    e.stopPropagation();
    if (tool === 'select') {
      if (e.shiftKey) {
        const ln = lines.find(l => l.id === lineId);
        shiftClickSelect('line', lineId, ln?.elementType ?? 'edge');
        return;
      }
      clearMultiSelect();
      setSelectedLineId(lineId);
      setSelectedPointId(null);
      setSelectedAreaId(null);
    } else if (tool === 'delete') {
      setLines(lines.filter(l => l.id !== lineId));
    }
  };

  const handleAreaClick = (e: MouseEvent, areaId: string) => {
    e.stopPropagation();
    if (tool === 'select') {
      if (e.shiftKey) {
        const ar = areas.find(a => a.id === areaId);
        shiftClickSelect('area', areaId, ar?.elementType);
        return;
      }
      clearMultiSelect();
      setSelectedAreaId(areaId);
      setSelectedPointId(null);
      setSelectedLineId(null);
    } else if (tool === 'delete') {
      setAreas(areas.filter(a => a.id !== areaId));
    }
  };

  const handleSave = () => {
    const canvasData = { points, lines, areas };
    const updateData: Record<string, unknown> = { canvasData };
    if (scalePxPerFt != null) updateData.scalePxPerFt = scalePxPerFt;
    updateBlueprint.mutate({ id, data: updateData as Parameters<typeof updateBlueprint.mutate>[0]['data'] }, {
      onSuccess: () => {
        toast.success('Blueprint saved');
        queryClient.invalidateQueries({ queryKey: getGetBlueprintQueryKey(id) });
        // Once saved, the prior migration state is no longer recoverable via undo (it's not persisted anywhere).
        setLastMigration(null);
      }
    });
  };

  const handleCalculate = () => {
    calcEstimate.mutate({ id }, {
      onSuccess: (data) => {
        setEstimateResult(data);
        toast.success('Estimate calculated');
        queryClient.invalidateQueries({ queryKey: getGetBlueprintQueryKey(id) });
      }
    });
  };

  const handleConfirmCalibration = () => {
    if (!calibStart || !calibEnd) return;
    const feet = parseFloat(calibFeetInput);
    if (!feet || feet <= 0) { toast.error('Enter a valid real-world length in feet'); return; }
    const dx = calibEnd.x - calibStart.x;
    const dy = calibEnd.y - calibStart.y;
    const pxDist = Math.sqrt(dx * dx + dy * dy);
    if (pxDist < 1) { toast.error('Reference line is too short'); return; }
    const scale = pxDist / feet;
    setScalePxPerFt(scale);
    toast.success(`Calibration set: ${scale.toFixed(2)} px/ft`);
    setCalibDialogOpen(false);
    setCalibStart(null);
    setCalibEnd(null);
    setCalibFeetInput('');
    setTool('select');
    // Persist immediately
    updateBlueprint.mutate({ id, data: { scalePxPerFt: scale } as Parameters<typeof updateBlueprint.mutate>[0]['data'] }, {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: getGetBlueprintQueryKey(id) }),
    });
  };

  // Keyboard delete
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Backspace' || e.key === 'Delete') {
        if (selectedPointId) {
          setPoints(pts => pts.filter(p => p.id !== selectedPointId));
          setLines(ls => ls.filter(l => l.startId !== selectedPointId && l.endId !== selectedPointId));
          setSelectedPointId(null);
        } else if (selectedLineId) {
          setLines(ls => ls.filter(l => l.id !== selectedLineId));
          setSelectedLineId(null);
        } else if (selectedAreaId) {
          setAreas(ars => ars.filter(a => a.id !== selectedAreaId));
          setSelectedAreaId(null);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedPointId, selectedLineId, selectedAreaId]);

  if (isLoading) return <div className="p-8 text-center">Loading...</div>;
  if (!blueprint && !isLoading) return <div className="p-8 text-center">Blueprint not found.</div>;

  // Uploaded-PDF blueprints default to a view-only import — show the PDF inline instead of the drawing
  // canvas. Staff can switch into Trace Mode to draw editable elements over the rendered PDF page.
  if (blueprint?.sourceType === 'pdf' && !traceMode) {
    const base = import.meta.env.BASE_URL.replace(/\/$/, '');
    const pdfViewUrl = blueprint.pdfSignedUrl ?? (blueprint.pdfObjectPath ? `${base}/api/storage${blueprint.pdfObjectPath}` : null);
    return (
      <div className="h-[calc(100vh-8rem)] flex flex-col gap-4 animate-in fade-in duration-500">
        <div className="flex items-center justify-between shrink-0">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => setLocation('/blueprints')}>
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-bold tracking-tight">{blueprint.name}</h1>
                <Badge variant="outline" className="uppercase text-[10px] gap-1">PDF</Badge>
              </div>
              {blueprint.pdfFileName && (
                <p className="text-xs text-muted-foreground mt-0.5">{blueprint.pdfFileName}</p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" className="gap-2" onClick={() => setPdfReplaceOpen(true)}>
              <Upload className="w-4 h-4" /> Replace PDF
            </Button>
            <Button className="gap-2" onClick={() => setTraceMode(true)}>
              <PlusCircle className="w-4 h-4" /> Trace on Canvas
            </Button>
            {pdfViewUrl && (
              <Button variant="outline" asChild className="gap-2">
                <a href={pdfViewUrl} target="_blank" rel="noopener noreferrer" download={blueprint.pdfFileName ?? undefined}>
                  Download
                </a>
              </Button>
            )}
          </div>
        </div>
        <Card className="flex-1 overflow-hidden shadow-md">
          {pdfViewUrl ? (
            <iframe src={pdfViewUrl} title={blueprint.name} className="w-full h-full border-0" />
          ) : (
            <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
              Unable to load this PDF right now.
            </div>
          )}
        </Card>
        <Dialog open={pdfReplaceOpen} onOpenChange={open => { setPdfReplaceOpen(open); if (!open) setPdfReplaceFile(null); }}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Replace PDF</DialogTitle>
              <DialogDescription>Upload a new PDF to replace this blueprint's source file. This does not affect any traced elements you've already drawn.</DialogDescription>
            </DialogHeader>
            <div className="py-2">
              {pdfReplaceFile ? (
                <div className="flex items-center gap-2 border rounded-md p-3">
                  <FileText className="w-4 h-4 text-muted-foreground shrink-0" />
                  <span className="text-sm truncate flex-1">{pdfReplaceFile.name}</span>
                  <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setPdfReplaceFile(null)}><X className="w-3.5 h-3.5" /></Button>
                </div>
              ) : (
                <label className="flex flex-col items-center gap-2 border-2 border-dashed rounded-md p-6 cursor-pointer hover:bg-muted/40">
                  <Upload className="w-5 h-5 text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">Click to choose a PDF (max 25 MB)</span>
                  <input
                    type="file"
                    accept="application/pdf"
                    className="hidden"
                    onChange={e => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      if (file.type !== 'application/pdf') { toast.error('Only PDF files are allowed'); e.target.value = ''; return; }
                      if (file.size > 25 * 1024 * 1024) { toast.error('PDF too large. Max 25 MB allowed.'); e.target.value = ''; return; }
                      setPdfReplaceFile(file);
                    }}
                  />
                </label>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setPdfReplaceOpen(false)}>Cancel</Button>
              <Button onClick={handleReplacePdf} disabled={!pdfReplaceFile || pdfReplaceUploading}>
                {pdfReplaceUploading ? 'Uploading...' : 'Replace'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  const isIrrigation = blueprint?.mode === 'irrigation';
  const hasSatelliteBackdrop = hasLiveMap || (!!satelliteImage && !satelliteFailed);
  // Against a busy satellite photo, the default muted/border tones are nearly invisible — switch to
  // higher-contrast colors so nodes/lines stay legible on top of imagery. Irrigation's primary color
  // already reads well on both backgrounds.
  const nodeColor = isIrrigation ? 'hsl(var(--primary))' : hasSatelliteBackdrop ? '#facc15' : 'hsl(var(--muted-foreground))';
  const lineColor = isIrrigation ? 'hsl(var(--primary))' : hasSatelliteBackdrop ? '#facc15' : 'hsl(var(--border))';

  const totalAreaSqFt = computeTotalAreaSqFt(points, lines, scalePxPerFt);

  return (
    <div className="h-[calc(100vh-8rem)] flex flex-col gap-4 animate-in fade-in duration-500">
      <div className="flex items-center justify-between shrink-0">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => setLocation('/blueprints')}>
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight">{blueprint?.name}</h1>
              <Badge variant="secondary" className="uppercase text-[10px]">{blueprint?.mode}</Badge>
              {blueprint?.isTemplate && (
                <Badge variant="outline" className="text-primary border-primary/40 text-[10px]">Template</Badge>
              )}
              {blueprint?.sourceType === 'pdf' && traceMode && (
                <Badge variant="outline" className="uppercase text-[10px] gap-1 text-amber-600 border-amber-400 bg-amber-500/10">
                  <FileText className="w-3 h-3" /> Tracing PDF
                </Badge>
              )}
            </div>
          </div>
        </div>
        <div className="flex gap-2">
          {blueprint?.sourceType === 'pdf' && traceMode && (
            <Button variant="outline" onClick={() => setTraceMode(false)} className="gap-2">
              <ArrowLeft className="w-4 h-4" /> Back to PDF View
            </Button>
          )}
          {totalLegacyCount > 0 && (
            <Button variant="outline" onClick={() => setBulkMigrateOpen(true)} className="gap-2 text-amber-600 border-amber-400 hover:text-amber-700">
              <HelpCircle className="w-4 h-4" /> Legacy Points ({totalLegacyCount})
            </Button>
          )}
          <Button variant="outline" onClick={() => setDeleteBlueprintOpen(true)} className="gap-2 text-destructive border-destructive/40 hover:text-destructive">
            <Trash2 className="w-4 h-4" /> Delete Blueprint
          </Button>
          {lastMigration && (
            <Button variant="outline" onClick={undoLastMigration} className="gap-2 text-blue-600 border-blue-400 hover:text-blue-700">
              <Undo2 className="w-4 h-4" /> Undo Migration
            </Button>
          )}
          <Button variant="outline" onClick={handleSave} disabled={updateBlueprint.isPending} className="gap-2">
            <Save className="w-4 h-4" /> Save
          </Button>
          <Button onClick={handleCalculate} disabled={calcEstimate.isPending || updateBlueprint.isPending} className="gap-2">
            <Calculator className="w-4 h-4" /> Calculate Estimate
          </Button>
        </div>
      </div>

      <Dialog open={bulkMigrateOpen} onOpenChange={setBulkMigrateOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Migrate Legacy Points</DialogTitle>
            <DialogDescription>
              This blueprint has {totalLegacyCount} point{totalLegacyCount === 1 ? '' : 's'} imported from an old legacy type that doesn't
              match a current fixture type. Assign a real type to each group at once, or migrate everything remaining in one action.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 max-h-80 overflow-y-auto pr-1">
            {legacyGroups.map(group => (
              <div key={group.label} className="flex items-center gap-2 border rounded-md p-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <HelpCircle className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                    <span className="text-sm font-medium truncate">"{group.label}"</span>
                  </div>
                  <span className="text-xs text-muted-foreground">{group.count} point{group.count === 1 ? '' : 's'}</span>
                </div>
                <Select
                  value={bulkGroupTargets[group.label] ?? ''}
                  onValueChange={v => setBulkGroupTargets(prev => ({ ...prev, [group.label]: v as PointElementType }))}
                >
                  <SelectTrigger className="h-8 w-40"><SelectValue placeholder="Pick a type" /></SelectTrigger>
                  <SelectContent>
                    {POINT_PALETTE.map(p => (
                      <SelectItem key={p.type} value={p.type}>
                        <span className="flex items-center gap-2">
                          <p.icon className="w-3.5 h-3.5" style={{ color: p.color }} />
                          {p.label}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  size="sm"
                  disabled={!bulkGroupTargets[group.label]}
                  onClick={() => migrateLegacyGroup(group.label, bulkGroupTargets[group.label]!)}
                >
                  Migrate
                </Button>
              </div>
            ))}
            {legacyGroups.length === 0 && (
              <p className="text-sm text-muted-foreground py-4 text-center">No legacy points remaining — you're all caught up.</p>
            )}
          </div>
          {legacyGroups.length > 1 && (
            <div className="flex items-center gap-2 border-t pt-3">
              <span className="text-sm shrink-0">Or migrate all {totalLegacyCount} remaining to:</span>
              <Select value={bulkAllTarget} onValueChange={v => setBulkAllTarget(v as PointElementType)}>
                <SelectTrigger className="h-8 flex-1"><SelectValue placeholder="Pick a type" /></SelectTrigger>
                <SelectContent>
                  {POINT_PALETTE.map(p => (
                    <SelectItem key={p.type} value={p.type}>
                      <span className="flex items-center gap-2">
                        <p.icon className="w-3.5 h-3.5" style={{ color: p.color }} />
                        {p.label}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button size="sm" disabled={!bulkAllTarget} onClick={() => migrateAllLegacyPoints(bulkAllTarget as PointElementType)}>
                Migrate All
              </Button>
            </div>
          )}
          {lastMigration && (
            <div className="flex items-center justify-between gap-2 border-t pt-3 text-sm">
              <span className="text-muted-foreground truncate">Last migration: {lastMigration.description}</span>
              <Button size="sm" variant="outline" onClick={undoLastMigration} className="gap-1.5 shrink-0 text-blue-600 border-blue-400 hover:text-blue-700">
                <Undo2 className="w-3.5 h-3.5" /> Undo
              </Button>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkMigrateOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="flex-1 flex gap-4 min-h-0">
        <Card className="flex-1 flex flex-col overflow-hidden shadow-md">
          {/* Toolbar */}
          <div className="border-b p-2 flex items-center gap-2 bg-muted/20">
            <Button variant={tool === 'select' ? 'default' : 'ghost'} size="sm" onClick={() => { setTool('select'); setDrawingLineStartId(null); }} title="Select / Move">
              <MousePointer2 className="w-4 h-4" />
            </Button>
            <div className="w-px h-6 bg-border mx-1" />
            <Popover open={pointPaletteOpen} onOpenChange={setPointPaletteOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant={tool === 'addNode' ? 'default' : 'ghost'}
                  size="sm"
                  className="gap-1"
                  title="Add fixture / material point"
                  onClick={() => { setTool('addNode'); setDrawingLineStartId(null); setPointPaletteOpen(true); }}
                >
                  {React.createElement(pointElementMeta(pendingPointType).icon, { className: 'w-4 h-4' })}
                  <span className="text-[10px] max-w-[5.5rem] truncate">{pointElementMeta(pendingPointType).label}</span>
                  <ChevronDown className="w-3 h-3" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-56 p-1" align="start">
                {POINT_PALETTE.map(p => (
                  <button
                    key={p.type}
                    className={`w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted text-left ${pendingPointType === p.type ? 'bg-muted' : ''}`}
                    onClick={() => { setPendingPointType(p.type); setTool('addNode'); setDrawingLineStartId(null); setPointPaletteOpen(false); }}
                  >
                    <p.icon className="w-4 h-4" style={{ color: p.color }} />
                    {p.label}
                  </button>
                ))}
              </PopoverContent>
            </Popover>
            <Popover open={linePaletteOpen} onOpenChange={setLinePaletteOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant={tool === 'addLine' ? 'default' : 'ghost'}
                  size="sm"
                  className="gap-1"
                  title="Add line / pipe segment"
                  onClick={() => { setTool('addLine'); setLinePaletteOpen(true); }}
                >
                  <Minus className="w-4 h-4" />
                  <span className="text-[10px] max-w-[5.5rem] truncate">{pendingLineType === 'pipe' ? pendingPipeType : pendingLineType === 'trench' ? 'Trench' : pendingLineType === 'retainingWall' ? 'Retaining Wall' : 'Generic Edge'}</span>
                  <ChevronDown className="w-3 h-3" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-64 p-2 space-y-2" align="start">
                <button
                  className={`w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted text-left ${pendingLineType === 'edge' ? 'bg-muted' : ''}`}
                  onClick={() => { setPendingLineType('edge'); setTool('addLine'); setLinePaletteOpen(false); }}
                >
                  <Minus className="w-4 h-4" /> Generic Edge
                </button>
                <div className="border-t pt-2">
                  <p className="text-xs text-muted-foreground px-2 pb-1">Pipe (real-world length auto-calculated)</p>
                  {PIPE_TYPES.map(pt => (
                    <button
                      key={pt}
                      className={`w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted text-left ${pendingLineType === 'pipe' && pendingPipeType === pt ? 'bg-muted' : ''}`}
                      onClick={() => { setPendingLineType('pipe'); setPendingPipeType(pt); setTool('addLine'); setLinePaletteOpen(false); }}
                    >
                      <Ruler className="w-4 h-4 text-primary" /> {pt}
                    </button>
                  ))}
                </div>
                <div className="border-t pt-2">
                  <button
                    className={`w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted text-left ${pendingLineType === 'trench' ? 'bg-muted' : ''}`}
                    onClick={() => { setPendingLineType('trench'); setTool('addLine'); setLinePaletteOpen(false); }}
                  >
                    <Hash className="w-4 h-4" style={{ color: '#f97316' }} /> Trench (numbered, real-world length auto-calculated)
                  </button>
                </div>
                <div className="border-t pt-2">
                  <button
                    className={`w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted text-left ${pendingLineType === 'retainingWall' ? 'bg-muted' : ''}`}
                    onClick={() => { setPendingLineType('retainingWall'); setTool('addLine'); setLinePaletteOpen(false); }}
                  >
                    <BrickWall className="w-4 h-4" style={{ color: '#57534e' }} /> Retaining Wall (real-world length auto-calculated)
                  </button>
                </div>
              </PopoverContent>
            </Popover>
            <Popover open={areaPaletteOpen} onOpenChange={setAreaPaletteOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant={tool === 'addArea' ? 'default' : 'ghost'}
                  size="sm"
                  className="gap-1"
                  title="Add ground-cover area (gravel, dry river bed)"
                  onClick={() => { setAreaPaletteOpen(true); }}
                >
                  <Square className="w-4 h-4" style={{ color: areaElementMeta(pendingAreaType).color }} />
                  <span className="text-[10px] max-w-[5.5rem] truncate">{areaElementMeta(pendingAreaType).label}</span>
                  <ChevronDown className="w-3 h-3" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-56 p-1" align="start">
                <p className="text-xs text-muted-foreground px-2 py-1">Draws a bounded area (sq ft), not a single dot</p>
                {AREA_PALETTE.map(a => (
                  <button
                    key={a.type}
                    className={`w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted text-left ${pendingAreaType === a.type ? 'bg-muted' : ''}`}
                    onClick={() => startAreaDrawing(a.type)}
                  >
                    <a.icon className="w-4 h-4" style={{ color: a.color }} />
                    {a.label}
                  </button>
                ))}
              </PopoverContent>
            </Popover>
            <div className="w-px h-6 bg-border mx-1" />
            <Button variant={tool === 'delete' ? 'destructive' : 'ghost'} size="sm" onClick={() => { setTool('delete'); setDrawingLineStartId(null); }} title="Delete (click an item, or drag a box to delete multiple)">
              <Trash2 className="w-4 h-4" />
            </Button>
            <div className="w-px h-6 bg-border mx-1" />
            <Button variant="ghost" size="sm" onClick={() => zoomBy(1.25)} title="Zoom in">
              <ZoomIn className="w-4 h-4" />
            </Button>
            <Button variant="ghost" size="sm" onClick={() => zoomBy(1 / 1.25)} title="Zoom out">
              <ZoomOut className="w-4 h-4" />
            </Button>
            <Button variant="ghost" size="sm" onClick={resetView} title="Reset pan/zoom">
              <Maximize className="w-4 h-4" />
            </Button>
            <div className="w-px h-6 bg-border mx-1" />
            <Button
              variant={tool === 'calibrate' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => { setTool('calibrate'); setCalibStart(null); setCalibEnd(null); setDrawingLineStartId(null); }}
              title="Calibrate Scale (draw reference line)"
              className="gap-1"
            >
              <Ruler className="w-4 h-4" />
              {scalePxPerFt ? <span className="text-[10px]">{scalePxPerFt.toFixed(1)} px/ft</span> : <span className="text-[10px]">Calibrate</span>}
            </Button>
            <div className="w-px h-6 bg-border mx-1" />
            <Button
              variant={tool === 'zone' ? 'default' : 'ghost'}
              size="sm"
              onClick={startZoneDrawing}
              title="Draw a zone to AI-design (satellite map recommended)"
              className="gap-1"
            >
              <Shapes className="w-4 h-4" />
              <span className="text-[10px]">Draw AI Zone</span>
            </Button>
            {aiZones.length > 0 && !aiPreview && (
              <Button
                size="sm"
                className="gap-1"
                onClick={handlePreviewAiZones}
                disabled={generateAiZones.isPending}
                title="Preview AI design for the drawn zones before committing it"
              >
                <Wand2 className="w-4 h-4" />
                <span className="text-[10px]">{generateAiZones.isPending ? 'Generating preview...' : `Preview (${aiZones.length})`}</span>
              </Button>
            )}
            {aiPreview && (
              <>
                <Badge variant="outline" className="gap-1 text-amber-600 border-amber-400 bg-amber-500/10">
                  <Sparkles className="w-3 h-3" /> Previewing {aiPreview.points.length + aiPreview.lines.length + aiPreview.areas.length} new item{(aiPreview.points.length + aiPreview.lines.length + aiPreview.areas.length) === 1 ? '' : 's'}
                </Badge>
                <Button size="sm" className="gap-1" onClick={handleAcceptAiPreview} disabled={generateAiZones.isPending}>
                  <Check className="w-4 h-4" />
                  <span className="text-[10px]">{generateAiZones.isPending ? 'Saving...' : 'Accept'}</span>
                </Button>
                <Button size="sm" variant="outline" className="gap-1" onClick={handleDiscardAiPreview} disabled={generateAiZones.isPending}>
                  <X className="w-4 h-4" />
                  <span className="text-[10px]">Discard</span>
                </Button>
              </>
            )}
            <span className="ml-auto text-xs text-muted-foreground mr-2 capitalize">
              {tool === 'calibrate' && !calibStart ? 'Click first point of reference line' :
               tool === 'calibrate' && calibStart ? 'Click second point of reference line' :
               tool === 'zone' ? `Click to add zone vertices (${zoneDraftPoints.length})` :
               tool === 'addArea' ? `Click to add area vertices (${areaDraftPoints.length})` :
               tool === 'delete' ? 'Click an item, or drag a box, to delete' :
               tool === 'select' ? 'Drag empty space to pan, scroll to zoom' :
               `Mode: ${tool.replace(/([A-Z])/g, ' $1')}`}
            </span>
          </div>

          {/* Zone drawing overlay controls */}
          {tool === 'zone' && (
            <div className="border-b p-2 flex items-center gap-3 bg-amber-500/10">
              <Shapes className="w-4 h-4 text-amber-600 shrink-0" />
              <p className="text-xs text-amber-700 dark:text-amber-400 flex-1">
                Click the map to trace the area that needs designing ({zoneDraftPoints.length} point{zoneDraftPoints.length === 1 ? '' : 's'}). Close the shape with at least 3 points.
              </p>
              {zoneDraftPoints.length >= 3 && (
                <Button size="sm" className="h-7 gap-1" onClick={finishZoneDrawing}>
                  <Check className="w-3.5 h-3.5" /> Finish Zone
                </Button>
              )}
              <Button size="sm" variant="outline" className="h-7 gap-1" onClick={cancelZoneDrawing}>
                <X className="w-3.5 h-3.5" /> Cancel
              </Button>
            </div>
          )}

          {/* Area drawing overlay controls */}
          {tool === 'addArea' && (
            <div className="border-b p-2 flex items-center gap-3" style={{ backgroundColor: `${areaElementMeta(pendingAreaType).color}1a` }}>
              <Square className="w-4 h-4 shrink-0" style={{ color: areaElementMeta(pendingAreaType).color }} />
              <p className="text-xs flex-1" style={{ color: areaElementMeta(pendingAreaType).color }}>
                Click to trace the {areaElementMeta(pendingAreaType).label} area ({areaDraftPoints.length} point{areaDraftPoints.length === 1 ? '' : 's'}). Close the shape with at least 3 points.
              </p>
              {areaDraftPoints.length >= 3 && (
                <Button size="sm" className="h-7 gap-1" onClick={finishAreaDrawing}>
                  <Check className="w-3.5 h-3.5" /> Finish Area
                </Button>
              )}
              <Button size="sm" variant="outline" className="h-7 gap-1" onClick={cancelAreaDrawing}>
                <X className="w-3.5 h-3.5" /> Cancel
              </Button>
            </div>
          )}

          {/* AI zones list */}
          {aiZones.length > 0 && (
            <div className="border-b p-2 flex flex-wrap items-center gap-2 bg-primary/5">
              <Sparkles className="w-4 h-4 text-primary shrink-0" />
              {aiZones.map((zone, i) => (
                <Badge
                  key={zone.id}
                  variant="outline"
                  className="gap-1.5 pl-2 pr-1 py-1 cursor-pointer hover:border-primary/60"
                  style={{ borderColor: ZONE_COLORS[i % ZONE_COLORS.length] }}
                  onClick={() => openEditZoneMaterials(zone)}
                >
                  <span style={{ color: ZONE_COLORS[i % ZONE_COLORS.length] }}>{zone.label}</span>
                  <span className="text-muted-foreground">· {zone.materials.length} material{zone.materials.length === 1 ? '' : 's'}</span>
                  <button
                    className="ml-1 rounded-full hover:bg-destructive/20 hover:text-destructive p-0.5"
                    onClick={(e) => { e.stopPropagation(); removeZone(zone.id); }}
                  >
                    <X className="w-3 h-3" />
                  </button>
                </Badge>
              ))}
            </div>
          )}

          {/* Bulk-link toolbar — shown while a shift-click multi-select of same-type elements is active */}
          {tool === 'select' && multiSelect && multiSelect.ids.length > 0 && (
            <div className="border-b p-3 flex flex-wrap items-end gap-3 bg-primary/5">
              <Badge variant="outline" className="text-xs">{multiSelect.ids.length} {multiSelect.kind}{multiSelect.ids.length > 1 ? 's' : ''} selected</Badge>
              <div className="space-y-1">
                <Label className="text-xs flex items-center gap-1"><Link2 className="w-3 h-3" /> Link all to Inventory Item</Label>
                <Select value={bulkLinkInventoryId} onValueChange={setBulkLinkInventoryId}>
                  <SelectTrigger className="h-8 w-48"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    {filteredInventoryItems(
                      blueprintInventoryItems,
                      multiSelect.kind === 'line'
                        ? LINE_INVENTORY_CATEGORY
                        : multiSelect.kind === 'area'
                          ? areaElementMeta(multiSelect.elementType as AreaElementType).inventoryCategory
                          : pointElementMeta(multiSelect.elementType as PointElementType).inventoryCategory,
                    ).map(item => (
                      <SelectItem key={item.id} value={String(item.id)}>{item.name} · {item.sku}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button size="sm" className="h-8 gap-1.5" onClick={applyBulkLink}>
                <Check className="w-3.5 h-3.5" /> Apply to All
              </Button>
              <Button size="sm" variant="ghost" className="h-8" onClick={clearMultiSelect}>Clear</Button>
              <span className="text-xs text-muted-foreground">Shift-click more {multiSelect.kind}s of the same type to add them.</span>
            </div>
          )}

          {/* Selected element details */}
          {tool === 'select' && !multiSelect && selectedPointId && (() => {
            const pt = points.find(p => p.id === selectedPointId);
            if (!pt) return null;
            const meta = resolvePointMeta(pt);
            const isLegacyUnknown = isLegacyUnknownPoint(pt);
            const updatePoint = (patch: Partial<Point>) => setPoints(pts => pts.map(p => p.id === pt.id ? { ...p, ...patch } : p));
            const assignRealType = (type: PointElementType) => {
              const patch = realTypeAssignmentPatch(type);
              const priorPoints = [{ ...pt }];
              updatePoint(patch);
              setLastMigration({ description: `"${pt.label}" → ${pointElementMeta(type).label}`, priorPoints });
              toast.success(`Reassigned "${pt.label}" to ${pointElementMeta(type).label}`);
            };
            return (
              <div className="border-b p-3 flex flex-wrap items-end gap-3 bg-muted/10">
                <div className="flex items-center gap-1.5">
                  <meta.icon className="w-4 h-4" style={{ color: meta.color }} />
                  <span className="text-sm font-medium">{meta.label}</span>
                  {isLegacyUnknown && (
                    <Badge variant="outline" className="text-xs text-amber-600 border-amber-400">Legacy: "{pt.label}"</Badge>
                  )}
                </div>
                {isLegacyUnknown && (
                  <div className="space-y-1">
                    <Label className="text-xs">Assign real type</Label>
                    <Select value="" onValueChange={v => assignRealType(v as PointElementType)}>
                      <SelectTrigger className="h-8 w-44"><SelectValue placeholder="Pick a fixture type" /></SelectTrigger>
                      <SelectContent>
                        {POINT_PALETTE.map(p => (
                          <SelectItem key={p.type} value={p.type}>
                            <span className="flex items-center gap-2">
                              <p.icon className="w-3.5 h-3.5" style={{ color: p.color }} />
                              {p.label}
                            </span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                {(pt.elementType === 'trench' || !pt.elementType || pt.elementType === 'node') && (
                  <div className="space-y-1">
                    <Label className="text-xs">Label</Label>
                    <Input className="h-8 w-36" value={pt.label ?? ''} placeholder="Optional label" onChange={e => updatePoint({ label: e.target.value })} />
                  </div>
                )}
                {pt.elementType === 'sprinkler' && (
                  <>
                    <div className="space-y-1">
                      <Label className="text-xs">Head Type</Label>
                      <Select value={pt.sprinklerHeadType ?? SPRINKLER_HEAD_TYPES[0]} onValueChange={v => updatePoint({ sprinklerHeadType: v, nozzleType: v === 'Rotor' || v === 'MP Rotator' ? 'rotor' : v === 'Drip / Micro' ? 'drip' : v === 'Bubbler' ? 'bubbler' : 'popup' })}>
                        <SelectTrigger className="h-8 w-36"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {SPRINKLER_HEAD_TYPES.map(h => <SelectItem key={h} value={h}>{h}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    {/* ── Nozzle detail ────────────────────────────────────── */}
                    <div className="space-y-1">
                      <Label className="text-xs flex items-center gap-1"><Droplets className="w-3 h-3 text-sky-500" /> Nozzle Brand</Label>
                      <Input className="h-8 w-32" placeholder="e.g. Hunter" value={pt.nozzleBrand ?? ''} onChange={e => updatePoint({ nozzleBrand: e.target.value || null })} />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">GPM</Label>
                      <Input type="number" step="0.01" min="0" className="h-8 w-24" placeholder="0.00" value={pt.nozzleGpm ?? ''} onChange={e => updatePoint({ nozzleGpm: e.target.value ? Number(e.target.value) : null, coverageRadiusFt: pt.nozzleRadiusFt ?? pt.coverageRadiusFt ?? null })} />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Radius (ft)</Label>
                      <Input type="number" step="0.5" min="0" className="h-8 w-24" placeholder="12" value={pt.nozzleRadiusFt ?? pt.coverageRadiusFt ?? ''} onChange={e => { const v = e.target.value ? Number(e.target.value) : null; updatePoint({ nozzleRadiusFt: v, coverageRadiusFt: v }); }} />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Arc (°)</Label>
                      <Select value={pt.nozzleArcDegrees != null ? String(pt.nozzleArcDegrees) : 'custom'} onValueChange={v => updatePoint({ nozzleArcDegrees: v !== 'custom' ? Number(v) : null })}>
                        <SelectTrigger className="h-8 w-24"><SelectValue placeholder="Arc" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="90">90°</SelectItem>
                          <SelectItem value="180">180°</SelectItem>
                          <SelectItem value="270">270°</SelectItem>
                          <SelectItem value="360">360° full</SelectItem>
                          <SelectItem value="custom">Custom</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    {/* For popup nozzles: link the nozzle insert as a separate inventory SKU */}
                    {(pt.nozzleType === 'popup' || pt.sprinklerHeadType === 'Spray') && (
                      <div className="space-y-1">
                        <Label className="text-xs flex items-center gap-1"><Droplets className="w-3 h-3 text-sky-500" /> Nozzle Insert (inventory)</Label>
                        <InventoryLinkField
                          items={blueprintInventoryItems}
                          category="Sprinkler Heads"
                          value={pt.nozzleInventoryItemId}
                          onChange={id => updatePoint({ nozzleInventoryItemId: id })}
                        />
                      </div>
                    )}
                  </>
                )}
                {(pt.elementType === 'valve' || pt.elementType === 'controller') && (
                  <div className="space-y-1">
                    <Label className="text-xs">Label</Label>
                    <Input className="h-8 w-36" value={pt.label ?? ''} placeholder={pt.elementType === 'valve' ? 'Zone 1 Valve' : 'Zone Controller'} onChange={e => updatePoint({ label: e.target.value })} />
                  </div>
                )}
                <InventoryLinkField
                  items={blueprintInventoryItems}
                  category={pointElementMeta(pt.elementType).inventoryCategory}
                  value={pt.inventoryItemId}
                  onChange={id => updatePoint({ inventoryItemId: id })}
                />
              </div>
            );
          })()}
          {tool === 'select' && !multiSelect && selectedLineId && (() => {
            const ln = lines.find(l => l.id === selectedLineId);
            if (!ln) return null;
            const p1 = points.find(p => p.id === ln.startId);
            const p2 = points.find(p => p.id === ln.endId);
            const lengthFt = lineLengthFt(p1, p2, scalePxPerFt);
            const updateLine = (patch: Partial<Line>) => setLines(ls => ls.map(l => l.id === ln.id ? { ...l, ...patch } : l));
            return (
              <div className="border-b p-3 flex flex-wrap items-end gap-3 bg-muted/10">
                <div className="flex items-center gap-1.5">
                  <Minus className="w-4 h-4 text-primary" />
                  <span className="text-sm font-medium">{ln.elementType === 'pipe' ? 'Pipe' : ln.elementType === 'trench' ? 'Trench' : ln.elementType === 'retainingWall' ? 'Retaining Wall' : 'Generic Edge'}</span>
                  {lengthFt !== null ? (
                    <Badge variant="outline" className="text-xs">{lengthFt.toFixed(1)} ft</Badge>
                  ) : (
                    <Badge variant="outline" className="text-xs text-muted-foreground">Calibrate for length</Badge>
                  )}
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Type</Label>
                  <Select
                    value={ln.elementType === 'pipe' ? (ln.pipeType ?? PIPE_TYPES[0]) : ln.elementType === 'trench' ? 'trench' : ln.elementType === 'retainingWall' ? 'retainingWall' : 'edge'}
                    onValueChange={v => {
                      if (v === 'edge') updateLine({ elementType: 'edge', pipeType: undefined, label: undefined });
                      else if (v === 'trench') updateLine({ elementType: 'trench', pipeType: undefined, label: ln.label ?? `Trench ${nextTrenchNumber}` });
                      else if (v === 'retainingWall') updateLine({ elementType: 'retainingWall', pipeType: undefined, label: undefined });
                      else updateLine({ elementType: 'pipe', pipeType: v, label: undefined });
                    }}
                  >
                    <SelectTrigger className="h-8 w-44"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="edge">Generic Edge</SelectItem>
                      <SelectItem value="trench">Trench</SelectItem>
                      <SelectItem value="retainingWall">Retaining Wall</SelectItem>
                      {PIPE_TYPES.map(pt => <SelectItem key={pt} value={pt}>{pt}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                {ln.elementType === 'trench' && (
                  <div className="space-y-1">
                    <Label className="text-xs">Label</Label>
                    <Input className="h-8 w-36" value={ln.label ?? ''} onChange={e => updateLine({ label: e.target.value })} />
                  </div>
                )}
                <InventoryLinkField
                  items={blueprintInventoryItems}
                  category={ln.elementType === 'retainingWall' ? 'Concrete' : LINE_INVENTORY_CATEGORY}
                  value={ln.inventoryItemId}
                  onChange={id => updateLine({ inventoryItemId: id })}
                />
              </div>
            );
          })()}
          {tool === 'select' && !multiSelect && selectedAreaId && (() => {
            const area = areas.find(a => a.id === selectedAreaId);
            if (!area) return null;
            const meta = areaElementMeta(area.elementType);
            const isCoverage = COVERAGE_AREA_TYPES.has(area.elementType);
            const sqFt = scalePxPerFt ? pxAreaToSqFt(polygonAreaPx(area.polygon), scalePxPerFt) : null;
            const depthInches = area.depthInches ?? defaultDepthInches(area.elementType);
            const cubicYards = sqFt !== null ? (sqFt * (depthInches / 12)) / 27 : null;
            const updateArea = (patch: Partial<Area>) => setAreas(ars => ars.map(a => a.id === area.id ? { ...a, ...patch } : a));
            return (
              <div className="border-b p-3 flex flex-wrap items-end gap-3 bg-muted/10">
                <div className="flex items-center gap-1.5">
                  <meta.icon className="w-4 h-4" style={{ color: meta.color }} />
                  <span className="text-sm font-medium">{meta.label}</span>
                  {sqFt !== null ? (
                    <>
                      <Badge variant="outline" className="text-xs">{sqFt.toLocaleString(undefined, { maximumFractionDigits: 1 })} sq ft</Badge>
                      {!isCoverage && (
                        <Badge variant="outline" className="text-xs">{cubicYards!.toLocaleString(undefined, { maximumFractionDigits: 2 })} cu yd</Badge>
                      )}
                    </>
                  ) : (
                    <Badge variant="outline" className="text-xs text-muted-foreground">Calibrate for sq ft</Badge>
                  )}
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Label</Label>
                  <Input className="h-8 w-36" value={area.label ?? ''} placeholder="Optional label" onChange={e => updateArea({ label: e.target.value })} />
                </div>
                {!isCoverage && (
                  <div className="space-y-1">
                    <Label className="text-xs">Depth (in)</Label>
                    <Input
                      type="number" min={0.5} step={0.5} className="h-8 w-20"
                      value={depthInches}
                      onChange={e => updateArea({ depthInches: Number(e.target.value) || 0 })}
                    />
                  </div>
                )}
                <InventoryLinkField
                  items={blueprintInventoryItems}
                  category={meta.inventoryCategory}
                  value={area.inventoryItemId}
                  onChange={id => updateArea({ inventoryItemId: id })}
                />
              </div>
            );
          })()}

          {/* Canvas */}
          <div ref={canvasContainerRef} className={`flex-1 bg-gray-50 dark:bg-zinc-950 relative overflow-hidden ${isPanning ? 'cursor-grabbing' : tool === 'select' ? 'cursor-grab' : 'cursor-crosshair'}`}>
            {/* Live map: a real Leaflet/Esri tile layer, driven programmatically off viewTransform (see effects
                above) — dragging/zooming the SVG on top pans & zooms this actual map underneath. */}
            {hasLiveMap && <div ref={mapContainerRef} className="absolute inset-0 z-0" />}
            <svg
              ref={svgRef}
              className="w-full h-full absolute inset-0"
              style={{ background: hasLiveMap ? 'transparent' : undefined }}
              onClick={handleSvgClick}
              onMouseDown={handleSvgMouseDown}
              onMouseMove={handleSvgMouseMove}
              onMouseUp={handleSvgMouseUp}
              onMouseLeave={handleSvgMouseUp}
            >
              <defs>
                <pattern id="grid-pattern" width="40" height="40" patternUnits="userSpaceOnUse">
                  <path d="M 40 0 L 0 0 0 40" fill="none" stroke="hsl(var(--border))" strokeWidth="0.5" strokeOpacity="0.5"/>
                </pattern>
              </defs>
              {hasLiveMap && (
                <text x={8} y={18} fontSize={10} fontFamily="monospace" fill="white" fillOpacity={0.85} pointerEvents="none">LIVE MAP</text>
              )}
              {!hasLiveMap && satelliteImage && !satelliteFailed && (
                <text x={8} y={18} fontSize={10} fontFamily="monospace" fill="white" fillOpacity={0.85} pointerEvents="none">TRACING PDF</text>
              )}

              {/* Everything below pans/zooms together; the HUD label above stays fixed. */}
              <g transform={`translate(${viewTransform.x}, ${viewTransform.y}) scale(${viewTransform.k})`}>
              {hasLiveMap ? null : satelliteImage && !satelliteFailed ? (
                <image
                  href={satelliteImage.url}
                  x={0} y={0}
                  width="100%" height="100%"
                  preserveAspectRatio="none"
                  pointerEvents="none"
                  onError={handleSatelliteImageError}
                />
              ) : (
                <rect width="100%" height="100%" fill="url(#grid-pattern)" pointerEvents="none" />
              )}

              {/* Ground-cover areas (gravel, dry river bed) */}
              {areas.map(area => {
                const meta = areaElementMeta(area.elementType);
                const isMultiSelected = multiSelect?.kind === 'area' && multiSelect.ids.includes(area.id);
                const isSelected = selectedAreaId === area.id || isMultiSelected;
                const pathD = `M ${area.polygon.map(p => `${p.x},${p.y}`).join(' L ')} Z`;
                const cx = area.polygon.reduce((s, p) => s + p.x, 0) / area.polygon.length;
                const cy = area.polygon.reduce((s, p) => s + p.y, 0) / area.polygon.length;
                const sqFt = scalePxPerFt ? pxAreaToSqFt(polygonAreaPx(area.polygon), scalePxPerFt) : null;
                const perimeterFt = scalePxPerFt ? pxLengthToFt(polygonPerimeterPx(area.polygon), scalePxPerFt) : null;
                return (
                  <g key={area.id}>
                    <path
                      d={pathD}
                      fill={meta.color}
                      fillOpacity={isSelected ? 0.45 : 0.3}
                      stroke={isMultiSelected ? 'hsl(var(--primary))' : isSelected ? 'hsl(var(--destructive))' : meta.color}
                      strokeWidth={isSelected ? 3 : 2}
                      strokeDasharray={isMultiSelected ? '4 2' : undefined}
                      className="cursor-pointer"
                      onClick={(e) => handleAreaClick(e, area.id)}
                    />
                    <text x={cx} y={cy} fontSize={10} textAnchor="middle" fill={meta.color} className="font-medium" pointerEvents="none" style={{ paintOrder: 'stroke', stroke: 'white', strokeWidth: 3 }}>
                      {area.label ?? meta.label}{sqFt !== null ? ` · ${sqFt.toLocaleString(undefined, { maximumFractionDigits: 0 })} sq ft` : ''}
                    </text>
                    {perimeterFt !== null && (
                      <text x={cx} y={cy + 12} fontSize={9} textAnchor="middle" fill={meta.color} pointerEvents="none" style={{ paintOrder: 'stroke', stroke: 'white', strokeWidth: 3 }}>
                        {perimeterFt.toLocaleString(undefined, { maximumFractionDigits: 0 })} ft perimeter
                      </text>
                    )}
                  </g>
                );
              })}

              {/* In-progress area drawing preview */}
              {tool === 'addArea' && areaDraftPoints.length > 0 && (
                <>
                  <path
                    d={`M ${areaDraftPoints.map(p => `${p.x},${p.y}`).join(' L ')}${areaDraftPoints.length >= 3 ? ` L ${mousePos.x},${mousePos.y} Z` : ` L ${mousePos.x},${mousePos.y}`}`}
                    fill={areaDraftPoints.length >= 3 ? areaElementMeta(pendingAreaType).color : 'none'}
                    fillOpacity={0.25}
                    stroke={areaElementMeta(pendingAreaType).color}
                    strokeWidth={2}
                    strokeDasharray="6 3"
                    pointerEvents="none"
                  />
                  {areaDraftPoints.map((p, i) => (
                    <circle key={i} cx={p.x} cy={p.y} r={4} fill={areaElementMeta(pendingAreaType).color} pointerEvents="none" />
                  ))}
                  {scalePxPerFt && (() => {
                    const draftPts = [...areaDraftPoints, mousePos];
                    const liveSqFt = areaDraftPoints.length >= 2 ? pxAreaToSqFt(polygonAreaPx(draftPts), scalePxPerFt) : 0;
                    const livePerimeterFt = pxLengthToFt(polygonPerimeterPx(draftPts), scalePxPerFt);
                    return (
                      <text x={mousePos.x + 10} y={mousePos.y - 10} fontSize={10} fontFamily="monospace" fill={areaElementMeta(pendingAreaType).color} pointerEvents="none" style={{ paintOrder: 'stroke', stroke: 'white', strokeWidth: 3 }}>
                        {liveSqFt.toLocaleString(undefined, { maximumFractionDigits: 0 })} sq ft · {livePerimeterFt.toLocaleString(undefined, { maximumFractionDigits: 0 })} ft
                      </text>
                    );
                  })()}
                </>
              )}

              {/* Sprinkler coverage radius previews */}
              {points.filter(p => p.elementType === 'sprinkler' && p.coverageRadiusFt && scalePxPerFt).map(p => (
                <circle
                  key={`radius_${p.id}`}
                  cx={p.x} cy={p.y}
                  r={(p.coverageRadiusFt ?? 0) * (scalePxPerFt ?? 0)}
                  fill="#38bdf8" fillOpacity={0.08}
                  stroke="#38bdf8" strokeOpacity={0.35} strokeWidth={1} strokeDasharray="3 3"
                  pointerEvents="none"
                />
              ))}

              {/* Delete-box drag preview */}
              {tool === 'delete' && deleteBoxStart && deleteBoxEnd && (
                <rect
                  x={Math.min(deleteBoxStart.x, deleteBoxEnd.x)}
                  y={Math.min(deleteBoxStart.y, deleteBoxEnd.y)}
                  width={Math.abs(deleteBoxEnd.x - deleteBoxStart.x)}
                  height={Math.abs(deleteBoxEnd.y - deleteBoxStart.y)}
                  fill="hsl(var(--destructive))" fillOpacity={0.1}
                  stroke="hsl(var(--destructive))" strokeWidth={1.5} strokeDasharray="4 3"
                  pointerEvents="none"
                />
              )}

              {/* Lines */}
              {lines.map(line => {
                const p1 = points.find(p => p.id === line.startId);
                const p2 = points.find(p => p.id === line.endId);
                if (!p1 || !p2) return null;
                const isMultiSelected = multiSelect?.kind === 'line' && multiSelect.ids.includes(line.id);
                const isSelected = selectedLineId === line.id || isMultiSelected;
                const isPipe = line.elementType === 'pipe';
                const isTrench = line.elementType === 'trench';
                const isRetainingWall = line.elementType === 'retainingWall';
                const lengthFt = lineLengthFt(p1, p2, scalePxPerFt);
                const midX = (p1.x + p2.x) / 2;
                const midY = (p1.y + p2.y) / 2;
                return (
                  <g key={line.id}>
                    <line
                      x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y}
                      stroke={isMultiSelected ? 'hsl(var(--primary))' : isSelected ? 'hsl(var(--destructive))' : isPipe ? '#0ea5e9' : isTrench ? '#f97316' : isRetainingWall ? '#57534e' : lineColor}
                      strokeWidth={isSelected ? 4 : isPipe ? 3 : isTrench ? 4 : isRetainingWall ? 5 : 2}
                      strokeDasharray={isMultiSelected ? '3 3' : isTrench ? '8 4' : undefined}
                      className="cursor-pointer transition-colors"
                      onClick={(e) => handleLineClick(e, line.id)}
                    />
                    {isRetainingWall && (
                      <text
                        x={midX} y={midY - 6}
                        fontSize={10}
                        textAnchor="middle"
                        fill={isSelected ? 'hsl(var(--destructive))' : '#44403c'}
                        pointerEvents="none"
                        className="font-medium"
                        style={{ paintOrder: 'stroke', stroke: 'white', strokeWidth: 3 }}
                      >
                        Retaining Wall{lengthFt !== null ? ` · ${lengthFt.toFixed(1)} ft` : ''}
                      </text>
                    )}
                    {isPipe && (
                      <text
                        x={midX} y={midY - 6}
                        fontSize={10}
                        textAnchor="middle"
                        fill={isSelected ? 'hsl(var(--destructive))' : '#0369a1'}
                        pointerEvents="none"
                        className="font-medium"
                      >
                        {line.pipeType}{lengthFt !== null ? ` · ${lengthFt.toFixed(1)} ft` : ''}
                      </text>
                    )}
                    {isTrench && (
                      <text
                        x={midX} y={midY - 6}
                        fontSize={10}
                        textAnchor="middle"
                        fill={isSelected ? 'hsl(var(--destructive))' : '#c2410c'}
                        pointerEvents="none"
                        className="font-medium"
                        style={{ paintOrder: 'stroke', stroke: 'white', strokeWidth: 3 }}
                      >
                        {line.label ?? 'Trench'}{lengthFt !== null ? ` · ${lengthFt.toFixed(1)} ft` : ''}
                      </text>
                    )}
                  </g>
                );
              })}

              {/* Drawing Line preview */}
              {drawingLineStartId && tool === 'addLine' && (() => {
                const p1 = points.find(p => p.id === drawingLineStartId);
                if (!p1) return null;
                const previewLengthFt = lineLengthFt(p1, mousePos, scalePxPerFt);
                return (
                  <>
                    <line
                      x1={p1.x} y1={p1.y} x2={mousePos.x} y2={mousePos.y}
                      stroke={pendingLineType === 'pipe' ? '#0ea5e9' : lineColor} strokeWidth={2} strokeDasharray="4 4"
                      pointerEvents="none"
                    />
                    {previewLengthFt !== null && (
                      <text x={mousePos.x + 10} y={mousePos.y - 10} fontSize={10} fill="#0369a1" pointerEvents="none">
                        {previewLengthFt.toFixed(1)} ft
                      </text>
                    )}
                  </>
                )
              })()}

              {/* Calibration line preview */}
              {tool === 'calibrate' && calibStart && (
                <>
                  <circle cx={calibStart.x} cy={calibStart.y} r={5} fill="hsl(var(--primary))" pointerEvents="none" />
                  <line
                    x1={calibStart.x} y1={calibStart.y}
                    x2={calibEnd ? calibEnd.x : mousePos.x}
                    y2={calibEnd ? calibEnd.y : mousePos.y}
                    stroke="hsl(var(--primary))" strokeWidth={2} strokeDasharray="6 3"
                    pointerEvents="none"
                  />
                  {calibEnd && (
                    <circle cx={calibEnd.x} cy={calibEnd.y} r={5} fill="hsl(var(--primary))" pointerEvents="none" />
                  )}
                </>
              )}

              {/* Saved AI design zones */}
              {aiZones.map((zone, i) => {
                const color = ZONE_COLORS[i % ZONE_COLORS.length];
                const pathD = `M ${zone.polygon.map(p => `${p.x},${p.y}`).join(' L ')} Z`;
                const cx = zone.polygon.reduce((s, p) => s + p.x, 0) / zone.polygon.length;
                const cy = zone.polygon.reduce((s, p) => s + p.y, 0) / zone.polygon.length;
                return (
                  <g key={zone.id} pointerEvents="none">
                    <path d={pathD} fill={color} fillOpacity={0.15} stroke={color} strokeWidth={2} strokeDasharray="6 3" />
                    <text x={cx} y={cy} fontSize={11} textAnchor="middle" fill={color} className="font-semibold" style={{ paintOrder: 'stroke', stroke: 'white', strokeWidth: 3 }}>
                      {zone.label}
                    </text>
                  </g>
                );
              })}

              {/* In-progress zone drawing preview */}
              {tool === 'zone' && zoneDraftPoints.length > 0 && (
                <>
                  <path
                    d={`M ${zoneDraftPoints.map(p => `${p.x},${p.y}`).join(' L ')}${zoneDraftPoints.length >= 3 ? ` L ${mousePos.x},${mousePos.y} Z` : ` L ${mousePos.x},${mousePos.y}`}`}
                    fill={zoneDraftPoints.length >= 3 ? '#f59e0b' : 'none'}
                    fillOpacity={0.15}
                    stroke="#f59e0b"
                    strokeWidth={2}
                    strokeDasharray="6 3"
                    pointerEvents="none"
                  />
                  {zoneDraftPoints.map((p, i) => (
                    <circle key={i} cx={p.x} cy={p.y} r={4} fill="#f59e0b" pointerEvents="none" />
                  ))}
                </>
              )}

              {/* Nodes */}
              {points.map(point => {
                const isMultiSelected = multiSelect?.kind === 'point' && multiSelect.ids.includes(point.id);
                const isSelected = selectedPointId === point.id || isMultiSelected;
                const isDrawingStart = drawingLineStartId === point.id;
                const meta = resolvePointMeta(point);
                const isLegacyUnknown = isLegacyUnknownPoint(point);
                const isSpecial = isLegacyUnknown || (!!point.elementType && point.elementType !== 'node');
                const displayLabel = point.label ?? (point.elementType === 'sprinkler' ? point.sprinklerHeadType : undefined);
                return (
                  <g key={point.id} transform={`translate(${point.x}, ${point.y})`}>
                    <circle
                      r={isDrawingStart ? 10 : isSpecial ? 9 : 8}
                      fill={isMultiSelected ? 'hsl(var(--primary))' : isSelected || isDrawingStart ? 'hsl(var(--destructive))' : isSpecial ? meta.color : nodeColor}
                      stroke={isSelected ? 'white' : isLegacyUnknown ? 'white' : point.inventoryItemId ? '#22c55e' : 'transparent'}
                      strokeWidth={isLegacyUnknown && !isSelected ? 1.5 : point.inventoryItemId && !isSelected ? 2.5 : 2}
                      strokeDasharray={isLegacyUnknown && !isSelected ? '2.5,2' : undefined}
                      className="cursor-pointer transition-all hover:opacity-80"
                      onClick={(e) => handlePointClick(e, point.id)}
                      onMouseDown={(e) => handlePointMouseDown(e, point.id)}
                    />
                    {isLegacyUnknown && !isSelected && !isDrawingStart && (
                      <text y={3} textAnchor="middle" fontSize={9} fontWeight={700} fill="white" pointerEvents="none">?</text>
                    )}
                    {isIrrigation && !isSpecial && !isSelected && !isDrawingStart && (
                      <circle r={3} fill="white" pointerEvents="none" />
                    )}
                    {displayLabel && !isSelected && (
                      <text y={-13} textAnchor="middle" fontSize={9} fill={meta.color} className="font-medium" pointerEvents="none">
                        {displayLabel}
                      </text>
                    )}
                  </g>
                );
              })}

              {/* AI preview overlay — ghost render of what Accept would add; not yet saved, not interactive */}
              {aiPreview && (
                <g pointerEvents="none" opacity={0.75}>
                  {aiPreview.areas.map(area => {
                    const meta = areaElementMeta(area.elementType);
                    const pathD = `M ${area.polygon.map(p => `${p.x},${p.y}`).join(' L ')} Z`;
                    return <path key={area.id} d={pathD} fill={meta.color} fillOpacity={0.25} stroke="#f59e0b" strokeWidth={2} strokeDasharray="6 3" />;
                  })}
                  {aiPreview.lines.map(line => {
                    const p1 = [...points, ...aiPreview.points].find(p => p.id === line.startId);
                    const p2 = [...points, ...aiPreview.points].find(p => p.id === line.endId);
                    if (!p1 || !p2) return null;
                    return <line key={line.id} x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} stroke="#f59e0b" strokeWidth={2.5} strokeDasharray="6 3" />;
                  })}
                  {aiPreview.points.map(point => (
                    <circle key={point.id} cx={point.x} cy={point.y} r={7} fill="none" stroke="#f59e0b" strokeWidth={2} strokeDasharray="3 2" />
                  ))}
                </g>
              )}
              </g>
            </svg>
          </div>
        </Card>

        {/* Estimation Panel */}
        <Card className="w-80 flex flex-col shrink-0 shadow-md">
          <CardHeader className="py-4 border-b bg-muted/10">
            <CardTitle className="text-lg flex items-center gap-2">
              <Calculator className="w-5 h-5" /> Estimate
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0 flex-1 overflow-y-auto">
            {/* Real-world measurements */}
            {scalePxPerFt && (
              <div className="p-4 border-b bg-muted/10 space-y-1">
                <p className="text-xs font-medium flex items-center gap-1.5 text-muted-foreground">
                  <Ruler className="w-3.5 h-3.5" /> Real-World Measurements
                </p>
                <p className="text-xs text-muted-foreground">Scale: {scalePxPerFt.toFixed(2)} px/ft</p>
                {totalAreaSqFt !== null && (
                  <p className="text-sm font-semibold">
                    Area: {totalAreaSqFt.toLocaleString(undefined, { maximumFractionDigits: 1 })} sq ft
                  </p>
                )}
                {areas.length > 0 && (
                  <div className="pt-1 space-y-0.5">
                    {areas.map(a => {
                      const meta = areaElementMeta(a.elementType);
                      const sqFt = pxAreaToSqFt(polygonAreaPx(a.polygon), scalePxPerFt);
                      return (
                        <p key={a.id} className="text-xs flex items-center gap-1.5">
                          <span className="w-2 h-2 rounded-full inline-block" style={{ backgroundColor: meta.color }} />
                          {a.label ?? meta.label}: {sqFt !== null ? sqFt.toLocaleString(undefined, { maximumFractionDigits: 1 }) : '—'} sq ft
                        </p>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {blueprint?.totalEstimate !== undefined && blueprint?.totalEstimate !== null ? (
              <div className="p-4 space-y-6">
                <div className="p-4 bg-primary/5 rounded-lg border border-primary/20 text-center">
                  <p className="text-sm font-medium text-primary mb-1">Total Estimated Cost</p>
                  <p className="text-4xl font-bold tracking-tight text-primary">${blueprint.totalEstimate.toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
                </div>
                
                <div className="space-y-3 pt-4 border-t">
                  <div className="flex items-center justify-between">
                    <label className="text-sm font-medium">Overage Buffer</label>
                    <div className="flex items-center gap-1 w-24">
                      <Input 
                        type="number" 
                        value={blueprint.overageBufferPercent || 15} 
                        className="h-8 text-right pr-1"
                        onChange={(e) => {
                          const val = Number(e.target.value);
                          updateBlueprint.mutate({ id, data: { overageBufferPercent: val }});
                        }}
                      />
                      <span className="text-sm text-muted-foreground">%</span>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground">Adjust buffer percentage to account for waste/spoilage.</p>
                </div>

                {estimateResult && estimateResult.parts.length > 0 && (
                  <div className="space-y-2 pt-4 border-t">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-medium">Parts Breakdown</p>
                      {estimateResult.parts.some(p => p.orderNeeded) && (
                        <Badge variant="destructive" className="text-[10px] gap-1"><AlertTriangle className="w-3 h-3" /> Order needed</Badge>
                      )}
                    </div>
                    <div className="space-y-1.5">
                      {estimateResult.parts.map(part => (
                        <div key={part.inventoryItemId} className="flex items-center justify-between text-xs gap-2">
                          <div className="min-w-0">
                            <p className="truncate font-medium">{part.name}</p>
                            <p className="text-muted-foreground">
                              {part.quantity.toLocaleString(undefined, { maximumFractionDigits: 1 })} {part.unit ?? 'each'}
                              {part.source && part.source !== 'generic' && (
                                <span className="ml-1 opacity-70">
                                  ({part.source === 'canvas' ? 'from canvas' : part.source === 'manual' ? 'manual' : 'canvas + manual'})
                                </span>
                              )}
                            </p>
                            {part.warehouseStock !== undefined && (
                              <p className={`mt-0.5 ${part.orderNeeded ? 'text-destructive' : 'text-muted-foreground'}`}>
                                {part.warehouseStock.toLocaleString(undefined, { maximumFractionDigits: 1 })} on hand
                                {part.orderNeeded && ' · order more'}
                              </p>
                            )}
                          </div>
                          <p className="font-medium shrink-0">${part.total.toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="h-full flex flex-col items-center justify-center p-8 text-center text-muted-foreground">
                <Calculator className="w-12 h-12 mb-4 opacity-20" />
                <p className="font-medium mb-1">No Estimate Generated</p>
                <p className="text-sm">Draw your nodes and lines, then click Calculate Estimate.</p>
                {!scalePxPerFt && (
                  <p className="text-xs mt-3 text-muted-foreground/70">Tip: Use the Ruler tool to calibrate real-world scale for area measurements in sq ft.</p>
                )}
              </div>
            )}

            {/* Linked Quotes */}
            {blueprint?.linkedQuotes && blueprint.linkedQuotes.length > 0 && (
              <div className="p-4 border-t space-y-2">
                <p className="text-sm font-medium flex items-center gap-1.5">
                  <Receipt className="w-4 h-4" /> Linked Quotes
                </p>
                <div className="space-y-2">
                  {blueprint.linkedQuotes.map((q) => {
                    const statusVariant =
                      q.status === 'approved' ? 'default' :
                      q.status === 'declined' ? 'destructive' : 'outline';
                    const statusLabel =
                      q.status === 'approved' ? 'Approved' :
                      q.status === 'declined' ? 'Declined' : 'Pending';
                    return (
                      <div key={q.id} className="rounded-md border p-2.5 text-xs space-y-1 bg-muted/20">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-muted-foreground font-mono">Quote #{q.id}</span>
                          <Badge variant={statusVariant} className="text-[10px] px-1.5 py-0">
                            {statusLabel}
                          </Badge>
                        </div>
                        <p className="font-semibold text-sm">${q.calculatedPrice.toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
                        {q.expiresAt && (
                          <p className="text-muted-foreground">
                            Expires {format(new Date(q.expiresAt), 'MMM d, yyyy')}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Calibration dialog */}
      <Dialog open={calibDialogOpen} onOpenChange={open => { if (!open) { setCalibDialogOpen(false); setCalibStart(null); setCalibEnd(null); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Set Real-World Scale</DialogTitle>
            <DialogDescription>
              You drew a reference line on the canvas. Enter its real-world length in feet so the app can compute actual area in square feet.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <label className="text-sm font-medium">Length of the reference line (feet)</label>
            <Input
              type="number"
              min={0.1}
              step={0.5}
              placeholder="e.g. 20"
              value={calibFeetInput}
              onChange={e => setCalibFeetInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleConfirmCalibration(); }}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setCalibDialogOpen(false); setCalibStart(null); setCalibEnd(null); }}>Cancel</Button>
            <Button onClick={handleConfirmCalibration}>Apply Scale</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Zone materials dialog — pick which fixtures/materials AI should use inside this zone */}
      <Dialog open={materialsDialogOpen} onOpenChange={open => { if (!open) { setMaterialsDialogOpen(false); setPendingZonePolygon(null); setEditingZoneId(null); } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Wand2 className="w-5 h-5" /> {editingZoneId ? 'Edit Zone Materials' : 'Choose Materials for This Zone'}</DialogTitle>
            <DialogDescription>
              AI will only place these materials inside the drawn area — the rest of the property is left untouched.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label className="text-xs">Zone Label</Label>
              <Input value={zoneLabelDraft} onChange={e => setZoneLabelDraft(e.target.value)} placeholder="e.g. Front Bed" />
            </div>
            <div className="space-y-1.5 rounded-md border p-2.5 bg-muted/20">
              <Label className="text-xs flex items-center gap-1"><Library className="w-3 h-3" /> Load materials from a saved template</Label>
              <Select
                value=""
                onValueChange={v => setLoadingTemplateId(Number(v))}
                disabled={templateOptions.length === 0 || loadingTemplateId != null}
              >
                <SelectTrigger className="h-8">
                  <SelectValue placeholder={templateOptions.length === 0 ? 'No saved templates yet' : loadingTemplateId != null ? 'Loading...' : 'Pick a template to start from...'} />
                </SelectTrigger>
                <SelectContent>
                  {templateOptions.map((t: any) => (
                    <SelectItem key={t.id} value={String(t.id)}>{t.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">Copies the distinct fixture/material types used on that template's canvas as a starting point — still fully editable below.</p>
            </div>
            <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
              {ZONE_MATERIAL_PALETTE.map(p => {
                const material = zoneMaterialsDraft.find(m => m.elementType === p.type);
                const checked = !!material;
                return (
                  <div key={p.type} className={`rounded-md border p-2.5 space-y-2 transition-colors ${checked ? 'border-primary/50 bg-primary/5' : ''}`}>
                    <div className="flex items-center gap-2">
                      <Checkbox checked={checked} onCheckedChange={(v) => toggleZoneMaterial(p.type, v === true)} id={`mat-${p.type}`} />
                      <label htmlFor={`mat-${p.type}`} className="flex items-center gap-1.5 text-sm font-medium cursor-pointer flex-1">
                        <p.icon className="w-4 h-4" style={{ color: p.color }} /> {p.label}
                      </label>
                    </div>
                    {checked && (
                      <div className="pl-6 flex flex-wrap items-center gap-2">
                        <div className="flex items-center gap-1.5">
                          <Link2 className="w-3 h-3 text-muted-foreground" />
                          <Select
                            value={material?.inventoryItemId != null ? String(material.inventoryItemId) : 'none'}
                            onValueChange={v => updateZoneMaterial(p.type, { inventoryItemId: v === 'none' ? null : Number(v) })}
                          >
                            <SelectTrigger className="h-7 w-48 text-xs"><SelectValue placeholder="Inventory item (optional)" /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">No specific item</SelectItem>
                              {filteredInventoryItems(blueprintInventoryItems, p.inventoryCategory).map(item => (
                                <SelectItem key={item.id} value={String(item.id)}>{item.name} · {item.sku}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        {p.type === 'sprinkler' && (
                          <Select
                            value={material?.pipeType ?? PIPE_TYPES[0]}
                            onValueChange={v => updateZoneMaterial(p.type, { pipeType: v })}
                          >
                            <SelectTrigger className="h-7 w-40 text-xs"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {PIPE_TYPES.map(pt => <SelectItem key={pt} value={pt}>{pt}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setMaterialsDialogOpen(false); setPendingZonePolygon(null); setEditingZoneId(null); }}>Cancel</Button>
            <Button onClick={saveZoneMaterials} className="gap-2">
              <Check className="w-4 h-4" /> {editingZoneId ? 'Save Changes' : 'Add Zone'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <AlertDialog open={deleteBlueprintOpen} onOpenChange={setDeleteBlueprintOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete "{blueprint?.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes the blueprint and its canvas layout. Jobs and estimates that referenced it will be unlinked, not deleted. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                deleteBlueprintMutation.mutate({ id }, {
                  onSuccess: () => {
                    toast.success('Blueprint deleted');
                    queryClient.invalidateQueries({ queryKey: getListBlueprintsQueryKey() });
                    setLocation('/blueprints');
                  },
                  onError: () => toast.error('Failed to delete blueprint'),
                });
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
