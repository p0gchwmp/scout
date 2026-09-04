import { ScoutSignIn } from "./sign-in-client";

export default function SignInPage() {
  const publishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.trim() ?? "";
  if (!publishableKey) {
    return <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24 }}>
      <section style={{ maxWidth: 520 }}>
        <h1>Scout authentication is not configured.</h1>
        <p>The hosted runtime is missing its Clerk publishable key. Scout remains closed.</p>
      </section>
    </main>;
  }
  return <ScoutSignIn publishableKey={publishableKey} />;
}
