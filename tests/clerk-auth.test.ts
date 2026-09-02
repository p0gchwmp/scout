import assert from "node:assert/strict";
import test from "node:test";
import { clerkSessionToken, verifyClerkSession } from "../lib/scout/clerk-auth.ts";

const keyPair = await crypto.subtle.generateKey(
  {
    name: "RSASSA-PKCS1-v1_5",
    modulusLength: 2048,
    publicExponent: new Uint8Array([1, 0, 1]),
    hash: "SHA-256",
  },
  true,
  ["sign", "verify"],
);

const spki = Buffer.from(await crypto.subtle.exportKey("spki", keyPair.publicKey)).toString("base64");
const publicPem = `-----BEGIN PUBLIC KEY-----\n${spki.match(/.{1,64}/g)?.join("\n")}\n-----END PUBLIC KEY-----`;
const issuer = "https://clerk.example.test";
const publicOrigin = "https://scout.example.com";
const now = 1_788_400_000;

function encoded(value: unknown) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

async function token(overrides: Record<string, unknown> = {}) {
  const header = encoded({ alg: "RS256", typ: "JWT" });
  const payload = encoded({
    sub: "user_Ryan123",
    sid: "sess_123",
    iss: issuer,
    azp: publicOrigin,
    iat: now - 10,
    nbf: now - 10,
    exp: now + 60,
    sts: "active",
    ...overrides,
  });
  const signed = new TextEncoder().encode(`${header}.${payload}`);
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", keyPair.privateKey, signed);
  return `${header}.${payload}.${Buffer.from(signature).toString("base64url")}`;
}

test("Clerk owner token is verified from signature and bounded claims", async () => {
  const session = await verifyClerkSession(await token(), {
    jwtKey: publicPem,
    issuer,
    publicOrigin,
    nowSeconds: now,
  });
  assert.deepEqual(session, { userId: "user_Ryan123", sessionId: "sess_123" });
});

test("Clerk verification rejects wrong authorized party", async () => {
  await assert.rejects(
    verifyClerkSession(await token({ azp: "https://evil.example" }), {
      jwtKey: publicPem,
      issuer,
      publicOrigin,
      nowSeconds: now,
    }),
    /authorized party mismatch/,
  );
});

test("Clerk verification rejects expired, pending, and impersonation sessions", async () => {
  const options = { jwtKey: publicPem, issuer, publicOrigin, nowSeconds: now };
  await assert.rejects(verifyClerkSession(await token({ exp: now - 30 }), options), /expired/);
  await assert.rejects(verifyClerkSession(await token({ sts: "pending" }), options), /pending/);
  await assert.rejects(verifyClerkSession(await token({ act: { sub: "user_admin" } }), options), /impersonation/);
});

test("Clerk verification rejects invalid signatures and issuer mismatch", async () => {
  const valid = await token();
  const parts = valid.split(".");
  parts[2] = `${parts[2]!.slice(0, -2)}AA`;
  await assert.rejects(
    verifyClerkSession(parts.join("."), { jwtKey: publicPem, issuer, publicOrigin, nowSeconds: now }),
    /signature verification failed/,
  );
  await assert.rejects(
    verifyClerkSession(await token(), { jwtKey: publicPem, issuer: "https://wrong.example", publicOrigin, nowSeconds: now }),
    /issuer mismatch/,
  );
});

test("Clerk session token accepts Bearer first and same-origin __session cookie second", async () => {
  const bearer = await token();
  assert.equal(clerkSessionToken(new Request("https://scout.example.com", {
    headers: { authorization: `Bearer ${bearer}`, cookie: "__session=ignored" },
  })), bearer);
  assert.equal(clerkSessionToken(new Request("https://scout.example.com", {
    headers: { cookie: "other=1; __session=cookie-token; x=2" },
  })), "cookie-token");
});
