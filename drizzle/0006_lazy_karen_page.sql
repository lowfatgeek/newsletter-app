ALTER TABLE "contact" DROP CONSTRAINT "contact_unsubscribe_token_hash_unique";--> statement-breakpoint
ALTER TABLE "contact" DROP COLUMN "unsubscribe_token_hash";