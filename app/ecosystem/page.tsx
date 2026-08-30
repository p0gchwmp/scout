import { getScoutOwnerUserId, requireChatGPTUser } from "../chatgpt-auth";
import { requireScoutPageOwner } from "../scout-api";
import { EcosystemWorkspace } from "./ecosystem-client";

export default async function EcosystemPage() {
  const user = await requireChatGPTUser("/ecosystem");
  await requireScoutPageOwner(user, getScoutOwnerUserId);
  return <EcosystemWorkspace />;
}
