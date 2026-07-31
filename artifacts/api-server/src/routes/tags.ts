/**
 * Business Tags — tenant-wide tag library.
 * Tags are created here in settings, then stored as text[] on customers/jobs/properties.
 * Slug-based dedup prevents near-duplicates from different spellings.
 */
import { Router, type IRouter } from "express";
import { db, businessTagsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { getTenantId } from "../lib/tenantHelper";

const router: IRouter = Router();

/** Normalise a tag name to a slug: lowercase, alphanumeric + hyphens only */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

// GET /tags — list all tags for the tenant
router.get("/tags", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const rows = await db
    .select()
    .from(businessTagsTable)
    .where(eq(businessTagsTable.tenantId, tenantId))
    .orderBy(businessTagsTable.name);
  res.json(rows);
});

// POST /tags — create a new tag (rejects near-duplicates by slug)
router.post("/tags", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const { name, color } = req.body as { name?: string; color?: string };

  if (!name || !name.trim()) {
    res.status(400).json({ error: "name is required" });
    return;
  }

  const slug = slugify(name.trim());
  if (!slug) {
    res.status(400).json({ error: "Tag name must contain at least one letter or number" });
    return;
  }

  // Dedup check
  const [existing] = await db
    .select({ id: businessTagsTable.id, name: businessTagsTable.name })
    .from(businessTagsTable)
    .where(and(eq(businessTagsTable.tenantId, tenantId), eq(businessTagsTable.slug, slug)));

  if (existing) {
    res.status(409).json({
      error: `A tag with this name already exists: "${existing.name}". It looks the same — use it instead of creating a new one.`,
      conflictId: existing.id,
    });
    return;
  }

  const [tag] = await db
    .insert(businessTagsTable)
    .values({ tenantId, name: name.trim(), slug, color: color ?? "#6b7280" })
    .returning();

  res.status(201).json(tag);
});

// PATCH /tags/:id — rename or recolor a tag
router.patch("/tags/:id", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const id = parseInt(req.params.id, 10);
  const { name, color } = req.body as { name?: string; color?: string };

  const updates: Partial<typeof businessTagsTable.$inferInsert> = {};

  if (name !== undefined) {
    const trimmed = name.trim();
    if (!trimmed) { res.status(400).json({ error: "name cannot be empty" }); return; }
    const newSlug = slugify(trimmed);

    // Check another tag doesn't already have this slug
    const [conflict] = await db
      .select({ id: businessTagsTable.id })
      .from(businessTagsTable)
      .where(and(eq(businessTagsTable.tenantId, tenantId), eq(businessTagsTable.slug, newSlug)));

    if (conflict && conflict.id !== id) {
      res.status(409).json({ error: `Another tag normalises to the same name. Use that one instead.` });
      return;
    }

    updates.name = trimmed;
    updates.slug = newSlug;
  }

  if (color !== undefined) updates.color = color;

  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: "No fields to update" });
    return;
  }

  const [updated] = await db
    .update(businessTagsTable)
    .set(updates)
    .where(and(eq(businessTagsTable.id, id), eq(businessTagsTable.tenantId, tenantId)))
    .returning();

  if (!updated) { res.status(404).json({ error: "Not found" }); return; }
  res.json(updated);
});

// DELETE /tags/:id — remove a tag from the library
router.delete("/tags/:id", async (req, res): Promise<void> => {
  const tenantId = getTenantId(req);
  const id = parseInt(req.params.id, 10);

  await db
    .delete(businessTagsTable)
    .where(and(eq(businessTagsTable.id, id), eq(businessTagsTable.tenantId, tenantId)));

  res.status(204).send();
});

export default router;
