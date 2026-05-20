export type ValidationProfile = "strict" | "reader-tolerant";

export function resolveValidationProfile(profile: unknown): ValidationProfile {
  if (profile === undefined || profile === "strict") {
    return "strict";
  }

  if (profile === "reader-tolerant") {
    return "reader-tolerant";
  }

  throw new TypeError('Validation profile must be "strict" or "reader-tolerant"');
}
