import { pgTable, text, serial, timestamp, integer, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { tenantsTable } from "./tenants";

export const mediaAttachmentsTable = pgTable("media_attachments", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull().references(() => tenantsTable.id),
  /** 'property' | 'job' | 'customer' */
  entityType: text("entity_type").notNull(),
  entityId: integer("entity_id").notNull(),
  fileKey: text("file_key").notNull(), // objectPath returned from storage upload
  fileUrl: text("file_url").notNull(), // serving URL e.g. /api/storage/objects/...
  mimeType: text("mime_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  caption: text("caption"),
  /** Marks the property cover photo */
  isCover: boolean("is_cover").notNull().default(false),
  /**
   * For video attachments: true = server compressed to 720p H.264 before storing,
   * false = stored as-is (ffmpeg unavailable), null = not a video.
   */
  videoCompressed: boolean("video_compressed"),
  createdBy: integer("created_by"),
  /** 'staff' (uploaded by a staff member) | 'customer' (uploaded via the customer portal) */
  source: text("source"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertMediaAttachmentSchema = createInsertSchema(mediaAttachmentsTable).omit({ id: true, createdAt: true });
export type InsertMediaAttachment = z.infer<typeof insertMediaAttachmentSchema>;
export type MediaAttachment = typeof mediaAttachmentsTable.$inferSelect;
