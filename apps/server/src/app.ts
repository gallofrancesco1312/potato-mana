import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import { createUserSchema, loginSchema, type Me } from "@potato-mana/shared";
import type Database from "better-sqlite3";
import { count, eq } from "drizzle-orm";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import type { z } from "zod";
import {
  authResolver,
  COOKIE,
  createSession,
  destroySession,
  hashPassword,
  verifyPassword,
} from "./auth.ts";
import type { Config } from "./config.ts";
import type { Db } from "./db.ts";
import { backupJob, createScheduler, notifyNtfy } from "./jobs.ts";
import { registerOidc } from "./oidc.ts";
import { users } from "./schema.ts";

declare module "fastify" {
  interface FastifyRequest {
    user: Me | null;
  }
}

export function buildApp(o: {
  cfg: Config;
  db: Db;
  sqlite: Database.Database;
  logger?: boolean;
  schedule?: boolean;
}) {
  const { cfg, db, sqlite } = o;
  const app = Fastify({ logger: o.logger ?? true, bodyLimit: 1_048_576 });
  const resolveUser = authResolver(db);

  const scheduler = createScheduler(
    db,
    [backupJob(sqlite, `${cfg.DATA_DIR}/backups`, cfg.BACKUP_KEEP_DAYS, cfg.BACKUP_CRON)],
    (name, err) => notifyNtfy(cfg, `Job failed: ${name}`, err),
    { error: (obj, msg) => app.log.error(obj, msg) },
    o.schedule ?? true,
  );
  app.addHook("onClose", async () => scheduler.stop());

  app.register(helmet, {
    hsts: false, // TLS is terminated by Traefik
    contentSecurityPolicy: { directives: { "upgrade-insecure-requests": null } },
  });
  app.register(cookie);
  app.register(rateLimit, { global: false });

  app.decorateRequest("user", null);

  // CSRF: browsers always send Origin on cross-site mutations; SameSite=Lax is the second layer.
  app.addHook("onRequest", async (req, reply) => {
    if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") return;
    const origin = req.headers.origin;
    if (origin && new URL(origin).host !== req.headers.host) {
      return reply.code(403).send({ error: "cross-origin request rejected" });
    }
  });
  app.addHook("preHandler", async (req) => {
    req.user = resolveUser(req);
  });

  const parse = <T extends z.ZodType>(schema: T, body: unknown, reply: FastifyReply) => {
    const r = schema.safeParse(body);
    if (!r.success) {
      reply.code(400).send({ error: "invalid input", issues: r.error.issues });
      return null;
    }
    return r.data as z.infer<T>;
  };
  const needUser = async (req: FastifyRequest, reply: FastifyReply) => {
    if (!req.user) return reply.code(401).send({ error: "unauthenticated" });
  };
  const needAdmin = async (req: FastifyRequest, reply: FastifyReply) => {
    if (!req.user) return reply.code(401).send({ error: "unauthenticated" });
    if (req.user.role !== "admin") return reply.code(403).send({ error: "admin only" });
  };
  const setCookie = (reply: FastifyReply, token: string) =>
    reply.setCookie(COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: cfg.COOKIE_SECURE,
      path: "/",
      maxAge: cfg.SESSION_DAYS * 86_400,
    });
  const startSession = (reply: FastifyReply, userId: number) =>
    setCookie(reply, createSession(db, userId, cfg.SESSION_DAYS));
  const userCount = () => db.select({ n: count() }).from(users).get()?.n ?? 0;

  app.get("/healthz", async (_req, reply) => {
    try {
      sqlite.prepare("select 1").get();
      return { status: "ok" };
    } catch {
      return reply.code(503).send({ status: "db unavailable" });
    }
  });

  app.register(
    async (api) => {
      const oidc = registerOidc(api, { cfg, db, startSession });
      api.get("/auth/state", async () => ({ setupNeeded: userCount() === 0, oidc }));

      api.post(
        "/auth/setup",
        { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } },
        async (req, reply) => {
          const body = parse(createUserSchema, req.body, reply);
          if (!body) return;
          const passwordHash = await hashPassword(body.password);
          // single sync block: count + insert cannot interleave with another request
          const created = db.transaction((tx) => {
            if ((tx.select({ n: count() }).from(users).get()?.n ?? 0) > 0) return null;
            return tx
              .insert(users)
              .values({
                username: body.username,
                email: body.email ?? null,
                passwordHash,
                role: "admin",
              })
              .returning()
              .get();
          });
          if (!created) return reply.code(409).send({ error: "setup already done" });
          setCookie(reply, createSession(db, created.id, cfg.SESSION_DAYS));
          return {
            id: created.id,
            username: created.username,
            email: created.email,
            role: created.role,
          };
        },
      );

      api.post(
        "/auth/login",
        { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
        async (req, reply) => {
          const body = parse(loginSchema, req.body, reply);
          if (!body) return;
          const u = db.select().from(users).where(eq(users.username, body.username)).get();
          if (!(await verifyPassword(u?.passwordHash, body.password)) || !u) {
            return reply.code(401).send({ error: "invalid credentials" });
          }
          setCookie(reply, createSession(db, u.id, cfg.SESSION_DAYS));
          return { id: u.id, username: u.username, email: u.email, role: u.role } satisfies Me;
        },
      );

      api.post("/auth/logout", async (req, reply) => {
        const token = req.cookies[COOKIE];
        if (token) destroySession(db, token);
        reply.clearCookie(COOKIE, { path: "/" });
        return { ok: true };
      });

      api.get("/me", { preHandler: needUser }, async (req) => req.user);

      api.post("/admin/users", { preHandler: needAdmin }, async (req, reply) => {
        const body = parse(createUserSchema, req.body, reply);
        if (!body) return;
        if (db.select().from(users).where(eq(users.username, body.username)).get()) {
          return reply.code(409).send({ error: "username taken" });
        }
        const row = db
          .insert(users)
          .values({
            username: body.username,
            email: body.email ?? null,
            passwordHash: await hashPassword(body.password),
            role: body.role,
          })
          .returning()
          .get();
        return reply.code(201).send({ id: row.id, username: row.username, role: row.role });
      });

      api.get("/admin/jobs", { preHandler: needAdmin }, async () => ({
        jobs: scheduler.list(),
        history: scheduler.history(),
      }));

      api.post("/admin/jobs/:name/run", { preHandler: needAdmin }, async (req, reply) => {
        const r = await scheduler.run((req.params as { name: string }).name);
        if (r === "unknown") return reply.code(404).send({ error: "unknown job" });
        if (r === "busy") return reply.code(409).send({ error: "job already running" });
        return r;
      });
    },
    { prefix: "/api/v1" },
  );

  const webDir = cfg.WEB_DIR ?? fileURLToPath(new URL("../../web/dist", import.meta.url));
  if (existsSync(webDir)) {
    app.register(fastifyStatic, { root: webDir, wildcard: false });
    app.setNotFoundHandler((req, reply) =>
      req.url.startsWith("/api/")
        ? reply.code(404).send({ error: "not found" })
        : reply.sendFile("index.html"),
    );
  }

  return app;
}
