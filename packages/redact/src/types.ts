import type { JsonlRecord } from "@agent-trail/core";

export type RedactionPattern = {
  id: string;
  description: string;
  regex: RegExp;
  placeholder: string;
};

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
  userSecrets?: string[];
  includeSourceRaw?: boolean;
  outputMaxBytes?: number;
  maxSamples?: number;
};

export type RedactTrailResult = {
  records: JsonlRecord[];
  summary: RedactionSummary;
};
