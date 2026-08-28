ALTER TABLE "customers"
ADD COLUMN "referring_customer_id" integer;

ALTER TABLE "customers"
ADD CONSTRAINT "customers_referring_customer_id_customers_id_fk"
FOREIGN KEY ("referring_customer_id") REFERENCES "public"."customers"("id")
ON DELETE SET NULL ON UPDATE NO ACTION;