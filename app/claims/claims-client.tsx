"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "./claims.module.css";

type ClaimStatus = "draft" | "approved" | "rejected";

type Claim = {
  id: string;
  statement: string;
  evidence: string;
  status: ClaimStatus;
  version: number;
  approvedAt: string | null;
  createdAt: string;
  updatedAt?: string;
};

type ClaimEdit = Pick<Claim, "statement" | "evidence">;
type Filter = "all" | ClaimStatus;

function formatTimestamp(value: string | null | undefined) {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

function isRetiredClaim(claim: Claim) {
  return claim.status === "rejected" && Boolean(claim.approvedAt);
}

export function ClaimsWorkspace() {
  const [claims, setClaims] = useState<Claim[]>([]);
  const [edits, setEdits] = useState<Record<string, ClaimEdit>>({});
  const [newClaim, setNewClaim] = useState<ClaimEdit>({ statement: "", evidence: "" });
  const [filter, setFilter] = useState<Filter>("all");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const response = await fetch("/api/claims", { cache: "no-store" });
      const payload = await response.json() as { claims?: Claim[]; error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Unable to load claims");
      const nextClaims = payload.claims ?? [];
      setClaims(nextClaims);
      setEdits(Object.fromEntries(nextClaims
        .filter((claim) => claim.status === "draft")
        .map((claim) => [claim.id, { statement: claim.statement, evidence: claim.evidence }])));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to load claims");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const counts = useMemo(() => ({
    all: claims.length,
    draft: claims.filter((claim) => claim.status === "draft").length,
    approved: claims.filter((claim) => claim.status === "approved").length,
    rejected: claims.filter((claim) => claim.status === "rejected").length,
  }), [claims]);

  const visibleClaims = useMemo(
    () => filter === "all" ? claims : claims.filter((claim) => claim.status === filter),
    [claims, filter],
  );

  async function createClaim() {
    setBusy("claim:new"); setError(""); setNotice("");
    try {
      const response = await fetch("/api/claims", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(newClaim),
      });
      const payload = await response.json() as { claim?: Claim; error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Claim creation failed");
      setNewClaim({ statement: "", evidence: "" });
      setNotice(`Draft claim ${payload.claim?.id ?? "created"} created. It cannot support fit or outreach until approved.`);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Claim creation failed");
    } finally {
      setBusy(null);
    }
  }

  async function mutateClaim(
    claim: Claim,
    action: "edit" | "approve" | "reject",
    edit?: ClaimEdit,
  ) {
    setBusy(`claim:${claim.id}`); setError(""); setNotice("");
    try {
      const response = await fetch("/api/claims", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: claim.id,
          action,
          expectedVersion: claim.version,
          ...(action === "edit" ? edit : {}),
        }),
      });
      const payload = await response.json() as { claim?: Claim; error?: string };
      if (response.status === 409) {
        await load();
        throw new Error(payload.error ?? "Claim changed elsewhere. Latest version reloaded; review it before retrying.");
      }
      if (!response.ok) throw new Error(payload.error ?? "Claim update failed");
      const next = payload.claim;
      setNotice(action === "approve"
        ? `Approved ${claim.id} at version ${next?.version ?? claim.version + 1}. Approved claims are immutable unless you explicitly retire them.`
        : action === "reject"
          ? `Rejected ${claim.id}. It will not support fit, applications, or outreach.`
          : `Saved ${claim.id} as version ${next?.version ?? claim.version + 1}. Review the saved version before approving.`);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Claim update failed");
    } finally {
      setBusy(null);
    }
  }

  async function retireClaim(claim: Claim) {
    setBusy(`claim:${claim.id}`); setError(""); setNotice("");
    try {
      const response = await fetch("/api/claims", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: claim.id, action: "retire", expectedVersion: claim.version }),
      });
      const payload = await response.json() as { claim?: Claim; error?: string; alreadyRetired?: boolean };
      if (response.status === 409) {
        await load();
        throw new Error(payload.error ?? "Claim changed elsewhere. Latest version reloaded; review it before retrying.");
      }
      if (!response.ok) throw new Error(payload.error ?? "Claim retirement failed");
      const retiredClaim = payload.claim;
      if (!retiredClaim) throw new Error("Claim retirement did not return the updated claim");

      // Use the mutation response immediately instead of depending on a follow-up
      // GET that may be stale in an intermediary cache.
      setClaims((current) => current.map((item) => item.id === retiredClaim.id ? retiredClaim : item));
      setNotice(payload.alreadyRetired
        ? `Claim ${claim.id} was already retired. The latest retired state is now shown.`
        : `Retired ${claim.id}. Its statement and original approval timestamp remain in history, but it will no longer support fit, applications, or outreach.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Claim retirement failed");
    } finally {
      setBusy(null);
    }
  }

  if (loading) return <main className={styles.shell}><p>Loading claim governance…</p></main>;

  return <main className={styles.shell}>
    <header className={styles.header}>
      <div>
        <p className={styles.kicker}>SCOUT / CLAIM GOVERNANCE</p>
        <h1>Approve facts, not vibes.</h1>
        <p>Claims are the evidence boundary for resume fit, application preparation, and outreach drafting. Draft, rejected, and retired claims stay out of those workflows.</p>
      </div>
      <nav className={styles.headerLinks} aria-label="Scout claim navigation">
        <Link href="/shortlist">Shortlist</Link>
        <Link href="/applications">Applications</Link>
        <Link href="/">Dashboard</Link>
      </nav>
    </header>

    {notice && <div className={styles.notice}>{notice}</div>}
    {error && <div className={`${styles.notice} ${styles.error}`}>{error}</div>}

    <section className={styles.summary} aria-label="Claim status summary">
      {(["all", "draft", "approved", "rejected"] as const).map((status) => <button
        key={status}
        className={filter === status ? styles.activeSummary : ""}
        onClick={() => setFilter(status)}
      >
        <strong>{counts[status]}</strong>
        <span>{status === "all" ? "All claims" : status}</span>
      </button>)}
    </section>

    <section className={styles.createBox}>
      <div>
        <h2>New draft claim</h2>
        <p>Keep the statement narrow. Put the source, artifact, or verification context in evidence. Numbers should be anchored in evidence before approval.</p>
      </div>
      <label>
        Claim statement
        <textarea
          value={newClaim.statement}
          maxLength={1000}
          placeholder="Exact fact Scout may later reuse"
          onChange={(event) => setNewClaim((value) => ({ ...value, statement: event.target.value }))}
        />
      </label>
      <label>
        Evidence
        <textarea
          value={newClaim.evidence}
          maxLength={4000}
          placeholder="Where this fact is supported or verified"
          onChange={(event) => setNewClaim((value) => ({ ...value, evidence: event.target.value }))}
        />
      </label>
      <button
        className={styles.primary}
        disabled={busy === "claim:new" || !newClaim.statement.trim() || !newClaim.evidence.trim()}
        onClick={() => void createClaim()}
      >Create draft</button>
    </section>

    <section className={styles.claimList}>
      {!visibleClaims.length && <div className={styles.empty}>No claims in this view.</div>}
      {visibleClaims.map((claim) => {
        const edit = edits[claim.id] ?? { statement: claim.statement, evidence: claim.evidence };
        const dirty = claim.status === "draft" && (edit.statement !== claim.statement || edit.evidence !== claim.evidence);
        const claimBusy = busy === `claim:${claim.id}`;
        const retired = isRetiredClaim(claim);
        return <article className={styles.card} key={claim.id}>
          <div className={styles.cardHeader}>
            <div>
              <code>{claim.id}</code>
              <span>Version {claim.version}</span>
            </div>
            <strong className={`${styles.status} ${styles[claim.status]}`}>{retired ? "retired" : claim.status}</strong>
          </div>

          {claim.status === "draft" ? <>
            <label>
              Statement
              <textarea
                value={edit.statement}
                maxLength={1000}
                onChange={(event) => setEdits((value) => ({ ...value, [claim.id]: { ...edit, statement: event.target.value } }))}
              />
            </label>
            <label>
              Evidence
              <textarea
                value={edit.evidence}
                maxLength={4000}
                onChange={(event) => setEdits((value) => ({ ...value, [claim.id]: { ...edit, evidence: event.target.value } }))}
              />
            </label>
            {dirty && <p className={styles.warning}>Unsaved edits are not reviewable. Save this version before approving or rejecting it.</p>}
            <div className={styles.actions}>
              <button
                disabled={!dirty || claimBusy || !edit.statement.trim() || !edit.evidence.trim()}
                onClick={() => void mutateClaim(claim, "edit", edit)}
              >Save version</button>
              <button
                className={styles.primary}
                disabled={dirty || claimBusy}
                title={dirty ? "Save edits before approval" : "Approve this exact saved version"}
                onClick={() => void mutateClaim(claim, "approve")}
              >Approve saved version</button>
              <button
                className={styles.rejectButton}
                disabled={dirty || claimBusy}
                title={dirty ? "Save or discard edits before rejection" : "Reject this exact saved version"}
                onClick={() => void mutateClaim(claim, "reject")}
              >Reject</button>
            </div>
          </> : <>
            <div className={styles.readOnlyBlock}><strong>Statement</strong><p>{claim.statement}</p></div>
            <div className={styles.readOnlyBlock}><strong>Evidence</strong><p>{claim.evidence}</p></div>
            <p className={styles.readOnlyNote}>{claim.status === "approved"
              ? "Approved evidence is immutable. Retire it if a newer claim should replace it; retirement preserves history but removes it from downstream use."
              : retired
                ? "Retired approved evidence is retained with its original approval timestamp and ignored by downstream fit, applications, and drafting."
                : "Rejected evidence is retained for review history and ignored by downstream fit/drafting."}</p>
            {claim.status === "approved" && <div className={styles.actions}>
              <button
                className={`${styles.rejectButton} ${styles.retireButton}`}
                disabled={claimBusy}
                aria-label={`Retire approved claim ${claim.id}`}
                onClick={() => void retireClaim(claim)}
              >{claimBusy ? "Retiring…" : "Retire approved claim"}</button>
            </div>}
          </>}

          <footer className={styles.meta}>
            <span>Created {formatTimestamp(claim.createdAt)}</span>
            <span>Approved {formatTimestamp(claim.approvedAt)}</span>
            {claim.updatedAt && <span>Updated {formatTimestamp(claim.updatedAt)}</span>}
          </footer>
        </article>;
      })}
    </section>

    <footer className={styles.boundary}>Only approved, usable claims may support Scout decisions. Retiring a claim changes evidence state only; it does not delete history, contact employers, send email, or submit applications.</footer>
  </main>;
}
