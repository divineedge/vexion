import React, { useState } from 'react';
import {
  useListRoutines, getListRoutinesQueryKey,
  useCreateRoutine, useUpdateRoutine, useDeleteRoutine,
  useStartSubTimer,
} from '@workspace/api-client-react';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Separator } from '@/components/ui/separator';
import {
  Plus, CheckCircle2, Circle, Clock, PlayCircle, Edit, Trash2,
  Calendar, User, AlarmClock,
} from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { format } from 'date-fns';
import type { RoutineInput } from '@workspace/api-client-react';

type RoutineForm = {
  name: string;
  description: string;
  frequency: RoutineInput['frequency'];
  estimatedMinutes: string;
};

const EMPTY_FORM: RoutineForm = {
  name: '',
  description: '',
  frequency: 'daily',
  estimatedMinutes: '15',
};

export default function DailyRoutinesPage() {
  const { isTechnician } = useAuth();
  const qc = useQueryClient();

  const [sheetMode, setSheetMode] = useState<'create' | 'edit' | 'view' | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [form, setForm] = useState<RoutineForm>(EMPTY_FORM);

  const { data: routines, isLoading } = useListRoutines({ query: { queryKey: getListRoutinesQueryKey() } });
  const createRoutine = useCreateRoutine();
  const updateRoutine = useUpdateRoutine();
  const deleteRoutine = useDeleteRoutine();
  const startTimer = useStartSubTimer();

  const selectedRoutine = routines?.find(r => r.id === selectedId) ?? null;

  const openCreate = () => {
    setForm(EMPTY_FORM);
    setSelectedId(null);
    setSheetMode('create');
  };

  const openEdit = (id: number) => {
    const r = routines?.find(r => r.id === id);
    if (!r) return;
    setForm({
      name: r.name,
      description: r.description ?? '',
      frequency: r.frequency as RoutineForm['frequency'],
      estimatedMinutes: String(r.estimatedMinutes ?? 15),
    });
    setSelectedId(id);
    setSheetMode('edit');
  };

  const openView = (id: number) => {
    setSelectedId(id);
    setSheetMode('view');
  };

  const toggleStatus = (id: number, current: boolean) => {
    updateRoutine.mutate({ id, data: { isActive: !current } }, {
      onSuccess: () => { qc.invalidateQueries({ queryKey: getListRoutinesQueryKey() }); },
    });
  };

  const handleSave = () => {
    if (!form.name.trim()) { toast.error('Name is required'); return; }
    const data = {
      name: form.name,
      description: form.description || undefined,
      frequency: form.frequency,
      estimatedMinutes: parseInt(form.estimatedMinutes, 10) || 15,
    };

    if (sheetMode === 'create') {
      createRoutine.mutate({ data }, {
        onSuccess: () => {
          toast.success('Routine created');
          qc.invalidateQueries({ queryKey: getListRoutinesQueryKey() });
          setSheetMode(null);
        },
        onError: () => toast.error('Failed to create routine'),
      });
    } else if (sheetMode === 'edit' && selectedId) {
      updateRoutine.mutate({ id: selectedId, data }, {
        onSuccess: () => {
          toast.success('Routine updated');
          qc.invalidateQueries({ queryKey: getListRoutinesQueryKey() });
          setSheetMode(null);
        },
        onError: () => toast.error('Failed to update routine'),
      });
    }
  };

  const handleDelete = (id: number) => {
    deleteRoutine.mutate({ id }, {
      onSuccess: () => {
        toast.success('Routine deleted');
        qc.invalidateQueries({ queryKey: getListRoutinesQueryKey() });
        setSheetMode(null);
      },
      onError: () => toast.error('Failed to delete routine'),
    });
  };

  const handleStartTimer = (routineId: number, name: string) => {
    startTimer.mutate({ data: { label: name, type: 'routine', routineId } }, {
      onSuccess: () => toast.success(`Timer started for ${name}`),
    });
  };

  const FREQ_LABELS: Record<string, string> = {
    daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly', as_needed: 'As Needed',
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Daily Routines</h1>
          <p className="text-muted-foreground mt-1">Standard operating procedures and checklists.</p>
        </div>
        {!isTechnician && (
          <Button className="gap-2" onClick={openCreate}>
            <Plus className="w-4 h-4" /> New Routine
          </Button>
        )}
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-muted-foreground">Loading routines...</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {routines?.map(routine => (
            <Card
              key={routine.id}
              className={`transition-all cursor-pointer hover:shadow-md ${routine.isActive ? 'border-primary/30' : 'opacity-70'}`}
              onClick={() => openView(routine.id)}
            >
              <CardContent className="p-5">
                <div className="flex justify-between items-start mb-4">
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <button
                      onClick={e => { e.stopPropagation(); toggleStatus(routine.id, routine.isActive); }}
                      className="text-primary hover:text-primary/80 transition-colors shrink-0"
                    >
                      {routine.isActive ? <CheckCircle2 className="w-6 h-6" /> : <Circle className="w-6 h-6 text-muted-foreground" />}
                    </button>
                    <h3 className={`font-semibold text-base truncate ${!routine.isActive && 'line-through text-muted-foreground'}`}>
                      {routine.name}
                    </h3>
                  </div>
                  <Badge variant="outline" className="capitalize text-xs shrink-0 ml-2">
                    {FREQ_LABELS[routine.frequency] ?? routine.frequency}
                  </Badge>
                </div>

                {routine.description && (
                  <p className="text-sm text-muted-foreground mb-4 line-clamp-2">{routine.description}</p>
                )}

                <div className="flex items-center justify-between pt-4 border-t">
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Clock className="w-3.5 h-3.5" />
                    <span>{routine.estimatedMinutes ?? 15} min</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {!isTechnician && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 w-7 p-0"
                        onClick={e => { e.stopPropagation(); openEdit(routine.id); }}
                      >
                        <Edit className="w-3.5 h-3.5" />
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant={routine.isActive ? 'secondary' : 'outline'}
                      className="gap-1.5 h-8 text-xs"
                      disabled={!routine.isActive}
                      onClick={e => { e.stopPropagation(); handleStartTimer(routine.id, routine.name); }}
                    >
                      <PlayCircle className="w-3.5 h-3.5" /> Track Time
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
          {routines?.length === 0 && (
            <div className="col-span-full text-center py-12 text-muted-foreground border rounded-xl border-dashed">
              No routines defined yet.{!isTechnician && ' Click "New Routine" to add one.'}
            </div>
          )}
        </div>
      )}

      {/* Create / Edit Sheet */}
      <Sheet open={sheetMode === 'create' || sheetMode === 'edit'} onOpenChange={open => { if (!open) setSheetMode(null); }}>
        <SheetContent className="w-full sm:max-w-md overflow-y-auto">
          <SheetHeader className="pb-4">
            <SheetTitle>{sheetMode === 'create' ? 'New Routine' : 'Edit Routine'}</SheetTitle>
            <SheetDescription>
              {sheetMode === 'create' ? 'Define a recurring task or SOP for your team.' : 'Update this routine\'s details.'}
            </SheetDescription>
          </SheetHeader>
          <div className="space-y-4 pb-6">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Name <span className="text-destructive">*</span></label>
              <Input placeholder="e.g. Morning Equipment Check" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Description</label>
              <Textarea placeholder="What does this routine involve?" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} rows={3} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Frequency</label>
                <Select value={form.frequency} onValueChange={v => setForm(f => ({ ...f, frequency: v as RoutineForm['frequency'] }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="daily">Daily</SelectItem>
                    <SelectItem value="weekly">Weekly</SelectItem>
                    <SelectItem value="monthly">Monthly</SelectItem>
                    <SelectItem value="as_needed">As Needed</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Est. Minutes</label>
                <Input type="number" min={1} value={form.estimatedMinutes} onChange={e => setForm(f => ({ ...f, estimatedMinutes: e.target.value }))} />
              </div>
            </div>
            <Separator />
            <div className="flex items-center justify-between">
              {sheetMode === 'edit' && selectedId && !isTechnician ? (
                <Button
                  variant="ghost"
                  className="text-destructive hover:text-destructive gap-2"
                  onClick={() => handleDelete(selectedId)}
                  disabled={deleteRoutine.isPending}
                >
                  <Trash2 className="w-4 h-4" /> Delete
                </Button>
              ) : <div />}
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setSheetMode(null)}>Cancel</Button>
                <Button onClick={handleSave} disabled={createRoutine.isPending || updateRoutine.isPending}>
                  {createRoutine.isPending || updateRoutine.isPending ? 'Saving...' : 'Save'}
                </Button>
              </div>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      {/* View Detail Sheet */}
      <Sheet open={sheetMode === 'view'} onOpenChange={open => { if (!open) setSheetMode(null); }}>
        <SheetContent className="w-full sm:max-w-md overflow-y-auto">
          {selectedRoutine && (
            <>
              <SheetHeader className="pb-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <SheetTitle>{selectedRoutine.name}</SheetTitle>
                    <SheetDescription className="mt-1">Routine details</SheetDescription>
                  </div>
                  <Badge variant={selectedRoutine.isActive ? 'default' : 'outline'} className="shrink-0">
                    {selectedRoutine.isActive ? 'Active' : 'Inactive'}
                  </Badge>
                </div>
              </SheetHeader>
              <div className="space-y-5">
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Frequency</p>
                    <div className="flex items-center gap-2">
                      <Calendar className="w-4 h-4 text-muted-foreground" />
                      <span className="capitalize">{FREQ_LABELS[selectedRoutine.frequency] ?? selectedRoutine.frequency}</span>
                    </div>
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Est. Time</p>
                    <div className="flex items-center gap-2">
                      <AlarmClock className="w-4 h-4 text-muted-foreground" />
                      <span>{selectedRoutine.estimatedMinutes ?? 15} minutes</span>
                    </div>
                  </div>
                  {selectedRoutine.assigneeName && (
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Assigned To</p>
                      <div className="flex items-center gap-2">
                        <User className="w-4 h-4 text-muted-foreground" />
                        <span>{selectedRoutine.assigneeName}</span>
                      </div>
                    </div>
                  )}
                  {selectedRoutine.lastCompletedAt && (
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Last Completed</p>
                      <div className="flex items-center gap-2">
                        <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                        <span>{format(new Date(selectedRoutine.lastCompletedAt), 'MMM d, yyyy')}</span>
                      </div>
                    </div>
                  )}
                </div>
                {selectedRoutine.description && (
                  <>
                    <Separator />
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Description</p>
                      <p className="text-sm">{selectedRoutine.description}</p>
                    </div>
                  </>
                )}
                <Separator />
                <div className="flex items-center justify-between">
                  <Button
                    variant="outline"
                    className="gap-2"
                    onClick={() => toggleStatus(selectedRoutine.id, selectedRoutine.isActive)}
                  >
                    {selectedRoutine.isActive ? <Circle className="w-4 h-4" /> : <CheckCircle2 className="w-4 h-4" />}
                    {selectedRoutine.isActive ? 'Deactivate' : 'Activate'}
                  </Button>
                  <div className="flex gap-2">
                    {!isTechnician && (
                      <Button variant="outline" className="gap-2" onClick={() => openEdit(selectedRoutine.id)}>
                        <Edit className="w-4 h-4" /> Edit
                      </Button>
                    )}
                    <Button
                      className="gap-2"
                      disabled={!selectedRoutine.isActive}
                      onClick={() => handleStartTimer(selectedRoutine.id, selectedRoutine.name)}
                    >
                      <PlayCircle className="w-4 h-4" /> Track Time
                    </Button>
                  </div>
                </div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
