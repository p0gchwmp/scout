"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "./setup.module.css";

type ProfileField = { id: string; kind: string; claim: string; evidence: string; verified: boolean; updatedAt: string };
type Claim = { id: string; statement: string; evidence: string; status: "draft" | "approved" | "rejected"; version: number };
type Job = { id: string; state: string; lifecycleState: string };
type Application = { id: string; status: string };
type Contact = { id: string; reviewState: string };
type Draft = { id: string; state: string };

const requiredProfileKinds = [
  "full_name",
  "email",
  "current_location",
  "university",
  "program",
  "resume_reference",
] as const;
const profileDisplayKinds = [...requiredProfileKinds, "graduation_year"] as const;

const starterProfile = [
  {
    kind: "full_name",
    claim: "Ryan Vivek Mahajan",
    evidence: "Ryan-provided Scout profile. Verify this exact reusable value before application use.",
  },
  {
    kind: "university",
    claim: "Indian Institute of Management Sambalpur",
    evidence: "Ryan-provided Scout profile. Verify the official institution wording before application use.",
  },
  {
    kind: "program",
    claim: "Bachelor of Science (B.S.) in Management and Public Policy",
    evidence: "Starter value from Ryan-provided project context. Verify the exact official degree wording before application use.",
  },
  {
    kind: "graduation_year",
    claim: "2028 (B.S. exit) / 2029 (B.S. Honours with Research)",
    evidence: "Starter value from Ryan-provided project context. Confirm the applicable graduation path against official academic documentation for each application.",
  },
] as const;

const starterClaims = [
  {
    statement: "I am pursuing the Bachelor of Science (B.S.) in Management and Public Policy at IIM Sambalpur; the B.S. exit award is available in 2028, with B.S. (Honours with Research) in 2029.",
    evidence: "Ryan-provided degree-path context. Verify against official academic documentation before approval.",
  },
  {
    statement: "At GMC Jammu, I worked on adverse-drug-reaction data review, technical documentation, and antibiotic price desk research.",
    evidence: "Ryan-provided GMC Jammu scope. Approve only against the relevant internship/project documentation; do not add outcomes or metrics that are not evidenced.",
  },
  {
    statement: "I prepared the pilot design and materials for a hand-hygiene project; fieldwork was planned/resuming rather than completed.",
    evidence: "Ryan-provided hand-hygiene scope boundary. This wording intentionally does not claim completed fieldwork or results.",
  },
  {
    statement: "For Aastha clinic/CMS work, I contributed product direction and design plus AI-assisted implementation rather than claiming sole manual coding.",
    evidence: "Ryan-provided Aastha implementation boundary. Review against the actual project artifacts before approval.",
  },
  {
    statement: "I built a Node.js, Express, and SQLite clinic-operations prototype covering workflow mapping, edge cases, and automated tests.",
    evidence: "Ryan-provided clinic operations prototype scope. Review the repository/tests before approval and do not infer production deployment or business outcomes.",
  },
  {
    statement: "For Scout, I worked on product requirements, the safety model, and prototype validation; Scout does not autonomously submit applications or send outreach.",
    evidence: "Scout repository and Ryan-provided scope boundary. Review current repository artifacts before approval.",
  },
  {
    statement: "My project work gives me practical familiarity with APIs, databases, workflows, automation, AI-assisted systems, testing, product architecture, and technical requirements without claiming professional full-stack engineering experience.",
    evidence: "Cross-project capability summary constrained to Ryan-provided Aastha, clinic prototype, and Scout evidence. Review supporting projects before approval.",
  },
] as const;

