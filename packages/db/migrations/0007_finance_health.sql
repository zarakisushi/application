CREATE TABLE "finance_attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"file_name" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"content" "bytea" NOT NULL,
	"status" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid
);
--> statement-breakpoint
ALTER TABLE "finance_categories" ADD COLUMN "cmv" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "finance_entries" ADD COLUMN "attachment_id" uuid;--> statement-breakpoint
ALTER TABLE "finance_attachments" ADD CONSTRAINT "finance_attachments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_entries" ADD CONSTRAINT "finance_entries_attachment_id_finance_attachments_id_fk" FOREIGN KEY ("attachment_id") REFERENCES "public"."finance_attachments"("id") ON DELETE no action ON UPDATE no action;