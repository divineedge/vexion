import { Router, type IRouter } from 'express';
import { db, vendorExpenseDefaultsTable, vendorsTable } from '@workspace/db';
import { and, eq } from 'drizzle-orm';
import { getTenantId, getUserId } from '../lib/tenantHelper';
import { isAdminRole } from '../lib/roles';
import { readVendorExpenseDefaults, vendorExpenseDefaultsPatchSchema } from '../lib/vendorExpenseDefaults';

const router: IRouter = Router();
router.use('/vendor-expense-defaults', async (req, res, next) => {
  if (!await isAdminRole(getTenantId(req), getUserId(req))) {
    res.status(403).json({ error: 'Restricted to owner/admin roles' }); return;
  }
  next();
});

router.get('/vendor-expense-defaults', async (req, res) => {
  res.json(await readVendorExpenseDefaults(getTenantId(req)));
});

router.patch('/vendor-expense-defaults/:scope', async (req, res) => {
  const tenantId = getTenantId(req);
  const scope = String(req.params.scope);
  const vendorId = scope === 'company' ? 0 : /^\d+$/.test(scope) ? Number(scope) : NaN;
  if (!Number.isSafeInteger(vendorId) || vendorId < 0 || vendorId > 2_147_483_647 || (vendorId === 0 && scope !== 'company')) {
    res.status(400).json({ error: 'Choose company defaults or a valid vendor' }); return;
  }
  const parsed = vendorExpenseDefaultsPatchSchema.safeParse(req.body);
  if (!parsed.success || (vendorId === 0 && Object.values(parsed.data).some(value => value === null))) {
    res.status(400).json({ error: 'Enter a tax rate from 0 to 100, a nonnegative delivery amount, and valid cost-inclusion choices. Only vendor overrides can inherit.' }); return;
  }
  if (vendorId > 0) {
    const [vendor] = await db.select({ id: vendorsTable.id }).from(vendorsTable)
      .where(and(eq(vendorsTable.tenantId, tenantId), eq(vendorsTable.id, vendorId)));
    if (!vendor) { res.status(404).json({ error: 'Vendor not found' }); return; }
  }
  await db.insert(vendorExpenseDefaultsTable).values({ tenantId, vendorId, ...parsed.data })
    .onConflictDoUpdate({
      target: [vendorExpenseDefaultsTable.tenantId, vendorExpenseDefaultsTable.vendorId],
      set: parsed.data,
    });
  res.json(await readVendorExpenseDefaults(tenantId));
});
export default router;
