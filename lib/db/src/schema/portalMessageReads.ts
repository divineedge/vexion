import { integer,pgTable,primaryKey,timestamp } from "drizzle-orm/pg-core";
import { tenantsTable } from "./tenants";
import { usersTable } from "./users";
import { portalMessagesTable } from "./portalMessages";

export const portalMessageReadsTable=pgTable("portal_message_reads",{
  tenantId:integer("tenant_id").notNull().references(()=>tenantsTable.id,{onDelete:"cascade"}),
  messageId:integer("message_id").notNull().references(()=>portalMessagesTable.id,{onDelete:"cascade"}),
  userId:integer("user_id").notNull().references(()=>usersTable.id,{onDelete:"cascade"}),
  readAt:timestamp("read_at",{withTimezone:true}).notNull().defaultNow(),
},table=>[primaryKey({columns:[table.tenantId,table.messageId,table.userId]})]);
