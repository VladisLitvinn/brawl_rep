/**
 * API routes: /api/generate, /api/validate
 * Session identified by sessionId header or body (in-memory store).
 */

const express = require('express');
const { generateExercise } = require('../services/openrouter');
const { generateSteps } = require('../services/steps');
const {
  createSession,
  getSession,
  updateSession,
} = require('../store');

const router = express.Router();

/** Нормализация для сравнения: только буквы и апостроф, всё остальное (пробелы, пунктуация, переносы, невидимые символы) → пробел, затем схлопнуть. */
function normalizeForCompare(text) {
  if (typeof text !== 'string') return '';
  return text
    .normalize('NFC')
    .toLowerCase()
    .replace(/[^a-z']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Сравнение ответа с эталоном: регистр и пунктуация не учитываются. */
function validateAnswer(userText, correctSentence) {
  const normUser = normalizeForCompare(userText);
  const normExpected = normalizeForCompare(correctSentence);
  const equal = normUser === normExpected;
  console.log('[validateAnswer]', {
    userTextLength: userText.length,
    expectedLength: correctSentence.length,
    normUserLength: normUser.length,
    normExpectedLength: normExpected.length,
    equal,
    normUser: normUser.slice(0, 80) + (normUser.length > 80 ? '...' : ''),
    normExpected: normExpected.slice(0, 80) + (normExpected.length > 80 ? '...' : ''),
  });
  return equal;
}

/** Session id from header or body (header может теряться при CORS/preflight). */
function getSessionId(req) {
  const id = req.headers['x-session-id'] || req.body?.sessionId;
  return (id && String(id).trim()) || 'default';
}

/**
 * POST /api/generate
 * Body: { topic?, level, iterations? }
 * Returns: { sessionId, sentence, chunks, steps, currentStep, totalSteps }
 */
router.post('/generate', async (req, res) => {
  try {
    const { topic = '', level = 'B2', iterations } = req.body || {};
    const sessionId = getSessionId(req);
    console.log('[generate]', { sessionId, topic, level, hasSessionId: !!sessionId });

    if (!['B1', 'B2', 'C1'].includes(level)) {
      return res.status(400).json({ error: 'Invalid level. Use B1, B2, or C1.' });
    }

    const exercise = await generateExercise(level, topic);
    const steps = generateSteps(exercise.sentence, exercise.chunks);

    // Optionally limit steps by iterations (e.g. 6–8); keep at least 2 steps
    let finalSteps = steps;
    if (typeof iterations === 'number' && iterations >= 2 && iterations < steps.length) {
      finalSteps = steps.slice(0, iterations + 1);
    }

    const session = createSession(sessionId, {
      sentence: exercise.sentence,
      chunks: exercise.chunks,
      steps: finalSteps,
    });
    console.log('[generate] session created', {
      sessionId,
      sentenceLength: session.sentence.length,
      sentencePreview: session.sentence.slice(0, 60) + (session.sentence.length > 60 ? '...' : ''),
    });

    res.json({
      sessionId,
      sentence: session.sentence,
      chunks: session.chunks,
      steps: session.steps,
      currentStep: session.currentStep,
      totalSteps: session.steps.length,
    });
  } catch (err) {
    const message =
      err.message ||
      'Failed to generate exercise. Check OPENROUTER_API_KEY and try again.';
    res.status(500).json({ error: message });
  }
});

/**
 * POST /api/validate
 * Body: { sessionId?, input, requestHint? }
 * Returns: { correct, done?, currentStep, totalSteps, displaySentence?, error?, hintShown? }
 */
router.post('/validate', (req, res) => {
  const sessionId = getSessionId(req);
  const { input, requestHint } = req.body || {};
  console.log('[validate] request', {
    sessionId,
    sessionIdFromHeader: req.headers['x-session-id'] ?? '(none)',
    sessionIdFromBody: req.body?.sessionId ?? '(none)',
    inputType: typeof input,
    inputLength: typeof input === 'string' ? input.length : 0,
    inputPreview: typeof input === 'string' ? JSON.stringify(input.slice(0, 80)) : String(input),
    requestHint: !!requestHint,
  });

  const session = getSession(sessionId);
  if (!session) {
    console.log('[validate] session not found', { sessionId });
    return res.status(404).json({ error: 'Session not found. Generate an exercise first.' });
  }

  // Hint: show previous step only when currentStep >= 2 (never show full English after progress)
  if (requestHint) {
    const canShowHint = session.currentStep >= 2;
    if (canShowHint) {
      const previousStepSentence = session.steps[session.currentStep - 1];
      updateSession(sessionId, { hintShown: true });
      return res.json({
        hintShown: true,
        displaySentence: previousStepSentence,
        currentStep: session.currentStep,
        totalSteps: session.steps.length,
      });
    }
    return res.json({
      hintShown: false,
      message: 'No hint available for this step.',
      currentStep: session.currentStep,
      totalSteps: session.steps.length,
    });
  }

  // input может отсутствовать в body (старые клиенты / JSON.stringify опускает undefined)
  const userText = typeof input === 'string' ? input : (input != null ? String(input) : '');
  const expectedSentence = session.sentence;
  console.log('[validate] comparing', {
    userText: JSON.stringify(userText),
    expectedSentence: JSON.stringify(expectedSentence),
    userCharCodes: userText.length ? [...userText.slice(-15)].map((c, i) => userText.charCodeAt(userText.length - 15 + i)) : [],
    expectedCharCodes: expectedSentence.length ? [...expectedSentence.slice(-15)].map((c, i) => expectedSentence.charCodeAt(expectedSentence.length - 15 + i)) : [],
  });

  const correct = validateAnswer(userText, expectedSentence);

  if (!correct) {
    console.log('[validate] MISMATCH', { sessionId, userTextLength: userText.length, expectedLength: expectedSentence.length });
    return res.json({
      correct: false,
      currentStep: session.currentStep,
      totalSteps: session.steps.length,
      message: 'Try again. Check spelling and wording.',
      expectedSentence: session.sentence,
    });
  }
  console.log('[validate] OK', { sessionId, currentStep: session.currentStep });

  const nextStep = session.currentStep + 1;
  const done = nextStep >= session.steps.length;
  updateSession(sessionId, {
    currentStep: nextStep,
    hintShown: false,
  });

  const updated = getSession(sessionId);
  res.json({
    correct: true,
    done,
    currentStep: updated.currentStep,
    totalSteps: session.steps.length,
    displaySentence: done ? null : updated.steps[updated.currentStep],
  });
});

/**
 * GET /api/state?sessionId=
 * Returns current session state for training screen (display sentence, step, etc.)
 */
router.get('/state', (req, res) => {
  const sessionId = req.query.sessionId || req.headers['x-session-id'] || 'default';
  const session = getSession(sessionId);
  if (!session) {
    return res.status(404).json({ error: 'Session not found.' });
  }
  res.json({
    currentStep: session.currentStep,
    totalSteps: session.steps.length,
    displaySentence: session.steps[session.currentStep],
    done: session.currentStep >= session.steps.length,
  });
});

module.exports = router;
