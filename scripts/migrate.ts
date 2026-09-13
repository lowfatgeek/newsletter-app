import "dotenv/config";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { db, sqlClient } from "../src/lib/db";
await migrate(db, { migrationsFolder: "./drizzle" });
await sqlClient.end();
console.log("migrated");
