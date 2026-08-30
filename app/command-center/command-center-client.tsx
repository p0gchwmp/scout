"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  buildCommandJobItem,
  ecosystemLeadNextAction,
  sortCommandJobs,
  summarizeCommandJobs,
  type CommandEcosystemLead,
  type CommandJobItem,
  type CommandPriority,
} from "../../lib/scout/opportunity-command-center";
import { assessOpportunityFit } from "../../lib/scout/opportunity-fit";
import { assessOpportunityQuality } from "../../lib/scout/opportunity-quality-intelligence";
import styles from "./command-center.module.css";

type Job = {
  id: string;
  sourceRegistryId: string | null;
  company: string;
  title: string;
  description: string;
  location: string;
  workplaceType: string;
  source: string;
  canonicalUrl: string;
  postedAt?: string | null;
  lastSeenAt?: string | null;
  state: "shortlisted" | "saved" | "rejected";
  lifecycleState: "active" | "closed";
  currentSnapshotId: string | null;
};

type Source = {
  id: string;
  provider: string;
  companyName: string;
  companyDomain: string;
  careersUrl: string | null;
  enabled: boolean;
};

type Application = { id: string; jobId: string; status: string; artifactVersion: number };
type Contact = { id: string; jobId: string; reviewState: "needs_review" | "accepted" | "rejected" };
type Draft = { id: string; jobId: string; state: "draft" | "approved" | "rejected"; approvedRevisionId?: string | null };
type EcosystemMetadata = {
  sources: Array<{ id: string; name: string; institutionType: string; directRecruitingTarget: boolean }>;
  adjacentLanes: string[];
};
type EcosystemDiscovery = {
  enabled: boolean;
  leads: CommandEcosystemLead[];
  failures?: Array<{ queryId?: string; reason?: string }>;
  persistedSearchResults?: boolean;
  createdTargets?: number;
  researchedTargets?: number;
  candidatesStored?: number;
  rejectedWrongPurpose?: number;
  safety?: { sendEmail?: boolean; submitApplication?: boolean; requiresHumanReview?: boolean };
  reason?: string;
};

type Filter = "attention" | "A" | "B" | "C" | "parked" | "all";

