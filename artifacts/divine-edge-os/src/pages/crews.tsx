import React, { useState } from 'react';
import {
  useListCrews, getListCrewsQueryKey,
  useGetCrew, getGetCrewQueryKey,
  useCreateCrew,
  useUpdateCrew,
  useDeleteCrew,
  useAddCrewMember,
  useRemoveCrewMember,
  useListUsers, getListUsersQueryKey,
  useGetTenantSettings, getGetTenantSettingsQueryKey,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Separator } from '@/components/ui/separator';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { Plus, Users, Trash2, UserMinus, UserPlus, Edit } from 'lucide-react';

export default function CrewsPage() {
  const { canManageOffice } = useAuth();
  const qc = useQueryClient();

  const [createOpen, setCreateOpen] = useState(false);
  const [selectedCrewId, setSelectedCrewId] = useState<number | null>(null);
  const [newCrewForm, setNewCrewForm] = useState({ name: '', description: '' });
  const [addMemberUserId, setAddMemberUserId] = useState('');
  const [editingCrew, setEditingCrew] = useState(false);
  const [editCrewForm, setEditCrewForm] = useState({ name: '', description: '', managerId: '' });

  const { data: crews, isLoading } = useListCrews({
    query: { queryKey: getListCrewsQueryKey() },
  });

  const { data: selectedCrew } = useGetCrew(selectedCrewId!, {
    query: { enabled: selectedCrewId != null, queryKey: getGetCrewQueryKey(selectedCrewId!) },
  });

  const { data: users } = useListUsers({ query: { queryKey: getListUsersQueryKey() } });
  const { data: settings } = useGetTenantSettings({ query: { queryKey: getGetTenantSettingsQueryKey() } });

  const createCrew = useCreateCrew();
  const updateCrew = useUpdateCrew();
  const deleteCrew = useDeleteCrew();
  const addMember = useAddCrewMember();
  const removeMember = useRemoveCrewMember();

  const eligibleMembers = users?.filter(u =>
    u.role === 'technician'
    || u.role === 'crew_manager'
    || ((settings as any)?.ownersSchedulable && u.role === 'company_owner')
  ) ?? [];
  const availableToAdd = selectedCrew
    ? eligibleMembers.filter(u => !selectedCrew.members?.some((m: { id: number }) => m.id === u.id))
    : eligibleMembers;

  const handleCreate = () => {
    if (!newCrewForm.name) { toast.error('Crew name is required'); return; }
    createCrew.mutate({ data: { name: newCrewForm.name, description: newCrewForm.description || undefined } }, {
      onSuccess: () => {
        toast.success('Crew created');
        qc.invalidateQueries({ queryKey: getListCrewsQueryKey() });
        setCreateOpen(false);
        setNewCrewForm({ name: '', description: '' });
      },
      onError: () => toast.error('Failed to create crew'),
    });
  };

  React.useEffect(() => {
    if (!selectedCrew) return;
    setEditCrewForm({
      name: selectedCrew.name,
      description: selectedCrew.description ?? '',
      managerId: selectedCrew.managerId ? String(selectedCrew.managerId) : '',
    });
    setEditingCrew(false);
  }, [selectedCrew?.id]);

  const handleUpdateCrew = () => {
    if (!selectedCrewId || !editCrewForm.name.trim()) {
      toast.error('Crew name is required');
      return;
    }
    updateCrew.mutate({
      id: selectedCrewId,
      data: {
        name: editCrewForm.name.trim(),
        description: editCrewForm.description || undefined,
        managerId: editCrewForm.managerId ? parseInt(editCrewForm.managerId, 10) : null,
      },
    }, {
      onSuccess: () => {
        toast.success('Crew updated');
        qc.invalidateQueries({ queryKey: getListCrewsQueryKey() });
        qc.invalidateQueries({ queryKey: getGetCrewQueryKey(selectedCrewId) });
        setEditingCrew(false);
      },
      onError: () => toast.error('Failed to update crew'),
    });
  };

  const [deleteCrewId, setDeleteCrewId] = React.useState<{ id: number; name: string } | null>(null);

  const handleDelete = (crewId: number, crewName: string) => {
    setDeleteCrewId({ id: crewId, name: crewName });
  };

  const confirmDeleteCrew = () => {
    if (!deleteCrewId) return;
    deleteCrew.mutate({ id: deleteCrewId.id }, {
      onSuccess: () => {
        toast.success('Crew deleted');
        qc.invalidateQueries({ queryKey: getListCrewsQueryKey() });
        if (selectedCrewId === deleteCrewId.id) setSelectedCrewId(null);
        setDeleteCrewId(null);
      },
      onError: () => toast.error('Failed to delete crew'),
    });
  };

  const handleAddMember = () => {
    if (!selectedCrewId || !addMemberUserId) return;
    addMember.mutate({ id: selectedCrewId, data: { userId: parseInt(addMemberUserId, 10) } }, {
      onSuccess: () => {
        toast.success('Member added');
        qc.invalidateQueries({ queryKey: getGetCrewQueryKey(selectedCrewId) });
        qc.invalidateQueries({ queryKey: getListCrewsQueryKey() });
        setAddMemberUserId('');
      },
      onError: () => toast.error('Failed to add member'),
    });
  };

  const handleRemoveMember = (userId: number) => {
    if (!selectedCrewId) return;
    removeMember.mutate({ id: selectedCrewId, userId }, {
      onSuccess: () => {
        toast.success('Member removed');
        qc.invalidateQueries({ queryKey: getGetCrewQueryKey(selectedCrewId) });
        qc.invalidateQueries({ queryKey: getListCrewsQueryKey() });
      },
      onError: () => toast.error('Failed to remove member'),
    });
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Crews</h1>
          <p className="text-muted-foreground mt-1">Organize your team into field crews.</p>
        </div>
        {canManageOffice && (
          <Button className="gap-2" onClick={() => setCreateOpen(true)}>
            <Plus className="w-4 h-4" /> New Crew
          </Button>
        )}
      </div>

      {isLoading ? (
        <div className="py-16 text-center text-muted-foreground">Loading crews...</div>
      ) : !crews?.length ? (
        <Card>
          <CardContent className="py-16 text-center">
            <Users className="w-12 h-12 mx-auto text-muted-foreground/40 mb-4" />
            <p className="font-semibold text-lg mb-2">No crews yet</p>
            <p className="text-muted-foreground text-sm mb-6">Create your first crew to organize technicians into field teams.</p>
            {canManageOffice && (
              <Button onClick={() => setCreateOpen(true)} className="gap-2">
                <Plus className="w-4 h-4" /> Create First Crew
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {crews.map(crew => (
            <Card
              key={crew.id}
              className="cursor-pointer hover:shadow-md transition-shadow"
              onClick={() => setSelectedCrewId(crew.id)}
            >
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <CardTitle className="text-base">{crew.name}</CardTitle>
                    {crew.managerName && (
                      <CardDescription className="mt-0.5">Manager: {crew.managerName}</CardDescription>
                    )}
                  </div>
                  <Badge variant="secondary" className="gap-1 shrink-0">
                    <Users className="w-3 h-3" />
                    {crew.memberCount ?? 0}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent>
                {crew.description && <p className="text-sm text-muted-foreground mb-3">{crew.description}</p>}
                <div className="flex flex-wrap gap-1">
                  {(crew.members ?? []).slice(0, 4).map((m: { id: number; name: string }) => (
                    <Badge key={m.id} variant="outline" className="text-xs">{m.name}</Badge>
                  ))}
                  {(crew.memberCount ?? 0) > 4 && (
                    <Badge variant="outline" className="text-xs">+{(crew.memberCount ?? 0) - 4} more</Badge>
                  )}
                </div>
                {canManageOffice && (
                  <div className="mt-3 pt-3 border-t flex items-center gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs gap-1.5"
                      onClick={e => { e.stopPropagation(); setSelectedCrewId(crew.id); }}
                    >
                      <Edit className="w-3 h-3" /> Manage
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs gap-1.5 text-destructive hover:text-destructive ml-auto"
                      onClick={e => { e.stopPropagation(); handleDelete(crew.id, crew.name); }}
                    >
                      <Trash2 className="w-3 h-3" /> Delete
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Create Crew Sheet */}
      <Sheet open={createOpen} onOpenChange={open => { if (!open) { setCreateOpen(false); setNewCrewForm({ name: '', description: '' }); } }}>
        <SheetContent className="w-full sm:max-w-[66vw]">
          <SheetHeader className="pb-4">
            <SheetTitle>New Crew</SheetTitle>
            <SheetDescription>Create a new field crew and add members after creation.</SheetDescription>
          </SheetHeader>
          <div className="space-y-4 pb-6">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Crew Name <span className="text-destructive">*</span></label>
              <Input
                placeholder="e.g. North Territory Crew"
                value={newCrewForm.name}
                onChange={e => setNewCrewForm(f => ({ ...f, name: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Description</label>
              <Input
                placeholder="Optional notes about this crew"
                value={newCrewForm.description}
                onChange={e => setNewCrewForm(f => ({ ...f, description: e.target.value }))}
              />
            </div>
            <Separator />
            <div className="flex gap-3 justify-end">
              <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
              <Button onClick={handleCreate} disabled={createCrew.isPending}>
                {createCrew.isPending ? 'Creating...' : 'Create Crew'}
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      {/* Crew Detail Sheet */}
      <Sheet open={selectedCrewId != null} onOpenChange={open => { if (!open) setSelectedCrewId(null); }}>
        <SheetContent className="w-full sm:max-w-[66vw] overflow-y-auto">
          {selectedCrew ? (
            <>
              <SheetHeader className="pb-4">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center text-primary shrink-0">
                    <Users className="w-5 h-5" />
                  </div>
                  <div>
                    <SheetTitle className="text-xl">{selectedCrew.name}</SheetTitle>
                    <SheetDescription className="mt-0.5">
                      {selectedCrew.memberCount ?? 0} member{(selectedCrew.memberCount ?? 0) !== 1 ? 's' : ''}
                      {selectedCrew.managerName && ` · Manager: ${selectedCrew.managerName}`}
                    </SheetDescription>
                  </div>
                </div>
              </SheetHeader>

              <div className="space-y-5">
                {canManageOffice && (
                  <div className="rounded-lg border p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Crew Details</p>
                      {!editingCrew && (
                        <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => setEditingCrew(true)} data-testid="button-edit-crew">
                          <Edit className="w-3.5 h-3.5" /> Edit
                        </Button>
                      )}
                    </div>
                    {editingCrew ? (
                      <>
                        <div className="space-y-1.5">
                          <label className="text-sm font-medium">Crew Name</label>
                          <Input value={editCrewForm.name} onChange={event => setEditCrewForm(current => ({ ...current, name: event.target.value }))} data-testid="input-edit-crew-name" />
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-sm font-medium">Description</label>
                          <Input value={editCrewForm.description} onChange={event => setEditCrewForm(current => ({ ...current, description: event.target.value }))} />
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-sm font-medium">Crew Manager</label>
                          <Select value={editCrewForm.managerId || 'none'} onValueChange={value => setEditCrewForm(current => ({ ...current, managerId: value === 'none' ? '' : value }))}>
                            <SelectTrigger><SelectValue placeholder="No manager" /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">No manager</SelectItem>
                              {eligibleMembers.map(user => <SelectItem key={user.id} value={String(user.id)}>{user.name} ({user.role === 'company_owner' ? 'owner' : user.role.replace(/_/g, ' ')})</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="flex justify-end gap-2">
                          <Button variant="outline" size="sm" onClick={() => setEditingCrew(false)}>Cancel</Button>
                          <Button size="sm" onClick={handleUpdateCrew} disabled={updateCrew.isPending} data-testid="button-save-crew">
                            {updateCrew.isPending ? 'Saving…' : 'Save Crew'}
                          </Button>
                        </div>
                      </>
                    ) : (
                      <div>
                        <p className="font-medium">{selectedCrew.name}</p>
                        <p className="text-sm text-muted-foreground">{selectedCrew.description || 'No description'}</p>
                      </div>
                    )}
                  </div>
                )}
                {selectedCrew.description && (
                  <p className="text-sm text-muted-foreground">{selectedCrew.description}</p>
                )}

                {/* Members list */}
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Members</p>
                  {!(selectedCrew.members?.length) ? (
                    <p className="text-sm text-muted-foreground py-4 text-center border rounded-lg border-dashed">No members yet</p>
                  ) : (
                    <div className="rounded-lg border divide-y">
                      {(selectedCrew.members as { id: number; name: string; role: string }[]).map(member => (
                        <div key={member.id} className="flex items-center justify-between px-3 py-2.5">
                          <div>
                            <p className="text-sm font-medium">{member.name}</p>
                            <p className="text-xs text-muted-foreground capitalize">{member.role.replace(/_/g, ' ')}</p>
                          </div>
                          {canManageOffice && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-muted-foreground hover:text-destructive"
                              onClick={() => handleRemoveMember(member.id)}
                              disabled={removeMember.isPending}
                            >
                              <UserMinus className="w-4 h-4" />
                            </Button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Add member */}
                {canManageOffice && availableToAdd.length > 0 && (
                  <>
                    <Separator />
                    <div className="space-y-2">
                      <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Add Member</p>
                      <div className="flex gap-2">
                        <Select value={addMemberUserId} onValueChange={setAddMemberUserId}>
                          <SelectTrigger className="flex-1">
                            <SelectValue placeholder="Select user..." />
                          </SelectTrigger>
                          <SelectContent>
                            {availableToAdd.map(u => (
                              <SelectItem key={u.id} value={String(u.id)}>
                                {u.name}{' '}
                                <span className="text-muted-foreground capitalize">({u.role.replace(/_/g, ' ')})</span>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Button
                          size="icon"
                          onClick={handleAddMember}
                          disabled={!addMemberUserId || addMember.isPending}
                        >
                          <UserPlus className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  </>
                )}
              </div>
            </>
          ) : (
            <div className="flex h-full items-center justify-center text-muted-foreground text-sm">Loading...</div>
          )}
        </SheetContent>
      </Sheet>

      {/* Delete Crew Confirmation */}
      <Dialog open={deleteCrewId != null} onOpenChange={open => { if (!open) setDeleteCrewId(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Crew</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Are you sure you want to delete <strong>{deleteCrewId?.name}</strong>? This action cannot be undone.
          </p>
          <div className="flex gap-3 justify-end mt-4">
            <Button variant="outline" onClick={() => setDeleteCrewId(null)}>Cancel</Button>
            <Button variant="destructive" onClick={confirmDeleteCrew} disabled={deleteCrew.isPending}>
              {deleteCrew.isPending ? 'Deleting…' : 'Delete'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
