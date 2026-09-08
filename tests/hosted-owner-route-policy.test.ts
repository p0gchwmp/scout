import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import {
  hostedAuthFailureUsesJson,
  isHostedOwnerProtectedPath,
  isHostedPublicPath,
} from "../lib/scout/hosted-route-policy.ts";

const ownerWorkspaces = [
  "/",
  "/inbox",
  "/assist",
  "/voice",
  "/review",
  "/shortlist",
  "/readiness",
  "/applications",
  "/sources",
  "/setup",
  "/evidence",
  "/preferences",
  "/quality",
  "/roles",
  "/roles/example-role",
  "/claims",
  "/command-center",
  "/company-outreach",
  "/contacts",
  "/ecosystem",
  "/external-leads",
  "/outcomes",
  "/run",
  "/start",
  "/resume-import",
] as const;

test("hosted route policy protects every current owner workspace", () => {
  for (const pathname of ownerWorkspaces) {
    assert.equal(isHostedOwnerProtectedPath(pathname), true, `${pathname} must require the hosted owner session`);
    assert.equal(isHostedPublicPath(pathname), false, `${pathname} must not be public`);
  }
});

test("hosted route policy fails closed for future Scout pages and APIs", () => {
  for (const pathname of ["/future-workspace", "/future-workspace/item", "/api/resume-import", "/api/future-action", "/health"]) {
    assert.equal(isHostedOwnerProtectedPath(pathname), true, `${pathname} must fail closed`);
  }
  assert.equal(hostedAuthFailureUsesJson("/api/resume-import"), true);
  assert.equal(hostedAuthFailureUsesJson("/health"), true);
  assert.equal(hostedAuthFailureUsesJson("/resume-import"), false);
});

test("only explicit auth and framework/static paths bypass owner auth", () => {
  for (const pathname of [
    "/sign-in",
    "/sign-in/factor-one",
    "/sign-out",
    "/signin-with-chatgpt",
    "/signout-with-chatgpt",
    "/callback",
    "/_next/static/chunks/app.js",
    "/_next/image",
    "/favicon.svg",
    "/file.svg",
    "/globe.svg",
    "/og.png",
    "/window.svg",
  ]) {
    assert.equal(isHostedPublicPath(pathname), true, `${pathname} should remain reachable before authentication`);
  }

  for (const pathname of ["/_next/data/private.json", "/public/anything", "/robots.txt", "/favicon.ico"]) {
    assert.equal(isHostedPublicPath(pathname), false, `${pathname} must not gain a broad public exemption`);
  }
});

test("candidate resume import artifacts stay out of the source tree", () => {
  const gitignore = readFileSync(new URL("../.gitignore", import.meta.url), "utf8");
  assert.match(gitignore, /\*_resume_import\.json/);
  assert.equal(existsSync(new URL("../Ryan_Vivek_Mahajan_resume_import.json", import.meta.url)), false);
});
