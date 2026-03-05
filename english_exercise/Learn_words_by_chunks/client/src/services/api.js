/**
 * API client for backend. In production (single server) uses /api/english.
 * In dev with proxy can use /api and proxy to 3001.
 */

const API_BASE = import.meta.env.VITE_API_BASE || '/api/english';

function getSessionId() {
  return sessionStorage.getItem('chunks_session_id') || 'default';
}

function setSessionId(id) {
  sessionStorage.setItem('chunks_session_id', id);
}

export async function generateExercise({ topic = '', level = 'B2', iterations }) {
  const sessionId =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `s${Date.now()}`;
  setSessionId(sessionId);

  const res = await fetch(`${API_BASE}/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Session-Id': sessionId },
    body: JSON.stringify({ topic, level, iterations }),
  });
  const data = await res.json();
  console.log('[api.generateExercise] response', {
    ok: res.ok,
    sessionId: data.sessionId,
    sentenceLength: data.sentence?.length,
  });
  if (!res.ok) throw new Error(data.error || 'Generate failed');
  return data;
}

export async function validateInput(input) {
  const sessionId = getSessionId();
  // Всегда отправляем строку: JSON.stringify опускает undefined, и сервер получает req.body.input === undefined
  const inputStr = (input != null && typeof input === 'string') ? input : '';
  const body = { input: inputStr, sessionId };
  console.log('[api.validateInput] sending', {
    sessionId,
    inputType: typeof input,
    inputLength: inputStr.length,
    inputPreview: JSON.stringify(inputStr.slice(0, 100)),
    bodyKeys: Object.keys(body),
  });
  const res = await fetch(`${API_BASE}/validate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Session-Id': sessionId,
    },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  console.log('[api.validateInput] response', {
    ok: res.ok,
    correct: data.correct,
    done: data.done,
    message: data.message,
    expectedSentenceLength: data.expectedSentence?.length,
  });
  if (!res.ok) throw new Error(data.error || 'Validate failed');
  return data;
}

export async function requestHint() {
  const res = await fetch(`${API_BASE}/validate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Session-Id': getSessionId(),
    },
    body: JSON.stringify({ requestHint: true }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Hint failed');
  return data;
}

export async function getState() {
  const res = await fetch(
    `${API_BASE}/state?sessionId=${encodeURIComponent(getSessionId())}`
  );
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'State failed');
  return data;
}
