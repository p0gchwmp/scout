import { getScoutOwnerUserId, requireChatGPTUser } from "../chatgpt-auth";
import { requireScoutPageOwner } from "../scout-api";
import { CompanyOutreachWorkspace } from "./company-outreach-client";

export default async function CompanyOutreachPage() {
  const user = await requireChatGPTUser("/company-outreach");
  await requireScoutPageOwner(user, getScoutOwnerUserId);
  return <CompanyOutreachWorkspace />;
}
