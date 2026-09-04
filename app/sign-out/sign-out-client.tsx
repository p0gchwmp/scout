"use client";

import { useEffect, useState } from "react";
import { loadClerkBrowser } from "../../lib/scout/clerk-browser";

export function ScoutSignOut({ publishableKey }: { publishableKey: string }) {
  const [message, setMessage] = useState("Signing out…");

  useEffect(() => {
    let active = true;
    void loadClerkBrowser(publishableKey).then(async (clerk) => {
      if (!active) return;
      if (clerk.isSignedIn) {
        await clerk.signOut({ redirectUrl: "/sign-in" });
        return;
      }
      window.location.replace("/sign-in");
    }).catch(() => {
      if (active) setMessage("Unable to complete sign-out. Close this browser tab or return to Scout sign-in.");
    });
    return () => {
      active = false;
    };
  }, [publishableKey]);

  return <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24 }}>
    <p>{message}</p>
  </main>;
}
