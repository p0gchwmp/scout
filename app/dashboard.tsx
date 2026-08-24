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
  provider: "greenhouse" | "lever" | "ashby" | "workable";
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
      const response = await fetch("/api/jobs", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, state }) });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Job update failed");
      await loadData();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Job update failed");
    } finally { setBusy(null); }
  }

  async function saveProfileField() {
    setBusy("profile:new");
    setError(""); setNotice("");
    try {
      const response = await fetch("/api/profile", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "upsert", ...newProfile }) });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Profile field save failed");
      setNewProfile({ kind: "full_name", claim: "", evidence: "" });
      setNotice("Profile evidence saved unverified. Verify it before Scout reuses it in application packets.");
      await loadData();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Profile field save failed"); }
    finally { setBusy(null); }
  }

  async function verifyProfileField(id: string, verified: boolean) {
    setBusy(`profile:${id}`);
    try {
      const response = await fetch("/api/profile", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "verify", id, verified }) });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Profile verification failed");
      await loadData();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Profile verification failed"); }
    finally { setBusy(null); }
  }

  async function prepareApplication(jobId: string) {
    setBusy(`apply:${jobId}`); setError(""); setNotice("");
    try {
      const response = await fetch("/api/applications", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "prepare", jobId }) });
      const payload = await response.json() as { application?: { status: string }; error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Application preparation failed");
      setNotice(`Application packet ${payload.application?.status === "ready_for_review" ? "is ready for your review" : "was prepared but still needs your input"}. No submission was attempted.`);
      await loadData();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Application preparation failed"); }
    finally { setBusy(null); }
  }

  async function refreshApplication(applicationId: string) {
    setBusy(`application:${applicationId}`); setError(""); setNotice("");
    try {
      const application = applications.find((item) => item.id === applicationId);
      if (!application) throw new Error("Application not found");
      const response = await fetch("/api/applications", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "refresh", id: applicationId, expectedVersion: application.artifactVersion }) });
      const payload = await response.json() as { application?: { status: string }; error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Application refresh failed");
      setNotice(`Application packet refreshed (${payload.application?.status ?? "unknown"}). No application was submitted.`);
      await loadData();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Application refresh failed"); }
    finally { setBusy(null); }
  }

  async function reviewContact(contactId: string, reviewState: "accepted" | "rejected") {
    setBusy(`contact:${contactId}`); setError(""); setNotice("");
    try {
      const response = await fetch("/api/contacts", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: contactId, reviewState }) });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Contact review failed");
      setNotice(reviewState === "accepted" ? "Contact evidence accepted for drafting. Nothing was sent." : "Contact evidence rejected and cannot be used for outreach.");
      await loadData();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Contact review failed"); }
    finally { setBusy(null); }
  }

  async function generateDraft(jobId: string, contactId: string) {
    const alignment = alignmentByJobId.get(jobId);
    const claimIds = [...new Set((alignment?.supportingClaims ?? []).flatMap((support) => support.claimIds))];
    setBusy(`draft:${jobId}`); setError(""); setNotice("");
    try {
      const response = await fetch("/api/outreach", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "generate", jobId, contactId, claimIds }) });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Draft generation failed");
      setNotice("Customized outreach draft created from the current job snapshot, accepted contact evidence, and exact approved role-relevant claims. Nothing was sent.");
      await loadData();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Draft generation failed"); }
    finally { setBusy(null); }
  }

  if (loading) return <main className="dashboard"><p>Loading Scout…</p></main>;

  return <main className="dashboard">
    <header className="hero">
      <div><p className="eyebrow">SCOUT · PRIVATE INTERNSHIP COPILOT</p><h1>Review evidence. Decide what moves.</h1><p>Discovery, provenance, resume alignment, application prep, and outreach drafts in one owner-only workspace.</p><p><a href="/inbox">Internship Inbox →</a> · <a href="/review">Review Queue →</a> · <a href="/assist">Safe Fill →</a> · <a href="/voice">Writing voice →</a></p></div>
      <aside><strong>Hard boundary</strong><span>Scout prepares. It does not submit applications or send email.</span></aside>
    </header>

    {error && <div className="alert error">{error}</div>}
    {notice && <div className="alert success">{notice}</div>}

    <nav className="tabs">{tabs.map((tab) => <button key={tab} className={activeTab === tab ? "active" : ""} onClick={() => setActiveTab(tab)}>{tab}</button>)}</nav>

    {activeTab === "Jobs" && <section>
      <div className="toolbar"><div className="segmented">{["Active", "Saved", "Closed", "All"].map((item) => <button key={item} className={filter === item ? "active" : ""} onClick={() => setFilter(item)}>{item}</button>)}</div><span>{visibleJobs.length} roles</span></div>
      {!hasResumeLens && <div className="alert">Resume match is unranked until you approve candidate claims in the Claims tab.</div>}
      <div className="grid">{visibleJobs.map((job) => {
        const alignment = alignmentByJobId.get(job.id)!;
        return <article className="card" key={job.id}>
          <div className="card-head"><span>{job.source}</span><strong className={`score band ${alignment.band}`}>{alignment.label}</strong></div>
          <h2>{job.title}</h2><p className="company">{job.company} · {job.location || "Location not specified"} · {job.workplaceType}</p>
          <p>{job.description.slice(0, 260)}{job.description.length > 260 ? "…" : ""}</p>
          <div className="chips">{alignment.eligibilityGaps.map((risk) => <span className="chip risk" key={risk}>{risk}</span>)}</div>
          <div className="match-box"><strong>Resume alignment</strong>{alignment.supportingClaims.length ? alignment.supportingClaims.map((support) => <p key={support.label}>{support.label}: {support.claimIds.join(", ")}</p>) : <p>{alignment.eligibilityGaps.length ? "No approved supporting claims matched this role yet." : "No approved resume claims configured yet."}</p>}</div>
          {alignment.caveats.length > 0 && <div className="chips">{alignment.caveats.map((item) => <span className="chip" key={item}>{item}</span>)}</div>}
          <div className="actions"><button disabled={busy === job.id} onClick={() => void updateJob(job.id, "saved")}>Save</button><button disabled={busy === job.id} onClick={() => void updateJob(job.id, "rejected")}>Reject</button><button disabled={busy === `apply:${job.id}` || !job.currentSnapshotId} onClick={() => void prepareApplication(job.id)}>Prepare application</button><a href={job.canonicalUrl} target="_blank" rel="noreferrer">Official posting</a></div>
        </article>;
      })}</div>
    </section>}

    {activeTab === "Apply" && <section><h2>Application action queue</h2><p className="section-intro">Scout prepares a conservative review packet from verified reusable profile fields and approved role-relevant claims. It never submits.</p><div className="grid">{applications.map((application) => <article className="card" key={application.id}><div className="card-head"><span>{String((application.submittedFields as Record<string, unknown>).platformLabel ?? "Application")}</span><strong className={`status ${application.status}`}>{application.status.replace(/_/g, " ")}</strong></div><h3>{application.job?.company} — {application.job?.title}</h3><p>{String((application.submittedFields as Record<string, unknown>).channelNote ?? "")}</p><p><strong>Verified fields:</strong> {Object.keys(((application.submittedFields as Record<string, unknown>).fields ?? {}) as object).join(", ") || "none"}</p><p><strong>Supporting claim IDs:</strong> {(((application.submittedFields as Record<string, unknown>).claimIds ?? []) as string[]).join(", ") || "none"}</p>{application.blockers.length > 0 && <div className="chips">{application.blockers.map((item) => <span className="chip risk" key={item}>{item}</span>)}</div>}<p><strong>Confirm manually:</strong> {(((application.submittedFields as Record<string, unknown>).confirmations ?? []) as string[]).join(" · ")}</p><div className="actions"><button disabled={busy === `application:${application.id}`} onClick={() => void refreshApplication(application.id)}>Refresh packet</button>{application.job?.canonicalUrl && <a href={application.job.canonicalUrl} target="_blank" rel="noreferrer">Open application</a>}</div><small>Artifact version {application.artifactVersion} · submission capability disabled</small></article>)}</div></section>}

    {activeTab === "Outreach" && <section><h2>Contact evidence + outreach drafts</h2><p className="section-intro">Accept only published business/recruiting evidence you trust. Drafts are then pinned to that evidence, the current job snapshot, and approved claim IDs.</p><div className="grid">{contacts.map((contact) => <article className="card" key={contact.id}><div className="card-head"><span>{contact.suitability}</span><strong className={`status ${contact.reviewState}`}>{contact.reviewState.replace(/_/g, " ")}</strong></div><h3>{contact.email}</h3><p>{contact.excerpt}</p><a href={contact.sourceUrl} target="_blank" rel="noreferrer">Evidence source</a><p>{contact.suitabilityReason}</p>{contact.reviewState === "needs_review" && <div className="actions"><button disabled={busy === `contact:${contact.id}`} onClick={() => void reviewContact(contact.id, "accepted")}>Accept evidence</button><button disabled={busy === `contact:${contact.id}`} onClick={() => void reviewContact(contact.id, "rejected")}>Reject</button></div>}{contact.reviewState === "accepted" && <button disabled={busy === `draft:${contact.jobId}`} onClick={() => void generateDraft(contact.jobId, contact.id)}>Create custom draft</button>}</article>)}</div>{drafts.map((draft) => { const revision = draft.revisions.at(-1); const parsed = revision ? gmailComposeUrl({ to: contacts.find((item) => item.id === revision.contactId)?.email ?? "", subject: revision.body.match(/^Subject:\s*(.+)$/m)?.[1] ?? "", body: revision.body.replace(/^To:.*\nSubject:.*\n\n/s, "") }) : "#"; return <article className="card draft" key={draft.id}><div className="card-head"><span>Draft</span><strong className={`status ${draft.state}`}>{draft.state}</strong></div><pre>{revision?.body ?? "No revision"}</pre><p><strong>Claim IDs:</strong> {revision?.claimIds.join(", ")}</p><div className="actions"><a href={parsed} target="_blank" rel="noreferrer">Open in Gmail</a></div></article>; })}</section>}

    {activeTab === "Profile" && <section><h2>Application profile evidence</h2><p className="section-intro">These are reusable form values, not inferred facts. New values stay unverified until you explicitly verify them.</p><div className="editor"><select value={newProfile.kind} onChange={(event) => setNewProfile((value) => ({ ...value, kind: event.target.value }))}>{profileOptions.map((kind) => <option key={kind}>{kind}</option>)}</select><input placeholder="Exact value" value={newProfile.claim} onChange={(event) => setNewProfile((value) => ({ ...value, claim: event.target.value }))} /><input placeholder="Evidence / where verified" value={newProfile.evidence} onChange={(event) => setNewProfile((value) => ({ ...value, evidence: event.target.value }))} /><button disabled={busy === "profile:new"} onClick={() => void saveProfileField()}>Save unverified</button></div><div className="grid">{profileFields.map((field) => <article className="card" key={field.id}><div className="card-head"><span>{field.kind}</span><strong className={`status ${field.verified ? "approved" : "draft"}`}>{field.verified ? "verified" : "unverified"}</strong></div><h3>{field.claim}</h3><p>{field.evidence}</p><button disabled={busy === `profile:${field.id}`} onClick={() => void verifyProfileField(field.id, !field.verified)}>{field.verified ? "Mark unverified" : "Verify"}</button></article>)}</div></section>}

    {activeTab === "Sources" && <section><h2>Controlled discovery sources</h2><div className="grid">{sources.map((source) => <article className="card" key={source.id}><div className="card-head"><span>{source.provider}</span><strong className={`status ${source.enabled ? "active" : "closed"}`}>{source.enabled ? "enabled" : "disabled"}</strong></div><h3>{source.companyName}</h3><p>{source.companyDomain}</p><a href={source.careersUrl ?? "#"} target="_blank" rel="noreferrer">Official careers source</a><button disabled={busy === source.id || !source.enabled} onClick={() => void syncSource(source)}>Sync now</button><div className="run-list">{runs.filter((run) => run.sourceId === source.id).slice(0, 3).map((run) => <small key={run.id}>{run.status} · {run.discoveredCount} found · {run.createdCount} new · {formatTimestamp(run.completedAt)}</small>)}</div></article>)}</div></section>}

    {activeTab === "Claims" && <section><h2>Candidate claims</h2><p className="section-intro">Only approved claims can support resume alignment, application preparation, or outreach. Draft edits use expected-version checks so stale browser state cannot overwrite newer decisions.</p><div className="editor claim-editor"><textarea placeholder="Claim statement" value={newClaim.statement} onChange={(event) => setNewClaim((value) => ({ ...value, statement: event.target.value }))} /><textarea placeholder="Evidence / source" value={newClaim.evidence} onChange={(event) => setNewClaim((value) => ({ ...value, evidence: event.target.value }))} /><button disabled={busy === "claim:new"} onClick={async () => { setBusy("claim:new"); try { const response = await fetch("/api/claims", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "create", ...newClaim }) }); const payload = await response.json() as { error?: string }; if (!response.ok) throw new Error(payload.error ?? "Claim creation failed"); setNewClaim({ statement: "", evidence: "" }); await loadData(); } catch (caught) { setError(caught instanceof Error ? caught.message : "Claim creation failed"); } finally { setBusy(null); } }}>Add draft claim</button></div><div className="grid">{claims.map((claim) => { const edit = claimEdits[claim.id] ?? { statement: claim.statement, evidence: claim.evidence }; const dirty = edit.statement !== claim.statement || edit.evidence !== claim.evidence; return <article className="card" key={claim.id}><div className="card-head"><span>v{claim.version}</span><strong className={`status ${claim.status}`}>{claim.status}</strong></div>{claim.status === "draft" ? <><textarea value={edit.statement} onChange={(event) => setClaimEdits((value) => ({ ...value, [claim.id]: { ...edit, statement: event.target.value } }))} /><textarea value={edit.evidence} onChange={(event) => setClaimEdits((value) => ({ ...value, [claim.id]: { ...edit, evidence: event.target.value } }))} /><div className="actions"><button disabled={!dirty || busy === `claim:${claim.id}`} onClick={async () => { setBusy(`claim:${claim.id}`); try { const response = await fetch("/api/claims", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "edit", id: claim.id, expectedVersion: claim.version, ...edit }) }); const payload = await response.json() as { error?: string }; if (!response.ok) throw new Error(payload.error ?? "Claim edit failed"); await loadData(); } catch (caught) { setError(caught instanceof Error ? caught.message : "Claim edit failed"); } finally { setBusy(null); } }}>Save edit</button><button disabled={dirty || busy === `claim:${claim.id}`} title={dirty ? "Save or discard edits before approval" : ""} onClick={async () => { setBusy(`claim:${claim.id}`); try { const response = await fetch("/api/claims", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "approve", id: claim.id, expectedVersion: claim.version }) }); const payload = await response.json() as { error?: string }; if (!response.ok) throw new Error(payload.error ?? "Claim approval failed"); await loadData(); } catch (caught) { setError(caught instanceof Error ? caught.message : "Claim approval failed"); } finally { setBusy(null); } }}>Approve</button><button disabled={busy === `claim:${claim.id}`} onClick={async () => { setBusy(`claim:${claim.id}`); try { const response = await fetch("/api/claims", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "reject", id: claim.id, expectedVersion: claim.version }) }); const payload = await response.json() as { error?: string }; if (!response.ok) throw new Error(payload.error ?? "Claim rejection failed"); await loadData(); } catch (caught) { setError(caught instanceof Error ? caught.message : "Claim rejection failed"); } finally { setBusy(null); } }}>Reject</button></div></> : <><h3>{claim.statement}</h3><p>{claim.evidence}</p><small>{claim.status === "approved" ? `Approved ${formatTimestamp(claim.approvedAt)}` : "Rejected — ignored by matching and drafting"}</small></>}</article>; })}</div></section>}
  </main>;
}
