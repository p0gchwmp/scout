import assert from "node:assert/strict";
import test from "node:test";
import {
  buildLocalDevWorkerBindings,
  resolveLocalDevWorkerAuth,
} from "../lib/scout/local-dev-auth.ts";

const shellEnvironment = {
  SCOUT_LOCAL_DEV_AUTH: "1",
  SCOUT_LOCAL_DEV_USER_ID: "scout-local-owner",
  SCOUT_OWNER_USER_ID: "scout-local-owner",
};

function localBindings() {
  return buildLocalDevWorkerBindings(
    "serve",
    "development",
    shellEnvironment,
  );
}

function request(url = "http://localhost:3000/") {
  return {
    url,
    headers: new Headers({ host: new URL(url).host }),
  };
}

test("vite local worker bindings exist only for development serve", () => {
  const bindings = localBindings();
  assert.deepEqual(bindings, {
    SCOUT_OWNER_USER_ID: "scout-local-owner",
    SCOUT_LOCAL_DEV_RUNTIME: "1",
    SCOUT_LOCAL_DEV_AUTH: "1",
    SCOUT_LOCAL_DEV_USER_ID: "scout-local-owner",
  });

  assert.deepEqual(
    buildLocalDevWorkerBindings("build", "production", shellEnvironment),
    {},
  );
  assert.deepEqual(
    buildLocalDevWorkerBindings("serve", "production", shellEnvironment),
    {},
  );
});

test("local worker auth accepts an explicitly enabled matching owner on loopback", () => {
  for (const url of [
    "http://localhost:3000/",
    "http://127.0.0.1:3000/",
    "http://[::1]:3000/",
  ]) {
    const context = resolveLocalDevWorkerAuth(request(url), localBindings());
    assert.ok(context, `expected local auth for ${url}`);
    assert.equal(context.user.userId, "scout-local-owner");
    assert.equal(context.ownerUserId, "scout-local-owner");
    assert.equal(context.user.email, "scout-local-owner@localhost.invalid");
  }
});

test("local worker auth fails closed without the dev-runtime marker or explicit enablement", () => {
  for (const bindings of [
    { ...localBindings(), SCOUT_LOCAL_DEV_RUNTIME: undefined },
    { ...localBindings(), SCOUT_LOCAL_DEV_RUNTIME: "0" },
    { ...localBindings(), SCOUT_LOCAL_DEV_AUTH: undefined },
    { ...localBindings(), SCOUT_LOCAL_DEV_AUTH: "0" },
  ]) {
    assert.equal(resolveLocalDevWorkerAuth(request(), bindings), null);
  }
});

test("local worker auth refuses non-loopback and ambiguous forwarded hosts", () => {
  const bindings = localBindings();
  for (const candidate of [
    {
      url: "http://192.168.1.50:3000/",
      headers: new Headers({ host: "192.168.1.50:3000" }),
    },
    {
      url: "http://scout.example:3000/",
      headers: new Headers({ host: "scout.example:3000" }),
    },
    {
      url: "http://localhost:3000/",
      headers: new Headers({
        host: "localhost:3000",
        "x-forwarded-host": "scout.example",
      }),
    },
    {
      url: "http://localhost:3000/",
      headers: new Headers({
        host: "localhost:3000",
        "x-forwarded-host": "localhost:3000, scout.example",
      }),
    },
  ]) {
    assert.equal(resolveLocalDevWorkerAuth(candidate, bindings), null);
  }
});

test("local worker auth never replaces a real or partial hosted identity", () => {
  const bindings = localBindings();
  for (const headers of [
    new Headers({
      host: "localhost:3000",
      "oai-authenticated-user-id": "hosted-user",
    }),
    new Headers({
      host: "localhost:3000",
      "oai-authenticated-user-email": "hosted@example.com",
    }),
  ]) {
    assert.equal(
      resolveLocalDevWorkerAuth(
        { url: "http://localhost:3000/", headers },
        bindings,
      ),
      null,
    );
  }
});

test("local worker binding setup requires an explicit matching owner", () => {
  for (const environment of [
    { ...shellEnvironment, SCOUT_LOCAL_DEV_USER_ID: undefined },
    { ...shellEnvironment, SCOUT_OWNER_USER_ID: undefined },
    { ...shellEnvironment, SCOUT_LOCAL_DEV_USER_ID: "other-user" },
    { ...shellEnvironment, SCOUT_OWNER_USER_ID: "other-owner" },
    { ...shellEnvironment, SCOUT_LOCAL_DEV_USER_ID: "bad user id" },
  ]) {
    assert.throws(
      () => buildLocalDevWorkerBindings("serve", "development", environment),
      /requires SCOUT_LOCAL_DEV_USER_ID and SCOUT_OWNER_USER_ID/,
    );
  }
});
