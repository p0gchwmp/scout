import { getScoutOwnerUserId, requireChatGPTUser } from "../chatgpt-auth";
import { requireScoutPageOwner } from "../scout-api";
import { PreferenceCalibrationWorkspace } from "./preference-client";

export default async function PreferencesPage() {
  const user = await requireChatGPTUser("/preferences");
  await requireScoutPageOwner(user, getScoutOwnerUserId);
  return <PreferenceCalibrationWorkspace />;
}
