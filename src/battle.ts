// Versioned separately from the earlier scripted prototype: these scores have
// different rules and should not be compared with the nine-gesture exercise.
const KEY = "rift.arena.best.v2";
export function readBest(storage: Pick<Storage, "getItem">): number {
  try {
    const score = Number(storage.getItem(KEY));
    return Number.isSafeInteger(score) && score > 0 ? score : 0;
  } catch {
    return 0;
  }
}
export function saveBest(
  storage: Pick<Storage, "getItem" | "setItem">,
  score: number,
): number {
  const best = Math.max(
    readBest(storage),
    Number.isSafeInteger(score) && score > 0 ? score : 0,
  );
  try {
    storage.setItem(KEY, String(best));
  } catch {
    /* Storage is optional. */
  }
  return best;
}
