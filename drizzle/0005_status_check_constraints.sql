-- Task 2.8 (audit 04-A3): tegakkan domain status di level database.
-- CHECK constraint tidak dapat dideklarasikan lewat pgTable pada kolom varchar
-- di drizzle-orm 0.45, sehingga migrasi ini ditulis manual dan didaftarkan
-- di drizzle/meta/_journal.json (idx 5). Snapshot 0005 identik dengan 0004
-- karena custom migration tidak mengubah skema yang dikenali drizzle-kit.
ALTER TABLE "email_campaigns" ADD CONSTRAINT "email_campaigns_status_check" CHECK ("status" IN ('draft', 'scheduled', 'queued', 'sending', 'completed', 'paused', 'cancelled', 'failed'));--> statement-breakpoint
ALTER TABLE "contact" ADD CONSTRAINT "contact_confirmation_status_check" CHECK ("confirmation_status" IN ('pending', 'confirmed'));
