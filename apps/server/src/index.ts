import { mkdirSync } from "node:fs";
import { buildApp } from "./app.ts";
import { loadConfig } from "./config.ts";
import { openDb } from "./db.ts";

const cfg = loadConfig();
mkdirSync(cfg.DATA_DIR, { recursive: true });
const { db, sqlite } = openDb(`${cfg.DATA_DIR}/app.sqlite`);
const app = buildApp({ cfg, db, sqlite });
app.addHook("onClose", async () => sqlite.close());

for (const sig of ["SIGTERM", "SIGINT"] as const) {
  process.on(sig, () => {
    app.log.info({ sig }, "shutting down");
    app.close().then(() => process.exit(0));
  });
}

await app.listen({ port: cfg.PORT, host: "0.0.0.0" });

// first start: fill the card database in the background
if (!sqlite.prepare("SELECT 1 FROM cards LIMIT 1").get()) void app.scheduler.run("scryfall-ingest");
