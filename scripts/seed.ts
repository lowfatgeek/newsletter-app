import "dotenv/config";
import { and, eq, like, or } from "drizzle-orm";
import { createHash } from "node:crypto";
import { AwsV4Signer } from "aws4fetch";
import { db, sqlClient } from "../src/lib/db";
import {
  doaSelections,
  doaTemplates,
  emailDomains,
  rateLimits,
  rewardAssets,
  rewardCampaignLocales,
  rewardCampaigns,
} from "../src/lib/schema";
import { DEFAULT_DOMAINS } from "../src/lib/allowlist";
import { ensureAdmin } from "../src/lib/admin/bootstrap";

const DOA = [
  { variant: "muslim", locale: "id", name: "Doa Muslim v1", content: "Ya Allah, berkahilah setiap usaha dan kerja keras kami hari ini. Lapangkan setiap langkah, mudahkan setiap urusan, dan jadikan ilmu yang kami pelajari bermanfaat bagi kami dan orang banyak. Aamiin." },
  { variant: "muslim", locale: "en", name: "Doa Muslim v1", content: "O Allah, bless every effort and hard work we put in today. Ease every step, smooth every matter, and make the knowledge we gain beneficial for us and for many. Ameen." },
  { variant: "universal", locale: "id", name: "Harapan Baik v1", content: "Semoga setiap langkah kecilmu hari ini membawamu lebih dekat ke tujuan besarmu. Semoga usahamu yang konsisten melunakkan jalan di depan — pelan-pelan, tapi pasti." },
  { variant: "universal", locale: "en", name: "Harapan Baik v1", content: "May every small step you take today bring you closer to your big goal. May your consistent effort soften the road ahead — slowly, but surely." },
] as const;

