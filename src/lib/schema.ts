import { desc, sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

export const contacts = pgTable("contact", {
  id: uuid("id").defaultRandom().primaryKey(),
  emailNormalized: varchar("email_normalized", { length: 254 }).notNull().unique(),
  locale: varchar("locale", { length: 2 }).notNull().default("id"),
  confirmationStatus: varchar("confirmation_status", { length: 20 }).notNull().default("pending"), // pending | confirmed
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  unsubscribeTokenHash: varchar("unsubscribe_token_hash", { length: 64 }).unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const marketingSubscriptions = pgTable("marketing_subscription", {
  contactId: uuid("contact_id")
    .primaryKey()
    .references(() => contacts.id),
  status: varchar("status", { length: 20 }).notNull().default("inactive"), // inactive | active | unsubscribed
  subscribedAt: timestamp("subscribed_at", { withTimezone: true }),
  unsubscribedAt: timestamp("unsubscribed_at", { withTimezone: true }),
  source: varchar("source", { length: 100 }),
});

export const consentEvents = pgTable(
  "consent_event",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id),
    event: varchar("event", { length: 30 }).notNull(), // subscribed | unsubscribed | resubscribed
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("consent_event_contact_idx").on(t.contactId)],
);

export const rewardCampaigns = pgTable("reward_campaign", {
  id: uuid("id").defaultRandom().primaryKey(),
  slug: varchar("slug", { length: 120 }).notNull().unique(),
  status: varchar("status", { length: 20 }).notNull().default("draft"), // draft | published | paused | archived
  indexable: boolean("indexable").notNull().default(false),
  featuredImageKey: text("featured_image_key"),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const rewardCampaignLocales = pgTable(
  "reward_campaign_locale",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => rewardCampaigns.id, { onDelete: "cascade" }),
    locale: varchar("locale", { length: 2 }).notNull(), // id | en
    title: varchar("title", { length: 200 }).notNull(),
    description: text("description").notNull(),
    rewardItems: jsonb("reward_items").notNull().default([]), // [{ name, benefit, format?, size? }]
    metaTitle: varchar("meta_title", { length: 200 }),
    metaDescription: text("meta_description"),
  },
  (t) => [uniqueIndex("campaign_locale_uq").on(t.campaignId, t.locale)],
);

export const rewardAssets = pgTable("reward_asset", {
  id: uuid("id").defaultRandom().primaryKey(),
  campaignId: uuid("campaign_id")
    .notNull()
    .references(() => rewardCampaigns.id, { onDelete: "cascade" }),
  storageKey: text("storage_key").notNull(),
  nameId: varchar("name_id", { length: 200 }).notNull(),
  nameEn: varchar("name_en", { length: 200 }),
  descId: text("desc_id"),
  descEn: text("desc_en"),
  mimeType: varchar("mime_type", { length: 100 }).notNull(),
  sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
  checksum: varchar("checksum", { length: 64 }).notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const rewardClaims = pgTable(
  "reward_claim",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => rewardCampaigns.id),
    status: varchar("status", { length: 20 }).notNull().default("access_sent"), // access_sent | accessed
    firstClaimedAt: timestamp("first_claimed_at", { withTimezone: true }).notNull().defaultNow(),
    lastAccessSentAt: timestamp("last_access_sent_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("claim_contact_campaign_uq").on(t.contactId, t.campaignId)],
);

export const accessTokens = pgTable(
  "access_token",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    claimId: uuid("claim_id")
      .notNull()
      .references(() => rewardClaims.id, { onDelete: "cascade" }),
    type: varchar("type", { length: 20 }).notNull(), // confirm | access | session
    tokenHash: varchar("token_hash", { length: 64 }).notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("access_token_claim_idx").on(t.claimId)],
);

export const doaTemplates = pgTable("doa_template", {
  id: uuid("id").defaultRandom().primaryKey(),
  variant: varchar("variant", { length: 20 }).notNull(), // muslim | universal
  locale: varchar("locale", { length: 2 }).notNull(),
  name: varchar("name", { length: 100 }).notNull(),
  content: text("content").notNull(),
});

export const doaSelections = pgTable(
  "doa_selection",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => rewardCampaigns.id, { onDelete: "cascade" }),
    variant: varchar("variant", { length: 20 }).notNull(), // muslim | universal
    templateId: uuid("template_id")
      .notNull()
      .references(() => doaTemplates.id),
  },
  (t) => [uniqueIndex("doa_selection_uq").on(t.campaignId, t.variant)],
);

