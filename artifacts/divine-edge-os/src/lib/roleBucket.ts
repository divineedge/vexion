/** Mirrors the server-side bucket matching in artifacts/api-server/src/lib/taskRouting.ts */
export function roleBucketMatches(bucket: string, role: string): boolean {
  if (bucket === 'admin_office') return role === 'company_owner' || role === 'office_manager' || role === 'department_manager';
  if (bucket === 'manager') return role === 'crew_manager';
  if (bucket === 'technician') return role === 'technician';
  return false;
}
