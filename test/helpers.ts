import { sqlClient } from "../src/lib/db";
export async function resetDb() {
  await sqlClient.unsafe(`
    TRUNCATE rate_limit, email_outbox, doa_selection, doa_template, access_token,
    reward_claim, reward_asset, reward_campaign_locale, reward_campaign,
    consent_event, marketing_subscription, contact, email_domain CASCADE;
  `);
}
