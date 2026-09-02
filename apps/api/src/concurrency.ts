/**
 * Bounded-parallelism map. Used to keep in-flight SEC requests <= 5, per the
 * EDGAR fair-access policy documented in CLAUDE.md.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const total = items.length;
  const results = new Array<R>(total);
  if (total === 0) return results;

  const workers = Math.max(1, Math.min(Math.floor(limit) || 1, total));
  let cursor = 0;

  async function worker(): Promise<void> {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= total) return;
      results[index] = await fn(items[index] as T, index);
    }
  }

  await Promise.all(Array.from({ length: workers }, () => worker()));
  return results;
}
