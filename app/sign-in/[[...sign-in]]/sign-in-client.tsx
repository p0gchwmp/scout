"use client";

import { useEffect, useRef, useState } from "react";
import { loadClerkBrowser, safeClerkReturnTo } from "../../../lib/scout/clerk-browser";

const REDIRECT_MARKER_KEY = "scout-clerk-sign-in-redirect";
const REDIRECT_LOOP_WINDOW_MS = 15_000;

type RedirectMarker = { returnTo: string; at: number };

function recentRedirectMarker(returnTo: string) {
  try {
    const raw = window.sessionStorage.getItem(REDIRECT_MARKER_KEY);
    if (!raw) return false;
    const marker = JSON.parse(raw) as Partial<RedirectMarker>;
    return marker.returnTo === returnTo
      && typeof marker.at === "number"
      && Date.now() - marker.at >= 0
      && Date.now() - marker.at < REDIRECT_LOOP_WINDOW_MS;
  } catch {
    return false;
  }
}

function rememberRedirect(returnTo: string) {
  try {
    window.sessionStorage.setItem(REDIRECT_MARKER_KEY, JSON.stringify({ returnTo, at: Date.now() } satisfies RedirectMarker));
  } catch {
    // Storage can be unavailable in hardened/private browser contexts. The
    // primary owner-route policy still prevents the known hosted loop.
  }
}

function clearRedirectMarker() {
  try {
    window.sessionStorage.removeItem(REDIRECT_MARKER_KEY);
  } catch {
    // Ignore unavailable storage.
  }
}

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
        if (recentRedirectMarker(returnTo)) {
          setError("Scout detected a repeated sign-in redirect. Your browser session exists, but the server did not accept it for this page. Reload once; if it continues, sign out and sign back in.");
          return;
        }
        rememberRedirect(returnTo);
        window.location.replace(returnTo);
        return;
      }
      clearRedirectMarker();
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
