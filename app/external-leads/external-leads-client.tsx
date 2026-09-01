"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import styles from "./external-leads.module.css";

type SavedLead = {
  created: boolean;
  job?: { id: string };
  externalLead?: { trust: string; leadUrl: string; resolutionCandidateUrl: string; requiresOfficialResolution: boolean };
  error?: string;
};

export function ExternalLeadsClient() {
  const [leadUrl, setLeadUrl] = useState("");
  const [company, setCompany] = useState("");
  const [title, setTitle] = useState("");
  const [officialUrl, setOfficialUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState<SavedLead | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(""); setNotice(""); setSaved(null);
    try {
      const response = await fetch("/api/external-leads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ source: "sprout", leadUrl, company, title, ...(officialUrl.trim() ? { officialUrl } : {}) }),
      });
      const payload = await response.json() as SavedLead;
      if (!response.ok) throw new Error(payload.error ?? "Unable to save external lead");
      setSaved(payload);
      setNotice(payload.created ? "Lead saved. It remains untrusted until official employer evidence is resolved." : "This resolution candidate is already present in Scout.");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to save external lead"); }
    finally { setBusy(false); }
  }

  async function resolveControlled() {
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/lead-resolution", { method: "POST" });
      const payload = await response.json() as { resolved?: number; pending?: number; failures?: unknown[]; error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Unable to resolve pending leads");
      setNotice(`Official resolution pass complete: ${payload.resolved ?? 0} resolved, ${payload.pending ?? 0} still pending. Unsupported/unregistered sources stay untrusted.`);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to resolve pending leads"); }
    finally { setBusy(false); }
  }

  return <main className={styles.shell}>
    <header className={styles.header}><div><p className={styles.kicker}>SCOUT / EXTERNAL LEADS</p><h1>Bring Sprout into Scout without making Sprout the source of truth.</h1><p>Paste a Sprout lead manually. If you already have the employer/ATS URL, add it too; Scout still requires its controlled official-resolution path before application preparation.</p></div><Link href="/">Dashboard</Link></header>
    <aside className={styles.boundary}><strong>What this integration does:</strong> accepts public/manual context. <strong>What it does not do:</strong> sign into Sprout, use your subscription, call undocumented APIs, scrape listings, spend credits, or submit applications.</aside>
    {notice && <div className={styles.notice}>{notice}</div>}{error && <div className={styles.error}>{error}</div>}
    <form className={styles.form} onSubmit={submit}>
      <label>Sprout job / lead URL<input type="url" required placeholder="https://…usesprout.com/…" value={leadUrl} onChange={(event) => setLeadUrl(event.target.value)} /></label>
      <div className={styles.two}><label>Company<input required maxLength={200} value={company} onChange={(event) => setCompany(event.target.value)} /></label><label>Role title<input required maxLength={300} value={title} onChange={(event) => setTitle(event.target.value)} /></label></div>
      <label>Independent official employer / ATS posting URL <span>optional but preferred</span><input type="url" placeholder="https://company.com/careers/… or official ATS URL" value={officialUrl} onChange={(event) => setOfficialUrl(event.target.value)} /></label>
      <button disabled={busy}>{busy ? "Working…" : "Save as unresolved lead"}</button>
    </form>
    {saved?.externalLead && <section className={styles.result}><strong>Trust state: {saved.externalLead.trust}</strong><p>Resolution candidate: {saved.externalLead.resolutionCandidateUrl}</p><p>Official resolution required: {saved.externalLead.requiresOfficialResolution ? "yes" : "no"}</p><div><button disabled={busy} onClick={() => void resolveControlled()}>Try controlled official resolution</button>{saved.job?.id && <Link href={`/roles/${saved.job.id}`}>Open lead →</Link>}</div></section>}
  </main>;
}
