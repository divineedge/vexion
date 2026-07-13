import React, { useState, useRef, useEffect, MouseEvent } from 'react';
import { useParams, useLocation } from 'wouter';
import { 
  useGetBlueprint, getGetBlueprintQueryKey,
  useUpdateBlueprint, useCalculateBlueprintEstimate
} from '@workspace/api-client-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Save, MousePointer2, PlusCircle, Minus, Trash2, Calculator, Ruler } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';

type Point = { id: string, x: number, y: number };
type Line = { id: string, startId: string, endId: string };
type CanvasData = { points: Point[], lines: Line[] };

type ToolMode = 'select' | 'addNode' | 'addLine' | 'delete' | 'calibrate';

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
  
  const [tool, setTool] = useState<ToolMode>('select');
  const [points, setPoints] = useState<Point[]>([]);
  const [lines, setLines] = useState<Line[]>([]);
  
  const [selectedPointId, setSelectedPointId] = useState<string | null>(null);
  const [selectedLineId, setSelectedLineId] = useState<string | null>(null);
  
  const [draggingPointId, setDraggingPointId] = useState<string | null>(null);
  const [drawingLineStartId, setDrawingLineStartId] = useState<string | null>(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });

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
      const newPoint = { id: `p_${Date.now()}`, x: coords.x, y: coords.y };
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
        setLines([...lines, { id: `l_${Date.now()}`, startId: drawingLineStartId, endId: pointId }]);
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
      onSuccess: () => {
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
  const nodeColor = isIrrigation ? 'hsl(var(--primary))' : 'hsl(var(--muted-foreground))';
  const lineColor = isIrrigation ? 'hsl(var(--primary))' : 'hsl(var(--border))';

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
            <Button variant={tool === 'addNode' ? 'default' : 'ghost'} size="sm" onClick={() => { setTool('addNode'); setDrawingLineStartId(null); }} title="Add Node (Sprinkler / Form Corner)">
              <PlusCircle className="w-4 h-4" />
            </Button>
            <Button variant={tool === 'addLine' ? 'default' : 'ghost'} size="sm" onClick={() => setTool('addLine')} title="Add Line (Pipe / Edge)">
              <Minus className="w-4 h-4" />
            </Button>
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
          
          {/* Canvas */}
          <div className="flex-1 bg-gray-50 dark:bg-zinc-950 relative overflow-hidden cursor-crosshair">
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
              <rect width="100%" height="100%" fill="url(#grid-pattern)" pointerEvents="none" />
              
              {/* Lines */}
              {lines.map(line => {
                const p1 = points.find(p => p.id === line.startId);
                const p2 = points.find(p => p.id === line.endId);
                if (!p1 || !p2) return null;
                const isSelected = selectedLineId === line.id;
                return (
                  <line
                    key={line.id}
                    x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y}
                    stroke={isSelected ? 'hsl(var(--destructive))' : lineColor}
                    strokeWidth={isSelected ? 4 : 2}
                    className="cursor-pointer transition-colors"
                    onClick={(e) => handleLineClick(e, line.id)}
                  />
                );
              })}

              {/* Drawing Line preview */}
              {drawingLineStartId && tool === 'addLine' && (() => {
                const p1 = points.find(p => p.id === drawingLineStartId);
                if (!p1) return null;
                return (
                  <line
                    x1={p1.x} y1={p1.y} x2={mousePos.x} y2={mousePos.y}
                    stroke={lineColor} strokeWidth={2} strokeDasharray="4 4"
                    pointerEvents="none"
                  />
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
                return (
                  <g key={point.id} transform={`translate(${point.x}, ${point.y})`}>
                    <circle
                      r={isDrawingStart ? 10 : 8}
                      fill={isSelected || isDrawingStart ? 'hsl(var(--destructive))' : nodeColor}
                      stroke={isSelected ? 'white' : 'transparent'}
                      strokeWidth={2}
                      className="cursor-pointer transition-all hover:opacity-80"
                      onClick={(e) => handlePointClick(e, point.id)}
                      onMouseDown={(e) => handlePointMouseDown(e, point.id)}
                    />
                    {isIrrigation && !isSelected && !isDrawingStart && (
                      <circle r={3} fill="white" pointerEvents="none" />
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
