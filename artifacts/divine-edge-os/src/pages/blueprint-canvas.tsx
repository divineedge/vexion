import React, { useState, useRef, useEffect, useCallback, useMemo, MouseEvent } from 'react';
import { useParams, useLocation } from 'wouter';
import { 
  useGetBlueprint, getGetBlueprintQueryKey,
  useUpdateBlueprint, useCalculateBlueprintEstimate,
  useGetProperty, getGetPropertyQueryKey,
  useListInventoryItems, getListInventoryItemsQueryKey,
} from '@workspace/api-client-react';
import type { EstimatedPart } from '@workspace/api-client-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  ArrowLeft, Save, MousePointer2, PlusCircle, Minus, Trash2, Calculator, Ruler,
  ChevronDown, TreeDeciduous, Mountain, Waves, Hash, Layers, SprayCan, Link2,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';

/** Specific fixture/material types placeable as points on the canvas, beyond the plain generic point. */
type PointElementType =
  | 'node' | 'sprinkler' | 'tree' | 'largeRock' | 'dryRiverBed'
  | 'gravel_1in' | 'gravel_2in' | 'gravel_3in' | 'gravel_4in' | 'trench';

/** Specific types for line segments, beyond the plain generic edge. */
type LineElementType = 'edge' | 'pipe';

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
};

type Line = {
  id: string; startId: string; endId: string;
  /** Specific line type; omitted/'edge' = plain generic edge (legacy behavior). */
  elementType?: LineElementType;
  /** Pipe class/size, only meaningful when elementType === 'pipe'. */
  pipeType?: string;
  /** Optional link to a flagged inventory item; quantity pulled is the real-world length in feet. */
  inventoryItemId?: number | null;
};

type CanvasData = { points: Point[], lines: Line[] };

type ToolMode = 'select' | 'addNode' | 'addLine' | 'delete' | 'calibrate';

const POINT_PALETTE: { type: PointElementType; label: string; icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>; color: string }[] = [
  { type: 'node', label: 'Generic Point', icon: PlusCircle, color: 'hsl(var(--muted-foreground))' },
  { type: 'sprinkler', label: 'Sprinkler', icon: SprayCan, color: '#38bdf8' },
  { type: 'tree', label: 'Tree', icon: TreeDeciduous, color: '#16a34a' },
  { type: 'largeRock', label: 'Large Rock', icon: Mountain, color: '#78716c' },
  { type: 'dryRiverBed', label: 'Dry River Bed', icon: Waves, color: '#0891b2' },
  { type: 'gravel_1in', label: 'Gravel (1")', icon: Layers, color: '#d6b98c' },
  { type: 'gravel_2in', label: 'Gravel (2")', icon: Layers, color: '#c9a876' },
  { type: 'gravel_3in', label: 'Gravel (3")', icon: Layers, color: '#bb9660' },
  { type: 'gravel_4in', label: 'Gravel (4")', icon: Layers, color: '#ad844a' },
  { type: 'trench', label: 'Trench (numbered)', icon: Hash, color: '#f97316' },
];

const SPRINKLER_HEAD_TYPES = ['Rotor', 'Spray', 'Drip / Micro', 'Bubbler', 'MP Rotator'];

const PIPE_TYPES = [
  'PVC Sch40 1/2"', 'PVC Sch40 3/4"', 'PVC Sch40 1"',
  'PVC Class200 3/4"', 'PVC Class200 1"', 'PVC Class200 1.5"',
  'Poly 1/2"', 'Poly 3/4"', 'Copper 1/2"',
];

function pointElementMeta(elementType: PointElementType | undefined) {
  return POINT_PALETTE.find(p => p.type === (elementType ?? 'node')) ?? POINT_PALETTE[0];
}

/** Real-world length of a line segment in feet, given the calibrated scale. Null if not calibrated. */
function lineLengthFt(p1: { x: number; y: number } | undefined, p2: { x: number; y: number } | undefined, scale: number | null | undefined): number | null {
  if (!p1 || !p2 || !scale || scale <= 0) return null;
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  return Math.sqrt(dx * dx + dy * dy) / scale;
}

