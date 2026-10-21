export const LEADERBOARD_KEY = 'ferret-heist:leaderboard';
export const MAX_ENTRIES = 5;

export function loadLeaderboard(storage) {
  const raw = storage.getItem(LEADERBOARD_KEY);
  if (!raw) return [];
  return JSON.parse(raw);
}

export function saveLeaderboard(storage, entries) {
  storage.setItem(LEADERBOARD_KEY, JSON.stringify(entries));
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
