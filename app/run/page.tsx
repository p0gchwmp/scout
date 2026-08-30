import { getScoutOwnerUserId, requireChatGPTUser } from "../chatgpt-auth";
import { requireScoutPageOwner } from "../scout-api";
import { RunScoutWorkspace } from "./run-client";

export default async function RunScoutPage() {
  const user = await requireChatGPTUser("/run");
  await requireScoutPageOwner(user, getScoutOwnerUserId);
  return <RunScoutWorkspace />;
}
