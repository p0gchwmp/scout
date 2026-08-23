export type ApplicationChannel = {
  id: "greenhouse" | "lever" | "ashby" | "workable" | "smartrecruiters" | "workday" | "internshala" | "unstop" | "wellfound" | "linkedin" | "indeed" | "naukri" | "company" | "unknown";
  label: string;
  kind: "ats" | "job_board" | "company" | "unknown";
  automation: "structured" | "browser_assist" | "manual_lead";
  note: string;
};

const channels: Array<{ hosts: RegExp; channel: ApplicationChannel }> = [
  { hosts: /(^|\.)greenhouse\.io$/i, channel: { id: "greenhouse", label: "Greenhouse", kind: "ats", automation: "structured", note: "Structured ATS. Prefer a dedicated adapter for form preparation." } },
  { hosts: /(^|\.)lever\.co$/i, channel: { id: "lever", label: "Lever", kind: "ats", automation: "structured", note: "Structured ATS. Prefer a dedicated adapter for form preparation." } },
  { hosts: /(^|\.)ashbyhq\.com$/i, channel: { id: "ashby", label: "Ashby", kind: "ats", automation: "structured", note: "Structured ATS. Prefer a dedicated adapter for form preparation." } },
  { hosts: /(^|\.)workable\.com$/i, channel: { id: "workable", label: "Workable", kind: "ats", automation: "structured", note: "Structured ATS. Prefer a dedicated adapter for form preparation." } },
  { hosts: /(^|\.)smartrecruiters\.com$/i, channel: { id: "smartrecruiters", label: "SmartRecruiters", kind: "ats", automation: "structured", note: "Structured ATS. Prefer a dedicated adapter for form preparation." } },
  { hosts: /(^|\.)(myworkdayjobs|myworkdaysite)\.com$/i, channel: { id: "workday", label: "Workday", kind: "ats", automation: "browser_assist", note: "Dynamic ATS. Prepare answers locally and use reviewed browser assistance." } },
  { hosts: /(^|\.)internshala\.com$/i, channel: { id: "internshala", label: "Internshala", kind: "job_board", automation: "browser_assist", note: "Internship board. Treat listing as a lead and preserve the exact application URL." } },
  { hosts: /(^|\.)unstop\.com$/i, channel: { id: "unstop", label: "Unstop", kind: "job_board", automation: "browser_assist", note: "Opportunity board. Prepare answers locally and stop at unexpected/sensitive fields." } },
  { hosts: /(^|\.)wellfound\.com$/i, channel: { id: "wellfound", label: "Wellfound", kind: "job_board", automation: "browser_assist", note: "Startup job board. Prefer the company/ATS posting when available." } },
  { hosts: /(^|\.)linkedin\.com$/i, channel: { id: "linkedin", label: "LinkedIn", kind: "job_board", automation: "manual_lead", note: "Manual lead/context only. Do not scrape profiles or private contact data." } },
  { hosts: /(^|\.)indeed\.(com|co\.in)$/i, channel: { id: "indeed", label: "Indeed", kind: "job_board", automation: "manual_lead", note: "Job-board lead. Prefer the official company or ATS application URL when available." } },
  { hosts: /(^|\.)naukri\.com$/i, channel: { id: "naukri", label: "Naukri", kind: "job_board", automation: "manual_lead", note: "Job-board lead. Prefer the official company or ATS application URL when available." } },
];

export function classifyApplicationUrl(value: string): ApplicationChannel {
  let url: URL;
  try { url = new URL(value); }
  catch { return { id: "unknown", label: "Unknown", kind: "unknown", automation: "manual_lead", note: "Invalid or unsupported application URL." }; }
  if (url.protocol !== "https:" && url.protocol !== "http:") return { id: "unknown", label: "Unknown", kind: "unknown", automation: "manual_lead", note: "Unsupported application URL scheme." };
  const match = channels.find((item) => item.hosts.test(url.hostname));
  if (match) return match.channel;
  return { id: "company", label: "Company careers site", kind: "company", automation: "browser_assist", note: "Direct company site. Prepare a reviewed packet and use browser assistance only after inspecting the form." };
}
