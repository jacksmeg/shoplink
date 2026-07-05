import { createSeedDb, dbMode, ensureDb, writeDb } from "../server/database.mjs";

await ensureDb();
await writeDb(createSeedDb());

console.log(`ShopLink starter marketplace data seeded in ${dbMode()} mode.`);
