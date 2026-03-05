/**
 * Progressive step generation: Step 0 = full English, each next step
 * replaces one more chunk with Russian (by order of appearance).
 * Replacement is done from end to start to preserve indices.
 */

/**
 * Get ordered chunk positions in the sentence (startIndex, endIndex).
 * Sorts by position to preserve word order; rejects overlapping chunks.
 */
function getChunkPositions(sentence, chunks) {
  const withIndex = chunks.map((chunk) => {
    const idx = sentence.indexOf(chunk.english);
    if (idx === -1) {
      throw new Error(`Chunk not found in sentence: "${chunk.english}"`);
    }
    return {
      ...chunk,
      startIndex: idx,
      endIndex: idx + chunk.english.length,
    };
  });
  withIndex.sort((a, b) => a.startIndex - b.startIndex);
  for (let i = 1; i < withIndex.length; i++) {
    if (withIndex[i].startIndex < withIndex[i - 1].endIndex) {
      throw new Error('Overlapping or duplicate chunks in sentence');
    }
  }
  return withIndex;
}

/**
 * Build one step: replace the first `replaceCount` chunks (by position) with Russian.
 * replaceCount 0 => full English sentence.
 * Replace from end to start so indices don't shift.
 */
function buildStep(sentence, positions, replaceCount) {
  if (replaceCount <= 0) return sentence;
  const toReplace = positions
    .slice(0, replaceCount)
    .sort((a, b) => b.startIndex - a.startIndex);
  let result = sentence;
  for (const p of toReplace) {
    result =
      result.slice(0, p.startIndex) + p.russian + result.slice(p.endIndex);
  }
  return result;
}

/**
 * Generate all steps: [full English, then progressively more Russian].
 * @param {string} sentence
 * @param {Array<{ english: string, russian: string }>} chunks
 * @returns {string[]} steps[0] = English, steps[steps.length-1] = most Russian
 */
function generateSteps(sentence, chunks) {
  const positions = getChunkPositions(sentence, chunks);
  const steps = [sentence];
  for (let i = 1; i <= positions.length; i++) {
    steps.push(buildStep(sentence, positions, i));
  }
  return steps;
}

module.exports = { generateSteps, getChunkPositions };
