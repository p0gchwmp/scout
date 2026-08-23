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

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // Local development auth is injected before routing so every owner-only page
    // (including /inbox and future pages) receives the same synthetic identity.
    // resolveLocalDevWorkerAuth itself only succeeds for an explicitly marked
    // development worker on loopback and never replaces hosted identity headers.
    const localAuth = resolveLocalDevWorkerAuth(request, env);
    if (localAuth) {
      const routedHeaders = new Headers(request.headers);
      routedHeaders.set(USER_ID_HEADER, localAuth.user.userId);
      routedHeaders.set(USER_EMAIL_HEADER, localAuth.user.email);
      routedHeaders.set(
        USER_FULL_NAME_HEADER,
        encodeURIComponent(localAuth.user.fullName ?? localAuth.user.displayName),
      );
      routedHeaders.set(USER_FULL_NAME_ENCODING_HEADER, PERCENT_ENCODED_UTF8);
      routedHeaders.set(SCOUT_OWNER_USER_ID_HEADER, localAuth.ownerUserId);
      request = new Request(request, { headers: routedHeaders });
    }

    if (url.pathname === "/" || url.pathname === "/inbox" || url.pathname.startsWith("/api/")) {
      const authenticatedUserId = request.headers.get(USER_ID_HEADER);
      if (authenticatedUserId) {
        const ownerId = env.SCOUT_OWNER_USER_ID?.trim();
        if (!ownerId) return Response.json({ error: "Scout owner is not configured" }, { status: 503 });
        if (authenticatedUserId !== ownerId) return Response.json({ error: "Forbidden" }, { status: 403 });
        const routedHeaders = new Headers(request.headers);
        routedHeaders.set(SCOUT_OWNER_USER_ID_HEADER, ownerId);
        request = new Request(request, { headers: routedHeaders });
      }
    }

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths);
    }

    return handler.fetch(request, env, ctx);
  },
};

export default worker;
