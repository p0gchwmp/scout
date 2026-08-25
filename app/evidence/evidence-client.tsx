"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  buildEvidenceIntelligence,
  type EvidenceClaim,
  type EvidenceJob,
} from "../../lib/scout/evidence-intelligence";
import type { ApplicationProfileField } from "../../lib/scout/application-prep";
import styles from "./evidence.module.css";

type ClaimFilter = "All" | "Approved" | "Draft" | "Needs review";
const claimFilters: ClaimFilter[] = ["All", "Approved", "Draft", "Needs review"];

function humanize(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

export function EvidenceWorkspace() {
  const [claims, setClaims] = useState<EvidenceClaim[]>([]);
  const [profileFields, setProfileFields] = useState<ApplicationProfileField[]>([]);
  const [jobs, setJobs] = useState<EvidenceJob[]>([]);
  const [filter, setFilter] = useState<ClaimFilter>("All");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const [claimsResponse, profileResponse, jobsResponse] = await Promise.all([
        fetch("/api/claims"),
        fetch("/api/profile"),
        fetch("/api/jobs"),
      ]);
      const claimsPayload = await claimsResponse.json() as { claims?: EvidenceClaim[]; error?: string };
      const profilePayload = await profileResponse.json() as { fields?: ApplicationProfileField[]; error?: string };
      const jobsPayload = await jobsResponse.json() as { jobs?: EvidenceJob[]; error?: string };
      if (!claimsResponse.ok) throw new Error(claimsPayload.error ?? "Unable to load claims");
      if (!profileResponse.ok) throw new Error(profilePayload.error ?? "Unable to load profile evidence");
      if (!jobsResponse.ok) throw new Error(jobsPayload.error ?? "Unable to load jobs");
      setClaims(claimsPayload.claims ?? []);
      setProfileFields(profilePayload.fields ?? []);
      setJobs(jobsPayload.jobs ?? []);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to load evidence intelligence");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const intelligence = useMemo(() => buildEvidenceIntelligence({ claims, profileFields, jobs }), [claims, profileFields, jobs]);
  const assessmentById = useMemo(() => new Map(intelligence.claimAssessments.map((assessment) => [assessment.claimId, assessment])), [intelligence.claimAssessments]);
  const visibleClaims = useMemo(() => claims.filter((claim) => {
    const assessment = assessmentById.get(claim.id);
    const text = `${claim.id} ${claim.statement} ${claim.evidence} ${assessment?.roleFamilyLabels.join(" ") ?? ""}`.toLowerCase();
    if (query.trim() && !text.includes(query.trim().toLowerCase())) return false;
    if (filter === "Approved") return claim.status === "approved";
    if (filter === "Draft") return claim.status === "draft";
    if (filter === "Needs review") return Boolean(assessment && (assessment.formQuality !== "clear" || assessment.possibleDuplicateClaimIds.length || assessment.cautions.length));
    return true;
  }), [claims, assessmentById, query, filter]);

  if (loading) return <main className={styles.shell}><p>Loading evidence intelligence…</p></main>;

  return <main className={styles.shell}>
    <header className={styles.header}>
      <div>
        <p className={styles.kicker}>SCOUT / EVIDENCE INTELLIGENCE</p>
        <h1>Know what Scout can actually prove.</h1>
        <p>Claims are analyzed for coverage, clarity and overlap without changing their approval state. Missing coverage means Scout lacks approved evidence — not that you lack the real-world ability.</p>
      </div>
      <div className={styles.headerLinks}>
        <Link href="/shortlist">Shortlist</Link>
        <Link href="/readiness">Readiness</Link>
        <Link href="/">Dashboard</Link>
      </div>
    </header>

    {error && <div className={styles.error}>{error}</div>}

    <section className={styles.summary}>
      <div><strong>{intelligence.summary.approvedClaims}</strong><span>Approved claims</span></div>
      <div><strong>{intelligence.summary.supportedBroadFamilies}/{intelligence.summary.broadFamilyCount}</strong><span>Broad role families evidenced</span></div>
      <div><strong>{intelligence.summary.verifiedRequiredProfileCount}/{intelligence.summary.requiredProfileCount}</strong><span>Required profile fields verified</span></div>
      <div><strong>{intelligence.summary.activeOpportunityUsageCount}</strong><span>Active role/claim uses</span></div>
      <div><strong>{intelligence.summary.possibleDuplicatePairs}</strong><span>Possible claim overlaps</span></div>
    </section>

    {intelligence.nextEvidenceActions.length > 0 && <section className={styles.actionsPanel}>
      <div>
        <p className={styles.kicker}>NEXT EVIDENCE ACTIONS</p>
        <h2>Fix the evidence layer before blaming the ranking.</h2>
      </div>
      <ul>{intelligence.nextEvidenceActions.map((action) => <li key={action}>{action}</li>)}</ul>
      <Link href="/">Manage Claims / Profile →</Link>
    </section>}

    <section className={styles.section}>
      <div className={styles.sectionHead}>
        <div><p className={styles.kicker}>ROLE COVERAGE</p><h2>What approved evidence currently supports</h2></div>
        <p>Software development remains visible as a stretch lane. The other families represent the broad analyst/product/business/finance/ops/research/tech-adjacent search profile.</p>
      </div>
      <div className={styles.coverageGrid}>
        {intelligence.familyCoverage.map((family) => <article className={`${styles.coverageCard} ${family.supported ? styles.covered : styles.gap}`} key={family.id}>
          <div className={styles.coverageTop}><strong>{family.label}</strong><span>{family.preferenceLane === "software_stretch" ? "Stretch lane" : "Broad-fit lane"}</span></div>
          <p>{family.note}</p>
          {family.claimIds.length > 0 && <div className={styles.chips}>{family.claimIds.map((id) => <code key={id}>{id}</code>)}</div>}
        </article>)}
      </div>
    </section>

    <section className={styles.section}>
      <div className={styles.sectionHead}>
        <div><p className={styles.kicker}>APPLICATION PROFILE</p><h2>Reusable facts still need verification</h2></div>
        <p>Required application fields are reusable only after explicit verification. Legal/eligibility answers remain per-application manual checks.</p>
      </div>
      <div className={styles.profileGrid}>
        {intelligence.profileCoverage.map((field) => <article className={styles.profileCard} key={field.kind}>
          <div><strong>{humanize(field.kind)}</strong><span>{field.required ? "Required" : "Optional"}</span></div>
          <p className={field.verified ? styles.good : styles.warn}>{field.verified ? "Verified for reuse" : field.present ? "Present but not verified" : "Not configured / verified"}</p>
        </article>)}
      </div>
    </section>

    {intelligence.duplicatePairs.length > 0 && <section className={styles.section}>
      <div className={styles.sectionHead}>
        <div><p className={styles.kicker}>POSSIBLE OVERLAPS</p><h2>Review; never auto-merge</h2></div>
        <p>Similarity is a diagnostic clue only. Two similar claims can still represent legitimately different scopes or evidence.</p>
      </div>
      <div className={styles.duplicateList}>
        {intelligence.duplicatePairs.map((pair) => <div key={pair.claimIds.join(":")}><code>{pair.claimIds[0]}</code><span>↔</span><code>{pair.claimIds[1]}</code><strong>{Math.round(pair.similarity * 100)}% text overlap</strong></div>)}
      </div>
    </section>}

    <section className={styles.section}>
      <div className={styles.sectionHead}>
        <div><p className={styles.kicker}>CLAIM INVENTORY</p><h2>Evidence, usage and review signals</h2></div>
        <p>Approved claims are immutable. If one needs improvement, create a new draft rather than silently rewriting what was previously approved.</p>
      </div>
      <div className={styles.controls}>
        <div className={styles.filters}>{claimFilters.map((item) => <button className={filter === item ? styles.active : ""} key={item} onClick={() => setFilter(item)}>{item}</button>)}</div>
        <input aria-label="Search evidence claims" placeholder="Search claim, evidence or role family…" value={query} onChange={(event) => setQuery(event.target.value)} />
      </div>
      <div className={styles.claimList}>
        {!visibleClaims.length && <div className={styles.empty}>No claims match this view.</div>}
        {visibleClaims.map((claim) => {
          const assessment = assessmentById.get(claim.id)!;
          return <article className={styles.claimCard} key={claim.id}>
            <div className={styles.claimTop}>
              <div><p className={styles.claimId}>{claim.id}</p><h3>{claim.statement}</h3></div>
              <div className={styles.statusStack}><span className={`${styles.status} ${styles[claim.status]}`}>{claim.status}</span><span>v{claim.version}</span><span className={`${styles.quality} ${styles[assessment.formQuality]}`}>{assessment.formQualityLabel}</span></div>
            </div>
            <div className={styles.evidenceBox}><strong>Evidence</strong><p>{claim.evidence}</p></div>
            <div className={styles.chips}>{assessment.roleFamilyLabels.map((label) => <span key={label}>{label}</span>)}</div>
            <div className={styles.claimColumns}>
              <div><strong>Current role usage</strong><p>{assessment.activeOpportunityCount ? `${assessment.activeOpportunityCount} active opportunity${assessment.activeOpportunityCount === 1 ? "" : "ies"} currently use this claim.` : "No active opportunity currently uses this claim."}</p>{assessment.activeOpportunities.slice(0, 4).map((job) => <p className={styles.roleUse} key={job.id}>{job.company} · {job.title}</p>)}</div>
              <div><strong>Review signals</strong>{!assessment.issues.length && !assessment.cautions.length && !assessment.possibleDuplicateClaimIds.length ? <p>No wording/evidence warning detected by the current deterministic checks.</p> : <>{assessment.issues.map((issue) => <p className={styles.issue} key={issue}>{issue}</p>)}{assessment.cautions.map((caution) => <p className={styles.caution} key={caution}>{caution}</p>)}{assessment.possibleDuplicateClaimIds.length > 0 && <p className={styles.caution}>Possible overlap with: <code>{assessment.possibleDuplicateClaimIds.join(", ")}</code></p>}</>}</div>
            </div>
          </article>;
        })}
      </div>
    </section>

    <footer className={styles.boundary}>Scout diagnoses evidence. It does not invent claims, validate unsupported credentials, merge claims automatically, submit applications, or send outreach.</footer>
  </main>;
}
