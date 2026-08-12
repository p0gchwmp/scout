"use client";

import { useMemo, useState } from "react";

type JobState = "shortlisted" | "approved" | "saved" | "rejected";

type Job = {
  id: string;
  company: string;
  monogram: string;
  title: string;
  location: string;
  mode: string;
  source: string;
  posted: string;
  score: number;
  accent: string;
  reasons: string[];
  risks: string[];
  state: JobState;
  applyUrl: string;
};

const seedJobs: Job[] = [
  {
    id: "linear-product-intern",
    company: "Linear",
    monogram: "LI",
    title: "Product Operations Intern",
    location: "Remote · APAC",
    mode: "Remote",
    source: "Ashby",
    posted: "2h ago",
    score: 94,
    accent: "#e05b38",
    reasons: ["Student-friendly", "Product & ops fit", "Remote in APAC"],
    risks: [],
    state: "shortlisted",
    applyUrl: "https://jobs.ashbyhq.com/",
  },
  {
    id: "razorpay-product-analyst",
    company: "Razorpay",
    monogram: "RZ",
    title: "Product Analyst Intern",
    location: "Bengaluru, India",
    mode: "Hybrid",
    source: "Greenhouse",
    posted: "5h ago",
    score: 91,
    accent: "#3366cc",
    reasons: ["India eligible", "Analytics match", "Strong learning value"],
    risks: ["May require SQL assessment"],
    state: "shortlisted",
    applyUrl: "https://boards.greenhouse.io/",
  },
  {
    id: "meesho-strategy-intern",
    company: "Meesho",
    monogram: "ME",
    title: "Strategy & Operations Intern",
    location: "Bengaluru, India",
    mode: "On-site",
    source: "Lever",
    posted: "Yesterday",
    score: 87,
    accent: "#9d3c8c",
    reasons: ["Business breadth", "Current students accepted", "India eligible"],
    risks: ["On-site availability needed"],
    state: "shortlisted",
    applyUrl: "https://jobs.lever.co/",
  },
  {
    id: "atlassian-pm-intern",
    company: "Atlassian",
    monogram: "AT",
    title: "Associate Product Manager Intern",
    location: "Sydney, Australia",
    mode: "Hybrid",
    source: "Workday",
    posted: "1d ago",
    score: 86,
    accent: "#1769e0",
    reasons: ["Exceptional global role", "Product fit", "High learning value"],
    risks: ["Work authorization unconfirmed", "Relocation required"],
    state: "shortlisted",
    applyUrl: "https://atlassian.wd1.myworkdayjobs.com/",
  },
];

const tabs = ["Daily queue", "Applications", "Profile evidence", "Sources"];

