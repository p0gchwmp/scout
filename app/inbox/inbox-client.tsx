"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { classifyApplicationUrl } from "../../lib/scout/application-sites";
import styles from "./inbox.module.css";

type LeadJob = {
  id: string;
  source: string;
  company: string;
  title: string;
  canonicalUrl: string;
  currentSnapshotId: string | null;
  lastSeenAt: string;
};

export function InternshipInbox() {
  const [form, setForm] = useState({ url: "", company: "", title: "" });
  const [leads, setLeads] = useState<LeadJob[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const loadLeads = useCallback(async () => {
    const response = await fetch("/api/jobs");
    const payload = await response.json() as { jobs?: LeadJob[]; error?: string };
    if (!response.ok) throw new Error(payload.error ?? "Unable to load internship leads");
    setLeads((payload.jobs ?? []).filter((job) => job.source.startsWith("lead:")));
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadLeads().catch((caught) => setError(caught instanceof Error ? caught.message : "Unable to load internship leads"));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadLeads]);

  const channel = form.url.trim() ? classifyApplicationUrl(form.url.trim()) : null;

  async function saveLead() {
    setError("");
    setNotice("");
    if (!form.url.trim() || !form.company.trim() || !form.title.trim()) {
      setError("Internship URL, company and role title are required.");
      return;
    }
    setBusy(true);
    try {
      const response = await fetch("/api/intake", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(form),
      });
      const payload = await response.json() as { created?: boolean; lead?: { channel?: { label?: string }; nextStep?: string }; error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Unable to save internship lead");
      setForm({ url: "", company: "", title: "" });
      setNotice(`${payload.created ? "Saved" : "Already saved"}. ${payload.lead?.nextStep ?? "Official posting resolution is required before application preparation."}`);
      await loadLeads();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to save internship lead");
    } finally {
      setBusy(false);
    }
  }

  return <main className={styles.shell}>
    <header className={styles.header}>
      <div><p className={styles.kicker}>SCOUT / INTERNSHIP INBOX</p><h1>Drop the link. Keep the opportunity.</h1><p>Save internships from LinkedIn, Internshala, Unstop, Wellfound, ATS pages or company career sites. Scout records the lead now and resolves official evidence before application automation.</p></div>
      <Link href="/" className={styles.back}>← Dashboard</Link>
    </header>

    {notice && <div className={styles.notice}>{notice}</div>}
    {error && <div className={`${styles.notice} ${styles.error}`}>{error}</div>}

    <section className={styles.composer}>
      <label>Internship URL<input type="url" value={form.url} onChange={(event) => setForm((value) => ({ ...value, url: event.target.value }))} placeholder="https://…" /></label>
      <label>Company<input value={form.company} maxLength={160} onChange={(event) => setForm((value) => ({ ...value, company: event.target.value }))} placeholder="Company name" /></label>
      <label>Role title<input value={form.title} maxLength={240} onChange={(event) => setForm((value) => ({ ...value, title: event.target.value }))} placeholder="Product Intern" /></label>
      <div className={styles.channel}>{channel ? <><strong>{channel.label}</strong><span>{channel.note}</span></> : <span>Paste a link to classify the application channel.</span>}</div>
      <button disabled={busy} onClick={() => void saveLead()}>{busy ? "Saving…" : "Save internship"}</button>
    </section>

    <section className={styles.list}>
      <div className={styles.listHead}><div><p className={styles.kicker}>SAVED LEADS</p><h2>{leads.length} waiting for action</h2></div><p>No application or email is sent from this inbox.</p></div>
      {!leads.length && <div className={styles.empty}>No saved internship leads yet.</div>}
      {leads.map((lead) => <article className={styles.card} key={lead.id}>
        <div><p className={styles.source}>{lead.source.replace("lead:", "").toUpperCase()}</p><h3>{lead.company} — {lead.title}</h3><p>{lead.currentSnapshotId ? "Official snapshot captured" : "Needs official posting resolution before application prep"}</p></div>
        <a href={lead.canonicalUrl} target="_blank" rel="noreferrer">Open lead ↗</a>
      </article>)}
    </section>
  </main>;
}
