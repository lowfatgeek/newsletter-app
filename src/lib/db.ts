import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "./env";

// Task 2.15 / 04-A2: ukuran pool terhubung ke Neon harus bisa disetel lewat
// environment tanpa mengubah kode. Default tetap 5 (aman untuk Neon free /
// compute kecil); naikkan hanya bila instance Neon punya batas koneksi lebih
// besar — lihat docs/operations.md.
const poolMax = () => {
  const raw = process.env.DB_POOL_MAX;
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(parsed) && parsed >= 1 && parsed <= 100 ? parsed : 5;
};

export const sqlClient = postgres(env("DATABASE_URL"), { max: poolMax() });
export const db = drizzle(sqlClient);