function humanize(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

async function jsonResponse<T>(response: Response, fallback: string): Promise<T> {
  const payload = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(payload.error ?? fallback);
  return payload;
}

export function SetupWorkspace() {
  const [profile, setProfile] = useState<ProfileField[]>([]);
  const [claims, setClaims] = useState<Claim[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [applications, setApplications] = useState<Application[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [email, setEmail] = useState("");
  const [currentLocation, setCurrentLocation] = useState("");
  const [resumeReference, setResumeReference] = useState("");
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setError("");
    try {
      const [profileResponse, claimsResponse, jobsResponse, applicationsResponse, contactsResponse, draftsResponse] = await Promise.all([
        fetch("/api/profile"),
        fetch("/api/claims"),
        fetch("/api/jobs"),
        fetch("/api/applications"),
        fetch("/api/contacts"),
        fetch("/api/outreach"),
      ]);
      const profilePayload = await jsonResponse<{ fields?: ProfileField[] }>(profileResponse, "Unable to load profile evidence");
      const claimsPayload = await jsonResponse<{ claims?: Claim[] }>(claimsResponse, "Unable to load claims");
      const jobsPayload = await jsonResponse<{ jobs?: Job[] }>(jobsResponse, "Unable to load jobs");
      const applicationsPayload = await jsonResponse<{ applications?: Application[] }>(applicationsResponse, "Unable to load applications");
      const contactsPayload = await jsonResponse<{ contacts?: Contact[] }>(contactsResponse, "Unable to load contact evidence");
      const draftsPayload = await jsonResponse<{ drafts?: Draft[] }>(draftsResponse, "Unable to load outreach drafts");
      setProfile(profilePayload.fields ?? []);
      setClaims(claimsPayload.claims ?? []);
      setJobs(jobsPayload.jobs ?? []);
      setApplications(applicationsPayload.applications ?? []);
      setContacts(contactsPayload.contacts ?? []);
      setDrafts(draftsPayload.drafts ?? []);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to load Scout setup state");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const profileByKind = useMemo(() => new Map(profile.map((field) => [field.kind, field])), [profile]);
  const verifiedRequired = requiredProfileKinds.filter((kind) => profileByKind.get(kind)?.verified);
  const missingRequired = requiredProfileKinds.filter((kind) => !profileByKind.get(kind)?.verified);
  const approvedClaims = claims.filter((claim) => claim.status === "approved");
  const activeJobs = jobs.filter((job) => job.lifecycleState === "active" && job.state !== "rejected");
  const applicationsReady = applications.filter((application) => application.status === "ready_for_review").length;
  const contactsNeedReview = contacts.filter((contact) => contact.reviewState === "needs_review").length;

  async function saveStarterProfile() {
    setBusy("profile"); setError(""); setNotice("");
    try {
      const explicitInputs = [
        ...(email.trim() ? [{ kind: "email", claim: email.trim(), evidence: "Entered by Ryan in Scout Start Here. Verify this exact application email before reuse." }] : []),
        ...(currentLocation.trim() ? [{ kind: "current_location", claim: currentLocation.trim(), evidence: "Entered by Ryan in Scout Start Here. Verify this exact current location before reuse." }] : []),
        ...(resumeReference.trim() ? [{ kind: "resume_reference", claim: resumeReference.trim(), evidence: "Entered by Ryan in Scout Start Here. Verify that this points to the approved current resume before reuse." }] : []),
      ];
      let changed = 0;
      for (const field of starterProfile) {
        if (profileByKind.has(field.kind)) continue;
        const response = await fetch("/api/profile", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(field),
        });
        await jsonResponse(response, `Unable to save ${field.kind}`);
        changed += 1;
      }
      for (const field of explicitInputs) {
        const existing = profileByKind.get(field.kind);
        if (existing?.verified) continue;
        if (existing?.claim === field.claim && existing.evidence === field.evidence) continue;
        const response = await fetch("/api/profile", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(field),
        });
        await jsonResponse(response, `Unable to save ${field.kind}`);
        changed += 1;
      }
      setNotice(changed
        ? `${changed} profile field${changed === 1 ? "" : "s"} saved or updated as unverified. Verify each exact reusable value before Scout reuses it.`
        : "No profile values were changed. Existing verified evidence was left untouched.");
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to save starter profile");
    } finally { setBusy(""); }
  }

  async function verifyField(field: ProfileField) {
    setBusy(`profile:${field.id}`); setError(""); setNotice("");
    try {
      const response = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: field.id, action: field.verified ? "unverify" : "verify", expectedUpdatedAt: field.updatedAt }),
      });
      const payload = await response.json() as { error?: string };
      if (response.status === 409) {
        await load();
        throw new Error(payload.error ?? "Profile field changed elsewhere. Latest value reloaded; review it before retrying.");
      }
      if (!response.ok) throw new Error(payload.error ?? "Unable to update profile verification");
      setNotice(field.verified ? `${humanize(field.kind)} marked unverified.` : `${humanize(field.kind)} verified for reusable application fields.`);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to update profile verification");
    } finally { setBusy(""); }
  }

  async function addStarterClaims() {
    setBusy("claims"); setError(""); setNotice("");
    try {
      const existing = new Set(claims.map((claim) => claim.statement.trim().toLowerCase()));
      let created = 0;
      for (const claim of starterClaims) {
        if (existing.has(claim.statement.toLowerCase())) continue;
        const response = await fetch("/api/claims", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(claim),
        });
        await jsonResponse(response, "Unable to create starter claim");
        created += 1;
      }
      setNotice(created
        ? `${created} starter claim${created === 1 ? "" : "s"} added as drafts only. Review evidence and approve them individually in Claims.`
        : "Starter claim wording is already present. No claim was duplicated or auto-approved.");
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to add starter claims");
    } finally { setBusy(""); }
  }

  async function runScout() {
    setBusy("run"); setError(""); setNotice("");
    try {
      const response = await fetch("/api/agent/run", { method: "POST" });
      const payload = await jsonResponse<{
        run?: {
          discovery?: { found?: number; created?: number };
          resolution?: { resolved?: number };
          applications?: { prepared?: number };
          contacts?: { candidatesSaved?: number };
        };
      }>(response, "Run Scout now failed");
      const run = payload.run;
      setNotice(`Scout run complete: ${run?.discovery?.found ?? 0} leads observed, ${run?.discovery?.created ?? 0} new, ${run?.resolution?.resolved ?? 0} resolved, ${run?.applications?.prepared ?? 0} application packets prepared, ${run?.contacts?.candidatesSaved ?? 0} published contact candidates saved. Nothing was submitted or sent.`);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Run Scout now failed");
    } finally { setBusy(""); }
  }

  if (loading) return <main className={styles.shell}><p>Checking Scout setup…</p></main>;

  return <main className={styles.shell}>
    <header className={styles.hero}>
      <div>
        <p className={styles.kicker}>SCOUT / START HERE</p>
        <h1>Make Scout useful, then keep it honest.</h1>
        <p>Set the small amount of evidence Scout is allowed to reuse, run discovery, and move each role through review without giving the product permission to apply or send anything for you.</p>
      </div>
      <div className={styles.headerLinks}><Link href="/">Dashboard</Link><Link href="/inbox">Inbox</Link><Link href="/applications">Applications</Link></div>
    </header>

    {error && <div className={styles.error}>{error}</div>}
    {notice && <div className={styles.notice}>{notice}</div>}

    <section className={styles.metrics}>
      <article><strong>{verifiedRequired.length}/{requiredProfileKinds.length}</strong><span>Required profile facts verified</span></article>
      <article><strong>{approvedClaims.length}</strong><span>Approved resume claims</span></article>
      <article><strong>{activeJobs.length}</strong><span>Active discovered roles</span></article>
      <article><strong>{applicationsReady}</strong><span>Applications ready for review</span></article>
      <article><strong>{contactsNeedReview}</strong><span>Contact evidence decisions</span></article>
      <article><strong>{drafts.length}</strong><span>Outreach drafts</span></article>
    </section>

    <section className={styles.panel}>
      <div className={styles.panelHead}>
        <div><p className={styles.kicker}>1 · REUSABLE APPLICATION FACTS</p><h2>Verify only facts you want Safe Fill to reuse</h2></div>
        <span>{missingRequired.length ? `${missingRequired.length} still missing/unverified` : "Required profile complete"}</span>
      </div>
      <p className={styles.muted}>Starter values are saved unverified. Scout will not reuse them until you click Verify. Current location, email, and the approved resume reference are intentionally not guessed; enter them yourself if you want Scout to store them. Graduation year stays manual because the degree path can differ by application.</p>
      <div className={styles.inputs}>
        <label>Email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="Your application email" /></label>
        <label>Current location<input value={currentLocation} onChange={(event) => setCurrentLocation(event.target.value)} placeholder="Your current location" /></label>
        <label>Approved resume reference<input value={resumeReference} onChange={(event) => setResumeReference(event.target.value)} placeholder="e.g. Ryan_Mahajan_Resume_Aug_2026.pdf" /></label>
        <button disabled={busy === "profile"} onClick={() => void saveStarterProfile()}>Save missing profile basics</button>
      </div>
      <div className={styles.profileGrid}>
        {profileDisplayKinds.map((kind) => {
          const field = profileByKind.get(kind);
          const manualOnly = kind === "graduation_year";
          return <article key={kind} className={styles.profileCard}>
            <div><strong>{humanize(kind)}</strong><span className={manualOnly || !field?.verified ? styles.warn : styles.good}>{manualOnly ? "Manual per application" : field?.verified ? "Verified" : field ? "Unverified" : "Missing"}</span></div>
            <p>{field?.claim || "No reusable value saved yet."}</p>
            {field && (!manualOnly || field.verified) && <button disabled={busy === `profile:${field.id}`} onClick={() => void verifyField(field)}>{manualOnly ? "Mark unverified" : field.verified ? "Mark unverified" : "Verify exact value"}</button>}
          </article>;
        })}
      </div>
    </section>

    <section className={styles.panel}>
      <div className={styles.panelHead}>
        <div><p className={styles.kicker}>2 · RESUME EVIDENCE</p><h2>Load the known boundaries as drafts, not claims of fact</h2></div>
        <Link href="/claims">Open Claims →</Link>
      </div>
      <p className={styles.muted}>The starter wording preserves the project boundaries already defined for Scout. Clicking below only creates draft claims. It never approves them and never invents metrics, outcomes, work authorization, referrals, or credentials.</p>
      <button className={styles.primary} disabled={busy === "claims"} onClick={() => void addStarterClaims()}>Add missing starter claims as drafts</button>
      <div className={styles.claimSummary}><strong>{claims.filter((claim) => claim.status === "draft").length}</strong> draft · <strong>{approvedClaims.length}</strong> approved · <strong>{claims.filter((claim) => claim.status === "rejected").length}</strong> rejected</div>
    </section>

    <section className={styles.panel}>
      <div className={styles.panelHead}>
        <div><p className={styles.kicker}>3 · DISCOVER + PREPARE</p><h2>Run the safe local pipeline</h2></div>
        <Link href="/sources">Source health →</Link>
      </div>
      <p className={styles.muted}>This run can discover controlled public ATS roles, resolve official evidence, prepare application packets, and research explicitly published company-domain contact emails. Contacts stay needs-review. Applications stay review-only.</p>
      <button className={styles.primary} disabled={busy === "run"} onClick={() => void runScout()}>{busy === "run" ? "Scout is running…" : "Run Scout now"}</button>
    </section>

    <section className={styles.workflow}>
      <Link href="/inbox"><strong>Inbox</strong><span>Discover and inspect leads</span></Link>
      <Link href="/roles"><strong>Roles</strong><span>Fit, evidence, decision cockpit</span></Link>
      <Link href="/shortlist"><strong>Shortlist</strong><span>Compare the roles worth moving</span></Link>
      <Link href="/applications"><strong>Applications</strong><span>Today / Soon / Waiting / Done</span></Link>
      <Link href="/readiness"><strong>Readiness</strong><span>See Safe Fill blockers</span></Link>
      <Link href="/review"><strong>Review</strong><span>Human decisions for evidence/drafts</span></Link>
      <Link href="/assist"><strong>Safe Fill</strong><span>Fill only verified/reviewed fields</span></Link>
      <Link href="/voice"><strong>Voice</strong><span>Keep application/outreach writing human</span></Link>
      <Link href="/evidence"><strong>Evidence</strong><span>See what Scout can actually prove</span></Link>
      <Link href="/preferences"><strong>Preferences</strong><span>Broad role-family preferences</span></Link>
      <Link href="/quality"><strong>Quality</strong><span>Opportunity/source diagnostics</span></Link>
      <Link href="/sources"><strong>Sources</strong><span>Controlled discovery health</span></Link>
    </section>

    <footer className={styles.boundary}>Hard boundary: Scout can prepare and draft. It cannot submit an application, send an email, guess a private contact, auto-approve evidence, or answer sensitive eligibility questions for you.</footer>
  </main>;
}
