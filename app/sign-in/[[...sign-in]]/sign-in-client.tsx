"use client";

import { useEffect, useRef, useState } from "react";
import { loadClerkBrowser, safeClerkReturnTo } from "../../../lib/scout/clerk-browser";

export function ScoutSignIn({ publishableKey }: { publishableKey: string }) {
  const mountRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    const node = mountRef.current;
    if (!node) return;
    const returnTo = safeClerkReturnTo(new URLSearchParams(window.location.search).get("return_to"));

    void loadClerkBrowser(publishableKey).then((clerk) => {
      if (!active) return;
      if (clerk.isSignedIn) {
        window.location.replace(returnTo);
        return;
      }
      clerk.mountSignIn(node, {
        path: "/sign-in",
        routing: "path",
        withSignUp: false,
        fallbackRedirectUrl: returnTo,
        forceRedirectUrl: returnTo,
        signUpFallbackRedirectUrl: returnTo,
        signUpForceRedirectUrl: returnTo,
      });
    }).catch((caught) => {
      if (active) setError(caught instanceof Error ? caught.message : "Unable to load Scout sign-in");
    });

    return () => {
      active = false;
    };
  }, [publishableKey]);

  return <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: "32px 20px", background: "#f7f7f4" }}>
    <section style={{ width: "min(100%, 460px)", display: "grid", gap: 20 }}>
      <header style={{ textAlign: "center" }}>
        <p style={{ margin: 0, fontSize: 12, letterSpacing: ".14em", fontWeight: 700 }}>SCOUT / PRIVATE ACCESS</p>
        <h1 style={{ margin: "10px 0 8px", fontSize: 34 }}>Sign in to Scout</h1>
        <p style={{ margin: 0, lineHeight: 1.55 }}>Scout is owner-only. Authentication does not enable email sending or application submission.</p>
      </header>
      {error ? <div role="alert" style={{ padding: 14, border: "1px solid currentColor", borderRadius: 10 }}>{error}</div> : null}
      <div ref={mountRef} style={{ minHeight: 420, display: "grid", placeItems: "center" }} />
    </section>
  </main>;
}
