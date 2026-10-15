CREATE TABLE "finance_closings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"month" date NOT NULL,
	"status" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "royalty_charges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"matriz_tenant_id" uuid NOT NULL,
	"month" date NOT NULL,
	"revenue_cents" integer NOT NULL,
	"royalty_pct" numeric(5, 2) NOT NULL,
	"amount_cents" integer NOT NULL,
	"due_date" date NOT NULL,
	"franchise_entry_id" uuid,
	"matriz_entry_id" uuid,
	"status" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "royalty_charges_amount_ck" CHECK ("royalty_charges"."amount_cents" >= 0 and "royalty_charges"."revenue_cents" >= 0)
);
--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "royalty_due_day" integer DEFAULT 10 NOT NULL;--> statement-breakpoint
ALTER TABLE "finance_entries" ADD COLUMN "royalty_charge_id" uuid;--> statement-breakpoint
ALTER TABLE "finance_closings" ADD CONSTRAINT "finance_closings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "royalty_charges" ADD CONSTRAINT "royalty_charges_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "royalty_charges" ADD CONSTRAINT "royalty_charges_matriz_tenant_id_tenants_id_fk" FOREIGN KEY ("matriz_tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "finance_closings_tenant_month_uq" ON "finance_closings" USING btree ("tenant_id","month") WHERE "finance_closings"."status";--> statement-breakpoint
CREATE UNIQUE INDEX "royalty_charges_tenant_month_uq" ON "royalty_charges" USING btree ("tenant_id","month") WHERE "royalty_charges"."status";--> statement-breakpoint
ALTER TABLE "finance_entries" ADD CONSTRAINT "finance_entries_royalty_charge_id_royalty_charges_id_fk" FOREIGN KEY ("royalty_charge_id") REFERENCES "public"."royalty_charges"("id") ON DELETE no action ON UPDATE no action;