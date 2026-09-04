type ClerkSignInProps = {
  fallbackRedirectUrl?: string;
  forceRedirectUrl?: string;
  signUpFallbackRedirectUrl?: string;
  signUpForceRedirectUrl?: string;
  withSignUp?: boolean;
  routing?: "hash" | "path";
  path?: string;
};

type ClerkBrowser = {
  isSignedIn?: boolean;
  load(options?: { ui?: { ClerkUI?: unknown }; signInUrl?: string }): Promise<void>;
  mountSignIn(node: HTMLDivElement, props?: ClerkSignInProps): void;
  unmountSignIn?(node: HTMLDivElement): void;
  signOut(options?: { redirectUrl?: string }): Promise<void>;
};

type ClerkWindow = Window & typeof globalThis & {
  Clerk?: ClerkBrowser;
  __internal_ClerkUICtor?: unknown;
};

function clerkWindow() {
  return window as ClerkWindow;
}

export function safeClerkReturnTo(value: string | null | undefined): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/";
  let url: URL;
  try {
    url = new URL(value, window.location.origin);
  } catch {
    return "/";
  }
  if (url.origin !== window.location.origin) return "/";
  if (["/sign-in", "/sign-out", "/signin-with-chatgpt", "/signout-with-chatgpt", "/callback"].includes(url.pathname)) return "/";
  return `${url.pathname}${url.search}${url.hash}`;
}

export function clerkFrontendDomain(publishableKey: string): string {
  const parts = publishableKey.split("_");
  if (parts.length < 3 || !/^pk_(?:test|live)_/.test(publishableKey)) {
    throw new Error("Clerk publishable key is invalid");
  }
  let decoded: string;
  try {
    decoded = atob(parts.slice(2).join("_")).slice(0, -1);
  } catch {
    throw new Error("Clerk publishable key cannot be decoded");
  }
  let url: URL;
  try {
    url = new URL(`https://${decoded}`);
  } catch {
    throw new Error("Clerk publishable key contains an invalid Frontend API domain");
  }
  if (url.protocol !== "https:" || url.pathname !== "/" || url.search || url.hash || url.username || url.password || !url.hostname) {
    throw new Error("Clerk Frontend API domain is invalid");
  }
  return url.hostname;
}

function loadScript(id: string, src: string, attributes: Record<string, string> = {}) {
  return new Promise<void>((resolve, reject) => {
    const existing = document.getElementById(id) as HTMLScriptElement | null;
    if (existing) {
      if (existing.dataset.scoutLoaded === "1") return resolve();
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error(`Unable to load ${id}`)), { once: true });
      return;
    }
    const script = document.createElement("script");
    script.id = id;
    script.src = src;
    script.async = true;
    script.crossOrigin = "anonymous";
    for (const [key, value] of Object.entries(attributes)) script.setAttribute(key, value);
    script.addEventListener("load", () => {
      script.dataset.scoutLoaded = "1";
      resolve();
    }, { once: true });
    script.addEventListener("error", () => reject(new Error(`Unable to load ${id}`)), { once: true });
    document.head.appendChild(script);
  });
}

let clerkLoadPromise: Promise<ClerkBrowser> | null = null;

export function loadClerkBrowser(publishableKey: string): Promise<ClerkBrowser> {
  clerkLoadPromise ??= (async () => {
    const domain = clerkFrontendDomain(publishableKey);
    await loadScript("scout-clerk-ui", `https://${domain}/npm/@clerk/ui@1/dist/ui.browser.js`);
    await loadScript(
      "scout-clerk-js",
      `https://${domain}/npm/@clerk/clerk-js@6/dist/clerk.browser.js`,
      { "data-clerk-publishable-key": publishableKey },
    );
    const current = clerkWindow();
    if (!current.Clerk) throw new Error("Clerk browser SDK did not initialize");
    await current.Clerk.load({
      ui: { ClerkUI: current.__internal_ClerkUICtor },
      signInUrl: "/sign-in",
    });
    return current.Clerk;
  })();
  return clerkLoadPromise;
}