// PDF kecil yang valid (±1 KB) untuk asset contoh.
function samplePdf(): Buffer {
  const objects = [
    "<</Type/Catalog/Pages 2 0 R>>",
    "<</Type/Pages/Kids[3 0 R]/Count 1>>",
    "<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Resources<</Font<</F1 4 0 R>>>>/Contents 5 0 R>>",
    "<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>",
    "<</Length 60>>\nstream\nBT /F1 18 Tf 72 720 Td (Starter Kit KelasWFA - sample) Tj ET\nendstream",
  ];
  let pdf = "%PDF-1.4\n";
  objects.forEach((body, i) => {
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  pdf += "trailer\n<</Root 1 0 R>>\n%%EOF";
  return Buffer.from(pdf, "utf8");
}

async function uploadSampleAsset(campaignId: string): Promise<void> {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucket = process.env.R2_BUCKET;
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) {
    console.log("R2 env kosong — lewati upload asset contoh (bisa ditambahkan lewat admin di Plan 2)");
    return;
  }

  const nameId = "Checklist 30 Hari (contoh)";
  const existing = await db
    .select()
    .from(rewardAssets)
    .where(and(eq(rewardAssets.campaignId, campaignId), eq(rewardAssets.nameId, nameId)));
  if (existing.length > 0) return;

  const buffer = samplePdf();
  const storageKey = "rewards/starter-kit/sample.pdf";
  const url = new URL(`https://${accountId}.r2.cloudflarestorage.com/${bucket}/${storageKey}`);
  const signer = new AwsV4Signer({
    url,
    method: "PUT",
    accessKeyId,
    secretAccessKey,
    body: buffer,
    headers: { "Content-Type": "application/pdf" },
  });
  const signed = await signer.sign();
  const res = await fetch(signed.url, { method: "PUT", body: buffer, headers: signed.headers });
  if (!res.ok) throw new Error(`R2 upload gagal: ${res.status} ${await res.text()}`);

  await db.insert(rewardAssets).values({
    campaignId,
    storageKey,
    nameId,
    nameEn: "30-Day Checklist (sample)",
    descId: "Contoh asset hasil seed — ganti lewat admin di Plan 2.",
    descEn: "Seeded sample asset — replace via admin in Plan 2.",
    mimeType: "application/pdf",
    sizeBytes: buffer.length,
    checksum: createHash("sha256").update(buffer).digest("hex"),
    sortOrder: 0,
  });
  console.log("seeded starter-kit sample asset (uploaded to R2)");
}

async function main() {
  // 1. Domain allowlist default — hanya bila tabel masih kosong.
  const domains = await db.select().from(emailDomains);
  if (domains.length === 0) {
    await db.insert(emailDomains).values(DEFAULT_DOMAINS.map((domain) => ({ domain })));
    console.log(`seeded ${DEFAULT_DOMAINS.length} email domains`);
  }

  // 2. Template doa (muslim/universal x id/en) — idempoten per (variant, locale, name).
  for (const tpl of DOA) {
    const existing = await db
      .select()
      .from(doaTemplates)
      .where(
        and(
          eq(doaTemplates.variant, tpl.variant),
          eq(doaTemplates.locale, tpl.locale),
          eq(doaTemplates.name, tpl.name),
        ),
      );
    if (existing.length === 0) await db.insert(doaTemplates).values(tpl);
  }
  console.log("doa templates ok");

  // 3. Campaign contoh "starter-kit" — locale ID saja (EN sengaja kosong
  //    untuk membuktikan fallback ke ID di /en/r/starter-kit).
  let [camp] = await db.select().from(rewardCampaigns).where(eq(rewardCampaigns.slug, "starter-kit"));
  if (!camp) {
    [camp] = await db
      .insert(rewardCampaigns)
      .values({ slug: "starter-kit", status: "published", publishedAt: new Date() })
      .returning();
    console.log("seeded starter-kit campaign");
  }

  await db
    .insert(rewardCampaignLocales)
    .values({
      campaignId: camp.id,
      locale: "id",
      title: "Starter Kit KelasWFA",
      description:
        "Kumpulan template dan checklist untuk memulai perjalanan menuju kebebasan finansial lewat kerja dan skill.",
      rewardItems: [
        { name: "Checklist 30 Hari", benefit: "Rencana harian yang bisa langsung dijalankan.", format: "PDF", size: "2 MB" },
        { name: "Template Budget", benefit: "Kelola pemasukan dan penghematan dengan rapi.", format: "XLSX", size: "1 MB" },
      ],
      metaTitle: "Starter Kit KelasWFA — Hadiah Gratis",
      metaDescription:
        "Unduh Starter Kit KelasWFA: checklist 30 hari dan template budget untuk memulai perjalanan finansialmu.",
    })
    .onConflictDoNothing();

  // 4. Hubungkan kedua preset doa (muslim + universal, versi id) ke campaign.
  for (const variant of ["muslim", "universal"] as const) {
    const tpl = DOA.find((d) => d.variant === variant && d.locale === "id")!;
    const [row] = await db
      .select()
      .from(doaTemplates)
      .where(
        and(
          eq(doaTemplates.variant, variant),
          eq(doaTemplates.locale, "id"),
          eq(doaTemplates.name, tpl.name),
        ),
      );
    if (row) {
      await db
        .insert(doaSelections)
        .values({ campaignId: camp.id, variant, templateId: row.id })
        .onConflictDoNothing();
    }
  }

  // 5. Asset contoh ke R2 bila kredensial tersedia; kalau tidak, lewati.
  await uploadSampleAsset(camp.id);

  // 6. Admin e2e/dev — idempoten. Bila ADMIN_PASSWORD terpasang (fixture test,
  //    bukan secret produksi), hash admin di-reset agar login e2e repeatable
  //    walau admin sudah ada dari run sebelumnya. Try/catch supaya seed tetap
  //    sukses tanpa password (ensureAdmin membuat password acak sendiri).
  try {
    const { created, email } = await ensureAdmin({ resetPassword: process.env.ADMIN_PASSWORD });
    console.log(created ? `seeded admin ${email}` : `admin ${email} ok`);
  } catch (err) {
    console.error("admin bootstrap gagal (seed lanjut):", err);
  }

  // 7. Bersihkan rate limit login admin supaya e2e repeatable di satu jam yang
  //    sama (hanya scope admin-login — jalur publik tidak disentuh).
  await db
    .delete(rateLimits)
    .where(or(like(rateLimits.key, "admin-login-ip:%"), like(rateLimits.key, "admin-login-email:%")));

  console.log("seed done");
  await sqlClient.end();
  process.exit(0);
}

main().catch(async (err) => {
  console.error(err);
  await sqlClient.end().catch(() => {});
  process.exit(1);
});
