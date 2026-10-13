import { createHash } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import type Database from "better-sqlite3";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

const MAX_BYTES = 5_000_000;
const TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};
const KINDS = new Set(["normal", "art_crop", "small"]);

/**
 * Lazy local cache of Scryfall images: downloaded unmodified on first use, served from /data.
 * Cache key includes a hash of the source URL (Scryfall bumps a ?timestamp when art changes).
 */
export function registerImages(
  app: FastifyInstance,
  o: {
    sqlite: Database.Database;
    dir: string;
    userAgent: string;
    needUser: (req: FastifyRequest, reply: FastifyReply) => Promise<unknown>;
  },
) {
  const inflight = new Map<string, Promise<void>>();

  async function fetchTo(url: string, file: string) {
    const res = await fetch(url, {
      headers: { "User-Agent": o.userAgent },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_BYTES) throw new Error("image too large");
    await mkdir(join(file, ".."), { recursive: true });
    const tmp = `${file}.${process.pid}.part`;
    await writeFile(tmp, buf);
    await rename(tmp, file);
  }

  async function serve(reply: FastifyReply, url: string, host: string, file: string) {
    const u = new URL(url);
    if (u.protocol !== "https:" || u.hostname !== host)
      return reply.code(404).send({ error: "not found" });
    if (!existsSync(file)) {
      let p = inflight.get(file);
      if (!p) {
        p = fetchTo(url, file).finally(() => inflight.delete(file));
        inflight.set(file, p);
      }
      try {
        await p;
      } catch (e) {
        o_log(app, e);
        return reply.code(502).send({ error: "upstream image unavailable" });
      }
    }
    return reply
      .header("Cache-Control", "public, max-age=31536000, immutable")
      .type(TYPES[extname(u.pathname)] ?? "application/octet-stream")
      .send(createReadStream(file));
  }
  const o_log = (a: FastifyInstance, e: unknown) =>
    a.log.warn({ err: String(e) }, "image fetch failed");

  app.get("/img/symbol/:file", { preHandler: o.needUser }, async (req, reply) => {
    const { file } = req.params as { file: string };
    if (!/^[A-Za-z0-9_-]+\.svg$/.test(file)) return reply.code(404).send({ error: "not found" });
    const row = o.sqlite
      .prepare("SELECT svg_uri FROM symbols WHERE svg_uri LIKE ? LIMIT 1")
      .get(`https://svgs.scryfall.io/card-symbols/${file}`) as { svg_uri: string } | undefined;
    if (!row) return reply.code(404).send({ error: "not found" });
    return serve(reply, row.svg_uri, "svgs.scryfall.io", join(o.dir, "symbol", file));
  });

  app.get("/img/set/:code", { preHandler: o.needUser }, async (req, reply) => {
    const { code } = req.params as { code: string };
    const row = o.sqlite.prepare("SELECT icon_svg_uri FROM sets WHERE code=?").get(code) as
      | { icon_svg_uri: string | null }
      | undefined;
    if (!row?.icon_svg_uri) return reply.code(404).send({ error: "not found" });
    const hash = createHash("sha1").update(row.icon_svg_uri).digest("hex").slice(0, 10);
    return serve(
      reply,
      row.icon_svg_uri,
      "svgs.scryfall.io",
      join(o.dir, "set", `${code}-${hash}.svg`),
    );
  });

  app.get("/img/:kind/:id", { preHandler: o.needUser }, async (req, reply) => {
    const { kind, id } = req.params as { kind: string; id: string };
    const face = Number((req.query as { f?: string }).f ?? 0);
    if (!KINDS.has(kind) || !/^[0-9a-f-]{36}$/.test(id) || !Number.isInteger(face) || face < 0) {
      return reply.code(404).send({ error: "not found" });
    }
    const row = o.sqlite.prepare("SELECT images FROM cards WHERE id=?").get(id) as
      | { images: string }
      | undefined;
    const url: string | null | undefined = row && JSON.parse(row.images)[face]?.[kind];
    if (!url) return reply.code(404).send({ error: "not found" });
    const hash = createHash("sha1").update(url).digest("hex").slice(0, 10);
    const ext = extname(new URL(url).pathname) || ".jpg";
    return serve(reply, url, "cards.scryfall.io", join(o.dir, kind, `${id}-${face}-${hash}${ext}`));
  });
}
