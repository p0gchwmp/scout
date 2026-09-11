export type TargetGeographyLane = "india" | "open_remote" | "scoped_elsewhere" | "unknown";

export type TargetGeographyAssessment = {
  lane: TargetGeographyLane;
  label: string;
  scoreAdjustment: number;
  sortWeight: number;
  tags: string[];
};

const INDIA_PATTERN = /\b(india|bharat|bengaluru|bangalore|chennai|hyderabad|noida|gurugram|gurgaon|mumbai|delhi|new delhi|pune|kolkata|jammu|ahmedabad|jaipur|kochi|cochin|thiruvananthapuram|trivandrum|chandigarh|mohali|bhubaneswar|indore|lucknow|goa)\b/i;
const REMOTE_PATTERN = /\b(remote|work from home|wfh|distributed)\b/i;
const OPEN_REMOTE_SCOPE_PATTERN = /\b(worldwide|world-wide|anywhere|work from anywhere|global(?:ly)? remote|remote global|remote worldwide|remote anywhere)\b/i;
const UNSPECIFIED_PATTERN = /\b(location (?:not )?specified|unspecified|not specified|n\/a|na)\b/i;

function hasSpecificScope(value: string) {
  const residual = value
    .replace(REMOTE_PATTERN, " ")
    .replace(OPEN_REMOTE_SCOPE_PATTERN, " ")
    .replace(UNSPECIFIED_PATTERN, " ")
    .replace(/[·,/|()\-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return residual.length > 2;
}

export function assessTargetGeography(job: { location?: string | null; workplaceType?: string | null }): TargetGeographyAssessment {
  const location = String(job.location ?? "").trim();
  const workplace = String(job.workplaceType ?? "").trim();
  const text = `${location} ${workplace}`.trim();
  const india = INDIA_PATTERN.test(text);
  const remote = workplace.toLowerCase() === "remote" || REMOTE_PATTERN.test(text);
  const explicitlyOpenRemote = OPEN_REMOTE_SCOPE_PATTERN.test(text);

  if (india) {
    return {
      lane: "india",
      label: remote ? "India / remote target" : "India target",
      scoreAdjustment: 10,
      sortWeight: 3,
      tags: ["India", ...(remote ? ["Remote"] : [])],
    };
  }

  if (remote && (explicitlyOpenRemote || !hasSpecificScope(location))) {
    return {
      lane: "open_remote",
      label: "Open remote target",
      scoreAdjustment: 8,
      sortWeight: 2,
      tags: ["Remote"],
    };
  }

  if (hasSpecificScope(location)) {
    return {
      lane: "scoped_elsewhere",
      label: remote ? "Location-scoped remote outside explicit India" : "Location-scoped outside explicit India",
      scoreAdjustment: -20,
      sortWeight: 0,
      tags: [remote ? "Scoped remote" : "Other location"],
    };
  }

  return {
    lane: "unknown",
    label: remote ? "Remote scope unclear" : "Location scope unclear",
    scoreAdjustment: 0,
    sortWeight: 1,
    tags: [remote ? "Remote scope unclear" : "Location unclear"],
  };
}
