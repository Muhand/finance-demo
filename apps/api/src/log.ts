/** Tiny logging helpers. Keeps startup warnings to one clear line each. */

const emitted = new Set<string>();

const PREFIX = "[finance-demo:api]";

export function info(message: string): void {
  console.log(`${PREFIX} ${message}`);
}

export function warn(message: string): void {
  console.warn(`${PREFIX} ${message}`);
}

/** Emits `message` at most once per process for the given `key`. */
export function warnOnce(key: string, message: string): void {
  if (emitted.has(key)) return;
  emitted.add(key);
  warn(message);
}

/** Test seam: forget which one-shot warnings have already been emitted. */
export function resetWarnOnce(): void {
  emitted.clear();
}
