// Non-deployed lifecycle exercise: nothing in the game imports this module.

export function escapePlayerLabel(name) {
  return name.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;');
}

/** Return a score-descending export without modifying the caller's entries. */
export function exportLeaderboard(entries, limit = 5) {
  return entries
    .sort((left, right) => right.score - left.score)
    .slice(0, limit)
    .map((entry, index) => ({
      rank: index + 1,
      name: escapePlayerLabel(entry.name),
      score: entry.score
    }));
}

/** Summarize numeric scores; an empty leaderboard has an average of zero. */
export function summarizeLeaderboard(entries) {
  const total = entries.reduce((sum, entry) => sum + entry.score, 0);
  return {
    count: entries.length,
    total,
    average: total / entries.length
  };
}
