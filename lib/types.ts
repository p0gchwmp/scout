export type WorkplaceType = "remote" | "hybrid" | "on-site" | "unspecified";

export type NormalizedJob = {
  source: string;
  externalId: string;
  canonicalUrl: string;
  company: string;
  title: string;
  description: string;
  location: string;
  workplaceType: WorkplaceType;
  postedAt?: string;
};

export type CandidateProfile = {
  roleKeywords: string[];
  verifiedSkills: string[];
  preferredLocations: string[];
  currentStudent: boolean;
  remoteAllowed: boolean;
  workAuthorizedCountries: string[];
};

export interface SourceAdapter {
  readonly source: string;
  readonly capabilities: { discovery: true; submission: false };
  discover(companyToken: string): Promise<NormalizedJob[]>;
}
