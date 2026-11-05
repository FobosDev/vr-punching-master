// Persistent settings and local high scores (localStorage, with safe fallbacks).

const SETTINGS_KEY = 'punchingmaster.settings.v1';
const SCORES_KEY = 'punchingmaster.scores.v1';

export const DEFAULT_SETTINGS = Object.freeze({
  musicVolume: 0.8,
  sfxVolume: 0.9,
  audioOffsetMs: 0,
  noFail: false,
  haptics: true,
  reducedMotion: false,
  swapHands: false,
  autoplay: false,
  difficulty: 'normal',
  trackId: 'neon-pulse',
});

function safeRead(key) {
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : null; } catch { return null; }
}
function safeWrite(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode or quota: ignore */ }
}

export function loadSettings() {
  return { ...DEFAULT_SETTINGS, ...(safeRead(SETTINGS_KEY) || {}) };
}
export function saveSettings(settings) { safeWrite(SETTINGS_KEY, settings); }

export function loadScores() { return safeRead(SCORES_KEY) || {}; }
export function getBest(trackId, difficulty) { return loadScores()[`${trackId}|${difficulty}`] || null; }
/** Stores the result if it beats the previous best. Returns true when it is a new record. */
export function submitScore(trackId, difficulty, result) {
  const scores = loadScores();
  const key = `${trackId}|${difficulty}`;
  const prev = scores[key];
  if (!prev || result.score > prev.score) {
    scores[key] = { score: Math.round(result.score), rank: result.rank, accuracy: result.accuracy, maxCombo: result.maxCombo, date: Date.now() };
    safeWrite(SCORES_KEY, scores);
    return true;
  }
  return false;
}
