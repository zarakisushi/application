CREATE TYPE "public"."finance_account_kind" AS ENUM('CAIXA', 'BANCO', 'CARTEIRA_DIGITAL', 'OUTRO');--> statement-breakpoint
CREATE TYPE "public"."finance_direction" AS ENUM('ENTRADA', 'SAIDA');--> statement-breakpoint
CREATE TYPE "public"."finance_dre_group" AS ENUM('RECEITA', 'CUSTO_VARIAVEL', 'DESPESA_FIXA', 'IMPOSTOS', 'ROYALTIES', 'FINANCEIRO', 'INVESTIMENTO', 'OUTROS');--> statement-breakpoint
CREATE TYPE "public"."finance_origin" AS ENUM('MANUAL', 'PEDIDO', 'ROYALTIES', 'AJUSTE', 'TRANSFERENCIA');--> statement-breakpoint
CREATE TABLE "finance_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" "finance_account_kind" NOT NULL,
	"opening_balance_cents" integer DEFAULT 0 NOT NULL,
	"opening_date" date NOT NULL,
	"receives_methods" "payment_method"[] DEFAULT '{}' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"status" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "finance_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"direction" "finance_direction" NOT NULL,
	"dre_group" "finance_dre_group" NOT NULL,
	"system_key" text,
	"active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"status" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "finance_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"direction" "finance_direction" NOT NULL,
	"description" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"category_id" uuid,
	"account_id" uuid,
	"competence_date" date NOT NULL,
	"due_date" date NOT NULL,
	"paid_on" date,
	"payment_method" "payment_method",
	"counterparty" text,
	"notes" text,
	"attachment_url" text,
	"origin" "finance_origin" DEFAULT 'MANUAL' NOT NULL,
	"order_id" uuid,
	"transfer_id" uuid,
	"series_id" uuid,
	"installment" integer,
	"installments" integer,
	"status" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "finance_entries_amount_ck" CHECK ("finance_entries"."amount_cents" > 0),
	CONSTRAINT "finance_entries_paid_account_ck" CHECK ("finance_entries"."paid_on" is null or "finance_entries"."account_id" is not null),
	CONSTRAINT "finance_entries_category_ck" CHECK (("finance_entries"."origin" = 'TRANSFERENCIA') = ("finance_entries"."category_id" is null)),
	CONSTRAINT "finance_entries_transfer_ck" CHECK (("finance_entries"."origin" = 'TRANSFERENCIA') = ("finance_entries"."transfer_id" is not null)),
	CONSTRAINT "finance_entries_installment_ck" CHECK (("finance_entries"."installment" is null and "finance_entries"."installments" is null) or ("finance_entries"."installment" between 1 and "finance_entries"."installments"))
);
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "paid_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "finance_accounts" ADD CONSTRAINT "finance_accounts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_categories" ADD CONSTRAINT "finance_categories_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_entries" ADD CONSTRAINT "finance_entries_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_entries" ADD CONSTRAINT "finance_entries_category_id_finance_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."finance_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_entries" ADD CONSTRAINT "finance_entries_account_id_finance_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."finance_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_entries" ADD CONSTRAINT "finance_entries_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "finance_accounts_tenant_name_uq" ON "finance_accounts" USING btree ("tenant_id","name") WHERE "finance_accounts"."status";--> statement-breakpoint
CREATE UNIQUE INDEX "finance_categories_tenant_name_uq" ON "finance_categories" USING btree ("tenant_id","direction","name") WHERE "finance_categories"."status";--> statement-breakpoint
CREATE UNIQUE INDEX "finance_categories_system_uq" ON "finance_categories" USING btree ("tenant_id","system_key") WHERE "finance_categories"."status" and "finance_categories"."system_key" is not null;--> statement-breakpoint
CREATE INDEX "finance_entries_tenant_due_idx" ON "finance_entries" USING btree ("tenant_id","due_date");--> statement-breakpoint
CREATE INDEX "finance_entries_tenant_paid_idx" ON "finance_entries" USING btree ("tenant_id","paid_on");--> statement-breakpoint
CREATE INDEX "finance_entries_tenant_competence_idx" ON "finance_entries" USING btree ("tenant_id","competence_date");--> statement-breakpoint
CREATE INDEX "finance_entries_account_idx" ON "finance_entries" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "finance_entries_series_idx" ON "finance_entries" USING btree ("series_id");--> statement-breakpoint
CREATE UNIQUE INDEX "finance_entries_order_uq" ON "finance_entries" USING btree ("order_id") WHERE "finance_entries"."status" and "finance_entries"."order_id" is not null;