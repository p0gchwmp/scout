import { requireChatGPTUser } from "../chatgpt-auth";
import { BrowserAssist } from "./assist-client";

export default async function AssistPage() {
  await requireChatGPTUser("/assist");
  return <BrowserAssist />;
}
