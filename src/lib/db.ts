import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "./env";
export const sqlClient = postgres(env("DATABASE_URL"), { max: 5 });
export const db = drizzle(sqlClient);
