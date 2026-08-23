import { classifyPlatformUrl, type ScoutPlatformId, type ScoutPlatformKind } from "./platform-registry.ts";

export type ApplicationChannel = {
  id: ScoutPlatformId;
  label: string;
  kind: ScoutPlatformKind;
  automation: "structured" | "browser_assist" | "manual_lead";
  note: string;
  requiresOfficialResolution: boolean;
  easyApplyAssist: boolean;
};

export function classifyApplicationUrl(value: string): ApplicationChannel {
  const platform = classifyPlatformUrl(value);
  const automation = platform.application === "structured_prepare"
    ? "structured"
    : platform.application === "browser_assist"
      ? "browser_assist"
      : "manual_lead";
  return {
    id: platform.id,
    label: platform.label,
    kind: platform.kind,
    automation,
    note: platform.note,
    requiresOfficialResolution: platform.requiresOfficialResolution,
    easyApplyAssist: platform.easyApplyAssist,
  };
}
