import { readFile } from "node:fs/promises";
import {
  fetchApifyLeadContext,
  pushLeadContextToUnify,
  sanitizeLeadContextRecord,
  type LeadContextProvider,
} from "../lib/scout/lead-context-providers.ts";

function args(argv: string[]) {
  const parsed = new Map<string, string | true>();
  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    if (!current.startsWith("--")) throw new Error(`Unexpected argument: ${current}`);
    const name = current.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) parsed.set(name, true);
    else {
      parsed.set(name, next);
      index += 1;
    }
  }
  return parsed;
}

function value(parsed: Map<string, string | true>, name: string) {
  const found = parsed.get(name);
  return typeof found === "string" ? found : null;
}

function provider(value: string | null): LeadContextProvider {
  if (value === "apify" || value === "phantombuster" || value === "brightdata" || value === "scrapingdog" || value === "generic") return value;
  throw new Error("--provider must be apify, phantombuster, brightdata, scrapingdog, or generic");
}

async function importedRecord(path: string) {
  const text = await readFile(path, "utf8");
  if (text.length > 1_000_000) throw new Error("Lead-context import exceeds 1 MB");
  try { return JSON.parse(text) as unknown; }
  catch { throw new Error("Lead-context import is not valid JSON"); }
}

async function main() {
  const parsed = args(process.argv.slice(2));
  const selected = provider(value(parsed, "provider"));
  const linkedinUrl = value(parsed, "url");
  if (!linkedinUrl) throw new Error("--url with an exact public LinkedIn person/company/job URL is required");

  const context = selected === "apify"
    ? await fetchApifyLeadContext({
        apiToken: process.env.SCOUT_APIFY_API_TOKEN ?? "",
        actorId: process.env.SCOUT_APIFY_LINKEDIN_ACTOR_ID ?? "",
        linkedinUrl,
      })
    : sanitizeLeadContextRecord({
        provider: selected,
        linkedinUrl,
        raw: await importedRecord(value(parsed, "file") ?? ""),
      });

  if (parsed.has("push-unify")) {
    await pushLeadContextToUnify({
      apiKey: process.env.SCOUT_UNIFY_API_KEY ?? "",
      objectName: process.env.SCOUT_UNIFY_OBJECT ?? "",
      context,
    });
  }

  process.stdout.write(`${JSON.stringify(context, null, 2)}\n`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : "Lead-context command failed";
  process.stderr.write(`Scout lead-context error: ${message}\n`);
  process.exitCode = 1;
});
