import type { JsonlRecord, RedactionPattern } from "@agent-trail/core";

export type { RedactionPattern };

export type RedactionSample = {
  patternId: string;
  location: string;
  before: string;
  after: string;
};

export type RedactionSummary = {
  counts: Record<string, number>;
  samples: RedactionSample[];
  packs?: RedactionPackSummary[];
  warnings?: string[];
};

export type RedactionPackSource = "project" | "user_global";

export type RedactionPackSummary = {
  name: string;
  version: number;
  contentHash: string;
  source: RedactionPackSource;
};

export type LoadedRedactionPack = RedactionPackSummary & {
  path: string;
  patterns: RedactionPattern[];
  allowlist: string[];
};

export type PiiConfig = {
  email?: boolean;
  phone?: boolean;
  ssn?: boolean;
  creditCard?: boolean;
  name?: boolean;
  emailAllowlist?: string[];
  customLabels?: Record<string, string>;
};

export type RedactTrailOptions = {
  patterns?: RedactionPattern[];
  extendPatterns?: RedactionPattern[];
  redactionPacks?: LoadedRedactionPack[];
  userSecrets?: string[];
  allowedSecrets?: string[];
  pii?: PiiConfig;
  includeSourceRaw?: boolean;
  outputMaxBytes?: number;
  maxSamples?: number;
  attachmentUriRewrites?: Record<string, `sha256:${string}`>;
  enableEntropyRedaction?: boolean;
  // When true, preserve vcs.remote_url verbatim in the redacted header.
  // Default false strips the field because it identifies the repository
  // (and may identify a private repo). Spec §15 / PRD §8.6 step 7.
  keepRemoteUrl?: boolean;
};

export type RedactTrailResult = {
  records: JsonlRecord[];
  summary: RedactionSummary;
};
