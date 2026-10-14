#!/usr/bin/env node
// Local, owner-initiated desktop Safe Fill. Never submits, uploads or answers sensitive fields.
import { spawn } from "node:child_process";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { planVerifiedDesktopFill } from "../lib/scout/desktop-fill-policy.mjs";

const SCOUT_ORIGIN = "https://ryan-scout-e3a2eb4fdd1a.herokuapp.com";

function edgeCandidates() {
  if (process.platform === "win32") return [
    join(process.env["PROGRAMFILES(X86)"] || "C:\\Program Files (x86)", "Microsoft", "Edge", "Application", "msedge.exe"),
    join(process.env.PROGRAMFILES || "C:\\Program Files", "Microsoft", "Edge", "Application", "msedge.exe"),
    join(process.env.LOCALAPPDATA || "", "Microsoft", "Edge", "Application", "msedge.exe"),
  ];
  if (process.platform === "darwin") return ["/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"];
  return ["/usr/bin/microsoft-edge", "/usr/bin/microsoft-edge-stable", "/opt/microsoft/msedge/msedge"];
}

async function findEdge() {
  for (const candidate of edgeCandidates()) {
    try { await access(candidate); return candidate; } catch { /* try next location */ }
  }
  throw new Error("Microsoft Edge is not installed. Install Edge first; no extension is required.");
}

async function verifyWithScout(token) {
  if (!/^scout1\.[A-Za-z0-9_-]+\.[a-fA-F0-9]{64}$/.test(token) || token.length > 4000) {
    throw new Error("Paste a fresh Scout handoff token from /assist");
  }
  // The decoded candidate must never be visited until the server verifies its signature.
  let candidate;
  try { candidate = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8")); }
  catch { throw new Error("Invalid handoff token"); }
  if (typeof candidate?.allowedUrl !== "string") throw new Error("Missing handoff application URL");
  const response = await fetch(SCOUT_ORIGIN + "/browser-handoff/exchange", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token, currentUrl: candidate.allowedUrl, fields: [] }),
    signal: AbortSignal.timeout(15000),
    cache: "no-store",
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.task) throw new Error(data?.error || "Scout refused the handoff (HTTP " + response.status + ")");
  const task = data.task;
  if (task.allowedUrl !== candidate.allowedUrl || task.constraints?.submitAvailable !== false) {
    throw new Error("Scout did not authorize a non-submitting exact-page task");
  }
  const url = new URL(task.allowedUrl);
  if (url.protocol !== "https:" || url.username || url.password || url.hostname !== task.allowedDomain || url.search || url.hash) {
    throw new Error("Only a verified exact HTTPS application URL is allowed");
  }
  if (!Array.isArray(task.answers) || !task.answers.some(item => item.verified === true)) {
    throw new Error("Scout did not return any verified profile values");
  }
  if (!Number.isFinite(task.expiresAt) || Date.now() >= task.expiresAt) throw new Error("Scout task expired");
  return task;
}

function inspectFields() {
  const elements = [...document.querySelectorAll('input:not([type="hidden"]):not([type="submit"]):not([type="button"]),textarea,select')].slice(0, 40);
  return elements.map((element, index) => {
    const kind = element.tagName.toLowerCase();
    const controlKind = kind === "input" ? "input" : kind === "select" ? "select" : "textarea";
    const inputType = controlKind === "input" ? (element.type || "text").toLowerCase() : controlKind;
    const explicit = element.id ? document.querySelector('label[for="' + CSS.escape(element.id) + '"]')?.textContent : "";
    const labelledBy = element.getAttribute("aria-labelledby");
    const fromId = labelledBy ? labelledBy.split(/\s+/).map(id => document.getElementById(id)?.textContent || "").join(" ") : "";
    const label = String(explicit || fromId || element.closest("label")?.textContent || element.getAttribute("aria-label") || element.getAttribute("placeholder") || element.name || element.id || "field").replace(/\s+/g, " ").trim().slice(0, 1000);
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    const data = {
      index, controlKind, inputType, label,
      visible: rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden",
      disabled: !!element.disabled, readOnly: element.readOnly === true,
      name: String(element.name || "").slice(0, 200),
      domId: String(element.id || "").slice(0, 200),
      autocomplete: String(element.autocomplete || "").slice(0, 100),
      placeholder: String(element.getAttribute("placeholder") || "").slice(0, 200),
    };
    data.fingerprint = JSON.stringify([data.controlKind, data.inputType, data.label, data.name, data.domId, data.autocomplete]);
    return data;
  });
}

