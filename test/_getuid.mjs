import { loadConfig } from "../src/util.js";
import * as db from "../src/db.js";
db.initDb(loadConfig(process.cwd()));
const rows = db.getDb().prepare("SELECT user_uid, user_name FROM comments WHERE user_uid IS NOT NULL AND user_uid <> '' LIMIT 3").all();
console.log(JSON.stringify(rows));
