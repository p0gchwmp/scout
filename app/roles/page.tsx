import { getScoutOwnerUserId, requireChatGPTUser } from "../chatgpt-auth";
import { requireScoutPageOwner } from "../scout-api";
import { RoleIndexWorkspace } from "./role-index-client";

export default async function RolesPage() {
  const user = await requireChatGPTUser("/roles");
  await requireScoutPageOwner(user, getScoutOwnerUserId);
  return <RoleIndexWorkspace />;
}