export function Dashboard() {
  const [jobs, setJobs] = useState(seedJobs);
  const [activeTab, setActiveTab] = useState("Daily queue");
  const [selected, setSelected] = useState<string[]>([]);
  const [filter, setFilter] = useState("All matches");
  const [notice, setNotice] = useState("");

  const visibleJobs = useMemo(() => jobs.filter((job) => {
    if (filter === "India") return job.location.includes("India");
    if (filter === "Remote") return job.mode === "Remote";
    if (filter === "Exceptional global") return job.reasons.includes("Exceptional global role");
    return job.state !== "rejected";
  }), [jobs, filter]);

  const updateJob = (id: string, state: JobState) => {
    setJobs((items) => items.map((job) => job.id === id ? { ...job, state } : job));
    setSelected((items) => items.filter((item) => item !== id));
    setNotice(state === "approved" ? "Added to tonight’s safe-fill batch." : `Job ${state}.`);
  };

  const approveSelected = () => {
    if (!selected.length) return setNotice("Select at least one role first.");
    setJobs((items) => items.map((job) => selected.includes(job.id) ? { ...job, state: "approved" } : job));
    setNotice(`${selected.length} application${selected.length > 1 ? "s" : ""} approved for safe filling.`);
    setSelected([]);
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="Scout home">
          <span className="brand-mark">S</span>
          <span>Scout</span>
        </a>
        <nav className="main-nav" aria-label="Primary navigation">
          {tabs.map((tab) => (
            <button key={tab} className={activeTab === tab ? "nav-active" : ""} onClick={() => setActiveTab(tab)}>{tab}</button>
          ))}
        </nav>
        <div className="header-actions">
          <span className="sync-dot"><i /> Synced 8:42 AM</span>
          <button className="avatar" aria-label="Open profile">AK</button>
        </div>
      </header>

      <main id="top">
        <section className="hero">
          <div>
            <p className="eyebrow">WEDNESDAY · AUGUST 12</p>
            <h1>Your best shots,<br /><em>not the most shots.</em></h1>
            <p className="hero-copy">Scout found <strong>8 internships</strong> worth your attention today. Every match is scored against facts in your profile—never invented experience.</p>
          </div>
          <div className="hero-stats" aria-label="Daily summary">
            <div><span>08</span><p>strong matches</p></div>
            <div><span>03</span><p>closing soon</p></div>
            <div><span>92%</span><p>profile ready</p></div>
          </div>
        </section>

        <section className="control-strip" aria-label="Queue controls">
          <div className="filters">
            {["All matches", "India", "Remote", "Exceptional global"].map((item) => (
              <button key={item} className={filter === item ? "filter-active" : ""} onClick={() => setFilter(item)}>{item}</button>
            ))}
          </div>
          <div className="batch-actions">
            <span>{selected.length} selected</span>
            <button className="approve-batch" onClick={approveSelected}>Approve batch <span>→</span></button>
          </div>
        </section>

        {notice && <div className="notice" role="status"><span>✓</span>{notice}<button onClick={() => setNotice("")} aria-label="Dismiss notification">×</button></div>}

        <section className="queue-heading">
          <div>
            <p className="section-kicker">TODAY’S SHORTLIST</p>
            <h2>{activeTab}</h2>
          </div>
          <p>Ranked by fit, eligibility, learning value, and freshness.</p>
        </section>

        <section className="job-list" aria-label="Internship matches">
          {visibleJobs.map((job, index) => (
            <article className={`job-card ${job.state === "approved" ? "is-approved" : ""}`} key={job.id}>
              <label className="select-job">
                <span className="sr-only">Select {job.title} at {job.company}</span>
                <input type="checkbox" checked={selected.includes(job.id)} onChange={(event) => setSelected((items) => event.target.checked ? [...items, job.id] : items.filter((id) => id !== job.id))} />
                <span />
              </label>
              <div className="company-logo" style={{ background: job.accent }}>{job.monogram}</div>
              <div className="job-main">
                <div className="job-title-row">
                  <div>
                    <p className="company-name">{job.company}</p>
                    <h3>{job.title}</h3>
                  </div>
                  <div className="score-ring" style={{ "--score": `${job.score * 3.6}deg` } as React.CSSProperties}>
                    <span>{job.score}</span>
                  </div>
                </div>
                <p className="job-meta"><span>⌖</span>{job.location}<b>·</b>{job.mode}<b>·</b>{job.source}<b>·</b>{job.posted}</p>
                <div className="reason-row">
                  {job.reasons.map((reason) => <span className="reason" key={reason}>✓ {reason}</span>)}
                  {job.risks.map((risk) => <span className="risk" key={risk}>! {risk}</span>)}
                </div>
              </div>
              <div className="card-actions">
                <span className="rank">0{index + 1}</span>
                {job.state === "approved" ? (
                  <div className="approved-label"><span>✓</span> Approved</div>
                ) : (
                  <>
                    <button className="primary-action" onClick={() => updateJob(job.id, "approved")}>Approve</button>
                    <button className="ghost-action" onClick={() => updateJob(job.id, "saved")}>Save</button>
                  </>
                )}
                <a className="details-link" href={job.applyUrl} target="_blank" rel="noreferrer">Official listing ↗</a>
              </div>
            </article>
          ))}
        </section>

        <section className="safety-panel">
          <div className="safety-icon">◎</div>
          <div>
            <p className="section-kicker">SAFE SUBMISSION GATE</p>
            <h2>Scout knows when to stop.</h2>
            <p>Simple, allowlisted forms can be filled after approval. CAPTCHA, login, legal consent, self-ID, uncertain work authorization, or any unsupported answer comes back to you.</p>
          </div>
          <div className="safety-steps">
            <span className="done">1 <b>Match</b></span><i />
            <span className="done">2 <b>Approve</b></span><i />
            <span>3 <b>Safe-fill</b></span><i />
            <span>4 <b>Confirm</b></span>
          </div>
        </section>
      </main>

      <footer><span>SCOUT / APPLICATION COPILOT</span><p>Evidence first. Consent always. Zero duplicate applications.</p><span>INDIA + REMOTE</span></footer>
    </div>
  );
}
