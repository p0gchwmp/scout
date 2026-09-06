"use client";

import { useEffect } from "react";
import { loadClerkBrowser } from "../lib/scout/clerk-browser";

const SESSION_REFRESH_INTERVAL_MS = 45_000;
const SESSION_REFRESH_MAX_AGE_MS = 40_000;

function sameOriginRequest(input: RequestInfo | URL) {
  try {
    const raw = typeof input === "string" || input instanceof URL ? input.toString() : input.url;
    return new URL(raw, window.location.href).origin === window.location.origin;
  } catch {
    return false;
  }
}

export function ClerkSessionKeeper({ publishableKey }: { publishableKey: string }) {
  useEffect(() => {
    let active = true;
    let refreshInFlight: Promise<boolean> | null = null;
    let lastRefreshAt = 0;
    const originalFetch = window.fetch;

    const refreshSession = (force = false): Promise<boolean> => {
      if (!force && Date.now() - lastRefreshAt < SESSION_REFRESH_MAX_AGE_MS) {
        return Promise.resolve(true);
      }
      if (refreshInFlight) return refreshInFlight;

      refreshInFlight = (async () => {
        const clerk = await loadClerkBrowser(publishableKey);
        if (!active || !clerk.isSignedIn || !clerk.session) return false;
        const token = await clerk.session.getToken({ skipCache: true });
        if (!token) return false;
        lastRefreshAt = Date.now();
        return true;
      })().catch(() => false).finally(() => {
        refreshInFlight = null;
      });

      return refreshInFlight;
    };

    const guardedFetch: typeof window.fetch = async (input, init) => {
      // Next/Vinext client navigation and Scout API calls both use same-origin
      // fetches. When a tab wakes after browser timer throttling, wait for Clerk
      // to mint a fresh short-lived session token before those requests leave.
      if (active && sameOriginRequest(input)) await refreshSession(false);
      return originalFetch.call(window, input, init);
    };

    window.fetch = guardedFetch;

    const refreshWhenActive = () => {
      if (document.visibilityState === "visible") void refreshSession(true);
    };

    window.addEventListener("focus", refreshWhenActive);
    window.addEventListener("pageshow", refreshWhenActive);
    document.addEventListener("visibilitychange", refreshWhenActive);

    // Force one refresh on mount instead of assuming the cookie minted during
    // sign-in is still fresh by the time the authenticated app hydrates.
    void refreshSession(true);
    const interval = window.setInterval(refreshWhenActive, SESSION_REFRESH_INTERVAL_MS);

    return () => {
      active = false;
      window.clearInterval(interval);
      window.removeEventListener("focus", refreshWhenActive);
      window.removeEventListener("pageshow", refreshWhenActive);
      document.removeEventListener("visibilitychange", refreshWhenActive);
      if (window.fetch === guardedFetch) window.fetch = originalFetch;
    };
  }, [publishableKey]);

  return null;
}
