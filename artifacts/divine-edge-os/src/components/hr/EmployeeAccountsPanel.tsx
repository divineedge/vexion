import { useState } from 'react';
import { useLocation } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import {
  useListUsers, getListUsersQueryKey, useCreateUser, useUpdateUser, useDeleteUser,
} from '@workspace/api-client-react';
import { toast } from 'sonner';
import { Plus, Trash2, Eye, Search } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Separator } from '@/components/ui/separator';
import { format } from 'date-fns';

/**
 * Login accounts for staff (moved from Settings > Team). Viewing requires the
 * Employees page (owner + HR); add/edit/role/rate/activation/delete stay owner-only.
 */
export function EmployeeAccountsPanel({ showEmployeeFileLinks = true }: { showEmployeeFileLinks?: boolean }) {
  const { isOwner } = useAuth();
  const qc = useQueryClient();
  const [, setLocation] = useLocation();
  const { data: users } = useListUsers({ query: { queryKey: getListUsersQueryKey() } });
  const createUser = useCreateUser();
  const updateUser = useUpdateUser();
  const deleteUser = useDeleteUser();
  const [teamSearch, setTeamSearch] = useState('');
  const [teamRoleFilter, setTeamRoleFilter] = useState('all');
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteForm, setInviteForm] = useState({ name: '', email: '', role: 'technician', password: '', hourlyRate: '', hireDate: '' });
  const [editUserOpen, setEditUserOpen] = useState(false);
  const [editUserForm, setEditUserForm] = useState<{ id: number; name: string; role: string; hourlyRate: string; hireDate: string; applicatorLicense: string } | null>(null);

  const handleInvite = () => {
    if (!inviteForm.name || !inviteForm.email) { toast.error('Name and email are required'); return; }
    createUser.mutate(
      {
        data: {
          name: inviteForm.name,
          email: inviteForm.email,
          role: inviteForm.role,
          password: inviteForm.password || undefined,
          hourlyRate: inviteForm.hourlyRate ? parseFloat(inviteForm.hourlyRate) : undefined,
          hireDate: inviteForm.hireDate ? new Date(inviteForm.hireDate).toISOString() : undefined,
        } as Parameters<typeof createUser.mutate>[0]['data'],
      },
      {
        onSuccess: () => {
          toast.success(`${inviteForm.name} added`);
          qc.invalidateQueries({ queryKey: getListUsersQueryKey() });
          setInviteOpen(false);
          setInviteForm({ name: '', email: '', role: 'technician', password: '', hourlyRate: '', hireDate: '' });
        },
        onError: () => toast.error('Failed to add user'),
      },
    );
  };

  const openEditUser = (u: { id: number; name: string; role: string; hourlyRate?: number | null; hireDate?: string | null }) => {
    setEditUserForm({
      id: u.id,
      name: u.name,
      role: u.role,
      hourlyRate: u.hourlyRate != null ? String(u.hourlyRate) : '',
      hireDate: u.hireDate ? u.hireDate.slice(0, 10) : '',
      applicatorLicense: (u as any).applicatorLicense ?? '',
    });
    setEditUserOpen(true);
  };

  const handleSaveEditUser = () => {
    if (!editUserForm) return;
    updateUser.mutate({
      id: editUserForm.id,
      data: {
        name: editUserForm.name,
        role: editUserForm.role,
        hourlyRate: editUserForm.hourlyRate ? parseFloat(editUserForm.hourlyRate) : null,
        hireDate: editUserForm.hireDate ? new Date(editUserForm.hireDate).toISOString() : null,
        applicatorLicense: editUserForm.applicatorLicense || null,
      } as Parameters<typeof updateUser.mutate>[0]['data'],
    }, {
      onSuccess: () => {
        toast.success('Team member updated');
        qc.invalidateQueries({ queryKey: getListUsersQueryKey() });
        setEditUserOpen(false);
        setEditUserForm(null);
      },
      onError: () => toast.error('Failed to update user'),
    });
  };

  const toggleUserActive = (id: number, current: boolean) => {
    updateUser.mutate({ id, data: { isActive: !current } }, {
      onSuccess: () => {
        toast.success(current ? 'User deactivated' : 'User activated');
        qc.invalidateQueries({ queryKey: getListUsersQueryKey() });
      },
      onError: () => toast.error('Failed to update user'),
    });
  };

  const [deleteUserPending, setDeleteUserPending] = useState<{ id: number; name: string } | null>(null);

  const handleDeleteUser = (id: number, name: string) => {
    setDeleteUserPending({ id, name });
  };

  return (
    <div>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <div>
                <CardTitle>Team Members</CardTitle>
                <CardDescription>Manage access and roles for your team.</CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <div className="relative">
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
                  <Input
                    title="Search team members by name or email"
                    value={teamSearch}
                    onChange={e => setTeamSearch(e.target.value)}
                    placeholder="Search staff…"
                    className="h-8 text-sm pl-7 w-40"
                  />
                </div>
                <Select value={teamRoleFilter} onValueChange={setTeamRoleFilter}>
                  <SelectTrigger className="h-8 text-sm w-36" title="Filter team members by role"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Roles</SelectItem>
                    <SelectItem value="owner">Owner</SelectItem>
                    <SelectItem value="office_manager">Office Manager</SelectItem>
                    <SelectItem value="crew_manager">Crew Manager</SelectItem>
                    <SelectItem value="technician">Technician</SelectItem>
                  </SelectContent>
                </Select>
                {isOwner && (
                  <Button size="sm" title="Add a new team member to your organization" onClick={() => setInviteOpen(true)} className="gap-2">
                    <Plus className="w-4 h-4" /> Add Member
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Hourly Rate</TableHead>
                    <TableHead>Hire Date</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="w-[170px]">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(users ?? []).filter(u => !teamSearch.trim() || u.name.toLowerCase().includes(teamSearch.toLowerCase()) || u.email.toLowerCase().includes(teamSearch.toLowerCase())).filter(u => teamRoleFilter === 'all' || u.role === teamRoleFilter).map(u => {
                    const highlightUserId = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('userId') : null;
                    const isHighlighted = highlightUserId && String(u.id) === highlightUserId;
                    return (
                    <TableRow key={u.id} id={`user-row-${u.id}`} className={isHighlighted ? 'bg-primary/5 ring-1 ring-primary/20' : ''}>
                      <TableCell className="font-medium" title={u.name}>{u.name}</TableCell>
                      <TableCell className="text-muted-foreground text-sm" title={`Email: ${u.email}`}>{u.email}</TableCell>
                      <TableCell>
                        <Badge variant="secondary" className="capitalize" title={`Role: ${u.role.replace(/_/g, ' ')}`}>{u.role.replace(/_/g, ' ')}</Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground" title={(u as any).hourlyRate != null ? `Hourly rate: $${(u as any).hourlyRate.toFixed(2)}/hr` : 'No hourly rate set'}>{(u as any).hourlyRate != null ? `${(u as any).hourlyRate.toFixed(2)}/hr` : '—'}</TableCell>
                      <TableCell className="text-sm text-muted-foreground" title={(u as any).hireDate ? `Hire date: ${format(new Date((u as any).hireDate), 'EEEE, MMMM d, yyyy')}` : 'No hire date set'}>{(u as any).hireDate ? format(new Date((u as any).hireDate), 'MMM d, yyyy') : '—'}</TableCell>
                      <TableCell>
                        {u.isActive !== false ? (
                          <Badge className="bg-emerald-500/10 text-emerald-600 border-transparent" title="This team member is active">Active</Badge>
                        ) : (
                          <Badge variant="outline" className="text-muted-foreground" title="This team member is inactive">Inactive</Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          {showEmployeeFileLinks && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-muted-foreground hover:text-foreground"
                            title="View employee file"
                            onClick={() => setLocation(`/employees/${u.id}`)}
                          >
                            <Eye className="w-3.5 h-3.5" />
                          </Button>
                          )}
                          {isOwner && (
                            <>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 text-xs px-2"
                                title="Edit this team member's profile and role"
                                onClick={() => openEditUser(u as any)}
                              >
                                Edit
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 text-xs px-2"
                                title={u.isActive !== false ? 'Deactivate this team member (they will lose access)' : 'Reactivate this team member (they will regain access)'}
                                onClick={() => toggleUserActive(u.id, u.isActive !== false)}
                                disabled={updateUser.isPending}
                              >
                                {u.isActive !== false ? 'Deactivate' : 'Activate'}
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 text-muted-foreground hover:text-destructive"
                                title="Permanently delete this team member"
                                onClick={() => handleDeleteUser(u.id, u.name)}
                                disabled={deleteUser.isPending}
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </Button>
                            </>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ); })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* Invite Sheet */}
          <Sheet open={inviteOpen} onOpenChange={setInviteOpen}>
            <SheetContent className="w-full sm:max-w-md">
              <SheetHeader className="pb-4">
                <SheetTitle>Add Team Member</SheetTitle>
                <SheetDescription>Add a new user to your team. They'll receive access immediately.</SheetDescription>
              </SheetHeader>
              <div className="space-y-4 pb-6">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Full Name <span className="text-destructive">*</span></label>
                  <Input title="Team member's full name" value={inviteForm.name} onChange={e => setInviteForm(f => ({ ...f, name: e.target.value }))} placeholder="Jane Smith" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Email <span className="text-destructive">*</span></label>
                  <Input type="email" title="Team member's login email address" value={inviteForm.email} onChange={e => setInviteForm(f => ({ ...f, email: e.target.value }))} placeholder="jane@company.com" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Role</label>
                  <Select value={inviteForm.role} onValueChange={v => setInviteForm(f => ({ ...f, role: v }))}>
                    <SelectTrigger title="Role determines what this team member can see and do in the system"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="company_owner">Company Owner</SelectItem>
                      <SelectItem value="office_manager">Office Manager</SelectItem>
                      <SelectItem value="department_manager">Department Manager</SelectItem>
                      <SelectItem value="crew_manager">Crew Manager</SelectItem>
                      <SelectItem value="technician">Technician</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Password <span className="text-muted-foreground font-normal">(required to sign in)</span></label>
                  <Input type="password" title="Initial password for this team member — they can change it after signing in" value={inviteForm.password} onChange={e => setInviteForm(f => ({ ...f, password: e.target.value }))} placeholder="Min. 8 characters" autoComplete="new-password" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Hourly Pay Rate</label>
                  <Input type="number" min="0" step="0.01" title="Hourly pay rate in dollars — used for labor cost calculations" value={inviteForm.hourlyRate} onChange={e => setInviteForm(f => ({ ...f, hourlyRate: e.target.value }))} placeholder="e.g. 22.50" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Hire Date</label>
                  <Input type="date" title="Date this team member was hired" value={inviteForm.hireDate} onChange={e => setInviteForm(f => ({ ...f, hireDate: e.target.value }))} />
                </div>
                <Separator />
                <div className="flex gap-3 justify-end">
                  <Button variant="outline" onClick={() => setInviteOpen(false)}>Cancel</Button>
                  <Button title="Add this team member to your organization" onClick={handleInvite} disabled={createUser.isPending}>
                    {createUser.isPending ? 'Adding...' : 'Add Member'}
                  </Button>
                </div>
              </div>
            </SheetContent>
          </Sheet>

          {/* Edit Member Sheet */}
          <Sheet open={editUserOpen} onOpenChange={(open) => { setEditUserOpen(open); if (!open) setEditUserForm(null); }}>
            <SheetContent className="w-full sm:max-w-md">
              <SheetHeader className="pb-4">
                <SheetTitle>Edit Team Member</SheetTitle>
                <SheetDescription>Update role, pay rate, and hire date.</SheetDescription>
              </SheetHeader>
              {editUserForm && (
                <div className="space-y-4 pb-6">
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">Full Name</label>
                    <Input title="Team member's full name" value={editUserForm.name} onChange={e => setEditUserForm(f => f && ({ ...f, name: e.target.value }))} />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">Role</label>
                    <Select value={editUserForm.role} onValueChange={v => setEditUserForm(f => f && ({ ...f, role: v }))}>
                      <SelectTrigger title="Role determines what this team member can see and do in the system"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="company_owner">Company Owner</SelectItem>
                        <SelectItem value="office_manager">Office Manager</SelectItem>
                        <SelectItem value="department_manager">Department Manager</SelectItem>
                        <SelectItem value="crew_manager">Crew Manager</SelectItem>
                        <SelectItem value="technician">Technician</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">Hourly Pay Rate</label>
                    <Input type="number" min="0" step="0.01" title="Hourly pay rate in dollars — used for labor cost calculations" value={editUserForm.hourlyRate} onChange={e => setEditUserForm(f => f && ({ ...f, hourlyRate: e.target.value }))} placeholder="e.g. 22.50" />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">Hire Date</label>
                    <Input type="date" title="Date this team member was hired" value={editUserForm.hireDate} onChange={e => setEditUserForm(f => f && ({ ...f, hireDate: e.target.value }))} />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">Pesticide Applicator License #</label>
                    <Input title="Pesticide applicator license number — required for chemical application jobs" placeholder="e.g. LIC-12345" value={editUserForm.applicatorLicense} onChange={e => setEditUserForm(f => f && ({ ...f, applicatorLicense: e.target.value }))} />
                    <p className="text-xs text-muted-foreground">Required before assigning this person to chemical application jobs.</p>
                  </div>
                  <Separator />
                  <div className="flex gap-3 justify-end">
                    <Button variant="outline" onClick={() => setEditUserOpen(false)}>Cancel</Button>
                    <Button title="Save changes to this team member's profile" onClick={handleSaveEditUser} disabled={updateUser.isPending}>
                      {updateUser.isPending ? 'Saving...' : 'Save Changes'}
                    </Button>
                  </div>
                </div>
              )}
            </SheetContent>
          </Sheet>
      {/* Remove User Confirmation */}
      {deleteUserPending != null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setDeleteUserPending(null)}>
          <div className="bg-card rounded-xl shadow-xl p-6 max-w-sm w-full mx-4 space-y-4" onClick={e => e.stopPropagation()}>
            <h2 className="text-base font-semibold">Remove Team Member</h2>
            <p className="text-sm text-muted-foreground">Remove <strong>{deleteUserPending.name}</strong> from your team? They will lose access to the system.</p>
            <div className="flex gap-3 justify-end">
              <button className="text-sm px-3 py-1.5 rounded-md border hover:bg-muted transition-colors" onClick={() => setDeleteUserPending(null)}>Cancel</button>
              <button
                className="text-sm px-3 py-1.5 rounded-md bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors"
                disabled={deleteUser.isPending}
                onClick={() => {
                  deleteUser.mutate({ id: deleteUserPending.id }, {
                    onSuccess: () => { toast.success(`${deleteUserPending.name} removed`); qc.invalidateQueries({ queryKey: getListUsersQueryKey() }); setDeleteUserPending(null); },
                    onError: () => toast.error('Failed to remove user'),
                  });
                }}
              >
                {deleteUser.isPending ? 'Removing…' : 'Remove'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
