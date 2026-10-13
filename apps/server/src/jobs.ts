import { mkdirSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { APP_NAME, type JobInfo, type JobRow } from "@potato-mana/shared";
import type Database from "better-sqlite3";
import { Cron } from "croner";
import { desc, eq } from "drizzle-orm";
import type { Config } from "./config.ts";
import type { Db } from "./db.ts";
import { jobs } from "./schema.ts";

export type JobDef = {
  name: string;
  cron: string;
  run: (progress: (msg: string) => void) => Promise<string | undefined>;
};

export const backupJob = (
  sqlite: Database.Database,
  dir: string,
  keepDays: number,
  cron: string,
): JobDef => ({
  name: "backup",
  cron,
  async run() {
    mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..*/, "");
    const file = join(dir, `${APP_NAME}-${stamp}.sqlite`);
    await sqlite.backup(file); // consistent online copy, safe with WAL
    const cutoff = Date.now() - keepDays * 86_400_000;
    let pruned = 0;
    for (const f of readdirSync(dir)) {
      const p = join(dir, f);
      if (f.endsWith(".sqlite") && p !== file && statSync(p).mtimeMs < cutoff) {
        unlinkSync(p);
        pruned++;
      }
    }
    return `${file} (pruned ${pruned})`;
  },
});

export async function notifyNtfy(cfg: Config, title: string, body: string, topic?: string | null) {
  const t = topic || cfg.NTFY_TOPIC;
  if (!cfg.NTFY_URL || !t) return;
  const headers: Record<string, string> = { Title: title };
  if (cfg.NTFY_TOKEN) headers.Authorization = `Bearer ${cfg.NTFY_TOKEN}`;
  await fetch(`${cfg.NTFY_URL.replace(/\/$/, "")}/${t}`, {
    method: "POST",
    headers,
    body,
    signal: AbortSignal.timeout(5000),
  });
}

export function createScheduler(
  db: Db,
  defs: JobDef[],
  onFail: (name: string, err: string) => Promise<void> | void,
  log: { error: (o: object, m: string) => void },
  schedule = true,
) {
  const running = new Set<string>();
  // a crash mid-job leaves 'running' rows behind
  db.update(jobs)
    .set({
      status: "error",
      finishedAt: new Date().toISOString(),
      detail: "interrupted by restart",
    })
    .where(eq(jobs.status, "running"))
    .run();

  async function run(name: string): Promise<JobRow | "unknown" | "busy"> {
    const def = defs.find((d) => d.name === name);
    if (!def) return "unknown";
    if (running.has(name)) return "busy";
    running.add(name);
    const startedAt = new Date().toISOString();
    const row = db.insert(jobs).values({ name, status: "running", startedAt }).returning().get();
    let status: "ok" | "error" = "ok";
    let detail: string | null = null;
    try {
      detail =
        (await def.run((msg) => {
          db.update(jobs).set({ detail: msg }).where(eq(jobs.id, row.id)).run();
        })) ?? null;
    } catch (e) {
      status = "error";
      detail = e instanceof Error ? e.message : String(e);
      log.error({ job: name, err: detail }, "job failed");
      try {
        await onFail(name, detail);
      } catch (ne) {
        log.error({ job: name, err: String(ne) }, "failure notification failed");
      }
    } finally {
      running.delete(name);
    }
    return db
      .update(jobs)
      .set({ status, detail, finishedAt: new Date().toISOString() })
      .where(eq(jobs.id, row.id))
      .returning()
      .get();
  }

  const crons = schedule ? defs.map((d) => new Cron(d.cron, () => void run(d.name))) : [];

  return {
    run,
    list(): JobInfo[] {
      return defs.map((d) => ({
        name: d.name,
        cron: d.cron,
        last:
          db
            .select()
            .from(jobs)
            .where(eq(jobs.name, d.name))
            .orderBy(desc(jobs.id))
            .limit(1)
            .get() ?? null,
      }));
    },
    history(limit = 50): JobRow[] {
      return db.select().from(jobs).orderBy(desc(jobs.id)).limit(limit).all();
    },
    stop() {
      for (const c of crons) c.stop();
    },
  };
}
