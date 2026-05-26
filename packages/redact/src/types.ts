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
};

export type RedactTrailOptions = {
  patterns?: RedactionPattern[];
  extendPatterns?: RedactionPattern[];
  userSecrets?: string[];
  includeSourceRaw?: boolean;
  outputMaxBytes?: number;
  maxSamples?: number;
  // When true, preserve vcs.remote_url verbatim in the redacted header.
  // Default false strips the field because it identifies the repository
  // (and may identify a private repo). Spec §15 / PRD §8.6 step 7.
  keepRemoteUrl?: boolean;
};

export type RedactTrailResult = {
  records: JsonlRecord[];
  summary: RedactionSummary;
};
