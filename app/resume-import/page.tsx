import { getScoutOwnerUserId, requireChatGPTUser } from "../chatgpt-auth";
import { requireScoutPageOwner } from "../scout-api";
import { ResumeImportClient } from "./resume-import-client";

export default async function ResumeImportPage() {
  const user = await requireChatGPTUser("/resume-import");
  await requireScoutPageOwner(user, getScoutOwnerUserId);
  return <ResumeImportClient />;
}
