import React from 'react';
import { useListRoutines, getListRoutinesQueryKey, useUpdateRoutine, useStartSubTimer } from '@workspace/api-client-react';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Plus, CheckCircle2, Circle, Clock, PlayCircle } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

export default function DailyRoutinesPage() {
  const { isTechnician } = useAuth();
  const queryClient = useQueryClient();
  const { data: routines, isLoading } = useListRoutines({ query: { queryKey: getListRoutinesQueryKey() }});
  
  const updateRoutine = useUpdateRoutine();
  const startTimer = useStartSubTimer();

  const toggleStatus = (id: number, currentStatus: boolean) => {
    updateRoutine.mutate({ id, data: { isActive: !currentStatus } }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListRoutinesQueryKey() });
      }
    });
  };

  const handleStartTimer = (routineId: number, name: string) => {
    startTimer.mutate({ data: { label: name, type: 'routine', routineId } }, {
      onSuccess: () => {
        toast.success(`Timer started for ${name}`);
      }
    });
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Daily Routines</h1>
          <p className="text-muted-foreground mt-1">Standard operating procedures and checklists.</p>
        </div>
        {!isTechnician && (
          <Button className="gap-2">
            <Plus className="w-4 h-4" /> New Routine
          </Button>
        )}
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-muted-foreground">Loading routines...</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {routines?.map(routine => (
            <Card key={routine.id} className={`transition-all ${routine.isActive ? 'border-primary/50 shadow-sm' : 'opacity-70'}`}>
              <CardContent className="p-5">
                <div className="flex justify-between items-start mb-4">
                  <div className="flex items-center gap-2">
                    <button onClick={() => toggleStatus(routine.id, routine.isActive)} className="text-primary hover:text-primary/80 transition-colors">
                      {routine.isActive ? <CheckCircle2 className="w-6 h-6" /> : <Circle className="w-6 h-6 text-muted-foreground" />}
                    </button>
                    <h3 className={`font-semibold text-lg ${!routine.isActive && 'line-through text-muted-foreground'}`}>{routine.name}</h3>
                  </div>
                  <Badge variant="outline" className="capitalize text-xs">{routine.frequency.replace('_', ' ')}</Badge>
                </div>
                
                {routine.description && (
                  <p className="text-sm text-muted-foreground mb-4 line-clamp-2">{routine.description}</p>
                )}
                
                <div className="flex items-center justify-between mt-auto pt-4 border-t">
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Clock className="w-3.5 h-3.5" />
                    <span>{routine.estimatedMinutes || 15} mins</span>
                  </div>
                  
                  <Button 
                    size="sm" 
                    variant={routine.isActive ? "secondary" : "outline"} 
                    className="gap-1.5 h-8 text-xs"
                    disabled={!routine.isActive}
                    onClick={() => handleStartTimer(routine.id, routine.name)}
                  >
                    <PlayCircle className="w-3.5 h-3.5" /> Track Time
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
          {routines?.length === 0 && (
            <div className="col-span-full text-center py-12 text-muted-foreground border rounded-xl border-dashed">
              No routines defined yet.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
