"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import styles from "./voice.module.css";

type ProfileField = {
  id: string;
  kind: string;
  claim: string;
  evidence: string;
  verified: boolean;
  updatedAt: string;
};

const DEFAULT_NOTE = "Understated, specific and professional. Avoid hype, corporate fluff and exaggerated enthusiasm.";

export function WritingVoice() {
  const [fields, setFields] = useState<ProfileField[]>([]);
  const [sample, setSample] = useState("");
  const [styleNote, setStyleNote] = useState(DEFAULT_NOTE);
  const [sampleEvidence, setSampleEvidence] = useState("User-provided writing sample for Scout voice matching");
  const [noteEvidence, setNoteEvidence] = useState("User-approved Scout writing preference");
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const response = await fetch("/api/profile");
    const payload = await response.json() as { fields?: ProfileField[]; error?: string };
    if (!response.ok) throw new Error(payload.error ?? "Unable to load writing profile");
    const next = payload.fields ?? [];
    setFields(next);
    const storedSample = next.find((field) => field.kind === "writing_sample");
    const storedNote = next.find((field) => field.kind === "writing_style_note");
    if (storedSample) { setSample(storedSample.claim); setSampleEvidence(storedSample.evidence); }
    if (storedNote) { setStyleNote(storedNote.claim); setNoteEvidence(storedNote.evidence); }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load().catch((caught) => setError(caught instanceof Error ? caught.message : "Unable to load writing profile")); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const sampleField = fields.find((field) => field.kind === "writing_sample");
  const noteField = fields.find((field) => field.kind === "writing_style_note");

  async function save(kind: "writing_sample" | "writing_style_note", claim: string, evidence: string) {
    setBusy(`save-${kind}`); setError(""); setNotice("");
    try {
      const current = fields.find((field) => field.kind === kind);
      if (current?.verified) throw new Error("Unverify this writing input before editing it.");
      const response = await fetch("/api/profile", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind, claim, evidence }),
      });
      const payload = await response.json() as { field?: ProfileField; error?: string };
      if (!response.ok || !payload.field) throw new Error(payload.error ?? "Unable to save writing input");
      await load();
      setNotice("Saved as unverified. Verify it before Scout uses it for AI writing.");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to save writing input"); }
    finally { setBusy(null); }
  }

  async function review(field: ProfileField, action: "verify" | "unverify") {
    setBusy(`${action}-${field.id}`); setError(""); setNotice("");
    try {
      const response = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: field.id, action, expectedUpdatedAt: field.updatedAt }),
      });
      const payload = await response.json() as { error?: string };
      if (response.status === 409) {
        await load();
        throw new Error(payload.error ?? "Writing input changed elsewhere. Latest value reloaded; review it before retrying.");
      }
      if (!response.ok) throw new Error(payload.error ?? "Unable to update writing input");
      await load();
      setNotice(action === "verify" ? "Verified. Scout may now use this input for outreach and non-sensitive application-answer style." : "Unverified. Scout will stop using this input until you verify it again.");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to update writing input"); }
    finally { setBusy(null); }
  }

  return <main className={styles.shell}>
    <header className={styles.header}>
      <div><p className={styles.kicker}>SCOUT / WRITING VOICE</p><h1>Sound like you, not a template.</h1><p>Give Scout a real sample of your own writing and a short style note. These inputs affect wording only. They cannot add credentials, metrics, eligibility, referrals or experience, and they are never autofilled into employer forms.</p></div>
      <div className={styles.links}><Link href="/">Dashboard</Link><Link href="/assist">Browser Assist</Link><Link href="/inbox">Internship Inbox</Link></div>
    </header>

    {notice && <div className={styles.notice}>{notice}</div>}
    {error && <div className={`${styles.notice} ${styles.error}`}>{error}</div>}

    <section className={styles.card}>
      <div className={styles.cardHead}><div><p className={styles.kicker}>VOICE SAMPLE</p><h2>2–3 paragraphs you actually wrote</h2></div><span className={sampleField?.verified ? styles.verified : styles.unverified}>{sampleField?.verified ? "verified" : "not verified"}</span></div>
      <p>Use normal emails, messages, essays or notes that sound like you. Remove private details you do not want the model to see.</p>
      <textarea value={sample} disabled={sampleField?.verified} maxLength={6000} onChange={(event) => setSample(event.target.value)} placeholder="Paste a representative sample of your writing…" />
      <label>Evidence / note<input value={sampleEvidence} disabled={sampleField?.verified} onChange={(event) => setSampleEvidence(event.target.value)} /></label>
      <div className={styles.actions}>
        <button disabled={Boolean(sampleField?.verified) || busy === "save-writing_sample" || !sample.trim()} onClick={() => void save("writing_sample", sample, sampleEvidence)}>Save unverified sample</button>
        {sampleField && <button className={sampleField.verified ? styles.secondary : styles.primary} disabled={busy?.endsWith(sampleField.id)} onClick={() => void review(sampleField, sampleField.verified ? "unverify" : "verify")}>{sampleField.verified ? "Unverify to edit" : "Verify sample"}</button>}
      </div>
    </section>

    <section className={styles.card}>
      <div className={styles.cardHead}><div><p className={styles.kicker}>STYLE NOTE</p><h2>What Scout should aim for</h2></div><span className={noteField?.verified ? styles.verified : styles.unverified}>{noteField?.verified ? "verified" : "not verified"}</span></div>
      <textarea value={styleNote} disabled={noteField?.verified} maxLength={1200} onChange={(event) => setStyleNote(event.target.value)} />
      <label>Evidence / note<input value={noteEvidence} disabled={noteField?.verified} onChange={(event) => setNoteEvidence(event.target.value)} /></label>
      <div className={styles.actions}>
        <button disabled={Boolean(noteField?.verified) || busy === "save-writing_style_note" || !styleNote.trim()} onClick={() => void save("writing_style_note", styleNote, noteEvidence)}>Save unverified note</button>
        {noteField && <button className={noteField.verified ? styles.secondary : styles.primary} disabled={busy?.endsWith(noteField.id)} onClick={() => void review(noteField, noteField.verified ? "unverify" : "verify")}>{noteField.verified ? "Unverify to edit" : "Verify style note"}</button>}
      </div>
    </section>

    <section className={styles.safety}><strong>Style cannot override evidence.</strong> Scout&apos;s Humanizer-inspired pass must preserve approved claim IDs and rejects newly introduced numerical/contact anchors. Sensitive application questions remain manual.</section>
  </main>;
}
