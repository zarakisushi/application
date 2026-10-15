CREATE TABLE "finance_statements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"statement_date" date NOT NULL,
	"balance_cents" integer NOT NULL,
	"attachment_ids" uuid[] NOT NULL,
	"notes" text,
	"adjustment_entry_id" uuid,
	"status" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "finance_statements_files_ck" CHECK (cardinality("finance_statements"."attachment_ids") between 1 and 10)
);
--> statement-breakpoint
ALTER TABLE "finance_statements" ADD CONSTRAINT "finance_statements_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_statements" ADD CONSTRAINT "finance_statements_account_id_finance_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."finance_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_statements" ADD CONSTRAINT "finance_statements_adjustment_entry_id_finance_entries_id_fk" FOREIGN KEY ("adjustment_entry_id") REFERENCES "public"."finance_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "finance_statements_account_idx" ON "finance_statements" USING btree ("account_id","statement_date");