import { getScoutOwnerUserId, requireChatGPTUser } from "../chatgpt-auth";
import { requireScoutPageOwner } from "../scout-api";
import { ApplicationWorkspace } from "./workspace-client";

export default async function ApplicationsPage() {
  const user = await requireChatGPTUser("/applications");
  await requireScoutPageOwner(user, getScoutOwnerUserId);
  return <ApplicationWorkspace />;
}
