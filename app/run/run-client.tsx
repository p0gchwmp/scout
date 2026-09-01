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

type LocalImportPayload = {
  found?: number;
  created?: number;
  existing?: number;
  error?: string;
};

type LocalResolutionPayload = {
  scanned?: number;
  resolved?: number;
  pending?: number;
  error?: string;
};

function metric(value: number | undefined) { return value ?? 0; }

function isLoopbackBrowser() {
  const hostname = window.location.hostname.toLowerCase();
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

export function RunScoutWorkspace() {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<RunPayload["run"] | null>(null);
  const [error, setError] = useState("");
  const [localFallback, setLocalFallback] = useState(false);

  async function runLocalDevelopmentFallback() {
    const bridgeResponse = await fetch("http://127.0.0.1:43119/discover", { method: "GET", cache: "no-store" });
    if (!bridgeResponse.ok) throw new Error("Local discovery bridge unavailable");
    const envelope = await bridgeResponse.json() as { payload?: string; signature?: string; error?: string };
    if (!envelope.payload || !envelope.signature) throw new Error(envelope.error ?? "Local discovery bridge returned an invalid envelope");

    const importResponse = await fetch("/api/lead-discovery/import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ payload: envelope.payload, signature: envelope.signature }),
    });
    const imported = await importResponse.json() as LocalImportPayload;
    if (!importResponse.ok) throw new Error(imported.error ?? "Unable to import local discovery results");

    const resolutionResponse = await fetch("/api/lead-resolution", { method: "POST" });
    const resolution = await resolutionResponse.json() as LocalResolutionPayload;
    if (!resolutionResponse.ok) throw new Error(resolution.error ?? "Unable to resolve official postings");

    setLocalFallback(true);
    setResult({
      discovery: {
        found: imported.found ?? 0,
        created: imported.created ?? 0,
        existing: imported.existing ?? 0,
      },
      resolution: {
        attempted: resolution.scanned ?? 0,
        resolved: resolution.resolved ?? 0,
        deferred: resolution.pending ?? 0,
      },
      safety: {
        sendEmail: false,
        submitApplication: false,
        autoAcceptContact: false,
        autoApproveApplication: false,
      },
    });
  }

  async function runScout() {
    setBusy(true); setError(""); setLocalFallback(false);
    try {
      // Vinext's local server code runs in workerd, whose SSRF boundary blocks
      // direct requests to the separate loopback Node agent. Reuse Scout's
      // existing browser-reachable, HMAC-signed local discovery bridge instead
      // of weakening workerd's private-network policy.
      if (isLoopbackBrowser()) {
        await runLocalDevelopmentFallback();
        return;
      }

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
    {localFallback && <section className={styles.boundary}><strong>Local safe run completed</strong><span>Discovery ran through Scout&apos;s signed loopback browser bridge and official posting resolution ran inside Scout. Cloud-agent-only ecosystem, AI/contact research and automatic application-preparation stages were deliberately not represented as completed; use the Shortlist, Applications and Contacts workspaces for reviewed follow-up.</span></section>}

    <section className={styles.runPanel}><div><p className={styles.kicker}>RUN</p><h2>One deliberate pass through every safe stage</h2><p>Broad ecosystem search stays ephemeral. Curated official recruiting targets can be seeded automatically; any contact found still requires your review. Local development uses Scout&apos;s signed browser bridge rather than weakening workerd&apos;s loopback protections.</p></div><button disabled={busy} onClick={() => void runScout()}>{busy ? "Scout is working…" : "Run Scout safely"}</button></section>

    {result && <>
      <section className={styles.metrics}>
        <article><span>Discovered</span><strong>{metric(result.discovery?.found)}</strong><small>{metric(result.resolution?.resolved)} official resolution(s)</small></article>
        <article><span>Application packets</span><strong>{localFallback ? "—" : metric(result.applications?.prepared)}</strong><small>{localFallback ? "Open Applications for reviewed preparation" : `${metric(result.applications?.readyForReview)} ready for review`}</small></article>
        <article><span>Public contacts</span><strong>{localFallback ? "—" : metric(result.contacts?.candidatesSaved)}</strong><small>{localFallback ? "Agent contact stage not run in local fallback" : `${metric(result.contacts?.classified)} classified`}</small></article>
        <article><span>Ecosystem leads</span><strong>{localFallback ? "—" : result.ecosystem?.leads?.length ?? 0}</strong><small>{localFallback ? "Cloud-agent ecosystem stage not run" : `${metric(result.ecosystem?.portfolioLeads)} portfolio-board lead(s)`}</small></article>
        <article><span>Follow-ups due</span><strong>{localFallback ? "—" : metric(result.outcomes?.followUpsDue)}</strong><small>{localFallback ? "Open Outcomes for current recorded state" : `${metric(result.outcomes?.activeResponses)} active recruiter/interview stage(s)`}</small></article>
        <article><span>Ready to draft</span><strong>{localFallback ? "—" : metric(result.outreachPreparation?.acceptedContactsReadyForDraft)}</strong><small>{localFallback ? "Open Contacts/Review after accepting evidence" : "Accepted contacts; drafting remains reviewed"}</small></article>
      </section>

      {!localFallback && <section className={styles.grid}>
        <article><p className={styles.kicker}>ECOSYSTEM</p><h2>Capital + startup surface</h2><p>{metric(result.ecosystem?.directInstitutionLeads)} direct institution lead(s), {metric(result.ecosystem?.portfolioLeads)} portfolio lead(s), {metric(result.ecosystem?.sourceReviewLeads)} source-review lead(s).</p><p>Curated research stored {metric(result.ecosystem?.curatedContactResearch?.candidatesStored)} public contact candidate(s) as <strong>needs_review</strong>.</p><Link href="/ecosystem">Triage ecosystem leads →</Link></article>
        <article><p className={styles.kicker}>OUTCOMES</p><h2>What happened after action</h2><p>{metric(result.outcomes?.submitted)} submitted application(s), {metric(result.outcomes?.awaitingReply)} awaiting reply, {metric(result.outcomes?.activeResponses)} active response/interview stage(s), {metric(result.outcomes?.terminal)} terminal outcome(s).</p><Link href="/outcomes">Review outcomes →</Link></article>
        <article><p className={styles.kicker}>REVIEW QUEUE</p><h2>Human decisions remain explicit</h2><div className={styles.queue}>{Object.entries(result.reviewQueue ?? {}).map(([key, value]) => <span key={key}><strong>{value}</strong>{key.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase())}</span>)}</div><Link href="/command-center">Open Command Center →</Link></article>
      </section>}

      {localFallback && <section className={styles.grid}>
        <article><p className={styles.kicker}>NEXT</p><h2>Review resolved opportunities</h2><p>The local run has persisted verified job evidence. Rank and inspect it before preparing anything external.</p><Link href="/shortlist">Open Shortlist →</Link></article>
        <article><p className={styles.kicker}>APPLICATIONS</p><h2>Prepare from approved evidence</h2><p>Application packets remain reviewable artifacts. Work authorization, availability and other sensitive answers stay explicit.</p><Link href="/applications">Open Applications →</Link></article>
        <article><p className={styles.kicker}>CONTACTS</p><h2>Research only when useful</h2><p>Published business/recruiting contacts remain provenance-first and require acceptance before outreach drafting.</p><Link href="/contacts">Open Contacts →</Link></article>
      </section>}

      <section className={styles.boundary}><strong>Still manual:</strong><span>portfolio employer confirmation where needed, new-source trust, contact acceptance/rejection, exact outreach revision approval, Gmail draft creation, email sending, and final application submission.</span></section>
    </>}
  </main>;
}
