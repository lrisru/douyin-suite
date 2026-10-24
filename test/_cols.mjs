import { loadConfig } from "../src/util.js";
import * as db from "../src/db.js";
db.initDb(loadConfig(process.cwd()));
const cols = db.getDb().prepare("PRAGMA table_info(items)").all();
console.log("items 列:", cols.map(c => c.name).join(", "));
const r = db.getDb().prepare("SELECT raw FROM items WHERE raw IS NOT NULL LIMIT 1").get();
if (r?.raw) {
  const raw = JSON.parse(r.raw);
  const st = raw.statistics || {};
  console.log("\nraw.statistics keys:", Object.keys(st).join(", "));
  console.log("raw.statistics:", JSON.stringify(st).slice(0, 300));
}
