import { getScoutOwnerUserId, requireChatGPTUser } from "../chatgpt-auth";
import { requireScoutPageOwner } from "../scout-api";
import { ShortlistWorkspace } from "./shortlist-client";

export default async function ShortlistPage() {
  const user = await requireChatGPTUser("/shortlist");
  await requireScoutPageOwner(user, getScoutOwnerUserId);
  return <ShortlistWorkspace />;
}
