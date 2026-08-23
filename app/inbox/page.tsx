import { getScoutOwnerUserId, requireChatGPTUser } from "../chatgpt-auth";
import { requireScoutPageOwner } from "../scout-api";
import { InternshipInbox } from "./inbox-client";

export default async function InboxPage() {
  const user = await requireChatGPTUser("/inbox");
  await requireScoutPageOwner(user, getScoutOwnerUserId);
  return <InternshipInbox />;
}
