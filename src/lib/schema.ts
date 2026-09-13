import { pgTable, uuid, varchar, text, timestamp, integer, bigint, boolean, uniqueIndex, index, jsonb } from "drizzle-orm/pg-core";

export const contacts = pgTable("contact", {
  id: uuid("id").defaultRandom().primaryKey(),
  emailNormalized: varchar("email_normalized", { length: 254 }).notNull().unique(),
  locale: varchar("locale", { length: 2 }).notNull().default("id"),
  confirmationStatus: varchar("confirmation_status", { length: 20 }).notNull().default("pending"), // pending | confirmed
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const marketingSubscriptions = pgTable("marketing_subscription", {
  contactId: uuid("contact_id").primaryKey().references(() => contacts.id),
  status: varchar("status", { length: 20 }).notNull().default("inactive"), // inactive | active | unsubscribed
  subscribedAt: timestamp("subscribed_at", { withTimezone: true }),
  unsubscribedAt: timestamp("unsubscribed_at", { withTimezone: true }),
  source: varchar("source", { length: 100 }),
});

export const consentEvents = pgTable("consent_event", {
  id: uuid("id").defaultRandom().primaryKey(),
  contactId: uuid("contact_id").notNull().references(() => contacts.id),
  event: varchar("event", { length: 30 }).notNull(), // subscribed | unsubscribed | resubscribed
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const rewardCampaigns = pgTable("reward_campaign", {
  id: uuid("id").defaultRandom().primaryKey(),
  slug: varchar("slug", { length: 120 }).notNull().unique(),
  status: varchar("status", { length: 20 }).notNull().default("draft"), // draft | published | paused | archived
  featuredImageKey: text("featured_image_key"),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const rewardCampaignLocales = pgTable("reward_campaign_locale", {
  id: uuid("id").defaultRandom().primaryKey(),
  campaignId: uuid("campaign_id").notNull().references(() => rewardCampaigns.id, { onDelete: "cascade" }),
  locale: varchar("locale", { length: 2 }).notNull(), // id | en
  title: varchar("title", { length: 200 }).notNull(),
  description: text("description").notNull(),
  rewardItems: jsonb("reward_items").notNull().default([]), // [{ name, benefit, format?, size? }]
  metaTitle: varchar("meta_title", { length: 200 }),
  metaDescription: text("meta_description"),
}, (t) => [uniqueIndex("campaign_locale_uq").on(t.campaignId, t.locale)]);

export const rewardAssets = pgTable("reward_asset", {
  id: uuid("id").defaultRandom().primaryKey(),
  campaignId: uuid("campaign_id").notNull().references(() => rewardCampaigns.id, { onDelete: "cascade" }),
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

export const rewardClaims = pgTable("reward_claim", {
  id: uuid("id").defaultRandom().primaryKey(),
  contactId: uuid("contact_id").notNull().references(() => contacts.id),
  campaignId: uuid("campaign_id").notNull().references(() => rewardCampaigns.id),
  status: varchar("status", { length: 20 }).notNull().default("access_sent"), // access_sent | accessed
  firstClaimedAt: timestamp("first_claimed_at", { withTimezone: true }).notNull().defaultNow(),
  lastAccessSentAt: timestamp("last_access_sent_at", { withTimezone: true }),
}, (t) => [uniqueIndex("claim_contact_campaign_uq").on(t.contactId, t.campaignId)]);

export const accessTokens = pgTable("access_token", {
  id: uuid("id").defaultRandom().primaryKey(),
  claimId: uuid("claim_id").notNull().references(() => rewardClaims.id, { onDelete: "cascade" }),
  type: varchar("type", { length: 20 }).notNull(), // confirm | access | session
  tokenHash: varchar("token_hash", { length: 64 }).notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("access_token_claim_idx").on(t.claimId)]);

export const doaTemplates = pgTable("doa_template", {
  id: uuid("id").defaultRandom().primaryKey(),
  variant: varchar("variant", { length: 20 }).notNull(), // muslim | universal
  locale: varchar("locale", { length: 2 }).notNull(),
  name: varchar("name", { length: 100 }).notNull(),
  content: text("content").notNull(),
});

export const doaSelections = pgTable("doa_selection", {
  id: uuid("id").defaultRandom().primaryKey(),
  campaignId: uuid("campaign_id").notNull().references(() => rewardCampaigns.id, { onDelete: "cascade" }),
  variant: varchar("variant", { length: 20 }).notNull(), // muslim | universal
  templateId: uuid("template_id").notNull().references(() => doaTemplates.id),
}, (t) => [uniqueIndex("doa_selection_uq").on(t.campaignId, t.variant)]);

export const emailDomains = pgTable("email_domain", {
  domain: varchar("domain", { length: 254 }).primaryKey(),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const emailOutbox = pgTable("email_outbox", {
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
});

export const rateLimits = pgTable("rate_limit", {
  key: varchar("key", { length: 200 }).primaryKey(),
  windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
  count: integer("count").notNull().default(0),
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
