import { getRemoteD1Database } from "../../db/remote-d1";

let db: D1Database | null = null;

function database() {
  db ??= getRemoteD1Database();
  return db;
}

// Node-hosted Scout keeps the existing Cloudflare-shaped binding surface so the
// application code does not fork by hosting provider. Secrets remain runtime-only
// Heroku config vars. DB is backed by Cloudflare's authenticated D1 HTTP API.
export const env = new Proxy<Record<string, unknown>>({}, {
  get(_target, property) {
    if (property === "DB") return database();
    if (typeof property !== "string") return undefined;
    return process.env[property];
  },
  has(_target, property) {
    if (property === "DB") return true;
    return typeof property === "string" && property in process.env;
  },
}) as Record<string, string | undefined> & { DB: D1Database };