function fillVerifiedFields(plan, expectedUrl, inspector) {
  const approved = new URL(expectedUrl);
  if (location.origin !== approved.origin || location.pathname !== approved.pathname) {
    return { filled: 0, stopped: "Application URL changed" };
  }
  if (document.querySelector('iframe[src*="recaptcha"],iframe[src*="hcaptcha"],[data-sitekey],[class*="captcha" i],[id*="captcha" i]')) {
    return { filled: 0, stopped: "CAPTCHA detected; complete it manually" };
  }
  const inputs = [...document.querySelectorAll('input:not([type="hidden"]):not([type="submit"]):not([type="button"]),textarea,select')].slice(0, 40);
  const fresh = inspector();
  let filled = 0;
  let preserved = 0;
  for (const item of plan) {
    const input = inputs[item.index];
    const meta = fresh[item.index];
    if (!input || !meta || meta.fingerprint !== item.fingerprint || !meta.visible || meta.disabled || meta.readOnly) continue;
    if (meta.controlKind !== "input" || !["text", "email", "tel", "url", "search"].includes(meta.inputType)) continue;
    if (String(input.value || "").trim()) { preserved++; continue; }
    if (typeof item.value !== "string" || !item.value.trim()) continue;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    if (!setter) continue;
    input.focus();
    setter.call(input, item.value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    if (input.value === item.value) filled++;
  }
  return { filled, preserved, submitted: false };
}

class DevTools {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 0;
    this.pending = new Map();
    socket.addEventListener("message", event => {
      let message;
      try { message = JSON.parse(event.data); } catch { return; }
      const pending = this.pending.get(message.id);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error("Edge protocol error: " + message.error.message));
      else pending.resolve(message.result || {});
    });
    socket.addEventListener("close", () => {
      for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(new Error("Edge was closed")); }
      this.pending.clear();
    });
  }
  async command(method, params = {}) {
    if (this.socket.readyState !== WebSocket.OPEN) throw new Error("Edge browser disconnected");
    return new Promise((resolvePromise, reject) => {
      const id = ++this.nextId;
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error("Edge command timed out")); }, 20000);
      this.pending.set(id, { resolve: resolvePromise, reject, timer });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  async evaluate(expression) {
    const result = await this.command("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error("Unable to inspect or fill this application form");
    return result.result?.value;
  }
  close() { this.socket.close(); }
}

async function attachEdge(profile, child) {
  let port = 0;
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null) throw new Error("Edge exited before startup");
    try {
      port = Number((await readFile(join(profile, "DevToolsActivePort"), "utf8")).split(/\r?\n/)[0]);
      if (Number.isInteger(port) && port > 0) break;
    } catch { /* wait for Edge startup */ }
    await delay(150);
  }
  if (!port) throw new Error("Edge debugging session did not start");
  const response = await fetch("http://127.0.0.1:" + port + "/json/list", { signal: AbortSignal.timeout(4000) });
  const targets = await response.json();
  const target = targets.find(item => item.type === "page" && typeof item.webSocketDebuggerUrl === "string");
  if (!target) throw new Error("Edge application tab not found");
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolvePromise, reject) => {
    const timer = setTimeout(() => reject(new Error("Edge attach timed out")), 8000);
    socket.addEventListener("open", () => { clearTimeout(timer); resolvePromise(); }, { once: true });
    socket.addEventListener("error", () => { clearTimeout(timer); reject(new Error("Edge attach failed")); }, { once: true });
  });
  return new DevTools(socket);
}

export async function runDesktopFill() {
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error("Run this on your own computer in a terminal");
  if (process.argv.slice(2).length) throw new Error("No command-line token or automation flags allowed");
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  let child = null;
  let client = null;
  let profile = null;
  try {
    console.log("\nScout desktop Safe Fill. No extension, no automatic submit.\n");
    const token = (await rl.question("Create and copy a fresh /assist handoff. Paste token here: ")).trim();
    const task = await verifyWithScout(token);
    const executable = await findEdge();
    profile = await mkdtemp(join(tmpdir(), "scout-desktop-fill-"));
    child = spawn(executable, [
      "--remote-debugging-address=127.0.0.1", "--remote-debugging-port=0",
      "--user-data-dir=" + profile, "--no-first-run", "--no-default-browser-check", "about:blank",
    ], { stdio: "ignore" });
    client = await attachEdge(profile, child);
    await client.command("Page.enable");
    await client.command("Runtime.enable");
    await client.command("Page.navigate", { url: task.allowedUrl });
    console.log("\nOpened approved application in a temporary Microsoft Edge window.\n");
    await rl.question("Wait for the visible form (sign in manually if needed), then press Enter: ");
    if (Date.now() >= task.expiresAt) throw new Error("Scout task expired; create a new handoff");
    const fields = await client.evaluate("(" + inspectFields.toString() + ")()");
    if (!Array.isArray(fields) || fields.length > 40) throw new Error("Invalid visible-form metadata");
    const plan = planVerifiedDesktopFill(fields, task.answers);
    if (plan.length) {
      console.log("\n" + plan.length + " verified field(s) eligible for Safe Fill:");
      for (const item of plan) console.log("  " + fields[item.index].label + " <- verified " + item.sourceField);
      const confirm = (await rl.question("Type FILL to apply these fields; anything else cancels: ")).trim();
      if (confirm !== "FILL") { console.log("Cancelled. Nothing filled."); return; }
      if (Date.now() >= task.expiresAt) throw new Error("Scout task expired");
      const expression = "(() => { const inspector = " + inspectFields.toString() + "; return (" + fillVerifiedFields.toString() + ")(" + JSON.stringify(plan) + "," + JSON.stringify(task.allowedUrl) + ",inspector); })()";
      const result = await client.evaluate(expression);
      if (result?.stopped) console.log("Stopped safely: " + result.stopped);
      else console.log("Filled " + (result?.filled ?? 0) + " verified field(s). Preserved " + (result?.preserved ?? 0) + " existing value(s).");
    } else {
      console.log("\n0 verified fields safely matched. Nothing changed.");
    }
    console.log("\nReview remaining questions, uploads, and eligibility in Edge. Submit manually if appropriate.");
    await rl.question("When finished reviewing, press Enter to close the temporary Edge window: ");
  } finally {
    client?.close();
    if (child && child.exitCode === null) child.kill();
    if (profile) await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 400 }).catch(() => {});
    rl.close();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runDesktopFill().catch(error => {
    console.error("\nScout desktop Safe Fill stopped: " + (error instanceof Error ? error.message : "Unknown error"));
    process.exitCode = 1;
  });
}
