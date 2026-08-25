"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { assessApplicationReadiness } from "../../../lib/scout/application-readiness";
import { buildApplicationProgress } from "../../../lib/scout/application-progress";
import { assessFollowUp } from "../../../lib/scout/follow-up-intelligence";
import { assessOpportunityQuality, type OpportunityQualitySource } from "../../../lib/scout/opportunity-quality-intelligence";
import {
  buildPreferenceCalibration,
  parsePreferenceFeedback,
  PREFERENCE_STORAGE_KEY,
  type PreferenceFeedback,
} from "../../../lib/scout/preference-calibration";
import { buildRoleDecisionSummary } from "../../../lib/scout/role-decision-cockpit";
import { evaluateShortlist } from "../../../lib/scout/shortlist-intelligence";
import styles from "./role-cockpit.module.css";

type Job = {
  id: string;
  company: string;
  title: string;
  description: string;
  location: string;
  workplaceType: string;
  source: string;
  sourceRegistryId: string | null;
  canonicalUrl: string;
  state: "shortlisted" | "saved" | "rejected";
  lifecycleState: "active" | "closed";
  currentSnapshotId: string | null;
  postedAt: string | null;
  lastSeenAt: string;
  eligibilityRisks: string[];
};

type Claim = {
  id: string;
  statement: string;
  evidence: string;
  status: "draft" | "approved" | "rejected";
};

type ProfileField = {
  id: string;
  kind: string;
  claim: string;
  evidence: string;
  verified: boolean;
  updatedAt?: string;
};

type Application = {
  id: string;
  jobId: string;
  status: string;
  blockers: string[];
  artifactVersion: number;
  submittedAt: string | null;
  confirmationUrl: string | null;
};

type Contact = {
  id: string;
  jobId: string;
  email: string;
  sourceUrl: string;
  excerpt: string;
  sourceType: string;
  suitability: string;
  reviewState: "needs_review" | "accepted" | "rejected";
};

type DraftRevision = {
  id: string;
  version: number;
  jobSnapshotId: string;
  contactId: string;
  claimIds: string[];
  body: string;
};

type Draft = {
  id: string;
  jobId: string;
  state: "draft" | "approved" | "rejected";
  revisions?: DraftRevision[];
};

type Source = OpportunityQualitySource & { registered: boolean; enabled: boolean };

