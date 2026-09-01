"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import styles from "./external-leads.module.css";

type JobRef = { id: string; currentSnapshotId?: string | null };
type SavedLead = {
  created: boolean;
  job?: JobRef;
  externalLead?: { trust: string; leadUrl: string; resolutionCandidateUrl: string; requiresOfficialResolution: boolean };
  error?: string;
};
type Promotion = { promotion?: { jobId: string; canonicalUrl: string }; error?: string };
type Resolution = { resolved?: number; pending?: number; resolvedJobIds?: string[]; pendingJobIds?: string[]; failures?: Array<{ jobId: string; reason: string }>; error?: string };
type PipelineResult = { jobId: string | null; verified: boolean; notes: string[] };

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(payload.error ?? `Request failed (${response.status})`);
  return payload;
}

export function ExternalLeadsClient() {
  const [leadUrl, setLeadUrl] = useState("");
  const [company, setCompany] = useState("");
  const [title, setTitle] = useState("");
  const [officialUrl, setOfficialUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState<SavedLead | null>(null);
  const [verifiedJobId, setVerifiedJobId] = useState<string | null>(null);
  const automaticCaptureStarted = useRef(false);

  const prepareVerifiedRole = useCallback(async (jobId: string) => {
    const notes: string[] = [];
    const [application, contacts] = await Promise.allSettled([
      postJson<{ application?: unknown }>("/api/applications", { jobId }),
      postJson<{ added?: number }>("/api/contacts/research", { jobId }),
    ]);
    notes.push(application.status === "fulfilled" ? "application review packet prepared" : "application packet needs manual retry");
    notes.push(contacts.status === "fulfilled" ? "public contact evidence checked" : "contact research needs manual retry");
    return notes;
  }, []);

  const runPipeline = useCallback(async (capture: { leadUrl: string; company: string; title: string; officialUrl?: string }): Promise<PipelineResult> => {
    setBusy(true); setError(""); setNotice(""); setSaved(null); setVerifiedJobId(null);
    const notes: string[] = [];
    try {
      let savedLead: SavedLead;
      let jobId: string | null = null;
      let verified = false;

      if (capture.officialUrl?.trim()) {
        savedLead = await postJson<SavedLead>("/api/external-leads", { source: "sprout", ...capture });
        setSaved(savedLead);
        jobId = savedLead.job?.id ?? null;
        if (savedLead.job?.currentSnapshotId) {
          verified = true;
          notes.push("existing official snapshot reused");
        } else {
          const resolution = await postJson<Resolution>("/api/lead-resolution", {});
          const failed = jobId ? resolution.failures?.find((item) => item.jobId === jobId) : null;
          if (failed) throw new Error(failed.reason);
          verified = Boolean(jobId && resolution.resolvedJobIds?.includes(jobId));
          notes.push(verified ? "official ATS posting resolved" : "official URL remains pending review");
        }
      } else {
        try {
          const promotion = await postJson<Promotion>("/api/lead-promotion", {
            action: "resolve_promote",
            leadUrl: capture.leadUrl,
            companyHint: capture.company,
            title: capture.title,
            sourceMode: "ecosystem_index_lead",
          });
          jobId = promotion.promotion?.jobId ?? null;
          const resolvedUrl = promotion.promotion?.canonicalUrl;
          if (!jobId || !resolvedUrl) throw new Error("Official role resolution returned no job identity");
          verified = true;
          notes.push("official employer/ATS source found and independently refetched");
          savedLead = await postJson<SavedLead>("/api/external-leads", {
            source: "sprout",
            ...capture,
            officialUrl: resolvedUrl,
          });
          setSaved(savedLead);
        } catch (resolutionError) {
          savedLead = await postJson<SavedLead>("/api/external-leads", { source: "sprout", ...capture });
          setSaved(savedLead);
          jobId = savedLead.job?.id ?? null;
          notes.push(`saved unresolved for review: ${resolutionError instanceof Error ? resolutionError.message : "official match unavailable"}`);
        }
      }

      if (verified && jobId) {
        setVerifiedJobId(jobId);
        notes.push(...await prepareVerifiedRole(jobId));
      }
      setNotice(verified
        ? `Capture complete: ${notes.join("; ")}. Nothing was submitted or sent.`
        : `Capture saved safely: ${notes.join("; ")}. Scout did not trust Sprout as employer evidence.`);
      return { jobId, verified, notes };
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Unable to capture this Sprout opportunity";
      setError(message);
      return { jobId: null, verified: false, notes: [message] };
    } finally { setBusy(false); }
  }, [prepareVerifiedRole]);

  useEffect(() => {
    if (automaticCaptureStarted.current) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("capture") !== "sprout") return;
    const capture = {
      leadUrl: params.get("leadUrl") ?? "",
      company: params.get("company") ?? "",
      title: params.get("title") ?? "",
    };
    automaticCaptureStarted.current = true;
    queueMicrotask(() => {
      setLeadUrl(capture.leadUrl); setCompany(capture.company); setTitle(capture.title);
      if (!capture.leadUrl || !capture.company || !capture.title) {
        setError("Sprout capture could not identify the company and role. Review the fields below.");
        return;
      }
      void runPipeline(capture);
    });
  }, [runPipeline]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await runPipeline({ leadUrl, company, title, ...(officialUrl.trim() ? { officialUrl } : {}) });
  }

  return <main className={styles.shell}>
    <header className={styles.header}><div><p className={styles.kicker}>SCOUT / EXTERNAL LEADS</p><h1>One-click Sprout capture, official evidence underneath.</h1><p>Capture the visible role once. Scout then tries official-source resolution, prepares the review packet, and checks public contact evidence automatically.</p></div><Link href="/">Dashboard</Link></header>
    <aside className={styles.boundary}><strong>Automatic after capture:</strong> official ATS search/refetch, immutable evidence, application review preparation, and public-contact research. <strong>Never automatic:</strong> Sprout login/session access, background crawling, credit use, contact acceptance, sending, or application submission.</aside>
    {notice && <div className={styles.notice}>{notice}</div>}{error && <div className={styles.error}>{error}</div>}
    <form className={styles.form} onSubmit={submit}>
      <label>Sprout job / lead URL<input type="url" required placeholder="https://…usesprout.com/…" value={leadUrl} onChange={(event) => setLeadUrl(event.target.value)} /></label>
      <div className={styles.two}><label>Company<input required maxLength={200} value={company} onChange={(event) => setCompany(event.target.value)} /></label><label>Role title<input required maxLength={300} value={title} onChange={(event) => setTitle(event.target.value)} /></label></div>
      <label>Independent official employer / ATS posting URL <span>optional</span><input type="url" placeholder="Scout can search for this automatically" value={officialUrl} onChange={(event) => setOfficialUrl(event.target.value)} /></label>
      <button disabled={busy}>{busy ? "Capturing and verifying…" : "Capture and verify automatically"}</button>
    </form>
    {saved?.externalLead && <section className={styles.result}><strong>Sprout trust state: {saved.externalLead.trust}</strong><p>Captured source: {saved.externalLead.leadUrl}</p><p>Official resolution required: {saved.externalLead.requiresOfficialResolution ? "yes" : "no"}</p><div>{verifiedJobId ? <Link href={`/roles/${verifiedJobId}`}>Open verified role →</Link> : saved.job?.id && <Link href={`/roles/${saved.job.id}`}>Review unresolved lead →</Link>}</div></section>}
  </main>;
}
