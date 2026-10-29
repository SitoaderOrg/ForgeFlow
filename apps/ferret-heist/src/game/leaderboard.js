export const LEADERBOARD_KEY = 'ferret-heist:leaderboard';
export const MAX_ENTRIES = 5;

function isValidEntry(entry) {
  return (
    entry !== null &&
    typeof entry === 'object' &&
    !Array.isArray(entry) &&
    typeof entry.name === 'string' &&
    typeof entry.score === 'number'
  );
}

export function loadLeaderboard(storage) {
  const raw = storage.getItem(LEADERBOARD_KEY);
  if (!raw) return [];
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(isValidEntry);
}

export function saveLeaderboard(storage, entries) {
  try {
    storage.setItem(LEADERBOARD_KEY, JSON.stringify(entries));
  } catch {
    // Persistence failures (e.g. quota exceeded) should not break gameplay.
  }
}

export function addEntry(entries, entry) {
  entries.push(entry);
  entries.sort((a, b) => b.score - a.score);
  return entries.slice(0, MAX_ENTRIES);
}

export function isHighScore(entries, score) {
  if (entries.length < MAX_ENTRIES) return true;
  return score > entries[entries.length - 1].score;
}

export function recordRun(storage, { name, score, items, outcome }) {
  const entries = loadLeaderboard(storage);
  const entry = {
    name,
    score,
    items,
    outcome,
    date: new Date().toISOString()
  };
  const updated = addEntry(entries, entry);
  saveLeaderboard(storage, updated);
  return { entries: updated, isNewBest: updated[0] === entry };
}