function formatDate(value: string | null | undefined) {
  if (!value) return "Not recorded";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

function qualityMeta(status: string) {
  if (status === "explicit_paid") return "Pay/stipend published";
  if (status === "explicit_unpaid") return "Explicitly unpaid";
  if (status === "commission_only") return "Commission-only";
  if (status === "mentioned") return "Compensation mentioned";
  return "Compensation not published";
}

export function RoleDecisionCockpit({ jobId }: { jobId: string }) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [claims, setClaims] = useState<Claim[]>([]);
  const [profileFields, setProfileFields] = useState<ProfileField[]>([]);
  const [applications, setApplications] = useState<Application[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [sources, setSources] = useState<Source[]>([]);
  const [preferenceFeedback, setPreferenceFeedback] = useState<PreferenceFeedback[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setError("");
    const responses = await Promise.all([
      fetch("/api/jobs"),
      fetch("/api/claims"),
      fetch("/api/profile"),
      fetch("/api/applications"),
      fetch("/api/contacts"),
      fetch("/api/outreach"),
      fetch("/api/sources"),
    ]);
    const [jobsPayload, claimsPayload, profilePayload, applicationsPayload, contactsPayload, draftsPayload, sourcesPayload] = await Promise.all(responses.map((response) => response.json())) as [
      { jobs?: Job[]; error?: string },
      { claims?: Claim[]; error?: string },
      { fields?: ProfileField[]; error?: string },
      { applications?: Application[]; error?: string },
      { contacts?: Contact[]; error?: string },
      { drafts?: Draft[]; error?: string },
      { sources?: Source[]; error?: string },
    ];
    const payloads = [jobsPayload, claimsPayload, profilePayload, applicationsPayload, contactsPayload, draftsPayload, sourcesPayload];
    const failed = responses.findIndex((response) => !response.ok);
    if (failed >= 0) throw new Error(payloads[failed].error ?? "Unable to load role cockpit data");
    setJobs(jobsPayload.jobs ?? []);
    setClaims(claimsPayload.claims ?? []);
    setProfileFields(profilePayload.fields ?? []);
    setApplications(applicationsPayload.applications ?? []);
    setContacts(contactsPayload.contacts ?? []);
    setDrafts(draftsPayload.drafts ?? []);
    setSources(sourcesPayload.sources ?? []);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load().catch((caught) => setError(caught instanceof Error ? caught.message : "Unable to load role cockpit")).finally(() => setLoading(false));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try { setPreferenceFeedback(parsePreferenceFeedback(window.localStorage.getItem(PREFERENCE_STORAGE_KEY))); }
      catch { setPreferenceFeedback([]); }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const model = useMemo(() => {
    const job = jobs.find((item) => item.id === jobId);
    if (!job) return null;
    const now = new Date();
    const calibration = buildPreferenceCalibration(jobs, preferenceFeedback);
    const fit = evaluateShortlist(job, claims, now, calibration);
    const source = job.sourceRegistryId ? sources.find((item) => item.id === job.sourceRegistryId) ?? null : null;
    const quality = assessOpportunityQuality(job, source, now);
    const readiness = assessApplicationReadiness({ job, profileFields, claims });
    const application = applications.find((item) => item.jobId === job.id) ?? null;
    const jobContacts = contacts.filter((item) => item.jobId === job.id);
    const jobDrafts = drafts.filter((item) => item.jobId === job.id);
    const progress = buildApplicationProgress({ job, application, contacts: jobContacts, drafts: jobDrafts });
    const followUp = assessFollowUp({ job, application, contacts: jobContacts, drafts: jobDrafts, now });
    const decision = buildRoleDecisionSummary({
      fit: { score: fit.score, label: fit.label, gaps: fit.gaps, supportingClaimIds: fit.supportingClaimIds },
      quality: { score: quality.score, label: quality.label, tier: quality.tier, flags: quality.flags.map((flag) => ({ severity: flag.severity, label: flag.label })) },
      preference: { points: fit.learnedPreferencePoints, label: fit.learnedPreferenceLabel, signalCount: fit.learnedPreferenceSignalCount },
      readiness: { score: readiness.score, label: readiness.label, status: readiness.status, blockers: readiness.blockers },
      progress: { summary: progress.summary, externallySubmitted: progress.externallySubmitted, nextAction: progress.nextAction },
      followUp: { bucket: followUp.bucket, label: followUp.label, reason: followUp.reason, deadline: followUp.deadline ? { label: followUp.deadline.label, raw: followUp.deadline.raw } : null },
    });
    return { job, fit, quality, readiness, application, jobContacts, jobDrafts, progress, followUp, decision, source };
  }, [applications, claims, contacts, drafts, jobId, jobs, preferenceFeedback, profileFields, sources]);

  if (loading) return <main className={styles.shell}><p>Loading role decision cockpit…</p></main>;
  if (error) return <main className={styles.shell}><div className={styles.error}>{error}</div><Link href="/shortlist">Back to Shortlist</Link></main>;
  if (!model) return <main className={styles.shell}><div className={styles.error}>Role not found in Scout’s current job set.</div><Link href="/shortlist">Back to Shortlist</Link></main>;

  const { job, fit, quality, readiness, application, jobContacts, jobDrafts, progress, followUp, decision, source } = model;
  const latestDraft = jobDrafts.at(0) ?? null;
  const latestRevision = latestDraft?.revisions?.at(-1) ?? null;

  return <main className={styles.shell}>
    <header className={styles.header}>
      <div>
        <p className={styles.kicker}>SCOUT / ROLE DECISION COCKPIT</p>
        <p className={styles.company}>{job.company}</p>
        <h1>{job.title}</h1>
        <p className={styles.meta}>{job.location || "Location unspecified"} · {job.workplaceType || "Workplace unspecified"} · {job.source}</p>
      </div>
      <div className={styles.headerLinks}><Link href="/shortlist">Shortlist</Link><Link href="/applications">Applications</Link><Link href="/quality">Quality</Link><Link href="/evidence">Evidence</Link></div>
    </header>

    <section className={styles.decision}>
      <div><span>ROLE STATE</span><strong>{followUp.label}</strong><p>{decision.headline}</p></div>
      <div><span>WHAT NEXT</span><strong>{progress.summary}</strong>{progress.nextAction.kind !== "none" && <Link href={progress.nextAction.href}>{progress.nextAction.label} →</Link>}</div>
    </section>

    {decision.attention.length > 0 && <section className={styles.attention}><strong>Attention before the next move</strong>{decision.attention.map((item) => <p key={item}>{item}</p>)}</section>}

    <section className={styles.axes} aria-label="Independent role decision axes">
      <article><span>FIT</span><strong>{fit.score}</strong><h2>{fit.label}</h2><p>{fit.roleFamilyLabel} · {fit.preferenceLabel}</p><small>{fit.supportingClaimIds.length} approved supporting claim(s) · {fit.gaps.length} explicit gap(s)</small></article>
      <article className={quality.tier === "red_flag" ? styles.riskAxis : ""}><span>OPPORTUNITY QUALITY</span><strong>{quality.score}</strong><h2>{quality.label}</h2><p>{quality.evidenceLabel}</p><small>{quality.flags.length} quality flag(s) · {qualityMeta(quality.compensation.status)}</small></article>
      <article><span>PREFERENCE</span><strong>{fit.learnedPreferencePoints > 0 ? `+${fit.learnedPreferencePoints}` : fit.learnedPreferencePoints}</strong><h2>{fit.learnedPreferenceLabel}</h2><p>{fit.learnedPreferenceSignalCount} family-specific signal(s)</p><small>Soft nudge only; evidence and eligibility remain authoritative.</small></article>
      <article><span>APPLICATION READINESS</span><strong>{readiness.score}</strong><h2>{readiness.label}</h2><p>{readiness.profileSummary}</p><small>{readiness.blockers.length} blocker(s) · packet {application ? `v${application.artifactVersion}` : "not prepared"}</small></article>
    </section>

    <section className={styles.grid}>
      <article className={styles.panel}>
        <div className={styles.panelHead}><span>FIT EVIDENCE</span><Link href="/evidence">Evidence workspace →</Link></div>
        {fit.alignment.supportingClaims.length ? fit.alignment.supportingClaims.map((support) => <div className={styles.row} key={support.theme}><strong>{support.theme}</strong><code>{support.claimIds.join(", ")}</code></div>) : <p>No approved supporting claims matched this role yet.</p>}
        {fit.gaps.length > 0 && <div className={styles.warning}><strong>Explicit gaps</strong>{fit.gaps.map((gap) => <p key={gap}>{gap}</p>)}</div>}
        <p className={styles.caveat}>Not checked automatically: {fit.alignment.notChecked.join(", ")}.</p>
      </article>

      <article className={styles.panel}>
        <div className={styles.panelHead}><span>OPPORTUNITY EVIDENCE</span><Link href="/quality">Quality workspace →</Link></div>
        <div className={styles.row}><strong>Official snapshot</strong><span>{quality.officialSnapshot ? "Captured" : "Missing"}</span></div>
        <div className={styles.row}><strong>Registered source</strong><span>{quality.registeredSource ? quality.provider : "Not bound"}</span></div>
        <div className={styles.row}><strong>Company domain</strong><span>{quality.companyDomain ?? "Not verified in source record"}</span></div>
        <div className={styles.row}><strong>Compensation</strong><span>{qualityMeta(quality.compensation.status)}</span></div>
        <div className={styles.row}><strong>Duration</strong><span>{quality.duration ?? "Not published"}</span></div>
        <div className={styles.row}><strong>Arrangement</strong><span>{quality.arrangement}</span></div>
        {quality.flags.length > 0 && <div className={styles.warning}><strong>Quality flags</strong>{quality.flags.map((flag) => <p key={`${flag.code}:${flag.evidence}`}><b>{flag.label}:</b> {flag.evidence}</p>)}</div>}
        {source?.careersUrl && <a href={source.careersUrl} target="_blank" rel="noreferrer">Official source / careers page ↗</a>}
      </article>

      <article className={styles.panel}>
        <div className={styles.panelHead}><span>APPLICATION + DEADLINE</span><Link href="/applications">Application workspace →</Link></div>
        <div className={styles.row}><strong>Queue</strong><span>{followUp.label} · {followUp.reason}</span></div>
        <div className={styles.row}><strong>Freshness</strong><span>{followUp.freshness.label}</span></div>
        <div className={styles.row}><strong>Submission</strong><span>{progress.externallySubmitted ? `Recorded ${formatDate(application?.submittedAt)}` : "Not recorded"}</span></div>
        <div className={styles.row}><strong>Readiness</strong><span>{readiness.label}</span></div>
        {followUp.deadline ? <div className={styles.deadline}><strong>{followUp.deadline.label}</strong><p>{followUp.deadline.raw}</p><small>Only from immutable official job evidence.</small></div> : <p className={styles.caveat}>No explicit official application deadline is currently available.</p>}
        {readiness.blockers.length > 0 && <div className={styles.warning}><strong>Readiness blockers</strong>{readiness.blockers.map((blocker) => <p key={blocker}>{blocker}</p>)}</div>}
      </article>

      <article className={styles.panel}>
        <div className={styles.panelHead}><span>CONTACT + OUTREACH</span><Link href="/review">Review queue →</Link></div>
        <div className={styles.row}><strong>Contact evidence</strong><span>{jobContacts.length} candidate(s)</span></div>
        <div className={styles.row}><strong>Accepted contacts</strong><span>{jobContacts.filter((contact) => contact.reviewState === "accepted").length}</span></div>
        <div className={styles.row}><strong>Outreach</strong><span>{latestDraft ? latestDraft.state : "No draft"}</span></div>
        {jobContacts.slice(0, 3).map((contact) => <div className={styles.contact} key={contact.id}><strong>{contact.email}</strong><span>{contact.reviewState} · {contact.sourceType}</span><p>{contact.excerpt}</p><a href={contact.sourceUrl} target="_blank" rel="noreferrer">Provenance ↗</a></div>)}
        {latestRevision && <div className={styles.draft}><strong>Latest draft evidence</strong><p>Revision {latestRevision.version} · snapshot <code>{latestRevision.jobSnapshotId}</code></p><p>Claims: <code>{latestRevision.claimIds.join(", ")}</code></p></div>}
        <p className={styles.caveat}>Scout may prepare reviewed outreach; it does not send it.</p>
      </article>
    </section>

    <section className={styles.timeline}>
      <div className={styles.panelHead}><span>ROLE PROGRESS</span><span>Evidence-backed stages</span></div>
      {progress.stages.map((stage) => <div className={`${styles.stage} ${styles[stage.state]}`} key={stage.id}><span className={styles.dot} /><div><strong>{stage.label}</strong><p>{stage.detail}</p></div></div>)}
    </section>

    <section className={styles.description}>
      <div className={styles.panelHead}><span>PERSISTED ROLE DESCRIPTION</span><a href={job.canonicalUrl} target="_blank" rel="noreferrer">Official posting ↗</a></div>
      <p>{job.description || "No persisted description available."}</p>
      <footer>Last observed: {formatDate(job.lastSeenAt)} · Posted: {formatDate(job.postedAt)} · State: {job.state} / {job.lifecycleState}</footer>
    </section>

    <footer className={styles.boundary}>{decision.boundary} No application submission or email send capability is enabled here.</footer>
  </main>;
}
