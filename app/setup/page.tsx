import { getScoutOwnerUserId, requireChatGPTUser } from "../chatgpt-auth";
import { requireScoutPageOwner } from "../scout-api";
import { SetupWorkspace } from "./setup-client";

export default async function SetupPage() {
  const user = await requireChatGPTUser("/setup");
  await requireScoutPageOwner(user, getScoutOwnerUserId);
  return <SetupWorkspace />;
}
