import { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import { db, staffNotificationDevicesTable } from "@workspace/db";
import { requireVerifiedStaff, verifiedStaffIdentity } from "../lib/verifiedStaff";
import { isExpoPushToken } from "../lib/pushNotifications";

const router: IRouter = Router();
router.use("/staff-notification-devices", requireVerifiedStaff);

function input(req: { body?: unknown }) {
  const body = req.body as { expoPushToken?: unknown; platform?: unknown };
  return { token: body?.expoPushToken, platform: body?.platform };
}

router.post("/staff-notification-devices", async (req, res): Promise<void> => {
  const { token, platform } = input(req);
  if (!isExpoPushToken(token) || (platform !== "ios" && platform !== "android")) {
    res.status(400).json({ error: "A valid Expo push token and platform (ios or android) are required" }); return;
  }
  const { tenantId, userId } = verifiedStaffIdentity(res);
  const [existing] = await db.select().from(staffNotificationDevicesTable)
    .where(eq(staffNotificationDevicesTable.expoPushToken, token)).limit(1);
  if (existing && (existing.tenantId !== tenantId || existing.userId !== userId)) {
    res.status(409).json({ error: "This device is registered to another staff account" }); return;
  }
  const [device] = existing
    ? await db.update(staffNotificationDevicesTable).set({ platform, isEnabled: true, disabledAt: null })
      .where(eq(staffNotificationDevicesTable.id, existing.id)).returning()
    : await db.insert(staffNotificationDevicesTable).values({ tenantId, userId, expoPushToken: token, platform }).returning();
  res.status(existing ? 200 : 201).json({ id: device.id, platform: device.platform, enabled: device.isEnabled });
});

router.post("/staff-notification-devices/disable", async (req, res): Promise<void> => {
  const { token } = input(req);
  if (!isExpoPushToken(token)) { res.status(400).json({ error: "A valid Expo push token is required" }); return; }
  const { tenantId, userId } = verifiedStaffIdentity(res);
  await db.update(staffNotificationDevicesTable).set({ isEnabled: false, disabledAt: new Date() }).where(and(
    eq(staffNotificationDevicesTable.tenantId, tenantId), eq(staffNotificationDevicesTable.userId, userId),
    eq(staffNotificationDevicesTable.expoPushToken, token),
  ));
  res.status(204).end();
});

export default router;