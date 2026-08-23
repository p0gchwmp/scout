"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { evaluateResumeAlignment, type ResumeAlignment } from "../lib/scout/resume-alignment";
import { gmailComposeUrl } from "../lib/scout/gmail-compose";

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
  score: number;
  scoreExplanation: string[];
  eligibilityRisks: string[];
  state: "shortlisted" | "saved" | "rejected";
  lifecycleState: "active" | "closed";
  currentSnapshotId: string | null;
  lastSeenAt: string;
};

type Source = {
  id: string;
  provider: "greenhouse";
  companyName: string;
  companyDomain: string;
  careersUrl: string | null;
  enabled: boolean;
};

type ResumeClaim = {
  id: string;
  statement: string;
  evidence: string;
  status: "draft" | "approved" | "rejected";
  version: number;
  approvedAt: string | null;
  createdAt: string;
  updatedAt?: string;
};

type SyncRun = {
  id: string;
  sourceId: string;
  status: "running" | "completed" | "failed";
  discoveredCount: number;
  createdCount: number;
  updatedCount: number;
  closedCount: number;
  completedAt: string | null;
};

type ClaimEdit = Pick<ResumeClaim, "statement" | "evidence">;

type ProfileField = { id: string; kind: string; claim: string; evidence: string; verified: boolean; updatedAt: string };
type PreparedApplication = {
  id: string; jobId: string; status: string; blockers: string[]; submittedFields: Record<string, unknown>; artifactVersion: number;
  job: Job | null;
};
type ContactEvidence = { id: string; jobId: string; jobSnapshotId: string; email: string; sourceUrl: string; excerpt: string; suitability: string; suitabilityReason: string; reviewState: "needs_review" | "accepted" | "rejected" };
type OutreachRevision = { id: string; version: number; body: string; claimIds: string[]; contactId: string; jobSnapshotId: string };
type OutreachDraft = { id: string; jobId: string; state: "draft" | "approved" | "rejected"; revisions: OutreachRevision[] };

const profileOptions = [
  "full_name", "email", "phone", "current_location", "university", "program", "graduation_year",
  "linkedin_url", "github_url", "portfolio_url", "resume_reference",
] as const;

const tabs = ["Jobs", "Apply", "Outreach", "Profile", "Sources", "Claims"] as const;

