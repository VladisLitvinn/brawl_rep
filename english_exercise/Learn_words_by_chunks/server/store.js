/**
 * In-memory session store. No database.
 * Maps sessionId -> { sentence, chunks, steps, currentStep, ... }
 */

const store = new Map();

function createSession(sessionId, exercise) {
  const { sentence, chunks, steps } = exercise;
  store.set(sessionId, {
    sentence,
    chunks,
    steps,
    currentStep: 0,
    hintShown: false,
    createdAt: Date.now(),
  });
  return store.get(sessionId);
}

function getSession(sessionId) {
  return store.get(sessionId) || null;
}

function updateSession(sessionId, updates) {
  const s = store.get(sessionId);
  if (!s) return null;
  Object.assign(s, updates);
  return s;
}

function deleteSession(sessionId) {
  return store.delete(sessionId);
}

module.exports = { createSession, getSession, updateSession, deleteSession };
