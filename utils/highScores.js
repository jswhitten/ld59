const KEY = 'pulse.highScores.v1';
const MAX = 5;

function sanitize(arr) {
    return arr
        .filter(r => typeof r.score === 'number' && isFinite(r.score))
        .map(r => ({
            score:        Math.max(0, Math.round(r.score)),
            survivalTime: typeof r.survivalTime === 'number' ? r.survivalTime : 0,
            multiplier:   typeof r.multiplier   === 'number' ? r.multiplier   : 1,
            date:         typeof r.date         === 'string' ? r.date         : ''
        }));
}

export function loadHighScores() {
    try {
        const parsed = JSON.parse(localStorage.getItem(KEY) || '[]');
        return Array.isArray(parsed) ? sanitize(parsed) : [];
    } catch {
        return [];
    }
}

export function saveHighScores(scores) {
    try {
        localStorage.setItem(KEY, JSON.stringify(scores.slice(0, MAX)));
    } catch { /* storage unavailable */ }
}

export function submitHighScore(record) {
    const scores = loadHighScores();
    const entry = sanitize([record])[0];
    scores.push(entry);
    scores.sort((a, b) => b.score - a.score);
    const top = scores.slice(0, MAX);
    saveHighScores(top);
    const rank = top.indexOf(entry) + 1;
    return { scores: top, rank: rank > 0 ? rank : null };
}
