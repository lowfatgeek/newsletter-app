CREATE TABLE "email_campaign_recipients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"locale_selected" varchar(2) NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"last_rendered_html" text,
	"click_token_hash" varchar(64) NOT NULL,
	"clicked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_campaign_recipients_click_token_hash_unique" UNIQUE("click_token_hash")
);
--> statement-breakpoint
CREATE TABLE "email_campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"status" varchar(20) DEFAULT 'draft' NOT NULL,
	"subject_id" varchar(300) NOT NULL,
	"subject_en" varchar(300),
	"preheader_id" varchar(300),
	"preheader_en" varchar(300),
	"body_html_id" text NOT NULL,
	"body_html_en" text,
	"audience_filter" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"max_per_minute" integer NOT NULL,
	"max_per_hour" integer NOT NULL,
	"scheduled_at" timestamp with time zone,
	"snapshot_at" timestamp with time zone,
	"confirmed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contact_id" uuid NOT NULL,
	"campaign_recipient_id" uuid,
	"provider_message_id" varchar(200),
	"email_type" varchar(30) NOT NULL,
	"status" varchar(20) NOT NULL,
	"error" text,
	"sent_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"bounced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_deliveries_provider_message_id_unique" UNIQUE("provider_message_id")
);
--> statement-breakpoint
CREATE TABLE "email_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"url_hash" varchar(64) NOT NULL,
	"url" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_links_url_hash_unique" UNIQUE("url_hash")
);
--> statement-breakpoint
CREATE TABLE "email_provider_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider_message_id" varchar(200) NOT NULL,
	"event_type" varchar(40) NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_suppressions" (
	"email_normalized" varchar(254) PRIMARY KEY NOT NULL,
	"reason" varchar(30) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "contact" ADD COLUMN "unsubscribe_token_hash" varchar(64);--> statement-breakpoint
ALTER TABLE "email_campaign_recipients" ADD CONSTRAINT "email_campaign_recipients_campaign_id_email_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."email_campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_campaign_recipients" ADD CONSTRAINT "email_campaign_recipients_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_deliveries" ADD CONSTRAINT "email_deliveries_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_deliveries" ADD CONSTRAINT "email_deliveries_campaign_recipient_id_email_campaign_recipients_id_fk" FOREIGN KEY ("campaign_recipient_id") REFERENCES "public"."email_campaign_recipients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_links" ADD CONSTRAINT "email_links_campaign_id_email_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."email_campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_recipient_uq" ON "email_campaign_recipients" USING btree ("campaign_id","contact_id");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_event_uq" ON "email_provider_events" USING btree ("provider_message_id","event_type");--> statement-breakpoint
ALTER TABLE "contact" ADD CONSTRAINT "contact_unsubscribe_token_hash_unique" UNIQUE("unsubscribe_token_hash");