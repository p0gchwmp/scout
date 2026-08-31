"use client";

import { useEffect, useMemo, useState } from "react";
import styles from "./runtime-preflight.module.css";

type ReadinessState =
  | "ready"
  | "disabled"
  | "attention"
  | "blocked"
  | "incomplete"
  | "invalid"
  | "unavailable"
  | "unverified"
  | "local_only";

type ReadinessItem = {
  state: ReadinessState;
  configured: boolean;
  required: boolean;
  detail: string;
  provider?: string;
  costClass?: "free_or_included" | "metered";
  missing?: string[];
};

type RuntimeReadiness = {
  status: "ready" | "attention" | "blocked";
  ownerOnly: true;
  zeroNetwork: true;
  core: {
    ownerGate: ReadinessItem;
    database: ReadinessItem;
    schema: ReadinessItem;
    immutableEvidence: ReadinessItem;
  };
  capabilities: {
    search: ReadinessItem & { resultPersistence?: "enabled" | "disabled" };
    ai: ReadinessItem;
    cloudAgent: ReadinessItem;
    browserHandoff: ReadinessItem;
    gmailDraft: ReadinessItem;
  };
  policies: {
    searchResultPersistence: "enabled" | "disabled";
    applicationSubmission: false;
    emailSending: false;
    captchaSolving: false;
    privateContactScraping: false;
  };
  demo: {
    state: "local_only";
    available: true;
    productionExecutionProhibited: true;
    commands: string[];
  };
};

function stateLabel(state: ReadinessState) {
  if (state === "local_only") return "Local only";
  if (state === "unverified") return "Not probed";
  if (state === "incomplete") return "Incomplete";
  if (state === "unavailable") return "Unavailable";
  return state.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function stateClass(state: ReadinessState) {
  if (state === "ready" || state === "local_only") return styles.good;
  if (state === "disabled") return styles.neutral;
  if (state === "blocked" || state === "invalid") return styles.bad;
  return styles.warn;
}

function ReadinessCard({ title, item }: { title: string; item: ReadinessItem }) {
  return <article className={styles.card}>
    <div className={styles.cardHead}>
      <strong>{title}</strong>
      <span className={stateClass(item.state)}>{stateLabel(item.state)}</span>
    </div>
    <p>{item.detail}</p>
    {item.provider && <small>Route: {item.provider}</small>}
    {item.costClass && <small>Cost class: {item.costClass === "free_or_included" ? "free / included" : "metered"}</small>}
    {item.missing?.length ? <small>Missing: {item.missing.join(", ")}</small> : null}
  </article>;
}

export function RuntimePreflightPanel() {
  const [readiness, setReadiness] = useState<RuntimeReadiness | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    void fetch("/api/runtime-readiness", { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json() as RuntimeReadiness & { error?: string };
        if (!response.ok) throw new Error(payload.error ?? "Runtime preflight failed");
        if (active) setReadiness(payload);
      })
      .catch((caught) => {
        if (active) setError(caught instanceof Error ? caught.message : "Runtime preflight failed");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, []);

  const cards = useMemo(() => readiness ? [
    ["Owner gate", readiness.core.ownerGate],
    ["Database", readiness.core.database],
    ["Schema", readiness.core.schema],
    ["Immutable evidence", readiness.core.immutableEvidence],
    ["Search", readiness.capabilities.search],
    ["AI routing", readiness.capabilities.ai],
    ["Browser Safe Fill", readiness.capabilities.browserHandoff],
    ["Cloud agent", readiness.capabilities.cloudAgent],
    ["Gmail draft", readiness.capabilities.gmailDraft],
  ] as Array<[string, ReadinessItem]> : [], [readiness]);

  return <aside className={styles.shell} aria-labelledby="runtime-preflight-title">
    <div className={styles.panel}>
      <div className={styles.heading}>
        <div>
          <p className={styles.kicker}>0 · RUNTIME PREFLIGHT</p>
          <h2 id="runtime-preflight-title">Know what Scout can safely use before the first run</h2>
        </div>
        {readiness && <span className={stateClass(readiness.status)}>{readiness.status === "attention" ? "Needs attention" : stateLabel(readiness.status)}</span>}
      </div>
      <p className={styles.muted}>Read-only and secret-safe. No provider was contacted, no model/search credits were consumed, and no Gmail draft was created to calculate this preflight.</p>

      {loading && <p className={styles.muted}>Checking local runtime configuration…</p>}
      {error && <p className={styles.error}>{error}</p>}
      {readiness && <>
        <div className={styles.grid}>
          {cards.map(([title, item]) => <ReadinessCard key={title} title={title} item={item} />)}
          <article className={styles.card}>
            <div className={styles.cardHead}><strong>Demo tooling</strong><span className={styles.good}>Local only</span></div>
            <p>Existing synthetic demo seed/reset tooling remains local-only and is prohibited from production execution.</p>
            <small>{readiness.demo.commands.join(" · ")}</small>
          </article>
        </div>
        <div className={styles.boundary}>
          Application submit: disabled · Email send: disabled · CAPTCHA solving: disabled · Private-contact scraping: disabled · Search-result persistence: {readiness.policies.searchResultPersistence}
        </div>
      </>}
    </div>
  </aside>;
}
