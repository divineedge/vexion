import React, { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  useGetTenantSettings, getGetTenantSettingsQueryKey,
  useUpdateTenantSettings,
} from '@workspace/api-client-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { buildEffectivePermissions, ROLE_DEFAULTS, ALL_PERMISSION_KEYS, type PermissionKey } from '@/hooks/usePermissions';

const ROLES = [
  { key: 'office_manager',    label: 'Admin',        description: 'Office managers with broad access' },
  { key: 'department_manager', label: 'Manager',      description: 'Department / division managers' },
  { key: 'crew_manager',      label: 'Crew Manager', description: 'Crew / field supervisors' },
  { key: 'technician',        label: 'Technician',   description: 'Field technicians' },
] as const;

const PERMISSION_GROUPS = [
  {
    label: 'Pages & Navigation',
    description: 'Which sections appear in the sidebar for this role',
    items: [
      { key: 'pages.billing' as PermissionKey,   label: 'Billing & Finance tab',    description: 'Financials, invoices, revenue pages' },
      { key: 'pages.reports' as PermissionKey,   label: 'Reports tab',              description: 'Business reports and analytics' },
      { key: 'pages.equipment' as PermissionKey, label: 'Equipment page',           description: 'Equipment management and maintenance' },
      { key: 'pages.services' as PermissionKey,  label: 'Services page',            description: 'Service catalog management' },
    ],
  },
  {
    label: 'Customer Information',
    description: 'What contact details this role can see',
    items: [
      { key: 'customerInfo.phone' as PermissionKey, label: 'View phone number', description: 'Customer phone and secondary phone' },
      { key: 'customerInfo.email' as PermissionKey, label: 'View email address', description: 'Customer email address' },
    ],
  },
  {
    label: 'Financial Data',
    description: 'What dollar amounts this role can see',
    items: [
      { key: 'financials.invoiceAmounts' as PermissionKey, label: 'Invoice & quote amounts', description: 'Totals on invoices and estimates' },
      { key: 'financials.jobPrices' as PermissionKey,      label: 'Job line-item prices',    description: 'Per-line pricing on jobs' },
      { key: 'financials.costData' as PermissionKey,       label: 'Cost / purchase price',   description: 'Unit cost / buy price on materials' },
    ],
  },
  {
    label: 'Actions',
    description: 'What this role is allowed to create or change',
    items: [
      { key: 'actions.createJobs' as PermissionKey,       label: 'Create jobs',          description: 'Schedule new work orders' },
      { key: 'actions.editCustomers' as PermissionKey,    label: 'Edit customer info',   description: 'Change customer name, contact, address' },
      { key: 'actions.manageEquipment' as PermissionKey,  label: 'Add / edit equipment', description: 'Create and update equipment records' },
      { key: 'actions.manageServices' as PermissionKey,   label: 'Add / edit services',  description: 'Create and update the service catalog' },
    ],
  },
  {
    label: 'Callbacks',
    description: 'Controls callback queue visibility',
    items: [
      { key: 'callbacks.seeAll' as PermissionKey, label: 'See all callbacks (not just assigned)', description: 'When OFF, this role only sees callbacks assigned to them' },
    ],
  },
  {
    label: 'Tasks',
    description: 'Controls task queue visibility',
    items: [
      { key: 'tasks.seeAll' as PermissionKey, label: 'See all tasks (not just assigned)', description: 'When OFF, this role only sees tasks assigned to them' },
    ],
  },
];

export default function RolePermissionsSettings() {
  const qc = useQueryClient();
  const { data: settings } = useGetTenantSettings({ query: { queryKey: getGetTenantSettingsQueryKey() } });
  const updateSettings = useUpdateTenantSettings();
  const [saving, setSaving] = useState<string | null>(null); // "role:key" while pending

  const tenantPerms = useMemo(
    () => ((settings as any)?.rolePermissions as Record<string, Record<string, boolean>> | null) ?? null,
    [settings]
  );

  // Build effective permissions per role (defaults merged with tenant config)
  const effectivePerms = useMemo(() => {
    const result: Record<string, Record<PermissionKey, boolean>> = {};
    for (const role of ROLES) {
      result[role.key] = buildEffectivePermissions(role.key, tenantPerms);
    }
    return result;
  }, [tenantPerms]);

  const toggle = (roleKey: string, permKey: PermissionKey, currentValue: boolean) => {
    const pendingKey = `${roleKey}:${permKey}`;
    setSaving(pendingKey);

    // Build the updated rolePermissions blob
    const updated: Record<string, Record<string, boolean>> = {};
    for (const role of ROLES) {
      updated[role.key] = { ...effectivePerms[role.key] };
    }
    updated[roleKey] = { ...updated[roleKey], [permKey]: !currentValue };

    updateSettings.mutate(
      { data: { rolePermissions: updated } as any },
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: getGetTenantSettingsQueryKey() });
          toast.success('Permission updated');
        },
        onError: () => toast.error('Failed to save permission'),
        onSettled: () => setSaving(null),
      }
    );
  };

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-semibold">Role Permissions</h3>
        <p className="text-sm text-muted-foreground mt-1">
          Control what each role can see and do. <strong>Owner</strong> always has full access.
          Changes save immediately.
        </p>
      </div>

      {PERMISSION_GROUPS.map(group => (
        <Card key={group.label}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">{group.label}</CardTitle>
            <CardDescription className="text-xs">{group.description}</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left font-medium text-muted-foreground px-4 py-2 w-64">Permission</th>
                    {ROLES.map(role => (
                      <th key={role.key} className="text-center font-medium px-4 py-2 min-w-[110px]">
                        <div className="flex flex-col items-center gap-0.5">
                          <span>{role.label}</span>
                          <span className="text-[10px] text-muted-foreground font-normal hidden sm:block">{role.description}</span>
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {group.items.map((item, idx) => (
                    <tr key={item.key} className={idx % 2 === 0 ? 'bg-muted/20' : ''}>
                      <td className="px-4 py-3">
                        <div>
                          <p className="font-medium text-xs">{item.label}</p>
                          <p className="text-[11px] text-muted-foreground">{item.description}</p>
                        </div>
                      </td>
                      {ROLES.map(role => {
                        const val = effectivePerms[role.key]?.[item.key] ?? true;
                        const isDefault = !(tenantPerms?.[role.key] && item.key in tenantPerms[role.key]);
                        const pendingKey = `${role.key}:${item.key}`;
                        return (
                          <td key={role.key} className="text-center px-4 py-3">
                            <div className="flex flex-col items-center gap-1">
                              <Switch
                                checked={val}
                                onCheckedChange={() => toggle(role.key, item.key, val)}
                                disabled={saving === pendingKey}
                                aria-label={`${item.label} for ${role.label}`}
                              />
                              {isDefault && (
                                <span className="text-[9px] text-muted-foreground">default</span>
                              )}
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      ))}

      <Card className="border-amber-200 bg-amber-50 dark:bg-amber-950/20">
        <CardContent className="pt-4 pb-4">
          <p className="text-xs text-amber-700 dark:text-amber-400">
            <strong>Note:</strong> Page and action permissions hide UI elements in the browser. 
            For full security, the server also enforces callback visibility. 
            Staff with technical access to the browser console can still inspect raw API responses — 
            use these controls for workflow clarity, not absolute data security.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
