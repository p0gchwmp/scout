"use client";

import Link from "next/link";
import { useState } from "react";

type ImportPayload = {
  schemaVersion: 1;
  resumeReference: string;
  acknowledgeDraftOnly: true;
  profile: Array<{ kind: string; claim: string; evidence?: string }>;
  claims: Array<{ statement: string; evidence?: string }>;
};

function parseFilePayload(text: string): ImportPayload {
  const parsed = JSON.parse(text) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Resume import file must contain one JSON object");
  const raw = parsed as Partial<ImportPayload>;
  if (raw.schemaVersion !== 1 || raw.acknowledgeDraftOnly !== true || !Array.isArray(raw.profile) || !Array.isArray(raw.claims)) {
    throw new Error("Resume import file is missing the Scout v1 draft-only contract");
  }
  return raw as ImportPayload;
}

export function ResumeImportClient() {
  const [payload, setPayload] = useState<ImportPayload | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  async function loadFile(file: File | null) {
    setNotice(""); setError(""); setPayload(null);
    if (!file) return;
    try {
      if (file.size > 250_000) throw new Error("Resume import JSON is unexpectedly large");
      setPayload(parseFilePayload(await file.text()));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to read resume import file");
    }
  }

  async function importResume() {
    if (!payload) return;
    setBusy(true); setNotice(""); setError("");
    try {
      const response = await fetch("/api/resume-import", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify(payload),
      });
      const text = await response.text();
      let result: { error?: string; imported?: { profile?: { created?: number; updated?: number }; claims?: { createdDrafts?: number } } } = {};
      try { result = text ? JSON.parse(text) as typeof result : {}; }
      catch { throw new Error(`/api/resume-import returned invalid JSON (HTTP ${response.status})`); }
      if (!response.ok) throw new Error(result.error ?? `Resume import failed (HTTP ${response.status})`);
      setNotice(`Imported ${result.imported?.profile?.created ?? 0} new profile field(s), updated ${result.imported?.profile?.updated ?? 0}, and created ${result.imported?.claims?.createdDrafts ?? 0} draft claim(s). Review Profile and Claims before Scout can reuse them.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Resume import failed");
    } finally {
      setBusy(false);
    }
  }

  return <main className="dashboard">
    <header className="hero">
      <div>
        <p className="eyebrow">SCOUT · RESUME IMPORT</p>
        <h1>Import evidence, then review it.</h1>
        <p>Scout imports reusable profile facts as unverified evidence and resume claims as drafts. Nothing is auto-approved, sent, or submitted.</p>
        <p><Link href="/">← Dashboard</Link> · <Link href="/review">Review Queue →</Link></p>
      </div>
      <aside><strong>Approval boundary</strong><span>Profile verification and claim approval remain explicit owner decisions.</span></aside>
    </header>

    {error && <div className="alert error">{error}</div>}
    {notice && <div className="alert success">{notice}</div>}

    <section>
      <h2>1. Choose Scout resume-import JSON</h2>
      <p className="section-intro">The JSON may contain personal profile evidence. It is sent only to this owner-only Scout instance when you press Import.</p>
      <input type="file" accept="application/json,.json" onChange={(event) => void loadFile(event.target.files?.[0] ?? null)} />
    </section>

    {payload && <section>
      <h2>2. Review the import summary</h2>
      <div className="grid">
        <article className="card"><h3>{payload.resumeReference}</h3><p>{payload.profile.length} profile field(s)</p><p>{payload.claims.length} draft claim(s)</p><small>Draft-only acknowledgement: yes</small></article>
        <article className="card"><h3>Profile kinds</h3><p>{payload.profile.map((field) => field.kind).join(", ")}</p></article>
      </div>
      <div className="actions"><button disabled={busy} onClick={() => void importResume()}>{busy ? "Importing…" : "Import as unverified + draft"}</button></div>
    </section>}
  </main>;
}
