"use client";

import Link from "next/link";
import { useEffect } from "react";

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Scout page crashed", { name: error.name, digest: error.digest });
  }, [error]);

  return <main className="dashboard">
    <header className="hero">
      <div>
        <p className="eyebrow">SCOUT · RECOVERY</p>
        <h1>Scout hit a page error.</h1>
        <p>Your saved data was not intentionally changed by this screen. Retry the page first; if it repeats, use the readiness check before continuing.</p>
      </div>
      <aside><strong>Safety boundary</strong><span>No application submission or email sending was triggered by this error.</span></aside>
    </header>
    <div className="alert error">{error.message || "Unexpected Scout page error"}</div>
    <div className="actions">
      <button onClick={reset}>Try again</button>
      <a href="/api/health">Open readiness check</a>
      <Link href="/">Return to dashboard</Link>
    </div>
  </main>;
}
