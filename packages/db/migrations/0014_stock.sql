CREATE TYPE "public"."stock_kind" AS ENUM('INSUMO', 'EMBALAGEM', 'MARKETING', 'OPERACIONAL', 'OUTRO');--> statement-breakpoint
CREATE TYPE "public"."stock_movement_kind" AS ENUM('COMPRA', 'PEDIDO', 'PERDA', 'CONSUMO', 'AJUSTE', 'ENTRADA');--> statement-breakpoint
ALTER TYPE "public"."finance_origin" ADD VALUE 'ESTOQUE';--> statement-breakpoint
CREATE TABLE "product_recipes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"qty" numeric(14, 3) NOT NULL,
	"status" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "product_recipes_qty_ck" CHECK ("product_recipes"."qty" > 0)
);
--> statement-breakpoint
CREATE TABLE "stock_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" "stock_kind" NOT NULL,
	"unit" text NOT NULL,
	"min_qty" numeric(14, 3) DEFAULT '0' NOT NULL,
	"finance_category_id" uuid,
	"supplier" text,
	"active" boolean DEFAULT true NOT NULL,
	"status" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "stock_items_unit_ck" CHECK ("stock_items"."unit" in ('un', 'kg', 'g', 'l', 'ml', 'pct', 'cx', 'folha', 'rolo', 'm')),
	CONSTRAINT "stock_items_min_ck" CHECK ("stock_items"."min_qty" >= 0)
);
--> statement-breakpoint
CREATE TABLE "stock_movements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"kind" "stock_movement_kind" NOT NULL,
	"qty" numeric(14, 3) NOT NULL,
	"total_cents" integer,
	"occurred_on" date NOT NULL,
	"order_id" uuid,
	"purchase_id" uuid,
	"notes" text,
	"status" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "stock_movements_sign_ck" CHECK (("stock_movements"."kind" in ('COMPRA', 'ENTRADA') and "stock_movements"."qty" > 0)
          or ("stock_movements"."kind" in ('PEDIDO', 'PERDA', 'CONSUMO') and "stock_movements"."qty" < 0)
          or ("stock_movements"."kind" = 'AJUSTE' and "stock_movements"."qty" <> 0)),
	CONSTRAINT "stock_movements_purchase_ck" CHECK (("stock_movements"."kind" = 'COMPRA') = ("stock_movements"."purchase_id" is not null and "stock_movements"."total_cents" is not null)),
	CONSTRAINT "stock_movements_order_ck" CHECK (("stock_movements"."kind" = 'PEDIDO') = ("stock_movements"."order_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "stock_purchases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"supplier" text NOT NULL,
	"purchased_on" date NOT NULL,
	"due_date" date NOT NULL,
	"total_cents" integer NOT NULL,
	"attachment_id" uuid,
	"notes" text,
	"finance_entry_ids" uuid[] DEFAULT '{}' NOT NULL,
	"status" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "stock_purchases_total_ck" CHECK ("stock_purchases"."total_cents" > 0)
);
--> statement-breakpoint
ALTER TABLE "product_recipes" ADD CONSTRAINT "product_recipes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_recipes" ADD CONSTRAINT "product_recipes_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_recipes" ADD CONSTRAINT "product_recipes_item_id_stock_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."stock_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_items" ADD CONSTRAINT "stock_items_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_items" ADD CONSTRAINT "stock_items_finance_category_id_finance_categories_id_fk" FOREIGN KEY ("finance_category_id") REFERENCES "public"."finance_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_item_id_stock_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."stock_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_purchase_id_stock_purchases_id_fk" FOREIGN KEY ("purchase_id") REFERENCES "public"."stock_purchases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_purchases" ADD CONSTRAINT "stock_purchases_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_purchases" ADD CONSTRAINT "stock_purchases_attachment_id_finance_attachments_id_fk" FOREIGN KEY ("attachment_id") REFERENCES "public"."finance_attachments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "product_recipes_product_item_uq" ON "product_recipes" USING btree ("product_id","item_id") WHERE "product_recipes"."status";--> statement-breakpoint
CREATE UNIQUE INDEX "stock_items_tenant_name_uq" ON "stock_items" USING btree ("tenant_id","name") WHERE "stock_items"."status";--> statement-breakpoint
CREATE INDEX "stock_movements_item_idx" ON "stock_movements" USING btree ("item_id","occurred_on");--> statement-breakpoint
CREATE INDEX "stock_movements_tenant_date_idx" ON "stock_movements" USING btree ("tenant_id","occurred_on");--> statement-breakpoint
CREATE INDEX "stock_movements_order_idx" ON "stock_movements" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "stock_movements_purchase_idx" ON "stock_movements" USING btree ("purchase_id");--> statement-breakpoint
CREATE INDEX "stock_purchases_tenant_date_idx" ON "stock_purchases" USING btree ("tenant_id","purchased_on");