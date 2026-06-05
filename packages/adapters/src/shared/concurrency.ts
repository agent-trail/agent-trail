export const DISCOVERY_CONCURRENCY_LIMIT = 32;

export async function mapConcurrent<T, U>(
  values: readonly T[],
  limit: number,
  mapper: (value: T, index: number) => Promise<U>,
): Promise<U[]> {
  if (values.length === 0) return [];
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error(`concurrency limit must be a positive integer, got ${limit}`);
  }

  const results = new Array<U>(values.length);
  const entries = values.entries();
  let firstError: unknown;
  const workerCount = Math.min(limit, values.length);

  async function worker(): Promise<void> {
    while (firstError === undefined) {
      const next = entries.next();
      if (next.done === true) break;
      const [index, value] = next.value;
      try {
        results[index] = await mapper(value, index);
      } catch (error) {
        if (firstError === undefined) firstError = error;
        break;
      }
    }
  }

  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  if (firstError !== undefined) throw firstError;
  return results;
}
