import { pgTable,serial,integer,text,boolean,jsonb,timestamp,uniqueIndex,date, type AnyPgColumn } from "drizzle-orm/pg-core";
import { tenantsTable } from "./tenants";
import { usersTable } from "./users";
import { employeeHistoryEntriesTable } from "./employeeHistory";
export const hrAccessTable=pgTable("hr_access",{
 id:serial("id").primaryKey(),tenantId:integer("tenant_id").notNull().references(()=>tenantsTable.id),
 userId:integer("user_id").notNull().references(()=>usersTable.id),grantedBy:integer("granted_by").notNull().references(()=>usersTable.id),
 createdAt:timestamp("created_at",{withTimezone:true}).notNull().defaultNow(),
},t=>[uniqueIndex("hr_access_member").on(t.tenantId,t.userId)]);
export const hrSettingsTable=pgTable("hr_settings",{
 credentialWarningDays:integer("credential_warning_days").notNull().default(30),
 tenantId:integer("tenant_id").primaryKey().references(()=>tenantsTable.id),publicHiringEnabled:boolean("public_hiring_enabled").notNull().default(false),
 applicationIntro:text("application_intro").notNull().default(""),privacyNotice:text("privacy_notice").notNull().default("Your application is stored for recruitment and hiring contact. Contact the employer with privacy questions."),
 applicationFields:jsonb("application_fields").notNull().default([]),
});
export const employeeProfilesTable=pgTable("employee_profiles",{
 id:serial("id").primaryKey(),tenantId:integer("tenant_id").notNull().references(()=>tenantsTable.id),userId:integer("user_id").notNull().references(()=>usersTable.id),
 legalName:text("legal_name"),phone:text("phone"),personalEmail:text("personal_email"),address:text("address"),jobTitle:text("job_title"),department:text("department"),
 hireDate:text("hire_date"),endDate:text("end_date"),employmentStatus:text("employment_status").notNull().default("active"),
 emergencyContactName:text("emergency_contact_name"),emergencyContactPhone:text("emergency_contact_phone"),notes:text("notes"),
 updatedAt:timestamp("updated_at",{withTimezone:true}).notNull().defaultNow(),
},t=>[uniqueIndex("employee_profile_member").on(t.tenantId,t.userId)]);
export const hrPostingsTable=pgTable("hr_postings",{
 id:serial("id").primaryKey(),tenantId:integer("tenant_id").notNull().references(()=>tenantsTable.id),title:text("title").notNull(),description:text("description").notNull().default(""),
 status:text("status").notNull().default("open"),fields:jsonb("fields").notNull().default([]),
 createdAt:timestamp("created_at",{withTimezone:true}).notNull().defaultNow(),updatedAt:timestamp("updated_at",{withTimezone:true}).notNull().defaultNow(),
});
export const hrApplicationsTable=pgTable("hr_applications",{
 pendingAccountSetup:boolean("pending_account_setup").notNull().default(false),
 id:serial("id").primaryKey(),tenantId:integer("tenant_id").notNull().references(()=>tenantsTable.id),postingId:integer("posting_id").references(()=>hrPostingsTable.id),
 requestId:text("request_id").notNull(),payloadHash:text("payload_hash").notNull(),fullName:text("full_name").notNull(),email:text("email").notNull(),phone:text("phone").notNull(),
 stage:text("stage").notNull().default("applied"),source:text("source").notNull(),notes:text("notes"),answers:jsonb("answers").notNull().default({}),
 fieldSnapshot:jsonb("field_snapshot").notNull().default([]),consentAt:timestamp("consent_at",{withTimezone:true}),consentSnapshot:text("consent_snapshot"),
 userId:integer("user_id").references(()=>usersTable.id),createdAt:timestamp("created_at",{withTimezone:true}).notNull().defaultNow(),updatedAt:timestamp("updated_at",{withTimezone:true}).notNull().defaultNow(),
},t=>[uniqueIndex("hr_application_request").on(t.tenantId,t.requestId)]);
export const hrDocumentsTable=pgTable("hr_documents",{
 credentialType:text("credential_type"),expiresOn:date("expires_on",{mode:"string"}),
 renewsDocumentId:integer("renews_document_id").references(():AnyPgColumn=>hrDocumentsTable.id),
 id:serial("id").primaryKey(),tenantId:integer("tenant_id").notNull().references(()=>tenantsTable.id),employeeId:integer("employee_id").references(()=>usersTable.id),
 applicationId:integer("application_id").references(()=>hrApplicationsTable.id),historyEntryId:integer("history_entry_id").references(()=>employeeHistoryEntriesTable.id),
 title:text("title").notNull(),fileName:text("file_name").notNull(),mimeType:text("mime_type").notNull(),sizeBytes:integer("size_bytes").notNull(),objectPath:text("object_path").notNull(),
 sharedWithEmployee:boolean("shared_with_employee").notNull().default(false),uploadedBy:integer("uploaded_by").references(()=>usersTable.id),createdAt:timestamp("created_at",{withTimezone:true}).notNull().defaultNow(),
},t=>[uniqueIndex("hr_document_single_renewal").on(t.renewsDocumentId)]);
export const hrCredentialNoticesTable=pgTable("hr_credential_notices",{
 id:serial("id").primaryKey(),tenantId:integer("tenant_id").notNull().references(()=>tenantsTable.id),
 documentId:integer("document_id").notNull().references(()=>hrDocumentsTable.id),
 recipientUserId:integer("recipient_user_id").notNull().references(()=>usersTable.id),
 expiresOn:date("expires_on",{mode:"string"}).notNull(),phase:text("phase").notNull(),
 notificationId:integer("notification_id"),
},t=>[uniqueIndex("hr_credential_notice_once").on(t.documentId,t.recipientUserId,t.expiresOn,t.phase)]);
export const employeeFormAssignmentsTable=pgTable("employee_form_assignments",{
 id:serial("id").primaryKey(),tenantId:integer("tenant_id").notNull().references(()=>tenantsTable.id),userId:integer("user_id").notNull().references(()=>usersTable.id),
 templateId:integer("template_id").notNull(),title:text("title").notNull(),snapshot:jsonb("snapshot").notNull(),required:boolean("required").notNull().default(true),dueDate:text("due_date"),
 answers:jsonb("answers").notNull().default({}),submittedAt:timestamp("submitted_at",{withTimezone:true}),submittedBy:integer("submitted_by").references(()=>usersTable.id),
 assignedBy:integer("assigned_by").notNull().references(()=>usersTable.id),createdAt:timestamp("created_at",{withTimezone:true}).notNull().defaultNow(),
});
export const hrAuditTable=pgTable("hr_audit",{
 id:serial("id").primaryKey(),tenantId:integer("tenant_id").notNull().references(()=>tenantsTable.id),actorId:integer("actor_id").references(()=>usersTable.id),
 employeeId:integer("employee_id").references(()=>usersTable.id),applicationId:integer("application_id").references(()=>hrApplicationsTable.id),
 action:text("action").notNull(),before:jsonb("before"),after:jsonb("after"),createdAt:timestamp("created_at",{withTimezone:true}).notNull().defaultNow(),
});
