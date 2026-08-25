/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";
import { resolveLocalDevWorkerAuth } from "../lib/scout/local-dev-auth";

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  SCOUT_OWNER_USER_ID?: string;
  SCOUT_LOCAL_DEV_RUNTIME?: string;
  SCOUT_LOCAL_DEV_AUTH?: string;
  SCOUT_LOCAL_DEV_USER_ID?: string;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

const USER_ID_HEADER = "oai-authenticated-user-id";
const USER_EMAIL_HEADER = "oai-authenticated-user-email";
const USER_FULL_NAME_HEADER = "oai-authenticated-user-full-name";
const USER_FULL_NAME_ENCODING_HEADER =
  "oai-authenticated-user-full-name-encoding";
const PERCENT_ENCODED_UTF8 = "percent-encoded-utf-8";
const SCOUT_OWNER_USER_ID_HEADER = "x-scout-owner-user-id";
const OWNER_PAGE_PATHS = new Set(["/", "/inbox", "/assist", "/voice", "/review", "/shortlist", "/readiness"]);

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // Local development auth is injected before routing so every owner-only page
    // receives the same synthetic identity. resolveLocalDevWorkerAuth itself only
    // succeeds for an explicitly marked development worker on loopback and never
    // changes production behavior.
    const localAuth = resolveLocalDevWorkerAuth({
      url,
      runtime: env.SCOUT_LOCAL_DEV_RUNTIME,
      enabled: env.SCOUT_LOCAL_DEV_AUTH,
      localUserId: env.SCOUT_LOCAL_DEV_USER_ID,
      ownerUserId: env.SCOUT_OWNER_USER_ID,
    });

    const headers = new Headers(request.headers);
    if (localAuth) {
      headers.set(USER_ID_HEADER, localAuth.userId);
      headers.set(USER_EMAIL_HEADER, localAuth.email);
      headers.set(USER_FULL_NAME_HEADER, encodeURIComponent(localAuth.fullName));
      headers.set(USER_FULL_NAME_ENCODING_HEADER, PERCENT_ENCODED_UTF8);
    }

    const ownerUserId = typeof env.SCOUT_OWNER_USER_ID === "string" ? env.SCOUT_OWNER_USER_ID.trim() : "";
    const requestUserId = headers.get(USER_ID_HEADER)?.trim() ?? "";
    if (OWNER_PAGE_PATHS.has(url.pathname)) {
      if (!ownerUserId || requestUserId !== ownerUserId) return new Response("Not found", { status: 404 });
      headers.set(SCOUT_OWNER_USER_ID_HEADER, ownerUserId);
    }

    const routedRequest = new Request(request, { headers });

    if (url.pathname.startsWith("/_next/image")) {
      return handleImageOptimization(routedRequest, env, ctx, {
        deviceSizes: DEFAULT_DEVICE_SIZES,
        imageSizes: DEFAULT_IMAGE_SIZES,
      });
    }

    return handler.fetch(routedRequest, env, ctx);
  },
};

export default worker;
