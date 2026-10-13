import {db,documentReminderStepsTable,usersTable,internalTasksTable,taskNotificationsTable} from "@workspace/db";
import {and,eq,inArray,sql} from "drizzle-orm";
export type ReminderActions={offsetDays:number;label:string;channels?:string[];notifyAdmin?:boolean;createTask?:boolean};
export type ReminderDocument={tenantId:number;kind:"invoice"|"estimate";id:number;customerId:number;customerName:string;link:string};
export async function reminderActions(doc:ReminderDocument,rule:ReminderActions){
  return db.transaction(async tx=>{
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${doc.tenantId},hashtext(${`${doc.kind}:${doc.id}:${rule.offsetDays}`}))`);
    await tx.insert(documentReminderStepsTable).values({tenantId:doc.tenantId,documentType:doc.kind,documentId:doc.id,offsetDays:rule.offsetDays}).onConflictDoNothing();
    const [step]=await tx.select().from(documentReminderStepsTable).where(and(eq(documentReminderStepsTable.tenantId,doc.tenantId),eq(documentReminderStepsTable.documentType,doc.kind),eq(documentReminderStepsTable.documentId,doc.id),eq(documentReminderStepsTable.offsetDays,rule.offsetDays))).for("update");
    const admins=await tx.select().from(usersTable).where(and(eq(usersTable.tenantId,doc.tenantId),eq(usersTable.isActive,true),inArray(usersTable.role,["company_owner","office_manager","department_manager"])));
    const title=`Follow up ${doc.kind} #${doc.id} — ${doc.customerName}`;
    if(rule.notifyAdmin && !step.alerted && admins.length){
      await tx.insert(taskNotificationsTable).values(admins.map(admin=>({tenantId:doc.tenantId,recipientUserId:admin.id,type:"document_followup",message:`${title}: ${rule.label}`,linkPath:doc.link})));
      await tx.update(documentReminderStepsTable).set({alerted:true}).where(eq(documentReminderStepsTable.id,step.id));
    }
    if(rule.createTask && !step.taskCreated && admins.length){
      const creator=admins.find(admin=>admin.role==="company_owner")??admins[0];
      await tx.insert(internalTasksTable).values({tenantId:doc.tenantId,title,description:`${rule.label}\nReview the document: ${doc.link}`,taskType:"follow_up",createdById:creator.id,assignedToRole:"admin_office",contextType:"customer",contextId:doc.customerId,idempotencyKey:`doc-reminder:${doc.kind}:${doc.id}:${rule.offsetDays}`}).onConflictDoNothing();
      await tx.update(documentReminderStepsTable).set({taskCreated:true}).where(eq(documentReminderStepsTable.id,step.id));
    }
    return step;
  });
}
export async function installDocumentReminderSchema(){
  await db.execute(sql.raw(`
    ALTER TABLE tenants ADD COLUMN IF NOT EXISTS estimate_reminder_settings jsonb DEFAULT '{"enabled":false,"rules":[]}'::jsonb;
    ALTER TABLE estimates ADD COLUMN IF NOT EXISTS reminder_anchor_at timestamptz;
    CREATE TABLE IF NOT EXISTS document_reminder_steps (
      id serial PRIMARY KEY,tenant_id integer NOT NULL REFERENCES tenants(id),document_type text NOT NULL,document_id integer NOT NULL,
      offset_days integer NOT NULL,alerted boolean NOT NULL DEFAULT false,task_created boolean NOT NULL DEFAULT false,
      email_state text NOT NULL DEFAULT 'pending',email_delivery_id integer,sms_state text NOT NULL DEFAULT 'pending',created_at timestamptz DEFAULT now());
    CREATE UNIQUE INDEX IF NOT EXISTS document_reminder_once ON document_reminder_steps(tenant_id,document_type,document_id,offset_days);
    CREATE OR REPLACE FUNCTION stamp_estimate_reminder_anchor() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.status='sent' AND (TG_OP='INSERT' OR OLD.status IS DISTINCT FROM 'sent')
      THEN NEW.reminder_anchor_at=COALESCE(NEW.reminder_anchor_at,now()); END IF; RETURN NEW; END $$;
    DROP TRIGGER IF EXISTS estimate_reminder_anchor ON estimates;
    CREATE TRIGGER estimate_reminder_anchor BEFORE INSERT OR UPDATE OF status ON estimates FOR EACH ROW EXECUTE FUNCTION stamp_estimate_reminder_anchor();
  `));
}
