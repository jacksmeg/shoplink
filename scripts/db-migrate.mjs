import { ensureDb, dbMode } from "../server/database.mjs";

if (dbMode() !== "postgres") {
  console.log("Set DATABASE_URL to run PostgreSQL migrations. Local JSON mode does not need migrations.");
  process.exit(0);
}

await ensureDb();
console.log("ShopLink PostgreSQL migrations are up to date.");
