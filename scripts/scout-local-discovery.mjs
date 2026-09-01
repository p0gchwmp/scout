const retryableStatuses = new Set([408, 425, 429, 500, 502, 503, 504]);
const internshipPattern = /\b(intern|internship|trainee|apprentice|co-?op)\b/i;

function stripHtml(value) {
  return String(value ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function workplace(value) {
  const normalized = String(value ?? "").toLowerCase().replace(/[_\s]+/g, "-");
  if (normalized === "remote" || normalized === "hybrid") return normalized;
  if (normalized === "on-site" || normalized === "onsite") return "on-site";
  return "unspecified";
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function retryableFetchError(error) {
  if (!(error instanceof Error)) return false;
  return /timeout|timed out|abort|fetch failed|network/i.test(`${error.name} ${error.message}`);
}

async function fetchJson(url) {
  let lastError = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { accept: "application/json", "user-agent": "ScoutLocalDiscovery/0.2" },
        signal: AbortSignal.timeout(12_000),
        redirect: "follow",
      });
      if (response.ok) return response.json();
      const error = new Error(`HTTP ${response.status}`);
      if (!retryableStatuses.has(response.status) || attempt === 1) throw error;
      lastError = error;
    } catch (error) {
      if (attempt === 1 || !retryableFetchError(error)) throw error;
      lastError = error;
    }
    await sleep(250 * (attempt + 1));
  }
  throw lastError ?? new Error("fetch failed");
}

function base(source) {
  return {
    provider: source.provider,
    slug: source.slug,
    company: source.company,
    companyDomain: source.companyDomain,
    sourceUrl: source.sourceUrl,
    focus: source.focus,
  };
}

async function greenhouse(source) {
  const payload = await fetchJson(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(source.slug)}/jobs?content=true`);
  if (!Array.isArray(payload.jobs)) throw new Error("invalid Greenhouse payload");
  return payload.jobs.map((raw) => ({
    ...base(source),
    externalId: String(raw.id),
    canonicalUrl: String(raw.absolute_url),
    title: String(raw.title),
    description: stripHtml(raw.content),
    location: String(raw.location?.name ?? ""),
    workplaceType: "unspecified",
    postedAt: raw.updated_at ? String(raw.updated_at) : null,
  }));
}

async function lever(source) {
  const payload = await fetchJson(`https://api.lever.co/v0/postings/${encodeURIComponent(source.slug)}?mode=json`);
  if (!Array.isArray(payload)) throw new Error("invalid Lever payload");
  return payload.map((raw) => ({
    ...base(source),
    externalId: String(raw.id),
    canonicalUrl: String(raw.hostedUrl),
    title: String(raw.text),
    description: String(raw.descriptionPlain ?? stripHtml(raw.description)),
    location: String(raw.categories?.location ?? ""),
    workplaceType: workplace(raw.workplaceType),
    postedAt: null,
  }));
}

async function ashby(source) {
  const payload = await fetchJson(`https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(source.slug)}?includeCompensation=false`);
  if (payload?.apiVersion !== "1" || !Array.isArray(payload.jobs)) throw new Error("invalid Ashby payload");
  return payload.jobs.flatMap((raw) => {
    if (!raw || typeof raw !== "object" || raw.isListed === false) return [];
    const canonicalUrl = String(raw.jobUrl ?? "");
    let externalId = "";
    try { externalId = new URL(canonicalUrl).pathname.split("/").filter(Boolean).at(-1) ?? ""; }
    catch { return []; }
    if (!externalId) return [];
    return [{
      ...base(source),
      externalId,
      canonicalUrl,
      title: String(raw.title ?? ""),
      description: String(raw.descriptionPlain ?? ""),
      location: String(raw.location ?? ""),
      workplaceType: workplace(raw.workplaceType ?? (raw.isRemote === true ? "remote" : "")),
      postedAt: raw.publishedAt ? String(raw.publishedAt) : null,
    }];
  });
}

function workableJobPageUrl(value, source, externalId) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  let url;
  try { url = new URL(text); }
  catch { return null; }
  if (url.protocol !== "https:" || url.username || url.password || url.port || url.search || url.hash || url.hostname.toLowerCase() !== "apply.workable.com") return null;
  const parts = url.pathname.split("/").filter(Boolean);
  const current = parts.length === 2 && parts[0] === "j" && parts[1] === externalId;
  const legacy = parts.length === 3 && parts[0] === source.slug && parts[1] === "j" && parts[2] === externalId;
  return current || legacy ? url.href : null;
}

