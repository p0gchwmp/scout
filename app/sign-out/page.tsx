import { ScoutSignOut } from "./sign-out-client";

export default function SignOutPage() {
  const publishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.trim() ?? "";
  if (!publishableKey) {
    return <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24 }}>
      <p>Scout authentication is not configured.</p>
    </main>;
  }
  return <ScoutSignOut publishableKey={publishableKey} />;
}
