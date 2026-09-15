CREATE INDEX "admin_audit_log_created_at_idx" ON "admin_audit_log" USING btree ("created_at" desc);--> statement-breakpoint
CREATE INDEX "consent_event_contact_idx" ON "consent_event" USING btree ("contact_id");--> statement-breakpoint
CREATE UNIQUE INDEX "email_campaigns_single_sending_uq" ON "email_campaigns" USING btree ("status") WHERE "email_campaigns"."status" = 'sending';--> statement-breakpoint
CREATE INDEX "email_campaigns_status_idx" ON "email_campaigns" USING btree ("status");--> statement-breakpoint
CREATE INDEX "email_deliveries_recipient_idx" ON "email_deliveries" USING btree ("campaign_recipient_id");--> statement-breakpoint
CREATE INDEX "email_deliveries_contact_idx" ON "email_deliveries" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "email_deliveries_sent_at_idx" ON "email_deliveries" USING btree ("sent_at");--> statement-breakpoint
CREATE INDEX "email_outbox_status_sched_idx" ON "email_outbox" USING btree ("status","scheduled_at");