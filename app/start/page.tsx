import Link from "next/link";
import { getScoutOwnerUserId, requireChatGPTUser } from "../chatgpt-auth";
import { requireScoutPageOwner } from "../scout-api";
import styles from "./start.module.css";

const steps = [
  { n: "01", title: "Check readiness", body: "Confirm Scout is healthy and its owner-only/local boundaries are intact before doing real work.", href: "/readiness", cta: "Open readiness" },
  { n: "02", title: "Run discovery", body: "Run the safe discovery/research/preparation stages. Scout may prepare evidence; it does not contact employers.", href: "/run", cta: "Run Scout" },
  { n: "03", title: "Review the shortlist", body: "Compare fit, eligibility, opportunity quality and approved supporting claims before choosing a role.", href: "/shortlist", cta: "Review roles" },
  { n: "04", title: "Prepare the application", body: "Create a snapshot-pinned review packet and use Safe Fill only after checking live form constraints yourself.", href: "/applications", cta: "Applications" },
  { n: "05", title: "Review contact evidence", body: "Accept only explicitly published business/recruiting contacts with exact provenance, then review any outreach draft.", href: "/review", cta: "Review queue" },
  { n: "06", title: "Track what happened", body: "After you act externally, record the submission and explicit outcomes so Scout can learn bounded, inspectable preferences.", href: "/outcomes", cta: "Outcomes" },
] as const;

export default async function StartPage() {
  const user = await requireChatGPTUser("/start");
  await requireScoutPageOwner(user, getScoutOwnerUserId);

  return <main className={styles.shell}>
    <header className={styles.hero}>
      <div><p className={styles.kicker}>SCOUT / START HERE</p><h1>From discovery to a reviewed application, without losing the evidence trail.</h1></div>
      <Link className={styles.home} href="/">Dashboard</Link>
    </header>

    <section className={styles.guardrail}>
      <strong>You stay at every trust boundary.</strong>
      <p>Scout can discover, verify, rank, prepare, research public business contacts and draft. Employer-side submission and email sending remain manual.</p>
    </section>

    <section className={styles.steps} aria-label="Scout first-use workflow">
      {steps.map((step) => <article key={step.n} className={styles.card}>
        <span>{step.n}</span><h2>{step.title}</h2><p>{step.body}</p><Link href={step.href}>{step.cta} →</Link>
      </article>)}
    </section>

    <nav className={styles.mobileBar} aria-label="Fast Scout actions">
      <Link href="/run">Run</Link><Link href="/shortlist">Review</Link><Link href="/applications">Apply prep</Link><Link href="/outcomes">Track</Link>
    </nav>
  </main>;
}