/** Shoelace formula — area of a polygon from ordered vertices (px²) */
function polygonAreaPx(pts: Point[]): number {
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

const METERS_PER_FOOT = 0.3048;
const METERS_PER_DEGREE_LAT = 111320;
/** Real-world east-west span (in feet) the satellite backdrop should cover. */
const SATELLITE_SPAN_FT = 300;

/** Build an ESRI World Imagery static export URL centered on lat/lng, sized to match the canvas aspect ratio. */
function buildSatelliteImageUrl(lat: number, lng: number, widthPx: number, heightPx: number): { url: string; widthFt: number; heightFt: number } {
  const widthFt = SATELLITE_SPAN_FT;
  const heightFt = widthFt * (heightPx / widthPx);
  const widthM = widthFt * METERS_PER_FOOT;
  const heightM = heightFt * METERS_PER_FOOT;
  const deltaLat = (heightM / 2) / METERS_PER_DEGREE_LAT;
  const metersPerDegreeLng = METERS_PER_DEGREE_LAT * Math.cos((lat * Math.PI) / 180);
  const deltaLng = (widthM / 2) / metersPerDegreeLng;
  const xmin = lng - deltaLng;
  const xmax = lng + deltaLng;
  const ymin = lat - deltaLat;
  const ymax = lat + deltaLat;
  const size = `${Math.max(1, Math.round(widthPx))},${Math.max(1, Math.round(heightPx))}`;
  const url = `https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/export?bbox=${xmin},${ymin},${xmax},${ymax}&bboxSR=4326&size=${size}&format=png&f=image`;
  return { url, widthFt, heightFt };
}

/** Resolve whether an image URL actually loads (the ESRI export service errors on some pixel sizes when the requested
 * resolution exceeds the available imagery cache for a given location — this can't be predicted up front). */
function probeImageLoads(url: string, timeoutMs = 8000): Promise<boolean> {
  return new Promise((resolve) => {
    const img = new window.Image();
    const timer = setTimeout(() => { img.onload = null; img.onerror = null; resolve(false); }, timeoutMs);
    img.onload = () => { clearTimeout(timer); resolve(true); };
    img.onerror = () => { clearTimeout(timer); resolve(false); };
    img.src = url;
  });
}

/** Try progressively smaller export sizes (same aspect ratio) until one is actually servable by the imagery cache. */
async function resolveSatelliteImage(lat: number, lng: number, aspect: number): Promise<{ url: string; widthFt: number; heightFt: number } | null> {
  const candidateWidths = [1024, 768, 512, 384, 256, 160];
  for (const w of candidateWidths) {
    const h = Math.max(1, Math.round(w / aspect));
    const built = buildSatelliteImageUrl(lat, lng, w, h);
    // eslint-disable-next-line no-await-in-loop
    if (await probeImageLoads(built.url)) return built;
  }
  return null;
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
  const calcEstimate = useCalculateBlueprintEstimate();

  const svgRef = useRef<SVGSVGElement>(null);
  const canvasContainerRef = useRef<HTMLDivElement>(null);

  // ── Satellite backdrop ───────────────────────────────────────────────────────
  const propertyId = blueprint?.propertyId ?? 0;
  const { data: property } = useGetProperty(propertyId, {
    query: { enabled: !!blueprint?.propertyId, queryKey: getGetPropertyQueryKey(propertyId) },
  });
  const [satelliteImage, setSatelliteImage] = useState<{ url: string; widthFt: number; heightFt: number } | null>(null);
  const [satelliteFailed, setSatelliteFailed] = useState(false);
  const satelliteBuiltRef = useRef(false);
  const autoScaleAppliedRef = useRef(false);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });

  const [tool, setTool] = useState<ToolMode>('select');
  const [points, setPoints] = useState<Point[]>([]);
  const [lines, setLines] = useState<Line[]>([]);
  
  const [selectedPointId, setSelectedPointId] = useState<string | null>(null);
  const [selectedLineId, setSelectedLineId] = useState<string | null>(null);
  
  const [draggingPointId, setDraggingPointId] = useState<string | null>(null);
  const [drawingLineStartId, setDrawingLineStartId] = useState<string | null>(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });

  // ── Palette: which specific fixture/material type is placed by the current add tools ──────
  const [pendingPointType, setPendingPointType] = useState<PointElementType>('node');
  const [pendingLineType, setPendingLineType] = useState<LineElementType>('edge');
  const [pendingPipeType, setPendingPipeType] = useState<string>(PIPE_TYPES[0]);
  const [pointPaletteOpen, setPointPaletteOpen] = useState(false);
  const [linePaletteOpen, setLinePaletteOpen] = useState(false);

  // Inventory items flagged as usable in the Blueprint canvas palette, for linking placed elements.
  const { data: blueprintInventoryItems } = useListInventoryItems(
    { availableForBlueprint: true },
    { query: { queryKey: getListInventoryItemsQueryKey({ availableForBlueprint: true }) } },
  );

  // Last calculated itemized estimate breakdown (parts list), shown alongside the total.
  const [estimateResult, setEstimateResult] = useState<{ parts: EstimatedPart[]; subtotal: number; overageAmount: number; total: number } | null>(null);

  const nextTrenchNumber = useMemo(
    () => points.filter(p => p.elementType === 'trench').length + 1,
    [points],
  );

  // ── Calibration state ────────────────────────────────────────────────────────
  const [calibStart, setCalibStart] = useState<{ x: number; y: number } | null>(null);
  const [calibEnd, setCalibEnd] = useState<{ x: number; y: number } | null>(null);
  const [calibDialogOpen, setCalibDialogOpen] = useState(false);
  const [calibFeetInput, setCalibFeetInput] = useState('');
  const [scalePxPerFt, setScalePxPerFt] = useState<number | null>(null);

  // Init canvas data and scale from blueprint
  useEffect(() => {
    if (blueprint?.canvasData) {
      const data = blueprint.canvasData as unknown as CanvasData;
      if (data.points) setPoints(data.points);
      if (data.lines) setLines(data.lines);
    }
    if (blueprint?.scalePxPerFt != null) {
      setScalePxPerFt(blueprint.scalePxPerFt);
    }
  }, [blueprint]);

  // Reset satellite backdrop state when switching blueprints/properties
  useEffect(() => {
    satelliteBuiltRef.current = false;
    autoScaleAppliedRef.current = false;
    setSatelliteImage(null);
    setSatelliteFailed(false);
  }, [blueprint?.id, blueprint?.propertyId]);

  // Track the canvas container's pixel size so we can size/frame the satellite image to match.
  useEffect(() => {
    const container = canvasContainerRef.current;
    if (!container) return;
    const update = () => setContainerSize({ width: container.clientWidth, height: container.clientHeight });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  // Build the satellite backdrop once we know the property's location and the canvas's pixel size.
  // Falls back silently to the blank/grid canvas when there's no property, no coordinates, or the imagery can't be found.
  useEffect(() => {
    if (satelliteBuiltRef.current) return;
    if (!blueprint?.propertyId) return;
    if (!property || property.lat == null || property.lng == null) return;
    const widthPx = containerSize.width;
    const heightPx = containerSize.height;
    if (!widthPx || !heightPx) return;

    satelliteBuiltRef.current = true;
    let cancelled = false;
    const aspect = widthPx / heightPx;
    resolveSatelliteImage(property.lat, property.lng, aspect).then((built) => {
      if (cancelled) return;
      if (!built) {
        setSatelliteFailed(true);
        return;
      }
      setSatelliteImage(built);

      // Give the user a sensible starting scale so the Calibrate tool has a real-world baseline to fine-tune,
      // but never clobber a scale that was already set (loaded from the blueprint or set by the user this session).
      // Use the functional updater so this always checks the *latest* scale at the moment it applies, not a
      // value captured in this effect's closure — the blueprint's persisted scale can finish loading afterward.
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
          toast.message('Scale estimated from satellite imagery', {
            description: 'Use the Calibrate tool to fine-tune against a known distance in the image.',
          });
        }
      }
    });
    return () => { cancelled = true; };
  }, [blueprint?.propertyId, property, containerSize]);

  const handleSatelliteImageError = useCallback(() => {
    setSatelliteFailed(true);
    setSatelliteImage(null);
  }, []);

  const getCoordinates = (e: MouseEvent) => {
    if (!svgRef.current) return { x: 0, y: 0 };
    const CTM = svgRef.current.getScreenCTM();
    if (!CTM) return { x: 0, y: 0 };
    return {
      x: (e.clientX - CTM.e) / CTM.a,
      y: (e.clientY - CTM.f) / CTM.d
    };
  };

  const handleSvgClick = (e: MouseEvent) => {
    const coords = getCoordinates(e);
    
    if (tool === 'addNode') {
      const newPoint: Point = { id: `p_${Date.now()}`, x: coords.x, y: coords.y, elementType: pendingPointType };
      if (pendingPointType === 'trench') newPoint.label = `Trench ${nextTrenchNumber}`;
      if (pendingPointType === 'sprinkler') newPoint.sprinklerHeadType = SPRINKLER_HEAD_TYPES[0];
      setPoints([...points, newPoint]);
    } else if (tool === 'select') {
      setSelectedPointId(null);
      setSelectedLineId(null);
    } else if (tool === 'calibrate') {
      if (!calibStart) {
        setCalibStart(coords);
        setCalibEnd(null);
      } else {
        setCalibEnd(coords);
        setCalibDialogOpen(true);
      }
    }
  };

  const handleSvgMouseMove = (e: MouseEvent) => {
    const coords = getCoordinates(e);
    setMousePos(coords);

    if (draggingPointId && tool === 'select') {
      setPoints(points.map(p => p.id === draggingPointId ? { ...p, x: coords.x, y: coords.y } : p));
    }
  };

  const handleSvgMouseUp = () => {
    setDraggingPointId(null);
  };

  const handlePointClick = (e: MouseEvent, pointId: string) => {
    e.stopPropagation();
    
    if (tool === 'select') {
      setSelectedPointId(pointId);
      setSelectedLineId(null);
    } else if (tool === 'delete') {
      setPoints(points.filter(p => p.id !== pointId));
      setLines(lines.filter(l => l.startId !== pointId && l.endId !== pointId));
    } else if (tool === 'addLine') {
      if (!drawingLineStartId) {
        setDrawingLineStartId(pointId);
      } else if (drawingLineStartId !== pointId) {
        const newLine: Line = { id: `l_${Date.now()}`, startId: drawingLineStartId, endId: pointId, elementType: pendingLineType };
        if (pendingLineType === 'pipe') newLine.pipeType = pendingPipeType;
        setLines([...lines, newLine]);
        setDrawingLineStartId(null);
      }
    }
  };

  const handlePointMouseDown = (e: MouseEvent, pointId: string) => {
    if (tool === 'select') {
      setDraggingPointId(pointId);
    }
  };

  const handleLineClick = (e: MouseEvent, lineId: string) => {
    e.stopPropagation();
    if (tool === 'select') {
      setSelectedLineId(lineId);
      setSelectedPointId(null);
    } else if (tool === 'delete') {
      setLines(lines.filter(l => l.id !== lineId));
    }
  };

  const handleSave = () => {
    const canvasData = { points, lines };
    const updateData: Record<string, unknown> = { canvasData };
    if (scalePxPerFt != null) updateData.scalePxPerFt = scalePxPerFt;
    updateBlueprint.mutate({ id, data: updateData as Parameters<typeof updateBlueprint.mutate>[0]['data'] }, {
      onSuccess: () => {
        toast.success('Blueprint saved');
        queryClient.invalidateQueries({ queryKey: getGetBlueprintQueryKey(id) });
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
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedPointId, selectedLineId]);

  if (isLoading) return <div className="p-8 text-center">Loading...</div>;
  if (!blueprint && !isLoading) return <div className="p-8 text-center">Blueprint not found.</div>;

  const isIrrigation = blueprint?.mode === 'irrigation';
  const hasSatelliteBackdrop = !!satelliteImage && !satelliteFailed;
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
            </div>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleSave} disabled={updateBlueprint.isPending} className="gap-2">
            <Save className="w-4 h-4" /> Save
          </Button>
          <Button onClick={handleCalculate} disabled={calcEstimate.isPending || updateBlueprint.isPending} className="gap-2">
            <Calculator className="w-4 h-4" /> Calculate Estimate
          </Button>
        </div>
      </div>

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
                  <span className="text-[10px] max-w-[5.5rem] truncate">{pendingLineType === 'pipe' ? pendingPipeType : 'Generic Edge'}</span>
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
              </PopoverContent>
            </Popover>
            <div className="w-px h-6 bg-border mx-1" />
            <Button variant={tool === 'delete' ? 'destructive' : 'ghost'} size="sm" onClick={() => { setTool('delete'); setDrawingLineStartId(null); }} title="Delete">
              <Trash2 className="w-4 h-4" />
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
            <span className="ml-auto text-xs text-muted-foreground mr-2 capitalize">
              {tool === 'calibrate' && !calibStart ? 'Click first point of reference line' :
               tool === 'calibrate' && calibStart ? 'Click second point of reference line' :
               `Mode: ${tool.replace(/([A-Z])/g, ' $1')}`}
            </span>
          </div>

          {/* Selected element details */}
          {tool === 'select' && selectedPointId && (() => {
            const pt = points.find(p => p.id === selectedPointId);
            if (!pt) return null;
            const meta = pointElementMeta(pt.elementType);
            const updatePoint = (patch: Partial<Point>) => setPoints(pts => pts.map(p => p.id === pt.id ? { ...p, ...patch } : p));
            return (
              <div className="border-b p-3 flex flex-wrap items-end gap-3 bg-muted/10">
                <div className="flex items-center gap-1.5">
                  <meta.icon className="w-4 h-4" style={{ color: meta.color }} />
                  <span className="text-sm font-medium">{meta.label}</span>
                </div>
                {(pt.elementType === 'trench' || !pt.elementType || pt.elementType === 'node') && (
                  <div className="space-y-1">
                    <Label className="text-xs">Label</Label>
                    <Input className="h-8 w-36" value={pt.label ?? ''} placeholder="Optional label" onChange={e => updatePoint({ label: e.target.value })} />
                  </div>
                )}
                {pt.elementType === 'sprinkler' && (
                  <div className="space-y-1">
                    <Label className="text-xs">Head Type</Label>
                    <Select value={pt.sprinklerHeadType ?? SPRINKLER_HEAD_TYPES[0]} onValueChange={v => updatePoint({ sprinklerHeadType: v })}>
                      <SelectTrigger className="h-8 w-36"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {SPRINKLER_HEAD_TYPES.map(h => <SelectItem key={h} value={h}>{h}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                <div className="space-y-1">
                  <Label className="text-xs flex items-center gap-1"><Link2 className="w-3 h-3" /> Linked Inventory Item</Label>
                  <Select
                    value={pt.inventoryItemId != null ? String(pt.inventoryItemId) : 'none'}
                    onValueChange={v => updatePoint({ inventoryItemId: v === 'none' ? null : Number(v) })}
                  >
                    <SelectTrigger className="h-8 w-48"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">None</SelectItem>
                      {(blueprintInventoryItems ?? []).map(item => (
                        <SelectItem key={item.id} value={String(item.id)}>{item.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            );
          })()}
          {tool === 'select' && selectedLineId && (() => {
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
                  <span className="text-sm font-medium">{ln.elementType === 'pipe' ? 'Pipe' : 'Generic Edge'}</span>
                  {lengthFt !== null ? (
                    <Badge variant="outline" className="text-xs">{lengthFt.toFixed(1)} ft</Badge>
                  ) : (
                    <Badge variant="outline" className="text-xs text-muted-foreground">Calibrate for length</Badge>
                  )}
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Type</Label>
                  <Select
                    value={ln.elementType === 'pipe' ? (ln.pipeType ?? PIPE_TYPES[0]) : 'edge'}
                    onValueChange={v => v === 'edge' ? updateLine({ elementType: 'edge', pipeType: undefined }) : updateLine({ elementType: 'pipe', pipeType: v })}
                  >
                    <SelectTrigger className="h-8 w-44"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="edge">Generic Edge</SelectItem>
                      {PIPE_TYPES.map(pt => <SelectItem key={pt} value={pt}>{pt}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs flex items-center gap-1"><Link2 className="w-3 h-3" /> Linked Inventory Item</Label>
                  <Select
                    value={ln.inventoryItemId != null ? String(ln.inventoryItemId) : 'none'}
                    onValueChange={v => updateLine({ inventoryItemId: v === 'none' ? null : Number(v) })}
                  >
                    <SelectTrigger className="h-8 w-48"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">None</SelectItem>
                      {(blueprintInventoryItems ?? []).map(item => (
                        <SelectItem key={item.id} value={String(item.id)}>{item.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            );
          })()}

          {/* Canvas */}
          <div ref={canvasContainerRef} className="flex-1 bg-gray-50 dark:bg-zinc-950 relative overflow-hidden cursor-crosshair">
            <svg
              ref={svgRef}
              className="w-full h-full"
              onClick={handleSvgClick}
              onMouseMove={handleSvgMouseMove}
              onMouseUp={handleSvgMouseUp}
              onMouseLeave={handleSvgMouseUp}
            >
              <defs>
                <pattern id="grid-pattern" width="40" height="40" patternUnits="userSpaceOnUse">
                  <path d="M 40 0 L 0 0 0 40" fill="none" stroke="hsl(var(--border))" strokeWidth="0.5" strokeOpacity="0.5"/>
                </pattern>
              </defs>
              {satelliteImage && !satelliteFailed ? (
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

              {satelliteImage && !satelliteFailed && (
                <text x={8} y={18} fontSize={10} fontFamily="monospace" fill="white" fillOpacity={0.85} pointerEvents="none">SATELLITE</text>
              )}
              
              {/* Lines */}
              {lines.map(line => {
                const p1 = points.find(p => p.id === line.startId);
                const p2 = points.find(p => p.id === line.endId);
                if (!p1 || !p2) return null;
                const isSelected = selectedLineId === line.id;
                const isPipe = line.elementType === 'pipe';
                const lengthFt = lineLengthFt(p1, p2, scalePxPerFt);
                const midX = (p1.x + p2.x) / 2;
                const midY = (p1.y + p2.y) / 2;
                return (
                  <g key={line.id}>
                    <line
                      x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y}
                      stroke={isSelected ? 'hsl(var(--destructive))' : isPipe ? '#0ea5e9' : lineColor}
                      strokeWidth={isSelected ? 4 : isPipe ? 3 : 2}
                      strokeDasharray={isPipe ? undefined : undefined}
                      className="cursor-pointer transition-colors"
                      onClick={(e) => handleLineClick(e, line.id)}
                    />
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

              {/* Nodes */}
              {points.map(point => {
                const isSelected = selectedPointId === point.id;
                const isDrawingStart = drawingLineStartId === point.id;
                const meta = pointElementMeta(point.elementType);
                const isSpecial = !!point.elementType && point.elementType !== 'node';
                const displayLabel = point.label ?? (point.elementType === 'sprinkler' ? point.sprinklerHeadType : undefined);
                return (
                  <g key={point.id} transform={`translate(${point.x}, ${point.y})`}>
                    <circle
                      r={isDrawingStart ? 10 : isSpecial ? 9 : 8}
                      fill={isSelected || isDrawingStart ? 'hsl(var(--destructive))' : isSpecial ? meta.color : nodeColor}
                      stroke={isSelected ? 'white' : point.inventoryItemId ? '#22c55e' : 'transparent'}
                      strokeWidth={point.inventoryItemId && !isSelected ? 2.5 : 2}
                      className="cursor-pointer transition-all hover:opacity-80"
                      onClick={(e) => handlePointClick(e, point.id)}
                      onMouseDown={(e) => handlePointMouseDown(e, point.id)}
                    />
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
                    <p className="text-sm font-medium">Parts Breakdown</p>
                    <div className="space-y-1.5">
                      {estimateResult.parts.map(part => (
                        <div key={part.inventoryItemId} className="flex items-center justify-between text-xs">
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
                          </div>
                          <p className="font-medium shrink-0 ml-2">${part.total.toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
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
    </div>
  );
}
