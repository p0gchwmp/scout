import Link from "next/link";
import { getScoutOwnerUserId, requireChatGPTUser } from "../chatgpt-auth";
import { requireScoutPageOwner } from "../scout-api";
import { ApplicationWorkspace } from "./workspace-client";
import styles from "./mobile-actions.module.css";

const mobileActions = [
  ["Queue", "/applications"],
  ["Shortlist", "/shortlist"],
  ["Safe Fill", "/assist"],
  ["Review", "/review"],
  ["Track", "/outcomes"],
] as const;

export default async function ApplicationsPage() {
  const user = await requireChatGPTUser("/applications");
  await requireScoutPageOwner(user, getScoutOwnerUserId);
  return <>
    <ApplicationWorkspace />
    <nav className={styles.mobileDock} aria-label="Application quick actions">
      {mobileActions.map(([label, href]) => <Link key={href} href={href} aria-current={href === "/applications" ? "page" : undefined}>{label}</Link>)}
    </nav>
  </>;
}
