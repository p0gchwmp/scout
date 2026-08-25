"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  buildPreferenceCalibration,
  parsePreferenceFeedback,
  PREFERENCE_CALIBRATION_CAPABILITIES,
  PREFERENCE_STORAGE_KEY,
  serializePreferenceFeedback,
  type PreferenceFeedback,
} from "../../lib/scout/preference-calibration";
import { classifyRoleTaxonomy } from "../../lib/scout/role-taxonomy";
import styles from "./preferences.module.css";

type Job = {
  id: string;
  company: string;
  title: string;
  description: string;
  location: string;
  state: "shortlisted" | "saved" | "rejected";
  lifecycleState: "active" | "closed";
};

function formatWhen(value: string) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

export function PreferenceCalibrationWorkspace() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [feedback, setFeedback] = useState<PreferenceFeedback[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const response = await fetch("/api/jobs");
      const payload = await response.json() as { jobs?: Job[]; error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Unable to load roles");
      setJobs(payload.jobs ?? []);
      try { setFeedback(parsePreferenceFeedback(window.localStorage.getItem(PREFERENCE_STORAGE_KEY))); }
      catch { setFeedback([]); }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to load preference calibration");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const calibration = useMemo(() => buildPreferenceCalibration(jobs, feedback), [jobs, feedback]);
  const jobsById = useMemo(() => new Map(jobs.map((job) => [job.id, job])), [jobs]);
  const recentFeedback = useMemo(() => feedback
    .map((item) => ({ item, job: jobsById.get(item.jobId) ?? null }))
    .filter((entry) => entry.job)
    .slice(0, 20), [feedback, jobsById]);

  function resetCalibration() {
    const confirmed = window.confirm("Clear this browser's Scout preference feedback? This does not change job states, claims, applications, or server data.");
    if (!confirmed) return;
    try { window.localStorage.setItem(PREFERENCE_STORAGE_KEY, serializePreferenceFeedback([])); }
    catch { /* in-memory reset still makes the current session neutral */ }
    setFeedback([]);
    setNotice("Browser-local preference calibration cleared. Job states and evidence were not changed.");
  }

  if (loading) return <main className={styles.shell}><p>Loading preference calibration…</p></main>;

  return <main className={styles.shell}>
    <header className={styles.header}>
      <div>
        <p className={styles.kicker}>SCOUT / PREFERENCE CALIBRATION</p>
        <h1>Teach Scout your taste without narrowing your prospects.</h1>
        <p>Repeated Shortlist and Reject decisions can add a small ranking nudge. Evidence, eligibility, role coverage and geography remain independent.</p>
      </div>
      <div className={styles.links}><Link href="/shortlist">Shortlist</Link><Link href="/evidence">Evidence</Link><Link href="/">Dashboard</Link></div>
    </header>

    {notice && <div className={styles.notice}>{notice}</div>}
    {error && <div className={`${styles.notice} ${styles.error}`}>{error}</div>}

    <section className={styles.summary}>
      <article><strong>{calibration.totalSignals}</strong><span>Explicit signals</span></article>
      <article><strong>{calibration.interested}</strong><span>Shortlist signals</span></article>
      <article><strong>{calibration.notInterested}</strong><span>Reject signals</span></article>
      <article><strong>{calibration.active ? "ON" : "WAIT"}</strong><span>Calibration</span></article>
    </section>

    <section className={styles.explainer}>
      <div><strong>{calibration.active ? "Soft ranking nudges are active." : "Scout is still learning."}</strong><p>{calibration.summary}</p></div>
      <ul>
        <li>One rejection cannot suppress a role family.</li>
        <li>A family needs at least {PREFERENCE_CALIBRATION_CAPABILITIES.minimumFamilySignals} explicit signals before it can move.</li>
        <li>Any nudge is capped at ±{PREFERENCE_CALIBRATION_CAPABILITIES.maximumAbsoluteNudge} points.</li>
        <li>Saved/discovered jobs are neutral because Scout may assign that state automatically.</li>
        <li>India, remote and global locations are never learned as ranking preferences.</li>
      </ul>
      <button onClick={resetCalibration}>Reset local preference feedback</button>
    </section>

    <section className={styles.section}>
      <div className={styles.sectionHead}><div><p className={styles.kicker}>ROLE-FAMILY SIGNALS</p><h2>What Scout has learned so far</h2></div><p>These are small recommendation nudges, not eligibility rules.</p></div>
      <div className={styles.familyGrid}>
        {calibration.families.map((family) => <article className={styles.familyCard} key={family.familyId}>
          <div className={styles.familyTop}><div><h3>{family.familyLabel}</h3><p>{family.confidence} confidence</p></div><strong className={family.adjustment > 0 ? styles.positive : family.adjustment < 0 ? styles.negative : styles.neutral}>{family.adjustment > 0 ? "+" : ""}{family.adjustment}</strong></div>
          <div className={styles.counts}><span>{family.interested} shortlisted</span><span>{family.notInterested} rejected</span><span>{family.signalCount} total</span></div>
          <p>{family.label}</p>
        </article>)}
      </div>
    </section>

    <section className={styles.section}>
      <div className={styles.sectionHead}><div><p className={styles.kicker}>RECENT FEEDBACK</p><h2>Exactly what trained the local model</h2></div><p>No hidden clicks, saves or browsing behavior count as preference feedback.</p></div>
      {!recentFeedback.length && <div className={styles.empty}>No explicit Shortlist/Reject feedback recorded in this browser yet.</div>}
      <div className={styles.feedbackList}>
        {recentFeedback.map(({ item, job }) => {
          if (!job) return null;
          const taxonomy = classifyRoleTaxonomy(job);
          return <article key={item.jobId}>
            <div><strong>{job.company} — {job.title}</strong><span>{taxonomy.primaryFamily.label} · {job.location || "Location unspecified"}</span></div>
            <div className={item.signal === "interested" ? styles.signalPositive : styles.signalNegative}>{item.signal === "interested" ? "Shortlisted" : "Rejected"}<small>{formatWhen(item.recordedAt)}</small></div>
          </article>;
        })}
      </div>
    </section>

    <footer className={styles.boundary}>This preference model is browser-local and reversible. It never changes approved claims, immutable job evidence, application packets, contact evidence, outreach state, work-authorization checks, or final-submit boundaries.</footer>
  </main>;
}
