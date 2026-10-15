CREATE TYPE "public"."coupon_kind" AS ENUM('PERCENT', 'FIXED');--> statement-breakpoint
CREATE TABLE "coupons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"code" text NOT NULL,
	"description" text,
	"kind" "coupon_kind" NOT NULL,
	"percent_off" numeric(5, 2),
	"amount_off_cents" integer,
	"min_tubes" integer,
	"min_subtotal_cents" integer,
	"starts_at" date,
	"ends_at" date,
	"max_uses" integer,
	"phone" text,
	"active" boolean DEFAULT true NOT NULL,
	"status" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "coupons_value_ck" CHECK (("coupons"."kind" = 'PERCENT' and "coupons"."percent_off" > 0 and "coupons"."percent_off" <= 100 and "coupons"."amount_off_cents" is null)
          or ("coupons"."kind" = 'FIXED' and "coupons"."amount_off_cents" > 0 and "coupons"."percent_off" is null)),
	CONSTRAINT "coupons_limits_ck" CHECK (coalesce("coupons"."max_uses", 1) >= 1 and coalesce("coupons"."min_tubes", 1) >= 1 and coalesce("coupons"."min_subtotal_cents", 0) >= 0),
	CONSTRAINT "coupons_dates_ck" CHECK ("coupons"."starts_at" is null or "coupons"."ends_at" is null or "coupons"."ends_at" >= "coupons"."starts_at"),
	CONSTRAINT "coupons_exclusive_ck" CHECK ("coupons"."phone" is null or "coupons"."max_uses" = 1)
);
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "coupon_id" uuid;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "coupon_code" text;--> statement-breakpoint
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "coupons_tenant_code_uq" ON "coupons" USING btree ("tenant_id","code") WHERE "coupons"."status";--> statement-breakpoint
CREATE INDEX "coupons_tenant_active_idx" ON "coupons" USING btree ("tenant_id","active");--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_coupon_id_coupons_id_fk" FOREIGN KEY ("coupon_id") REFERENCES "public"."coupons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "orders_coupon_idx" ON "orders" USING btree ("coupon_id");