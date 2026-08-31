import { getScoutOwnerUserId, requireChatGPTUser } from "../chatgpt-auth";
import { requireScoutPageOwner } from "../scout-api";
import { RuntimePreflightPanel } from "./runtime-preflight-panel";
import { SetupWorkspace } from "./setup-client";

export default async function SetupPage() {
  const user = await requireChatGPTUser("/setup");
  await requireScoutPageOwner(user, getScoutOwnerUserId);
  return <>
    <RuntimePreflightPanel />
    <SetupWorkspace />
  </>;
}
