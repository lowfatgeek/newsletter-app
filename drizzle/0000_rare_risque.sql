CREATE TABLE "access_token" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"claim_id" uuid NOT NULL,
	"type" varchar(20) NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "access_token_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "consent_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contact_id" uuid NOT NULL,
	"event" varchar(30) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contact" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email_normalized" varchar(254) NOT NULL,
	"locale" varchar(2) DEFAULT 'id' NOT NULL,
	"confirmation_status" varchar(20) DEFAULT 'pending' NOT NULL,
	"confirmed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contact_email_normalized_unique" UNIQUE("email_normalized")
);
--> statement-breakpoint
CREATE TABLE "doa_selection" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"variant" varchar(20) NOT NULL,
	"template_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "doa_template" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"variant" varchar(20) NOT NULL,
	"locale" varchar(2) NOT NULL,
	"name" varchar(100) NOT NULL,
	"content" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_domain" (
	"domain" varchar(254) PRIMARY KEY NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email_type" varchar(30) NOT NULL,
	"to_email" varchar(254) NOT NULL,
	"subject" varchar(300) NOT NULL,
	"html" text NOT NULL,
	"text" text NOT NULL,
	"idempotency_key" varchar(100) NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"scheduled_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_outbox_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "marketing_subscription" (
	"contact_id" uuid PRIMARY KEY NOT NULL,
	"status" varchar(20) DEFAULT 'inactive' NOT NULL,
	"subscribed_at" timestamp with time zone,
	"unsubscribed_at" timestamp with time zone,
	"source" varchar(100)
);
--> statement-breakpoint
CREATE TABLE "rate_limit" (
	"key" varchar(200) PRIMARY KEY NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reward_asset" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"storage_key" text NOT NULL,
	"name_id" varchar(200) NOT NULL,
	"name_en" varchar(200),
	"desc_id" text,
	"desc_en" text,
	"mime_type" varchar(100) NOT NULL,
	"size_bytes" bigint NOT NULL,
	"checksum" varchar(64) NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reward_campaign_locale" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"locale" varchar(2) NOT NULL,
	"title" varchar(200) NOT NULL,
	"description" text NOT NULL,
	"reward_items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"meta_title" varchar(200),
	"meta_description" text
);
--> statement-breakpoint
CREATE TABLE "reward_campaign" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" varchar(120) NOT NULL,
	"status" varchar(20) DEFAULT 'draft' NOT NULL,
	"featured_image_key" text,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reward_campaign_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "reward_claim" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contact_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"status" varchar(20) DEFAULT 'access_sent' NOT NULL,
	"first_claimed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_access_sent_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "access_token" ADD CONSTRAINT "access_token_claim_id_reward_claim_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."reward_claim"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent_event" ADD CONSTRAINT "consent_event_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doa_selection" ADD CONSTRAINT "doa_selection_campaign_id_reward_campaign_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."reward_campaign"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doa_selection" ADD CONSTRAINT "doa_selection_template_id_doa_template_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."doa_template"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_subscription" ADD CONSTRAINT "marketing_subscription_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reward_asset" ADD CONSTRAINT "reward_asset_campaign_id_reward_campaign_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."reward_campaign"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reward_campaign_locale" ADD CONSTRAINT "reward_campaign_locale_campaign_id_reward_campaign_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."reward_campaign"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reward_claim" ADD CONSTRAINT "reward_claim_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reward_claim" ADD CONSTRAINT "reward_claim_campaign_id_reward_campaign_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."reward_campaign"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "access_token_claim_idx" ON "access_token" USING btree ("claim_id");--> statement-breakpoint
CREATE UNIQUE INDEX "doa_selection_uq" ON "doa_selection" USING btree ("campaign_id","variant");--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_locale_uq" ON "reward_campaign_locale" USING btree ("campaign_id","locale");--> statement-breakpoint
CREATE UNIQUE INDEX "claim_contact_campaign_uq" ON "reward_claim" USING btree ("contact_id","campaign_id");