async function workable(source) {
  const payload = await fetchJson(`https://www.workable.com/api/accounts/${encodeURIComponent(source.slug)}?details=true`);
  if (!Array.isArray(payload?.jobs)) throw new Error("invalid Workable payload");
  return payload.jobs.flatMap((raw) => {
    const externalId = String(raw.shortcode ?? raw.code ?? "").trim();
    if (!externalId) return [];
    const canonicalUrl = [raw.shortlink, raw.application_url]
      .map((candidate) => workableJobPageUrl(candidate, source, externalId))
      .find(Boolean);
    if (!canonicalUrl) throw new Error("invalid Workable URL payload");
    return [{
      ...base(source),
      externalId,
      canonicalUrl,
      title: String(raw.title ?? ""),
      description: stripHtml(raw.description),
      location: [raw.city, raw.state, raw.country].map((value) => String(value ?? "").trim()).filter(Boolean).join(", "),
      workplaceType: workplace(raw.workplace_type ?? (raw.telecommuting === true ? "remote" : "")),
      postedAt: raw.published_on ? String(raw.published_on) : null,
    }];
  });
}

function smartRecruitersDescription(raw) {
  const sections = raw?.jobAd?.sections;
  if (!sections || typeof sections !== "object") return "";
  return ["companyDescription", "jobDescription", "qualifications", "additionalInformation"]
    .map((key) => stripHtml(sections[key]?.text))
    .filter(Boolean)
    .join("\n\n");
}

async function smartRecruitersPosting(source, postingId) {
  const raw = await fetchJson(`https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(source.slug)}/postings/${encodeURIComponent(postingId)}`);
  if (!raw || typeof raw !== "object" || raw.active === false) return null;
  if (String(raw.company?.identifier ?? "") !== source.slug) throw new Error("invalid SmartRecruiters company payload");
  const externalId = String(raw.id ?? "").trim();
  const canonicalUrl = String(raw.postingUrl ?? "").trim();
  if (!externalId || !canonicalUrl) throw new Error("invalid SmartRecruiters posting payload");
  return {
    ...base(source),
    externalId,
    canonicalUrl,
    title: String(raw.name ?? ""),
    description: smartRecruitersDescription(raw),
    location: [raw.location?.city, raw.location?.region, raw.location?.country].map((value) => String(value ?? "").trim()).filter(Boolean).join(", "),
    workplaceType: workplace(raw.location?.remote === true ? "remote" : ""),
    postedAt: raw.releasedDate ? String(raw.releasedDate) : null,
  };
}

async function smartRecruiters(source) {
  const candidateIds = [];
  let offset = 0;
  let total = null;
  while (total === null || offset < total) {
    const endpoint = new URL(`https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(source.slug)}/postings`);
    endpoint.searchParams.set("destination", "PUBLIC");
    endpoint.searchParams.set("limit", "100");
    endpoint.searchParams.set("offset", String(offset));
    const payload = await fetchJson(endpoint.href);
    if (!Array.isArray(payload?.content) || !Number.isInteger(payload.totalFound) || payload.totalFound < 0) throw new Error("invalid SmartRecruiters payload");
    total = payload.totalFound;
    if (total > 500) throw new Error("invalid SmartRecruiters payload: source exceeds safe 500-posting limit");
    for (const item of payload.content) {
      const id = String(item?.id ?? "").trim();
      const title = String(item?.name ?? "");
      if (id && internshipPattern.test(title)) candidateIds.push(id);
    }
    if (payload.content.length === 0) break;
    offset += payload.content.length;
  }
  const jobs = [];
  for (const postingId of [...new Set(candidateIds)]) {
    const job = await smartRecruitersPosting(source, postingId);
    if (job) jobs.push(job);
  }
  return jobs;
}

export const LOCAL_DISCOVERY_PROVIDERS = Object.freeze(["greenhouse", "lever", "ashby", "workable", "smartrecruiters"]);

export async function discoverLocalSource(source) {
  switch (source.provider) {
    case "greenhouse": return greenhouse(source);
    case "lever": return lever(source);
    case "ashby": return ashby(source);
    case "workable": return workable(source);
    case "smartrecruiters": return smartRecruiters(source);
    default: throw new Error(`unsupported local discovery provider: ${source.provider}`);
  }
}

export function stableLocalDiscoveryFailure(error) {
  const message = error instanceof Error ? `${error.name} ${error.message}` : "";
  if (/HTTP 404/.test(message)) return "Registered public ATS source no longer resolves and needs catalog review";
  if (/HTTP 429/.test(message)) return "Public ATS source was rate-limited after one bounded retry; try the next Scout run";
  if (/timeout|timed out|abort/i.test(message)) return "Public ATS source timed out after one bounded retry";
  if (/HTTP (408|425|500|502|503|504)/.test(message)) return "Public ATS source remained temporarily unavailable after one bounded retry";
  if (/invalid .* payload/i.test(message)) return "Public ATS source returned an unexpected payload and needs adapter review";
  if (/unsupported local discovery provider/i.test(message)) return "Local development discovery does not support this registered ATS provider yet";
  return "Public ATS source was temporarily unavailable";
}
