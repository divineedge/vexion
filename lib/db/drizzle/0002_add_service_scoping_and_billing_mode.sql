ALTER TABLE "recurring_invoice_templates" ALTER COLUMN "customer_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "recurring_invoice_templates" ADD COLUMN "service_id" integer;--> statement-breakpoint
ALTER TABLE "recurring_invoice_templates" ADD COLUMN "billing_mode" text DEFAULT 'static' NOT NULL;--> statement-breakpoint
ALTER TABLE "recurring_invoice_templates" ADD CONSTRAINT "recurring_invoice_templates_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE no action ON UPDATE no action;
