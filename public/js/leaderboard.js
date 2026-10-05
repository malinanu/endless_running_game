// Leaderboard fetch and render, with gold / silver / bronze styling for the top 3.

const BADGES = { 1: { cls: 'rank-gold', icon: '🥇', label: 'Gold star' }, 2: { cls: 'rank-silver', icon: '🥈', label: 'Silver sleigh bell' }, 3: { cls: 'rank-bronze', icon: '🥉', label: 'Bronze pinecone' } };

export async function fetchLeaderboard(limit = 10) {
  const res = await fetch(`/api/leaderboard?limit=${limit}`, { credentials: 'same-origin' });
  if (!res.ok) throw new Error('Could not load leaderboard');
  return res.json();
}

/**
 * Render entries into an <ol>. `me` is the signed-in username (case-insensitive match)
 * so the current player's row can be highlighted.
 */
export function renderLeaderboard(list, entries, me = null) {
  list.replaceChildren();
  if (!entries.length) {
    const li = document.createElement('li');
    li.className = 'lb-empty';
    li.textContent = 'No scores yet — be the first on the board!';
    list.append(li);
    return;
  }
  const meKey = me ? me.toLowerCase() : null;
  for (const entry of entries) {
    const badge = BADGES[entry.rank];
    const li = document.createElement('li');
    li.className = `lb-row ${badge ? badge.cls : 'rank-default'}`;
    if (meKey && entry.username.toLowerCase() === meKey) li.classList.add('is-me');

    const rank = document.createElement('span');
    rank.className = 'lb-rank';
    if (badge) {
      rank.textContent = badge.icon;
      rank.title = badge.label;
      rank.setAttribute('aria-label', `Rank ${entry.rank}`);
    } else {
      rank.textContent = entry.rank;
    }

    const name = document.createElement('span');
    name.className = 'lb-name';
    name.textContent = entry.username;
    if (li.classList.contains('is-me')) {
      const you = document.createElement('em');
      you.textContent = 'you';
      name.append(' ', you);
    }

    const score = document.createElement('span');
    score.className = 'lb-score';
    score.textContent = entry.score.toLocaleString();

    li.append(rank, name, score);
    list.append(li);
  }
}

export async function loadInto(list, me = null) {
  list.replaceChildren(Object.assign(document.createElement('li'), { className: 'lb-empty', textContent: 'Loading…' }));
  try {
    const entries = await fetchLeaderboard(10);
    renderLeaderboard(list, entries, me);
    return entries;
  } catch {
    list.replaceChildren(Object.assign(document.createElement('li'), { className: 'lb-empty', textContent: 'Leaderboard unavailable right now.' }));
    return [];
  }
}
