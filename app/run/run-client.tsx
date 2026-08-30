"use client";

import Link from "next/link";
import { useState } from "react";
import styles from "./run.module.css";

type RunPayload = {
  run?: {
    discovery?: { found?: number; created?: number; existing?: number };
    resolution?: { attempted?: number; resolved?: number; deferred?: number };
    applications?: { prepared?: number; readyForReview?: number; needsInput?: number };
    contacts?: { jobsResearched?: number; candidatesSaved?: number; classified?: number };
    ecosystem?: {
      enabled?: boolean;
      leads?: unknown[];
      directInstitutionLeads?: number;
      portfolioLeads?: number;
      sourceReviewLeads?: number;
      curatedContactResearch?: { createdTargets?: number; researchedTargets?: number; candidatesStored?: number; rejectedWrongPurpose?: number };
    };
    outcomes?: { submitted?: number; awaitingReply?: number; activeResponses?: number; terminal?: number; followUpsDue?: number };
    outreachPreparation?: { acceptedContactsReadyForDraft?: number; autoDrafted?: number; reason?: string };
    reviewQueue?: Record<string, number>;
    safety?: Record<string, boolean>;
  };
  error?: string;
};

function metric(value: number | undefined) { return value ?? 0; }

export function RunScoutWorkspace() {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<RunPayload["run"] | null>(null);
  const [error, setError] = useState("");

  async function runScout() {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/agent/orchestrate", { method: "POST" });
      const payload = await response.json() as RunPayload;
      if (!response.ok || !payload.run) throw new Error(payload.error ?? "One-run Scout failed");
      setResult(payload.run);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "One-run Scout failed");
    } finally {
      setBusy(false);
    }
  }

  return <main className={styles.shell}>
    <header className={styles.header}>
      <div><p className={styles.kicker}>SCOUT / ONE-RUN ORCHESTRATION</p><h1>Discover broadly. Persist only verified evidence. Stop at human decisions.</h1><p>One run covers the existing internship pipeline plus VC/startup/ecosystem discovery, curated public-contact research and explicit outcome/follow-up accounting.</p></div>
      <nav><Link href="/command-center">Command Center</Link><Link href="/outcomes">Outcomes</Link><Link href="/">Dashboard</Link></nav>
    </header>

    <section className={styles.boundary}><strong>Execution boundary</strong><span>Scout may create reviewable application packets and store public contacts as needs_review. It does not auto-promote portfolio-board leads, accept contacts, create Gmail drafts, send email, or submit applications.</span></section>
    {error && <div className={styles.error}>{error}</div>}

    <section className={styles.runPanel}><div><p className={styles.kicker}>RUN</p><h2>One deliberate pass through every safe stage</h2><p>Broad ecosystem search stays ephemeral. Curated official recruiting targets can be seeded automatically; any contact found still requires your review.</p></div><button disabled={busy} onClick={() => void runScout()}>{busy ? "Scout is working…" : "Run Scout end-to-end"}</button></section>

    {result && <>
      <section className={styles.metrics}>
        <article><span>Discovered</span><strong>{metric(result.discovery?.found)}</strong><small>{metric(result.resolution?.resolved)} official resolution(s)</small></article>
        <article><span>Application packets</span><strong>{metric(result.applications?.prepared)}</strong><small>{metric(result.applications?.readyForReview)} ready for review</small></article>
        <article><span>Public contacts</span><strong>{metric(result.contacts?.candidatesSaved)}</strong><small>{metric(result.contacts?.classified)} classified</small></article>
        <article><span>Ecosystem leads</span><strong>{result.ecosystem?.leads?.length ?? 0}</strong><small>{metric(result.ecosystem?.portfolioLeads)} portfolio-board lead(s)</small></article>
        <article><span>Follow-ups due</span><strong>{metric(result.outcomes?.followUpsDue)}</strong><small>{metric(result.outcomes?.activeResponses)} active recruiter/interview stage(s)</small></article>
        <article><span>Ready to draft</span><strong>{metric(result.outreachPreparation?.acceptedContactsReadyForDraft)}</strong><small>Accepted contacts; drafting remains reviewed</small></article>
      </section>

      <section className={styles.grid}>
        <article><p className={styles.kicker}>ECOSYSTEM</p><h2>Capital + startup surface</h2><p>{metric(result.ecosystem?.directInstitutionLeads)} direct institution lead(s), {metric(result.ecosystem?.portfolioLeads)} portfolio lead(s), {metric(result.ecosystem?.sourceReviewLeads)} source-review lead(s).</p><p>Curated research stored {metric(result.ecosystem?.curatedContactResearch?.candidatesStored)} public contact candidate(s) as <strong>needs_review</strong>.</p><Link href="/ecosystem">Triage ecosystem leads →</Link></article>
        <article><p className={styles.kicker}>OUTCOMES</p><h2>What happened after action</h2><p>{metric(result.outcomes?.submitted)} submitted application(s), {metric(result.outcomes?.awaitingReply)} awaiting reply, {metric(result.outcomes?.activeResponses)} active response/interview stage(s), {metric(result.outcomes?.terminal)} terminal outcome(s).</p><Link href="/outcomes">Review outcomes →</Link></article>
        <article><p className={styles.kicker}>REVIEW QUEUE</p><h2>Human decisions remain explicit</h2><div className={styles.queue}>{Object.entries(result.reviewQueue ?? {}).map(([key, value]) => <span key={key}><strong>{value}</strong>{key.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase())}</span>)}</div><Link href="/command-center">Open Command Center →</Link></article>
      </section>

      <section className={styles.boundary}><strong>Still manual:</strong><span>portfolio employer confirmation where needed, new-source trust, contact acceptance/rejection, exact outreach revision approval, Gmail draft creation, email sending, and final application submission.</span></section>
    </>}
  </main>;
}
