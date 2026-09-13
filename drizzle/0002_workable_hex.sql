CREATE TABLE "admin_audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admin_user_id" uuid,
	"action" varchar(50) NOT NULL,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ip_hash" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "admin_otp_challenge" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admin_user_id" uuid NOT NULL,
	"code_hash" varchar(64) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "admin_session" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"admin_user_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admin_session_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "admin_user" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(254) NOT NULL,
	"password_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_login_at" timestamp with time zone,
	CONSTRAINT "admin_user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "campaign_redirect" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"old_slug" varchar(120) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "campaign_redirect_old_slug_unique" UNIQUE("old_slug")
);
--> statement-breakpoint
CREATE TABLE "trusted_device" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admin_user_id" uuid NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"user_agent" varchar(300),
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trusted_device_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "reward_campaign" ADD COLUMN "sort_order" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "admin_audit_log" ADD CONSTRAINT "admin_audit_log_admin_user_id_admin_user_id_fk" FOREIGN KEY ("admin_user_id") REFERENCES "public"."admin_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_otp_challenge" ADD CONSTRAINT "admin_otp_challenge_admin_user_id_admin_user_id_fk" FOREIGN KEY ("admin_user_id") REFERENCES "public"."admin_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_session" ADD CONSTRAINT "admin_session_admin_user_id_admin_user_id_fk" FOREIGN KEY ("admin_user_id") REFERENCES "public"."admin_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_redirect" ADD CONSTRAINT "campaign_redirect_campaign_id_reward_campaign_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."reward_campaign"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trusted_device" ADD CONSTRAINT "trusted_device_admin_user_id_admin_user_id_fk" FOREIGN KEY ("admin_user_id") REFERENCES "public"."admin_user"("id") ON DELETE cascade ON UPDATE no action;