function formatTimestamp(value: string | null | undefined) {
  if (!value) return "Not approved";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

export function Dashboard() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [sources, setSources] = useState<Source[]>([]);
  const [runs, setRuns] = useState<SyncRun[]>([]);
  const [claims, setClaims] = useState<ResumeClaim[]>([]);
  const [profileFields, setProfileFields] = useState<ProfileField[]>([]);
  const [applications, setApplications] = useState<PreparedApplication[]>([]);
  const [contacts, setContacts] = useState<ContactEvidence[]>([]);
  const [drafts, setDrafts] = useState<OutreachDraft[]>([]);
  const [newProfile, setNewProfile] = useState({ kind: "full_name", claim: "", evidence: "" });
  const [claimEdits, setClaimEdits] = useState<Record<string, ClaimEdit>>({});
  const [newClaim, setNewClaim] = useState<ClaimEdit>({ statement: "", evidence: "" });
  const [activeTab, setActiveTab] = useState<(typeof tabs)[number]>("Jobs");
  const [filter, setFilter] = useState("Active");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const loadData = useCallback(async () => {
    setError("");
    try {
      const [jobsResponse, sourcesResponse, claimsResponse, profileResponse, applicationsResponse, contactsResponse, outreachResponse] = await Promise.all([
        fetch("/api/jobs"), fetch("/api/sources"), fetch("/api/claims"), fetch("/api/profile"),
        fetch("/api/applications"), fetch("/api/contacts"), fetch("/api/outreach"),
      ]);
      const jobsPayload = await jobsResponse.json() as { jobs?: Job[]; error?: string };
      const sourcesPayload = await sourcesResponse.json() as { sources?: Source[]; recentRuns?: SyncRun[]; error?: string };
      const claimsPayload = await claimsResponse.json() as { claims?: ResumeClaim[]; error?: string };
      const profilePayload = await profileResponse.json() as { fields?: ProfileField[]; error?: string };
      const applicationsPayload = await applicationsResponse.json() as { applications?: PreparedApplication[]; error?: string };
      const contactsPayload = await contactsResponse.json() as { contacts?: ContactEvidence[]; error?: string };
      const outreachPayload = await outreachResponse.json() as { drafts?: OutreachDraft[]; error?: string };
      for (const [response, payload, label] of [[jobsResponse, jobsPayload, "jobs"], [sourcesResponse, sourcesPayload, "sources"], [claimsResponse, claimsPayload, "claims"], [profileResponse, profilePayload, "application profile"], [applicationsResponse, applicationsPayload, "application queue"], [contactsResponse, contactsPayload, "contacts"], [outreachResponse, outreachPayload, "outreach"]] as const) {
        if (!response.ok) throw new Error(payload.error ?? `Unable to load ${label}`);
      }

      const nextClaims = claimsPayload.claims ?? [];
      setJobs(jobsPayload.jobs ?? []);
      setSources(sourcesPayload.sources ?? []);
      setRuns(sourcesPayload.recentRuns ?? []);
      setClaims(nextClaims);
      setProfileFields(profilePayload.fields ?? []);
      setApplications(applicationsPayload.applications ?? []);
      setContacts(contactsPayload.contacts ?? []);
      setDrafts(outreachPayload.drafts ?? []);
      setClaimEdits(Object.fromEntries(nextClaims
        .filter((claim) => claim.status === "draft")
        .map((claim) => [claim.id, { statement: claim.statement, evidence: claim.evidence }])));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to load Scout data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadData(); }, 0);
    return () => window.clearTimeout(timer);
  }, [loadData]);

  const approvedClaims = useMemo(() => claims.filter((claim) => claim.status === "approved"), [claims]);
  const alignmentByJobId = useMemo(() => new Map(jobs.map((job) => [
    job.id,
    evaluateResumeAlignment(job, claims),
  ])), [jobs, claims]);
  const visibleJobs = useMemo(() => {
    const bandWeight: Record<ResumeAlignment["band"], number> = { strong: 3, partial: 2, stretch: 1, unranked: 0 };
    return jobs.filter((job) => {
      if (filter === "Active") return job.lifecycleState === "active" && job.state !== "rejected";
      if (filter === "Saved") return job.state === "saved";
      if (filter === "Closed") return job.lifecycleState === "closed";
      return true;
    }).sort((left, right) => bandWeight[alignmentByJobId.get(right.id)?.band ?? "unranked"] - bandWeight[alignmentByJobId.get(left.id)?.band ?? "unranked"]);
  }, [jobs, filter, alignmentByJobId]);
  const hasResumeLens = approvedClaims.length > 0;

  async function syncSource(source: Source) {
    setBusy(source.id);
    setNotice("");
    setError("");
    try {
      const idempotencyKey = `manual-${new Date().toISOString().slice(0, 13)}`;
      const response = await fetch("/api/sync", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sourceId: source.id, idempotencyKey }),
      });
      const payload = await response.json() as { run?: SyncRun; error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Sync failed");
      setNotice(`${source.companyName}: ${payload.run?.discoveredCount ?? 0} jobs observed; the same hourly key is safe to retry.`);
      await loadData();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Sync failed");
    } finally {
      setBusy(null);
    }
  }

  async function updateJob(id: string, state: "shortlisted" | "saved" | "rejected") {
    setBusy(id);
    try {
      const response = await fetch("/api/jobs", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, state }),
      });
      const payload = await response.json() as { job?: Job; error?: string };
      if (!response.ok || !payload.job) throw new Error(payload.error ?? "Update failed");
      setJobs((items) => items.map((job) => job.id === id ? payload.job! : job));
      setNotice(`Job marked ${state}. No application or message was sent.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Update failed");
    } finally {
      setBusy(null);
    }
  }

  async function extractContacts(job: Job) {
    setBusy(job.id);
    try {
      const response = await fetch("/api/contacts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jobId: job.id }),
      });
      const payload = await response.json() as { contacts?: unknown[]; error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Extraction failed");
      setNotice(`${payload.contacts?.length ?? 0} published business contact record(s) stored with provenance. Nothing was sent.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Extraction failed");
    } finally {
      setBusy(null);
    }
  }

  async function prepareApplication(job: Job) {
    setBusy(`apply-${job.id}`); setError("");
    try {
      const response = await fetch("/api/applications", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jobId: job.id }) });
      const payload = await response.json() as { application?: PreparedApplication; error?: string };
      if (!response.ok || !payload.application) throw new Error(payload.error ?? "Unable to prepare application");
      setNotice(payload.application.status === "ready_for_review" ? "Application packet prepared and ready for review. Nothing was submitted." : `Application packet prepared with ${payload.application.blockers.length} blocker(s). Nothing was submitted.`);
      await loadData(); setActiveTab("Apply");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to prepare application"); } finally { setBusy(null); }
  }

  async function saveProfileField() {
    if (!newProfile.claim.trim() || !newProfile.evidence.trim()) { setError("Profile value and evidence are required."); return; }
    setBusy("profile-save"); setError("");
    try {
      const response = await fetch("/api/profile", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(newProfile) });
      const payload = await response.json() as { field?: ProfileField; error?: string };
      if (!response.ok || !payload.field) throw new Error(payload.error ?? "Unable to save profile field");
      setNewProfile((value) => ({ ...value, claim: "", evidence: "" })); await loadData(); setNotice("Application profile field saved as unverified. Review and verify it before Scout reuses it.");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to save profile field"); } finally { setBusy(null); }
  }

  async function reviewProfileField(field: ProfileField, action: "verify" | "unverify") {
    setBusy(`profile-${field.id}`); setError("");
    try {
      const response = await fetch("/api/profile", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: field.id, action }) });
      const payload = await response.json() as { field?: ProfileField; error?: string };
      if (!response.ok || !payload.field) throw new Error(payload.error ?? "Unable to review profile field");
      await loadData(); setNotice(action === "verify" ? "Profile field verified for safe repeated form preparation." : "Profile field unverified; Scout will stop reusing it.");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to review profile field"); } finally { setBusy(null); }
  }

  async function reviewContact(contact: ContactEvidence, reviewState: ContactEvidence["reviewState"]) {
    setBusy(`contact-${contact.id}`); setError("");
    try {
      const response = await fetch("/api/contacts", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: contact.id, reviewState }) });
      const payload = await response.json() as { contact?: ContactEvidence; error?: string };
      if (!response.ok || !payload.contact) throw new Error(payload.error ?? "Unable to review contact");
      await loadData(); setNotice(`Contact marked ${reviewState}. Nothing was sent.`);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to review contact"); } finally { setBusy(null); }
  }

  async function createOutreachDraft(contact: ContactEvidence) {
    const job = jobs.find((item) => item.id === contact.jobId);
    const candidateName = profileFields.find((field) => field.kind === "full_name" && field.verified)?.claim;
    if (!job || !candidateName) { setError("A verified full_name profile field and matching job are required before drafting outreach."); return; }
    const alignment = alignmentByJobId.get(job.id);
    const claimIds = [...new Set(alignment?.supportingClaims.flatMap((support) => support.claimIds) ?? [])].slice(0, 3);
    if (!claimIds.length) { setError("No approved role-relevant claim IDs are available for this outreach draft."); return; }
    setBusy(`draft-${contact.id}`); setError("");
    try {
      const response = await fetch("/api/outreach", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jobId: job.id, contactId: contact.id, claimIds, candidateName }) });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Unable to create outreach draft");
      await loadData(); setNotice("Customized outreach draft created from the current job snapshot, accepted contact and exact approved claim IDs. Nothing was sent.");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to create outreach draft"); } finally { setBusy(null); }
  }

  async function createClaim() {
    const statement = newClaim.statement.trim();
    const evidence = newClaim.evidence.trim();
    if (!statement || !evidence) {
      setError("Claim statement and evidence are required.");
      return;
    }

    setBusy("new-claim");
    setError("");
    try {
      const response = await fetch("/api/claims", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ statement, evidence }),
      });
      const payload = await response.json() as { claim?: ResumeClaim; error?: string };
      if (!response.ok || !payload.claim) throw new Error(payload.error ?? "Unable to create claim");
      setClaims((items) => [payload.claim!, ...items]);
      setClaimEdits((items) => ({ ...items, [payload.claim!.id]: { statement: payload.claim!.statement, evidence: payload.claim!.evidence } }));
      setNewClaim({ statement: "", evidence: "" });
      setNotice("Draft claim created. It will not affect resume alignment or outreach until you approve it.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to create claim");
    } finally {
      setBusy(null);
    }
  }

  async function mutateClaim(claim: ResumeClaim, action: "edit" | "approve" | "reject") {
    const busyKey = `claim-${claim.id}-${action}`;
    const edit = claimEdits[claim.id] ?? { statement: claim.statement, evidence: claim.evidence };
    setBusy(busyKey);
    setError("");
    try {
      const response = await fetch("/api/claims", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(action === "edit"
          ? { id: claim.id, action, expectedVersion: claim.version, statement: edit.statement, evidence: edit.evidence }
          : { id: claim.id, action, expectedVersion: claim.version }),
      });
      const payload = await response.json() as { claim?: ResumeClaim; error?: string };
      if (response.status === 409) {
        await loadData();
        setError("That claim changed before this action completed. Scout refreshed the latest version; review it before retrying.");
        return;
      }
      if (!response.ok || !payload.claim) throw new Error(payload.error ?? "Unable to update claim");

      setClaims((items) => items.map((item) => item.id === claim.id ? payload.claim! : item));
      if (payload.claim.status === "draft") {
        setClaimEdits((items) => ({ ...items, [claim.id]: { statement: payload.claim!.statement, evidence: payload.claim!.evidence } }));
      } else {
        setClaimEdits((items) => {
          const next = { ...items };
          delete next[claim.id];
          return next;
        });
      }
      setNotice(action === "edit"
        ? `Draft claim saved as version ${payload.claim.version}.`
        : `Claim ${action === "approve" ? "approved" : "rejected"}. ${action === "approve" ? "The approved version can now support resume alignment and drafts." : "Rejected claims are ignored by resume alignment."}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to update claim");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="Scout home"><span className="brand-mark">S</span><span>Scout</span></a>
        <nav className="main-nav" aria-label="Primary navigation">
          {tabs.map((tab) => <button key={tab} className={activeTab === tab ? "nav-active" : ""} onClick={() => setActiveTab(tab)}>{tab}</button>)}
        </nav>
        <div className="header-actions"><span className="sync-dot"><i /> Persisted D1 data</span><button className="avatar" aria-label="Local MVP">MVP</button></div>
      </header>

      <main id="top">
        <section className="hero">
          <div>
            <p className="eyebrow">CONTROLLED DISCOVERY · {hasResumeLens ? "APPROVED RESUME LENS" : "PROVENANCE FIRST"}</p>
            <h1>{hasResumeLens ? <>Resume evidence,<br /><em>without invented fit.</em></> : <>Observed openings,<br /><em>not personalized rankings.</em></>}</h1>
            <p className="hero-copy">{hasResumeLens ? <>Scout compares posting text only with approved resume claims, shows the exact claim IDs behind each evidence theme and calls out unsupported requirements. Alignment is not proof of eligibility. <strong>It cannot send messages or apply.</strong></> : <>Scout currently reads only registered Greenhouse boards and keeps immutable job snapshots. Jobs remain explicitly unranked until approved resume claims are configured. <strong>It cannot send messages or apply.</strong></>}</p>
          </div>
          <div className="hero-stats" aria-label="Current persisted summary">
            <div><span>{jobs.filter((job) => job.lifecycleState === "active").length}</span><p>active jobs</p></div>
            <div><span>{sources.filter((source) => source.enabled).length}</span><p>enabled sources</p></div>
            <div><span>{hasResumeLens ? approvedClaims.length : runs.filter((run) => run.status === "completed").length}</span><p>{hasResumeLens ? "approved claims" : "recent syncs"}</p></div>
          </div>
        </section>

        {notice && <div className="notice" role="status"><span>✓</span>{notice}<button onClick={() => setNotice("")} aria-label="Dismiss notification">×</button></div>}
        {error && <div className="notice error-notice" role="alert"><span>!</span>{error}<button onClick={() => setError("")} aria-label="Dismiss error">×</button></div>}

        {activeTab === "Jobs" && <>
          <section className="control-strip" aria-label="Job filters"><div className="filters">{["Active", "Saved", "Closed", "All"].map((item) => <button key={item} className={filter === item ? "filter-active" : ""} onClick={() => setFilter(item)}>{item}</button>)}</div><div className="batch-actions"><span>{visibleJobs.length} persisted result(s)</span></div></section>
          <section className="queue-heading"><div><p className="section-kicker">CURRENT DATABASE</p><h2>{hasResumeLens ? "Resume-aware shortlist" : "Discovered jobs"}</h2></div><p>{hasResumeLens ? "Evidence overlap · exact claim IDs · explicit gaps" : "Composite source identity · versioned snapshots · lifecycle tracking"}</p></section>
          <section className="job-list" aria-label="Persisted jobs">
            {loading && <div className="empty-state">Loading persisted jobs…</div>}
            {!loading && !visibleJobs.length && <div className="empty-state">No jobs match this view. Register a Greenhouse source in D1, then sync it from the Sources tab.</div>}
            {visibleJobs.map((job) => {
              const alignment = alignmentByJobId.get(job.id)!;
              return <article className="job-card" key={job.id}>
                <div className="company-logo">{job.company.slice(0, 2).toUpperCase()}</div>
                <div className="job-main">
                  <div className="job-title-row"><div><p className="company-name">{job.company}</p><h3>{job.title}</h3></div><span className={`sync-dot alignment-${alignment.band}`}>{alignment.label}</span></div>
                  <p className="job-meta"><span>⌖</span>{job.location || "Location unspecified"}<b>·</b>{job.workplaceType}<b>·</b>{job.source}<b>·</b>{job.lifecycleState}</p>
                  <div className="reason-row">{hasResumeLens ? <>
                    {alignment.supportingClaims.map((support) => <span className="reason" key={support.theme}>✓ {support.theme}<small>Claims: {support.claimIds.join(", ")}</small></span>)}
                    {alignment.gaps.map((risk) => <span className="risk" key={risk}>! {risk}</span>)}
                    <span className="alignment-basis">Based on {alignment.basis}</span>
                  </> : <>
                    {job.scoreExplanation.map((reason) => <span className="reason" key={reason}>✓ {reason}</span>)}
                    {job.eligibilityRisks.map((risk) => <span className="risk" key={risk}>! {risk}</span>)}
                  </>}</div>
                  {hasResumeLens && <p className="alignment-caveat">Not checked: {alignment.notChecked.join(" · ")}. Review the official posting before treating alignment as eligibility.</p>}
                </div>
                <div className="card-actions"><button className="primary-action" disabled={busy === `apply-${job.id}` || !job.currentSnapshotId} onClick={() => void prepareApplication(job)}>Prepare application</button><button className="ghost-action" disabled={busy === job.id || !job.currentSnapshotId} onClick={() => void extractContacts(job)}>Extract contacts</button><button className="ghost-action" disabled={busy === job.id} onClick={() => void updateJob(job.id, job.state === "saved" ? "shortlisted" : "saved")}>{job.state === "saved" ? "Unsave" : "Save"}</button><button className="ghost-action" disabled={busy === job.id} onClick={() => void updateJob(job.id, "rejected")}>Reject</button><a className="details-link" href={job.canonicalUrl} target="_blank" rel="noreferrer">Stored official URL ↗</a></div>
              </article>;
            })}
          </section>
        </>}

        {activeTab === "Apply" && <>
          <section className="queue-heading"><div><p className="section-kicker">APPLICATION PREP QUEUE</p><h2>Prepare once, reuse safely</h2></div><p>{applications.length} prepared packet(s) · no submission worker enabled</p></section>
          <section className="source-list">
            {!applications.length && <div className="empty-state">No application packets yet. Use “Prepare application” on a job. Scout will classify the site, reuse only verified profile fields and pin approved claim IDs.</div>}
            {applications.map((application) => { const packet = application.submittedFields as { channel?: { label?: string; automation?: string; note?: string }; claimIds?: string[]; safeFields?: Record<string, string>; alwaysConfirmPerApplication?: string[]; applicationUrl?: string }; return <article className="source-card" key={application.id}><div><p className="company-name">{packet.channel?.label ?? "Application"} · {application.status}</p><h3>{application.job?.company} — {application.job?.title}</h3><p>{packet.channel?.note}</p><small>Packet v{application.artifactVersion} · {Object.keys(packet.safeFields ?? {}).length} verified reusable field(s) · Claims: {(packet.claimIds ?? []).join(", ") || "none"}</small>{application.blockers.length > 0 && <div className="reason-row">{application.blockers.map((blocker) => <span className="risk" key={blocker}>! {blocker}</span>)}</div>}<p className="alignment-caveat">Per-application confirmation remains required for: {(packet.alwaysConfirmPerApplication ?? []).join(" · ")}</p></div><div className="card-actions"><button className="primary-action" disabled={!application.job || busy === `apply-${application.jobId}`} onClick={() => application.job && void prepareApplication(application.job)}>Refresh packet</button><a className="details-link" href={packet.applicationUrl ?? application.job?.canonicalUrl ?? "#"} target="_blank" rel="noreferrer">Open application ↗</a></div></article>; })}
          </section>
        </>}

        {activeTab === "Profile" && <>
          <section className="queue-heading"><div><p className="section-kicker">REUSABLE APPLICATION PROFILE</p><h2>Verified autofill facts</h2></div><p>{profileFields.filter((field) => field.verified).length} verified field(s)</p></section>
          <section className="claim-composer"><div><p className="section-kicker">ADD / UPDATE</p><h3>Save a reusable application field</h3><p>New or edited values are unverified until you explicitly verify them. Verified fields must be unverified before editing.</p></div><label>Field<select value={newProfile.kind} onChange={(event) => setNewProfile((value) => ({ ...value, kind: event.target.value }))}>{profileOptions.map((option) => <option key={option} value={option}>{option}</option>)}</select></label><label>Value<textarea value={newProfile.claim} onChange={(event) => setNewProfile((value) => ({ ...value, claim: event.target.value }))} placeholder="Exact value Scout may reuse" /></label><label>Evidence / source<textarea value={newProfile.evidence} onChange={(event) => setNewProfile((value) => ({ ...value, evidence: event.target.value }))} placeholder="Where this value came from or how you verified it" /></label><button className="primary-action" disabled={busy === "profile-save"} onClick={() => void saveProfileField()}>Save unverified</button></section>
          <section className="claim-list">{profileFields.map((field) => <article className={`claim-card ${field.verified ? "claim-approved" : "claim-draft"}`} key={field.id}><div className="claim-card-head"><div><span className={`claim-status ${field.verified ? "status-approved" : "status-draft"}`}>{field.verified ? "verified" : "unverified"}</span><code className="claim-id">{field.kind}</code></div></div><div className="claim-readonly"><span>Value</span><p>{field.claim}</p></div><div className="claim-readonly"><span>Evidence</span><p>{field.evidence}</p></div><div className="claim-actions"><button className={field.verified ? "danger-action" : "primary-action"} disabled={busy === `profile-${field.id}`} onClick={() => void reviewProfileField(field, field.verified ? "unverify" : "verify")}>{field.verified ? "Unverify to edit" : "Verify for reuse"}</button></div></article>)}</section>
        </>}

        {activeTab === "Outreach" && <>
          <section className="queue-heading"><div><p className="section-kicker">PROVENANCE + CUSTOM DRAFTING</p><h2>Recruiter outreach</h2></div><p>{contacts.filter((contact) => contact.reviewState === "accepted").length} accepted contact(s) · {drafts.length} draft record(s)</p></section>
          <section className="source-list">
            {!contacts.length && <div className="empty-state">No public business contacts have been extracted yet. Extract from a stored posting first; broader official contact-page discovery is the next adapter layer.</div>}
            {contacts.map((contact) => { const job = jobs.find((item) => item.id === contact.jobId); return <article className="source-card" key={contact.id}><div><p className="company-name">{contact.reviewState} · {contact.suitability}</p><h3>{contact.email}</h3><p>{job ? `${job.company} — ${job.title}` : "Pinned job"}</p><small>{contact.excerpt}</small><a className="details-link" href={contact.sourceUrl} target="_blank" rel="noreferrer">Evidence source ↗</a></div><div className="card-actions">{contact.reviewState === "needs_review" && <><button className="primary-action" onClick={() => void reviewContact(contact, "accepted")}>Accept evidence</button><button className="danger-action" onClick={() => void reviewContact(contact, "rejected")}>Reject</button></>}{contact.reviewState === "accepted" && <button className="primary-action" disabled={busy === `draft-${contact.id}`} onClick={() => void createOutreachDraft(contact)}>Create customized draft</button>}</div></article>; })}
          </section>
          <section className="claim-list">{drafts.map((draft) => { const latest = draft.revisions.at(-1); const job = jobs.find((item) => item.id === draft.jobId); let gmailUrl = "#"; try { if (latest) gmailUrl = gmailComposeUrl(latest.body); } catch { gmailUrl = "#"; } return <article className={`claim-card claim-${draft.state}`} key={draft.id}><div className="claim-card-head"><div><span className={`claim-status status-${draft.state}`}>{draft.state}</span><code className="claim-id">{job ? `${job.company} / ${job.title}` : draft.id}</code></div></div>{latest && <><div className="claim-readonly"><span>Customized email</span><pre className="draft-preview">{latest.body}</pre></div><p className="claim-note">Pinned claims: {latest.claimIds.join(", ")}. Opening Gmail pre-fills a compose window; Scout still does not send.</p><div className="claim-actions"><a className="primary-action" href={gmailUrl} target="_blank" rel="noreferrer">Open in Gmail</a></div></>}</article>; })}</section>
        </>}

        {activeTab === "Sources" && <>
          <section className="queue-heading"><div><p className="section-kicker">ALLOWLISTED REGISTRY</p><h2>Greenhouse sources</h2></div><p>Board tokens are never accepted by the sync endpoint.</p></section>
          <section className="source-list">
            {loading && <div className="empty-state">Loading registered sources…</div>}
            {!loading && !sources.length && <div className="empty-state">No controlled sources are registered. Add one directly to <code>company_sources</code> using the validated README procedure.</div>}
            {sources.map((source) => {
              const latest = runs.find((run) => run.sourceId === source.id);
              return <article className="source-card" key={source.id}><div><p className="company-name">{source.provider.toUpperCase()}</p><h3>{source.companyName}</h3><p>{source.companyDomain} · persisted posting content only</p><small>{latest ? `Last run: ${latest.status} · ${latest.discoveredCount} observed` : "Never synced"}</small></div><button className="primary-action" disabled={!source.enabled || busy === source.id} onClick={() => void syncSource(source)}>{busy === source.id ? "Syncing…" : "Sync registered source"}</button></article>;
            })}
          </section>
        </>}

        {activeTab === "Claims" && <>
          <section className="queue-heading"><div><p className="section-kicker">APPROVAL-BOUND EVIDENCE</p><h2>Candidate claims</h2></div><p>{approvedClaims.length} approved · {claims.filter((claim) => claim.status === "draft").length} draft · {claims.filter((claim) => claim.status === "rejected").length} rejected</p></section>

          <section className="claim-composer" aria-label="Create draft resume claim">
            <div><p className="section-kicker">NEW DRAFT</p><h3>Add an evidence-backed claim</h3><p>New claims start as drafts and are ignored by alignment and outreach until explicitly approved.</p></div>
            <label>Claim statement<textarea value={newClaim.statement} maxLength={1000} onChange={(event) => setNewClaim((value) => ({ ...value, statement: event.target.value }))} placeholder="A precise claim Scout may eventually use." /></label>
            <label>Evidence<textarea value={newClaim.evidence} maxLength={4000} onChange={(event) => setNewClaim((value) => ({ ...value, evidence: event.target.value }))} placeholder="Artifact, source, scope, or evidence supporting the statement." /></label>
            <button className="primary-action" disabled={busy === "new-claim"} onClick={() => void createClaim()}>{busy === "new-claim" ? "Creating…" : "Create draft"}</button>
          </section>

          <section className="claim-list" aria-label="Candidate claims">
            {loading && <div className="empty-state">Loading candidate claims…</div>}
            {!loading && !claims.length && <div className="empty-state">No candidate claims exist yet. Add a draft above, review its wording and evidence, then approve it only when it is accurate.</div>}
            {claims.map((claim) => {
              const edit = claimEdits[claim.id] ?? { statement: claim.statement, evidence: claim.evidence };
              const isDraft = claim.status === "draft";
              const isDirty = isDraft && (edit.statement.trim() !== claim.statement || edit.evidence.trim() !== claim.evidence);
              const claimBusy = busy?.startsWith(`claim-${claim.id}-`) === true;
              return <article className={`claim-card claim-${claim.status}`} key={claim.id}>
                <div className="claim-card-head">
                  <div><span className={`claim-status status-${claim.status}`}>{claim.status}</span><code className="claim-id">{claim.id}</code></div>
                  <p>Version {claim.version} · {claim.status === "approved" ? `Approved ${formatTimestamp(claim.approvedAt)}` : `Created ${formatTimestamp(claim.createdAt)}`}</p>
                </div>

                {isDraft ? <>
                  <label>Statement<textarea maxLength={1000} value={edit.statement} onChange={(event) => setClaimEdits((items) => ({ ...items, [claim.id]: { ...edit, statement: event.target.value } }))} /></label>
                  <label>Evidence<textarea maxLength={4000} value={edit.evidence} onChange={(event) => setClaimEdits((items) => ({ ...items, [claim.id]: { ...edit, evidence: event.target.value } }))} /></label>
                  <div className="claim-actions">
                    <button className="ghost-action" disabled={claimBusy || !isDirty} onClick={() => void mutateClaim(claim, "edit")}>{isDirty ? "Save draft" : "Draft saved"}</button>
                    <button className="primary-action" disabled={claimBusy || isDirty} onClick={() => void mutateClaim(claim, "approve")}>{isDirty ? "Save before approval" : `Approve version ${claim.version}`}</button>
                    <button className="danger-action" disabled={claimBusy} onClick={() => void mutateClaim(claim, "reject")}>Reject</button>
                  </div>
                  <p className="claim-note">Approval is version-bound. If this claim changes elsewhere first, Scout will return a conflict and refresh instead of overwriting it.</p>
                </> : <>
                  <div className="claim-readonly"><span>Statement</span><p>{claim.statement}</p></div>
                  <div className="claim-readonly"><span>Evidence</span><p>{claim.evidence}</p></div>
                  <p className="claim-note">{claim.status === "approved" ? "Immutable approved evidence. This exact version may support role alignment and outreach drafts." : "Rejected and immutable. Scout ignores this claim for role alignment and outreach drafts."}</p>
                </>}
              </article>;
            })}
          </section>
        </>}

        <section className="safety-panel">
          <div className="safety-icon">◎</div><div><p className="section-kicker">SAFE OUTREACH GATE</p><h2>Scout knows when to stop.</h2><p>Application packets reuse only verified profile fields and approved claims. Contact evidence still requires provenance and explicit acceptance; customized email drafts remain pinned to approved evidence.</p></div>
          <div className="safety-steps"><span className="done">1 <b>Discover</b></span><i /><span className="done">2 <b>Prepare</b></span><i /><span>3 <b>Draft</b></span><i /><span>4 <b>Review</b></span></div>
        </section>
      </main>
      <footer><span>SCOUT / INTERNSHIP ACTION QUEUE</span><p>Application preparation + customized Gmail compose. No autonomous submit or send worker enabled.</p><span>MULTI-SITE PREP</span></footer>
    </div>
  );
}
