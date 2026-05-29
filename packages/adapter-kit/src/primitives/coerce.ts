// Strict numeric coercion: accept only a finite number, undefined otherwise.
// Numeric-string leniency is intentionally NOT included (a Pi-only behavior that
// stays in the Pi adapter); see plan decision "Conservative divergence policy".
export function coerceInt(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