export const emailDomains = pgTable("email_domain", {
  domain: varchar("domain", { length: 254 }).primaryKey(),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const emailOutbox = pgTable(
  "email_outbox",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    emailType: varchar("email_type", { length: 30 }).notNull(), // confirmation | reward_access
    toEmail: varchar("to_email", { length: 254 }).notNull(),
    subject: varchar("subject", { length: 300 }).notNull(),
    html: text("html").notNull(),
    text: text("text").notNull(),
    idempotencyKey: varchar("idempotency_key", { length: 100 }).notNull().unique(),
    status: varchar("status", { length: 20 }).notNull().default("pending"), // pending | sent | failed
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull().defaultNow(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("email_outbox_status_sched_idx").on(t.status, t.scheduledAt)],
);

export const rateLimits = pgTable("rate_limit", {
  key: varchar("key", { length: 200 }).primaryKey(),
  windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
  count: integer("count").notNull().default(0),
});

export const adminUsers = pgTable("admin_user", {
  id: uuid("id").defaultRandom().primaryKey(),
  email: varchar("email", { length: 254 }).notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
});

export const adminSessions = pgTable("admin_session", {
  id: uuid("id").defaultRandom().primaryKey(),
  tokenHash: varchar("token_hash", { length: 64 }).notNull().unique(),
  adminUserId: uuid("admin_user_id")
    .notNull()
    .references(() => adminUsers.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const adminOtpChallenges = pgTable("admin_otp_challenge", {
  id: uuid("id").defaultRandom().primaryKey(),
  adminUserId: uuid("admin_user_id")
    .notNull()
    .references(() => adminUsers.id, { onDelete: "cascade" }),
  codeHash: varchar("code_hash", { length: 64 }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  attempts: integer("attempts").notNull().default(0),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const trustedDevices = pgTable("trusted_device", {
  id: uuid("id").defaultRandom().primaryKey(),
  adminUserId: uuid("admin_user_id")
    .notNull()
    .references(() => adminUsers.id, { onDelete: "cascade" }),
  tokenHash: varchar("token_hash", { length: 64 }).notNull().unique(),
  userAgent: varchar("user_agent", { length: 300 }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const adminAuditLog = pgTable(
  "admin_audit_log",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    adminUserId: uuid("admin_user_id").references(() => adminUsers.id, { onDelete: "set null" }),
    action: varchar("action", { length: 50 }).notNull(),
    detail: jsonb("detail").notNull().default({}),
    ipHash: varchar("ip_hash", { length: 64 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("admin_audit_log_created_at_idx").on(desc(t.createdAt))],
);

export const campaignRedirects = pgTable("campaign_redirect", {
  id: uuid("id").defaultRandom().primaryKey(),
  campaignId: uuid("campaign_id")
    .notNull()
    .references(() => rewardCampaigns.id, { onDelete: "cascade" }),
  oldSlug: varchar("old_slug", { length: 120 }).notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Contact = typeof contacts.$inferSelect;
export type MarketingSubscription = typeof marketingSubscriptions.$inferSelect;
export type ConsentEvent = typeof consentEvents.$inferSelect;
export type RewardCampaign = typeof rewardCampaigns.$inferSelect;
export type RewardCampaignLocale = typeof rewardCampaignLocales.$inferSelect;
export type RewardAsset = typeof rewardAssets.$inferSelect;
export type RewardClaim = typeof rewardClaims.$inferSelect;
export type AccessToken = typeof accessTokens.$inferSelect;
export type DoaTemplate = typeof doaTemplates.$inferSelect;
export type DoaSelection = typeof doaSelections.$inferSelect;
export type EmailDomain = typeof emailDomains.$inferSelect;
export type EmailOutbox = typeof emailOutbox.$inferSelect;
export type RateLimit = typeof rateLimits.$inferSelect;
export type AdminUser = typeof adminUsers.$inferSelect;
export type AdminSession = typeof adminSessions.$inferSelect;
export type AdminOtpChallenge = typeof adminOtpChallenges.$inferSelect;
export type TrustedDevice = typeof trustedDevices.$inferSelect;
export type AdminAuditLog = typeof adminAuditLog.$inferSelect;
export type CampaignRedirect = typeof campaignRedirects.$inferSelect;

export const emailCampaigns = pgTable(
  "email_campaigns",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    status: varchar("status", { length: 20 }).notNull().default("draft"), // draft | scheduled | queued | sending | completed | paused | cancelled | failed
    subjectId: varchar("subject_id", { length: 300 }).notNull(),
    subjectEn: varchar("subject_en", { length: 300 }),
    preheaderId: varchar("preheader_id", { length: 300 }),
    preheaderEn: varchar("preheader_en", { length: 300 }),
    bodyHtmlId: text("body_html_id").notNull(),
    bodyHtmlEn: text("body_html_en"),
    audienceFilter: jsonb("audience_filter").notNull().default({}),
    maxPerMinute: integer("max_per_minute").notNull(),
    maxPerHour: integer("max_per_hour").notNull(),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
    snapshotAt: timestamp("snapshot_at", { withTimezone: true }),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // PRD §7.4: hanya boleh ada tepat satu campaign berstatus 'sending'.
    // Partial unique index ini menjadi invariant di level DB; claimForSending
    // menangkap unique_violation (23505) sebagai "klaim kalah".
    uniqueIndex("email_campaigns_single_sending_uq").on(t.status).where(sql`${t.status} = 'sending'`),
    index("email_campaigns_status_idx").on(t.status),
  ],
);

export const emailCampaignRecipients = pgTable(
  "email_campaign_recipients",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => emailCampaigns.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id),
    localeSelected: varchar("locale_selected", { length: 2 }).notNull(), // id | en
    status: varchar("status", { length: 20 }).notNull().default("pending"), // pending | sent | failed | cancelled
    lastRenderedHtml: text("last_rendered_html"),
    clickTokenHash: varchar("click_token_hash", { length: 64 }).notNull().unique(),
    clickedAt: timestamp("clicked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("campaign_recipient_uq").on(t.campaignId, t.contactId)],
);

export const emailDeliveries = pgTable(
  "email_deliveries",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id),
    campaignRecipientId: uuid("campaign_recipient_id").references(() => emailCampaignRecipients.id),
    providerMessageId: varchar("provider_message_id", { length: 200 }).unique(),
    emailType: varchar("email_type", { length: 30 }).notNull(), // broadcast | broadcast_test
    status: varchar("status", { length: 20 }).notNull(), // accepted | sent | delivered | bounced | failed | suppressed
    error: text("error"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    bouncedAt: timestamp("bounced_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("email_deliveries_recipient_idx").on(t.campaignRecipientId),
    index("email_deliveries_contact_idx").on(t.contactId),
    index("email_deliveries_sent_at_idx").on(t.sentAt),
  ],
);

export const emailSuppressions = pgTable("email_suppressions", {
  emailNormalized: varchar("email_normalized", { length: 254 }).primaryKey(),
  reason: varchar("reason", { length: 30 }).notNull(), // unsubscribe | hard_bounce | complaint
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const emailProviderEvents = pgTable(
  "email_provider_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    providerMessageId: varchar("provider_message_id", { length: 200 }).notNull(),
    eventType: varchar("event_type", { length: 40 }).notNull(),
    payload: jsonb("payload").notNull().default({}),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("provider_event_uq").on(t.providerMessageId, t.eventType)],
);

export const emailLinks = pgTable("email_links", {
  id: uuid("id").defaultRandom().primaryKey(),
  campaignId: uuid("campaign_id")
    .notNull()
    .references(() => emailCampaigns.id, { onDelete: "cascade" }),
  urlHash: varchar("url_hash", { length: 64 }).notNull().unique(),
  url: text("url").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type EmailCampaign = typeof emailCampaigns.$inferSelect;
export type EmailCampaignRecipient = typeof emailCampaignRecipients.$inferSelect;
export type EmailDelivery = typeof emailDeliveries.$inferSelect;
export type EmailSuppression = typeof emailSuppressions.$inferSelect;
export type EmailProviderEvent = typeof emailProviderEvents.$inferSelect;
export type EmailLink = typeof emailLinks.$inferSelect;
