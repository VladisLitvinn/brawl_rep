/**
 * OpenRouter API client for generating English learning exercises.
 * Uses chat completions endpoint with a solid open model.
 */

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const DEFAULT_MODEL = 'stepfun/step-3.5-flash:free';
const TIMEOUT_MS = 30000;
const RETRY_ON_429_MAX = 3;
const RETRY_DELAY_MS = 4000;

function getModel() {
  return process.env.OPENROUTER_MODEL || DEFAULT_MODEL;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Build the system + user prompt for exercise generation.
 * @param {string} level - CEFR level (B1, B2, C1)
 * @param {string} topic - Optional topic
 * @returns {{ system: string, user: string }}
 */
function buildPrompt(level, topic) {
  const topicText = topic && topic.trim() ? topic.trim() : 'general knowledge or everyday situations';
  const system = `You generate structured English learning exercises.
Return strictly valid JSON.
No politics, no religion, no violence, no adult content.
Use neutral academic or real-world topics only.
Chunks must be meaningful phrases or semantic units, not random single words.`;

  const user = `One CEFR ${level} English sentence about "${topicText}". Reply with only this JSON (no other text): 4-6 chunks, each with "english" and "russian".
{"sentence":"...","chunks":[{"english":"...","russian":"..."}]}`;

  return { system, user };
}

/**
 * Call OpenRouter API and return parsed exercise data.
 * @param {string} level - CEFR level
 * @param {string} topic - Topic (optional)
 * @returns {Promise<{ sentence: string, chunks: Array<{ english: string, russian: string }> }>}
 */
async function generateExercise(level, topic = '') {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error('OPENROUTER_API_KEY is not set in environment');
  }

  const { system, user } = buildPrompt(level, topic);
  const body = {
    model: getModel(),
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    temperature: 0.6,
    max_tokens: 8192,
  };

  let lastError;
  for (let attempt = 1; attempt <= RETRY_ON_429_MAX; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await fetch(OPENROUTER_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'http://localhost:5173',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (response.status === 429) {
        const text = await response.text();
        let msg = 'Model is rate-limited. Please retry in a minute.';
        try {
          const errJson = JSON.parse(text);
          if (errJson?.error?.metadata?.raw) {
            msg = errJson.error.metadata.raw.slice(0, 120) + '…';
          }
        } catch (_) {}
        lastError = new Error(msg + ' You can set OPENROUTER_MODEL to another model in .env (e.g. google/gemma-2-9b-it:free).');
        if (attempt < RETRY_ON_429_MAX) {
          await sleep(RETRY_DELAY_MS);
          continue;
        }
        throw lastError;
      }

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`OpenRouter API error ${response.status}: ${text.slice(0, 200)}`);
      }

      const data = await response.json();
      const choice = data.choices?.[0];
      let rawContent = choice?.message?.content ?? choice?.text;
      // Some models return content as array of parts, e.g. [{ type: "text", text: "..." }]
      const content = typeof rawContent === 'string'
        ? rawContent
        : Array.isArray(rawContent)
          ? rawContent.map((p) => (p && typeof p.text === 'string' ? p.text : '')).join('')
          : null;
      if (!content || !content.trim()) {
        const finishReason = choice?.finish_reason;
        if (process.env.NODE_ENV !== 'production') {
          console.error('OpenRouter raw response:', JSON.stringify(data, null, 2).slice(0, 500));
        }
        const hint = finishReason ? ` (finish_reason: ${finishReason})` : '';
        throw new Error(`Empty response from OpenRouter${hint}. Try another model or check the prompt.`);
      }
      return parseExerciseJson(content);
    } catch (err) {
      if (err.name === 'AbortError') {
        throw new Error('Request to OpenRouter timed out');
      }
      throw err;
    }
  }
  throw lastError || new Error('OpenRouter request failed');
}

/**
 * Parse and validate JSON from LLM. Handles markdown code blocks.
 * @param {string} raw - Raw response text
 * @returns {{ sentence: string, chunks: Array<{ english: string, russian: string }> }}
 */
function parseExerciseJson(raw) {
  let text = raw.trim();
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    text = jsonMatch[0];
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('Invalid JSON from language model');
  }
  if (!parsed.sentence || typeof parsed.sentence !== 'string') {
    throw new Error('Missing or invalid "sentence" in response');
  }
  if (!Array.isArray(parsed.chunks) || parsed.chunks.length < 4) {
    throw new Error('Need at least 4 chunks in response');
  }
  const sentence = parsed.sentence.trim();
  if (sentence.length < 10) {
    throw new Error('Sentence too short');
  }
  const chunks = parsed.chunks
    .filter(c => c && typeof c.english === 'string' && typeof c.russian === 'string')
    .map(c => ({ english: c.english.trim(), russian: c.russian.trim() }))
    .filter(c => c.english.length > 0 && c.russian.length > 0);
  if (chunks.length < 4) {
    throw new Error('Need at least 4 valid chunks');
  }
  // Deduplicate by english text and avoid overlapping (use first occurrence only)
  const seen = new Set();
  const uniqueChunks = [];
  for (const c of chunks) {
    if (seen.has(c.english)) continue;
    if (!sentence.includes(c.english)) continue;
    seen.add(c.english);
    uniqueChunks.push(c);
  }
  if (uniqueChunks.length < 4) {
    throw new Error('Could not find enough non-overlapping chunks in sentence');
  }
  return { sentence, chunks: uniqueChunks };
}

module.exports = { generateExercise, buildPrompt };
