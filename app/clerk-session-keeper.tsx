"use client";

import { useEffect } from "react";
import { loadClerkBrowser } from "../lib/scout/clerk-browser";

export function ClerkSessionKeeper({ publishableKey }: { publishableKey: string }) {
  useEffect(() => {
    // Clerk session JWTs are intentionally short-lived. Keep ClerkJS mounted on
    // authenticated Scout pages so its normal background refresh can renew the
    // same-origin __session cookie before server/API navigation needs it.
    void loadClerkBrowser(publishableKey).catch(() => {
      // Fail closed: the server-side Clerk proxy remains authoritative. If the
      // browser SDK cannot refresh, protected requests will return to sign-in.
    });
  }, [publishableKey]);

  return null;
}
