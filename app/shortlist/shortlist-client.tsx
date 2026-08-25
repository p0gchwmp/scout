"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ROLE_FAMILIES, type RoleFamilyId } from "../../lib/scout/role-taxonomy";
import { evaluateShortlist, type ShortlistAssessment } from "../../lib/scout/shortlist-intelligence";
import styles from "./shortlist.module.css";

type Job = {
  id: string;
  company: string;
  title: string;
  description: string;
  location: string;
  workplaceType: string;
  source: string;
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

type Contact = {
  id: string;
  jobId: string;
  reviewState: "needs_review" | "accepted" | "rejected";
};

type RankedJob = { job: Job; assessment: ShortlistAssessment };
type Filter = "All" | "High priority" | "India" | "Remote" | "Shortlisted" | "Saved";
type FamilyFilter = "all" | RoleFamilyId;

const filters: Filter[] = ["All", "High priority", "India", "Remote", "Shortlisted", "Saved"];

function formatDate(value: string | null) {
  if (!value) return "Date unavailable";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "Date unavailable" : parsed.toLocaleDateString();
}

export function ShortlistWorkspace() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [claims, setClaims] = useState<Claim[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [filter, setFilter] = useState<Filter>("All");
  const [familyFilter, setFamilyFilter] = useState<FamilyFilter>("all");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const [jobsResponse, claimsResponse, contactsResponse] = await Promise.all([
        fetch("/api/jobs"),
        fetch("/api/claims"),
        fetch("/api/contacts"),
      ]);
      const jobsPayload = await jobsResponse.json() as { jobs?: Job[]; error?: string };
      const claimsPayload = await claimsResponse.json() as { claims?: Claim[]; error?: string };
      const contactsPayload = await contactsResponse.json() as { contacts?: Contact[]; error?: string };
      if (!jobsResponse.ok) throw new Error(jobsPayload.error ?? "Unable to load jobs");
      if (!claimsResponse.ok) throw new Error(claimsPayload.error ?? "Unable to load claims");
      if (!contactsResponse.ok) throw new Error(contactsPayload.error ?? "Unable to load contacts");
      setJobs(jobsPayload.jobs ?? []);
      setClaims(claimsPayload.claims ?? []);
      setContacts(contactsPayload.contacts ?? []);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to load shortlist");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const ranked = useMemo<RankedJob[]>(() => jobs
    .filter((job) => job.lifecycleState === "active" && job.state !== "rejected")
    .map((job) => ({ job, assessment: evaluateShortlist(job, claims) }))
    .sort((left, right) => {
      if (right.assessment.score !== left.assessment.score) return right.assessment.score - left.assessment.score;
      const rightPosted = Date.parse(right.job.postedAt ?? "") || 0;
      const leftPosted = Date.parse(left.job.postedAt ?? "") || 0;
      return rightPosted - leftPosted || left.job.company.localeCompare(right.job.company);
    }), [jobs, claims]);

  const visible = useMemo(() => ranked.filter(({ job, assessment }) => {
    const text = `${job.company} ${job.title} ${job.location} ${job.description}`.toLowerCase();
    if (query.trim() && !text.includes(query.trim().toLowerCase())) return false;
    if (familyFilter !== "all" && assessment.roleFamilyId !== familyFilter) return false;
    if (filter === "High priority") return assessment.priority === "high";
    if (filter === "India") return assessment.locationContext === "India";
    if (filter === "Remote") return assessment.locationTags.includes("Remote");
    if (filter === "Shortlisted") return job.state === "shortlisted";
    if (filter === "Saved") return job.state === "saved";
    return true;
  }), [ranked, filter, familyFilter, query]);

  const summary = useMemo(() => ({
    high: ranked.filter(({ assessment }) => assessment.priority === "high").length,
    india: ranked.filter(({ assessment }) => assessment.locationContext === "India").length,
    remote: ranked.filter(({ assessment }) => assessment.locationTags.includes("Remote")).length,
    shortlisted: ranked.filter(({ job }) => job.state === "shortlisted").length,
  }), [ranked]);

  async function updateJob(jobId: string, state: Job["state"]) {
    setBusy(`job:${jobId}`); setError(""); setNotice("");
    try {
      const response = await fetch("/api/jobs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: jobId, state }),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Unable to update job");
      setNotice(state === "shortlisted" ? "Role shortlisted." : state === "saved" ? "Role saved for later." : "Role rejected and removed from the active shortlist.");
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to update job");
    } finally { setBusy(null); }
  }

  async function prepareApplication(jobId: string) {
    setBusy(`apply:${jobId}`); setError(""); setNotice("");
    try {
      const response = await fetch("/api/applications", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jobId }),
      });
      const payload = await response.json() as { application?: { status?: string }; error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Unable to prepare application");
      setNotice(`Application packet prepared (${payload.application?.status ?? "review required"}). Nothing was submitted.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to prepare application");
    } finally { setBusy(null); }
  }

  async function researchContact(jobId: string) {
    setBusy(`contact:${jobId}`); setError(""); setNotice("");
    try {
      const response = await fetch("/api/contacts/research", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jobId }),
      });
      const payload = await response.json() as { added?: number; contacts?: Contact[]; researchReason?: string; error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Unable to research contacts");
      setNotice(`${payload.added ?? 0} new public contact candidate(s) saved for review. ${payload.researchReason ?? ""}`.trim());
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to research contacts");
    } finally { setBusy(null); }
  }

  if (loading) return <main className={styles.shell}><p>Loading shortlist intelligence…</p></main>;

  return <main className={styles.shell}>
    <header className={styles.header}>
      <div>
        <p className={styles.kicker}>SCOUT / SHORTLIST INTELLIGENCE</p>
        <h1>Broad prospects. Evidence-backed ranking.</h1>
        <p>Product, analytics, business, finance, operations, research and technical-systems roles are first-class lanes. Pure software development stays visible as a stretch preference rather than being hidden.</p>
      </div>
      <div className={styles.headerLinks}><Link href="/inbox">Internship Inbox</Link><Link href="/">Dashboard</Link></div>
    </header>

    {notice && <div className={styles.notice}>{notice}</div>}
    {error && <div className={`${styles.notice} ${styles.error}`}>{error}</div>}

    <section className={styles.summary}>
      <div><strong>{ranked.length}</strong><span>Active roles</span></div>
      <div><strong>{summary.high}</strong><span>High priority</span></div>
      <div><strong>{summary.shortlisted}</strong><span>Shortlisted</span></div>
      <div><strong>{summary.india}</strong><span>India context</span></div>
      <div><strong>{summary.remote}</strong><span>Remote</span></div>
    </section>

    <section className={styles.controls}>
      <div className={styles.filters}>{filters.map((item) => <button key={item} className={filter === item ? styles.active : ""} onClick={() => setFilter(item)}>{item}</button>)}</div>
      <div className={styles.controlFields}>
        <select aria-label="Filter by role family" value={familyFilter} onChange={(event) => setFamilyFilter(event.target.value as FamilyFilter)}>
          <option value="all">All role families</option>
          {ROLE_FAMILIES.map((family) => <option key={family.id} value={family.id}>{family.shortLabel}</option>)}
        </select>
        <input aria-label="Search roles" placeholder="Search company, role, location…" value={query} onChange={(event) => setQuery(event.target.value)} />
      </div>
    </section>

    <section className={styles.list}>
      {!visible.length && <div className={styles.empty}>No roles match this view.</div>}
      {visible.map(({ job, assessment }, index) => {
        const contactCount = contacts.filter((contact) => contact.jobId === job.id && contact.reviewState !== "rejected").length;
        return <article className={styles.card} key={job.id}>
          <div className={styles.rank}>#{index + 1}</div>
          <div className={styles.topline}>
            <div>
              <p className={styles.company}>{job.company}</p>
              <h2>{job.title}</h2>
              <p className={styles.meta}>{job.location || "Location unspecified"} · {job.workplaceType || "workplace unspecified"} · {job.source}</p>
            </div>
            <div className={`${styles.priority} ${styles[assessment.priority]}`}><strong>{assessment.score}</strong><span>{assessment.label}</span></div>
          </div>

          <div className={styles.context}>
            <span className={styles.roleFamily}>{assessment.roleFamilyLabel}</span>
            <span>{assessment.preferenceLabel}</span>
            {assessment.sectorTags.map((tag) => <span key={tag}>{tag}</span>)}
            {assessment.locationTags.map((tag) => <span key={tag}>{tag}</span>)}
            <span>{assessment.freshnessLabel}</span>
            <span>{job.currentSnapshotId ? "Official snapshot" : "Needs official snapshot"}</span>
          </div>

          <div className={styles.why}><strong>Why this is worth your time</strong><p>{assessment.whyWorthYourTime}</p></div>

          <div className={styles.columns}>
            <div><strong>Evidence supporting the fit</strong>{assessment.alignment.supportingClaims.length ? assessment.alignment.supportingClaims.map((support) => <p key={support.theme}>{support.theme}: <code>{support.claimIds.join(", ")}</code></p>) : <p>No approved supporting claims matched yet.</p>}</div>
            <div><strong>Gaps / checks</strong>{assessment.gaps.length ? assessment.gaps.map((gap) => <p className={styles.gap} key={gap}>{gap}</p>) : <p>No explicit eligibility gap detected by current rules.</p>}<p className={styles.caveat}>Still confirm work authorization, availability and any application-specific legal questions yourself.</p></div>
          </div>

          <p className={styles.description}>{job.description.slice(0, 320)}{job.description.length > 320 ? "…" : ""}</p>
          <div className={styles.footerMeta}><span>Posted: {formatDate(job.postedAt)}</span><span>{contactCount ? `${contactCount} contact candidate(s)` : "No reviewed contact candidate yet"}</span><span>State: {job.state}</span></div>

          <div className={styles.actions}>
            <button className={styles.primary} disabled={busy === `job:${job.id}`} onClick={() => void updateJob(job.id, "shortlisted")}>Shortlist</button>
            <button disabled={busy === `job:${job.id}`} onClick={() => void updateJob(job.id, "saved")}>Save</button>
            <button disabled={busy === `apply:${job.id}` || !job.currentSnapshotId} onClick={() => void prepareApplication(job.id)}>Prepare application</button>
            <button disabled={busy === `contact:${job.id}` || !job.currentSnapshotId} onClick={() => void researchContact(job.id)}>{contactCount ? "Refresh contact research" : "Research contact"}</button>
            <a href={job.canonicalUrl} target="_blank" rel="noreferrer">Official posting ↗</a>
            <button className={styles.reject} disabled={busy === `job:${job.id}`} onClick={() => void updateJob(job.id, "rejected")}>Reject</button>
          </div>
        </article>;
      })}
    </section>

    <footer className={styles.boundary}>Scout ranks and prepares. It does not send email or submit applications.</footer>
  </main>;
}