function label(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

function priorityClass(priority: CommandPriority) {
  if (priority === "A") return styles.priorityA;
  if (priority === "B") return styles.priorityB;
  if (priority === "C") return styles.priorityC;
  return styles.parked;
}

export function OpportunityCommandCenter() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [sources, setSources] = useState<Source[]>([]);
  const [applications, setApplications] = useState<Application[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [ecosystem, setEcosystem] = useState<EcosystemMetadata>({ sources: [], adjacentLanes: [] });
  const [ecosystemLeads, setEcosystemLeads] = useState<CommandEcosystemLead[]>([]);
  const [filter, setFilter] = useState<Filter>("attention");
  const [loading, setLoading] = useState(true);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const [jobsResponse, sourcesResponse, applicationsResponse, contactsResponse, draftsResponse, ecosystemResponse] = await Promise.all([
        fetch("/api/jobs"),
        fetch("/api/sources"),
        fetch("/api/applications"),
        fetch("/api/contacts"),
        fetch("/api/outreach"),
        fetch("/api/ecosystem"),
      ]);
      const jobsPayload = await jobsResponse.json() as { jobs?: Job[]; error?: string };
      const sourcesPayload = await sourcesResponse.json() as { sources?: Source[]; error?: string };
      const applicationsPayload = await applicationsResponse.json() as { applications?: Application[]; error?: string };
      const contactsPayload = await contactsResponse.json() as { contacts?: Contact[]; error?: string };
      const draftsPayload = await draftsResponse.json() as { drafts?: Draft[]; error?: string };
      const ecosystemPayload = await ecosystemResponse.json() as EcosystemMetadata & { error?: string };
      for (const [response, payload, name] of [
        [jobsResponse, jobsPayload, "jobs"],
        [sourcesResponse, sourcesPayload, "sources"],
        [applicationsResponse, applicationsPayload, "applications"],
        [contactsResponse, contactsPayload, "contacts"],
        [draftsResponse, draftsPayload, "outreach"],
        [ecosystemResponse, ecosystemPayload, "ecosystem registry"],
      ] as const) {
        if (!response.ok) throw new Error(payload.error ?? `Unable to load ${name}`);
      }
      setJobs(jobsPayload.jobs ?? []);
      setSources(sourcesPayload.sources ?? []);
      setApplications(applicationsPayload.applications ?? []);
      setContacts(contactsPayload.contacts ?? []);
      setDrafts(draftsPayload.drafts ?? []);
      setEcosystem({ sources: ecosystemPayload.sources ?? [], adjacentLanes: ecosystemPayload.adjacentLanes ?? [] });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to load Scout command center");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const queue = useMemo(() => {
    const sourceById = new Map(sources.map((source) => [source.id, source]));
    const applicationByJobId = new Map(applications.map((application) => [application.jobId, application]));
    const contactStatesByJobId = new Map<string, string[]>();
    for (const contact of contacts) {
      const current = contactStatesByJobId.get(contact.jobId) ?? [];
      current.push(contact.reviewState);
      contactStatesByJobId.set(contact.jobId, current);
    }
    const draftStatesByJobId = new Map<string, string[]>();
    for (const draft of drafts) {
      const current = draftStatesByJobId.get(draft.jobId) ?? [];
      current.push(draft.state);
      draftStatesByJobId.set(draft.jobId, current);
    }

    const items: CommandJobItem[] = jobs
      .filter((job) => job.lifecycleState === "active" && job.state !== "rejected")
      .map((job) => {
        const source = job.sourceRegistryId ? sourceById.get(job.sourceRegistryId) ?? null : null;
        const quality = assessOpportunityQuality(job, source ? { ...source, registered: true } : null);
        const fit = assessOpportunityFit(job, quality);
        return buildCommandJobItem({
          id: job.id,
          company: job.company,
          title: job.title,
          state: job.state,
          lifecycleState: job.lifecycleState,
          currentSnapshotId: job.currentSnapshotId,
          canonicalUrl: job.canonicalUrl,
          priority: fit.priority,
          priorityLabel: fit.priorityLabel,
          qualityLabel: quality.label,
          applicationStatus: applicationByJobId.get(job.id)?.status ?? null,
          contactStates: contactStatesByJobId.get(job.id) ?? [],
          draftStates: draftStatesByJobId.get(job.id) ?? [],
        });
      });
    return sortCommandJobs(items);
  }, [jobs, sources, applications, contacts, drafts]);

  const visibleQueue = useMemo(() => queue.filter((item) => {
    if (filter === "all") return true;
    if (filter === "attention") return item.nextAction.urgency >= 68;
    return item.priority === filter;
  }), [queue, filter]);
  const summary = useMemo(() => summarizeCommandJobs(queue), [queue]);

  async function runEcosystemAction(action: "discover" | "seed_recruiting_targets" | "research_public_contacts") {
    setBusyAction(action);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/ecosystem", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const payload = await response.json() as EcosystemDiscovery & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Ecosystem action failed");
      if (action === "discover") {
        setEcosystemLeads(payload.leads ?? []);
        if (!payload.enabled) {
          setNotice(payload.reason ?? "Ecosystem search is disabled. No provider configuration was changed.");
        } else {
          setNotice(`${payload.leads?.length ?? 0} ecosystem lead(s) found for this review session. Raw search results stay ephemeral; only resolved official evidence should be promoted into Scout.`);
        }
      } else if (action === "seed_recruiting_targets") {
        setNotice(`${payload.createdTargets ?? 0} official ecosystem recruiting target(s) added to the existing Company Outreach review flow. No contact was accepted and nothing was sent.`);
      } else {
        setNotice(`Researched ${payload.researchedTargets ?? 0} ecosystem target(s). ${payload.candidatesStored ?? 0} public recruiting/business contact candidate(s) were stored as needs_review; ${payload.rejectedWrongPurpose ?? 0} wrong-purpose inbox(es) were rejected.`);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Ecosystem action failed");
    } finally {
      setBusyAction(null);
    }
  }

  async function createGmailDraft(draftId: string) {
    setBusyAction(`gmail:${draftId}`);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/agent/create-gmail-draft", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ draftId }),
      });
      const payload = await response.json() as { gmailDraft?: { draftId?: string; reused?: boolean }; error?: string; bindingIssues?: string[] };
      if (!response.ok || !payload.gmailDraft) throw new Error(payload.error ?? "Unable to create Gmail draft");
      setNotice(payload.gmailDraft.reused
        ? `Existing Gmail draft reused (${payload.gmailDraft.draftId ?? "unknown"}). Nothing was sent.`
        : `Gmail draft created (${payload.gmailDraft.draftId ?? "unknown"}) after approved-revision freshness checks. Nothing was sent.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to create Gmail draft");
    } finally {
      setBusyAction(null);
    }
  }

  if (loading) return <main className={styles.shell}><p>Loading Scout command center…</p></main>;

  return <main className={styles.shell}>
    <header className={styles.hero}>
      <div>
        <p className={styles.kicker}>SCOUT / OPPORTUNITY COMMAND CENTER</p>
        <h1>One queue. One safest next move.</h1>
        <p>Persisted internships, M7 fit intelligence, application readiness, contact/outreach state, and M13 capital-ecosystem leads—without turning review into autonomous action.</p>
        <nav className={styles.links}><Link href="/">Dashboard</Link><Link href="/quality">Quality</Link><Link href="/readiness">Readiness</Link><Link href="/review">Review</Link><Link href="/company-outreach">Company outreach</Link></nav>
      </div>
      <aside><strong>Human execution boundary</strong><span>Scout can research public recruiting evidence and create Gmail drafts after exact outreach approval. It still cannot send email or submit applications.</span></aside>
    </header>

    {notice && <div className={styles.notice}>{notice}</div>}
    {error && <div className={`${styles.notice} ${styles.error}`}>{error}</div>}

    <section className={styles.metrics} aria-label="Opportunity queue summary">
      <article><span>Active queue</span><strong>{summary.total}</strong></article>
      <article><span>Priority A</span><strong>{summary.priorityA}</strong></article>
      <article><span>Evidence gaps</span><strong>{summary.needsEvidence}</strong></article>
      <article><span>Application review</span><strong>{summary.applicationReview}</strong></article>
      <article><span>Contact review</span><strong>{summary.contactReview}</strong></article>
      <article><span>Parked</span><strong>{summary.parked}</strong></article>
    </section>

    <section className={styles.section}>
      <div className={styles.sectionHead}>
        <div><p className={styles.kicker}>PERSISTED OPPORTUNITIES</p><h2>Decision queue</h2></div>
        <div className={styles.filters}>{(["attention", "A", "B", "C", "parked", "all"] as Filter[]).map((value) => <button className={filter === value ? styles.activeFilter : ""} key={value} onClick={() => setFilter(value)}>{value === "attention" ? "Attention first" : value === "all" ? "All" : value === "parked" ? "Parked" : `Priority ${value}`}</button>)}</div>
      </div>
      {!visibleQueue.length && <div className={styles.empty}>No active opportunities in this view.</div>}
      <div className={styles.queue}>{visibleQueue.map((item) => <article className={styles.card} key={item.id}>
        <div className={styles.cardTop}>
          <div><span className={`${styles.priority} ${priorityClass(item.priority)}`}>{item.priority === "parked" ? "Parked" : `Priority ${item.priority}`}</span><span className={styles.meta}>{item.qualityLabel}</span></div>
          <span className={styles.stage}>{label(item.stage)}</span>
        </div>
        <h3>{item.title}</h3>
        <p className={styles.company}>{item.company}</p>
        <p className={styles.reason}>{item.nextAction.reason}</p>
        <div className={styles.actions}>
          <Link className={styles.primary} href={item.nextAction.href}>{item.nextAction.label}</Link>
          {drafts.find((draft) => draft.jobId === item.id && draft.state === "approved" && draft.approvedRevisionId) && <button className={styles.secondary} disabled={busyAction !== null} onClick={() => {
            const approved = drafts.find((draft) => draft.jobId === item.id && draft.state === "approved" && draft.approvedRevisionId);
            if (approved) void createGmailDraft(approved.id);
          }}>{busyAction?.startsWith("gmail:") ? "Creating Gmail draft…" : "Create Gmail draft"}</button>}
          <a className={styles.secondary} href={item.canonicalUrl} target="_blank" rel="noreferrer">Official posting ↗</a>
        </div>
      </article>)}</div>
    </section>

    <section className={styles.section}>
      <div className={styles.sectionHead}>
        <div><p className={styles.kicker}>CAPITAL + STARTUP ECOSYSTEM</p><h2>M13 discovery, now visible</h2></div>
        <div className={styles.actions}>
          <button className={styles.primaryButton} disabled={busyAction !== null} onClick={() => void runEcosystemAction("discover")}>{busyAction === "discover" ? "Searching…" : "Search ecosystem surfaces"}</button>
          <button className={styles.secondary} disabled={busyAction !== null} onClick={() => void runEcosystemAction("seed_recruiting_targets")}>{busyAction === "seed_recruiting_targets" ? "Preparing…" : "Prepare recruiting targets"}</button>
          <button className={styles.secondary} disabled={busyAction !== null} onClick={() => void runEcosystemAction("research_public_contacts")}>{busyAction === "research_public_contacts" ? "Researching…" : "Research public contacts"}</button>
          <Link className={styles.secondary} href="/company-outreach">Personalize outreach</Link>
        </div>
      </div>
      <p className={styles.sectionCopy}>The registry currently contains {ecosystem.sources.length} bootstrap sources across VC, accelerators and startup networks. Scout can research bounded public recruiting/business channels and feed accepted evidence into claim-backed personalized outreach. Raw search hits remain review-only until official provenance is resolved; portfolio boards remain leads until the actual employer posting is verified.</p>
      {!ecosystemLeads.length && <div className={styles.empty}>Run discovery when you want a fresh review session. Scout keeps raw search-index hits ephemeral, but resolved official job/contact evidence can be persisted in the existing evidence and outreach workflows.</div>}
      <div className={styles.queue}>{ecosystemLeads.map((lead) => {
        const next = ecosystemLeadNextAction(lead);
        return <article className={styles.card} key={lead.url}>
          <div className={styles.cardTop}><div><span className={styles.ecosystemTag}>{label(lead.sourceMode)}</span><span className={styles.meta}>{lead.lane ? label(lead.lane) : "Ecosystem"}</span></div><span className={styles.stage}>{lead.sourceName}</span></div>
          <h3>{lead.title}</h3>
          {lead.description && <p className={styles.reason}>{lead.description}</p>}
          <p className={styles.reason}><strong>Next:</strong> {next.reason}</p>
          <div className={styles.actions}><a className={styles.primary} href={next.href} target="_blank" rel="noreferrer">{next.label} ↗</a>{lead.sourceMode === "direct_institution" && <Link className={styles.secondary} href="/evidence">Open evidence workspace</Link>}{lead.sourceMode === "ecosystem_index_lead" && <Link className={styles.secondary} href="/sources">Review sources</Link>}</div>
        </article>;
      })}</div>
      <div className={styles.lanes}><strong>Adjacent lanes</strong><span>{ecosystem.adjacentLanes.map(label).join(" · ")}</span></div>
    </section>
  </main>;
}
