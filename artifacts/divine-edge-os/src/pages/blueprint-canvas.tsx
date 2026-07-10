import React, { useState, useRef, useEffect, MouseEvent } from 'react';
import { useParams, useLocation } from 'wouter';
import { 
  useGetBlueprint, getGetBlueprintQueryKey,
  useUpdateBlueprint, useCalculateBlueprintEstimate
} from '@workspace/api-client-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Save, MousePointer2, PlusCircle, Minus, Trash2, Calculator, Settings } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Input } from '@/components/ui/input';

type Point = { id: string, x: number, y: number };
type Line = { id: string, startId: string, endId: string };
type CanvasData = { points: Point[], lines: Line[] };

type ToolMode = 'select' | 'addNode' | 'addLine' | 'delete';

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

  // Init canvas data from blueprint
  useEffect(() => {
    if (blueprint?.canvasData) {
      const data = blueprint.canvasData as unknown as CanvasData;
      if (data.points) setPoints(data.points);
      if (data.lines) setLines(data.lines);
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
        // Create line
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
    updateBlueprint.mutate({ id, data: { canvasData } }, {
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
            <span className="ml-auto text-xs text-muted-foreground mr-2 capitalize">Mode: {tool.replace(/([A-Z])/g, ' $1')}</span>
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
                    {/* Visual flourish based on mode */}
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
            {blueprint?.totalEstimate !== undefined && blueprint?.totalEstimate !== null ? (
              <div className="p-4 space-y-6">
                <div className="p-4 bg-primary/5 rounded-lg border border-primary/20 text-center">
                  <p className="text-sm font-medium text-primary mb-1">Total Estimated Cost</p>
                  <p className="text-4xl font-bold tracking-tight text-primary">${blueprint.totalEstimate.toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
                </div>
                
                {/* Normally we'd render the full estimate parts here, but we only have totalEstimate in the root schema directly.
                    We will just show the buffer control. */}
                
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
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
