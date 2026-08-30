export const APPLICATION_PROFILE_BINDING_CAPABILITIES = Object.freeze({
  pinVerifiedEvidenceRows: true,
  requireCurrentVerificationBeforeBrowserAssist: true,
  allowLegacyUnpinnedBrowserAssist: false,
  inferProfileValues: false,
  submitApplication: false,
} as const);

export type ProfileBindingField = {
  id: string;
  kind: string;
  claim: string;
  verified: boolean;
  updatedAt?: string | null;
};

export type ApplicationProfileBinding = {
  id: string;
  kind: string;
  updatedAt: string | null;
};

function cleanString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function packetObject(packet: unknown) {
  return packet && typeof packet === "object" && !Array.isArray(packet)
    ? packet as Record<string, unknown>
    : null;
}

function safeFieldEntries(packet: unknown) {
  const record = packetObject(packet);
  const raw = record?.safeFields;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [] as [string, string][];
  return Object.entries(raw as Record<string, unknown>).flatMap(([kind, value]) => {
    const cleanKind = kind.trim();
    const cleanValue = cleanString(value);
    return cleanKind && cleanValue ? [[cleanKind, cleanValue] as [string, string]] : [];
  }).sort(([left], [right]) => left.localeCompare(right));
}

function parsedBindings(packet: unknown): ApplicationProfileBinding[] | null {
  const record = packetObject(packet);
  if (!record || !Array.isArray(record.profileBindings)) return null;
  const bindings: ApplicationProfileBinding[] = [];
  for (const raw of record.profileBindings) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const item = raw as Record<string, unknown>;
    const id = cleanString(item.id);
    const kind = cleanString(item.kind);
    const updatedAt = item.updatedAt === null ? null : cleanString(item.updatedAt);
    if (!id || !kind || (item.updatedAt !== null && !updatedAt)) return null;
    bindings.push({ id, kind, updatedAt });
  }
  if (new Set(bindings.map((binding) => binding.kind)).size !== bindings.length) return null;
  if (new Set(bindings.map((binding) => binding.id)).size !== bindings.length) return null;
  return bindings.sort((left, right) => left.kind.localeCompare(right.kind));
}

export function buildApplicationProfileBindings(
  fields: readonly ProfileBindingField[],
  safeFields: Record<string, string>,
): ApplicationProfileBinding[] {
  const byKind = new Map<string, ProfileBindingField>();
  for (const field of fields) {
    if (!field.verified || field.kind === "graduation_year" || !field.id.trim() || !field.claim.trim()) continue;
    byKind.set(field.kind, field);
  }
  return Object.entries(safeFields)
    .sort(([left], [right]) => left.localeCompare(right))
    .flatMap(([kind, value]) => {
      const field = byKind.get(kind);
      if (!field || field.claim.trim() !== value.trim()) return [];
      return [{ id: field.id.trim(), kind, updatedAt: field.updatedAt?.trim() || null }];
    });
}

export function applicationPacketProfileBindingIssues(
  packet: unknown,
  currentFields: readonly ProfileBindingField[],
): string[] {
  const safeEntries = safeFieldEntries(packet);
  if (!safeEntries.length) return ["Application packet has no pinned verified profile values"];
  const bindings = parsedBindings(packet);
  if (!bindings) return ["Application packet predates verified profile-evidence pinning"];
  if (bindings.length !== safeEntries.length) return ["Application packet profile bindings do not cover every reusable value"];

  const safeFields = new Map(safeEntries);
  const bindingKinds = bindings.map((binding) => binding.kind).sort();
  const safeKinds = safeEntries.map(([kind]) => kind).sort();
  if (bindingKinds.some((kind, index) => kind !== safeKinds[index])) {
    return ["Application packet profile bindings do not match reusable profile keys"];
  }

  const currentById = new Map(currentFields.map((field) => [field.id.trim(), field]));
  const issues: string[] = [];
  for (const binding of bindings) {
    const field = currentById.get(binding.id);
    const expectedValue = safeFields.get(binding.kind) ?? "";
    if (!field || !field.verified || field.kind !== binding.kind) {
      issues.push(`Verified profile evidence changed: ${binding.kind}`);
      continue;
    }
    const currentUpdatedAt = field.updatedAt?.trim() || null;
    if (!binding.updatedAt || currentUpdatedAt !== binding.updatedAt || field.claim.trim() !== expectedValue) {
      issues.push(`Verified profile evidence changed: ${binding.kind}`);
    }
  }
  return [...new Set(issues)];
}

export function applicationPacketProfileBindingsCurrent(
  packet: unknown,
  currentFields: readonly ProfileBindingField[],
) {
  return applicationPacketProfileBindingIssues(packet, currentFields).length === 0;
}
