import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("dashboard stylesheet covers the classes rendered by the main workspace", async () => {
  const [dashboard, css, layout] = await Promise.all([
    readFile(new URL("../app/dashboard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/dashboard-ui.css", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
  ]);

  for (const className of [
    "dashboard", "hero", "tabs", "toolbar", "segmented", "grid", "card", "card-head",
    "chips", "chip", "match-box", "actions", "editor", "status", "section-intro",
  ]) {
    assert.ok(dashboard.includes(className), `dashboard should render ${className}`);
    assert.match(css, new RegExp(`\\.${className}\\b`), `dashboard UI stylesheet should cover ${className}`);
  }

  assert.match(layout, /import "\.\/globals\.css";\s*import "\.\/dashboard-ui\.css";/);
});

test("root workspace navigation is styled and keeps all current owner workflows reachable", async () => {
  const [page, css] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/dashboard-ui.css", import.meta.url), "utf8"),
  ]);

  for (const href of ["/inbox", "/shortlist", "/applications", "/readiness", "/review", "/assist", "/voice"]) {
    assert.ok(page.includes(`"${href}"`), `workspace navigation should include ${href}`);
  }
  assert.match(page, /dashboard-topbar/);
  assert.match(page, /workspace-links/);
  assert.match(page, /owner-badge/);
  assert.match(css, /\.dashboard-topbar/);
  assert.match(css, /\.workspace-links/);
  assert.match(css, /\.owner-badge/);
});

test("dashboard UI stays responsive and does not hide safety or actions on mobile", async () => {
  const css = await readFile(new URL("../app/dashboard-ui.css", import.meta.url), "utf8");
  assert.match(css, /@media \(max-width: 860px\)/);
  assert.match(css, /@media \(max-width: 620px\)/);
  assert.match(css, /\.dashboard \.actions/);
  assert.doesNotMatch(css, /\.dashboard \.actions\s*\{[^}]*display:\s*none/s);
  assert.doesNotMatch(css, /\.dashboard \.hero aside\s*\{[^}]*display:\s*none/s);
});
