import "dotenv/config";
import { sqlClient } from "../src/lib/db";
import { ensureAdmin } from "../src/lib/admin/bootstrap";

async function main() {
  const { created, email, generatedPassword } = await ensureAdmin();
  if (!created) {
    console.log(`Admin ${email} sudah ada. Tidak ada perubahan.`);
    process.exit(0);
  }
  if (generatedPassword) console.log(`PASSWORD SEKALI PAKAI (simpan sekarang): ${generatedPassword}`);
  console.log(`Admin ${email} dibuat.`);
  await sqlClient.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
