/**
 * Web Speech API: voice-to-text. Chrome, Edge, Safari. Not Firefox.
 * One session from Start to Stop: if browser ends recognition on pause, we restart and keep accumulating.
 * Text goes to input only when user presses Stop.
 */

const SpeechRecognition =
  typeof window !== 'undefined' &&
  (window.SpeechRecognition || window.webkitSpeechRecognition);

export function isSpeechSupported() {
  return !!SpeechRecognition;
}

export function useSpeechRecognition(onResult, onError, onEnd, onProgress, refs = {}) {
  const { stopRequestedRef, recognitionRef } = refs;

  const start = (lang = 'en-US', initialAccumulated = '') => {
    if (!SpeechRecognition) {
      onError?.(new Error('Voice input is not supported in this browser. Try Chrome or Edge.'));
      return null;
    }
    if (stopRequestedRef) stopRequestedRef.current = false;

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = lang;

    let accumulated = initialAccumulated;
    const addedFinalIndices = new Set();
    let currentInterim = '';

    console.log('[Voice] start', { lang, initialAccumulated, accumulatedLength: accumulated.length });

    recognition.onresult = (event) => {
      const results = event.results;
      console.log('[Voice] onresult', { resultsLength: results.length });
      currentInterim = '';
      for (let i = 0; i < results.length; i++) {
        const result = results[i];
        const transcript = (result[0]?.transcript ?? '').trim();
        if (!transcript) continue;
        console.log('[Voice] result[' + i + ']', { isFinal: result.isFinal, transcript: transcript.slice(0, 50) + (transcript.length > 50 ? '...' : '') });
        if (result.isFinal) {
          if (!addedFinalIndices.has(i)) {
            addedFinalIndices.add(i);
            const alreadyAtEnd = accumulated.endsWith(transcript) || (accumulated && accumulated.endsWith(' ' + transcript));
            if (!alreadyAtEnd) {
              accumulated += accumulated ? ' ' + transcript : transcript;
              console.log('[Voice] added to accumulated', { i, accumulatedLength: accumulated.length, accumulatedEnd: accumulated.slice(-80) });
            } else {
              console.log('[Voice] skipped duplicate at end', { i });
            }
          }
        } else {
          currentInterim = transcript;
        }
      }
      console.log('[Voice] after onresult', { accumulatedLength: accumulated.length, currentInterim: currentInterim.slice(0, 30), fullAccumulated: accumulated });
      onProgress?.(accumulated, currentInterim);
    };

    recognition.onerror = (event) => {
      console.log('[Voice] onerror', event.error);
      if (event.error === 'not-allowed') {
        onError?.(new Error('Microphone access denied.'));
      } else if (event.error === 'no-speech') {
        onError?.(new Error('No speech detected. Speak louder or check the mic.'));
      } else if (event.error !== 'aborted') {
        onError?.(new Error(event.error || 'Recognition failed.'));
      }
      onEnd?.();
    };

    recognition.onend = () => {
      const userStopped = stopRequestedRef?.current;
      console.log('[Voice] onend', { userStopped, accumulatedLength: accumulated.length, currentInterimLength: currentInterim.length, currentInterim, fullWillBe: (accumulated.trim() + (currentInterim.trim() ? ' ' + currentInterim.trim() : '')).trim() });
      if (stopRequestedRef == null || userStopped) {
        const getFullTranscript = () => {
          const acc = accumulated.trim();
          const inter = currentInterim.trim();
          return (acc + (inter ? ' ' + inter : '')).trim();
        };
        setTimeout(() => {
          const raw = getFullTranscript();
          let text = raw.replace(/\s+/g, ' ').trim();
          console.log('[Voice] setTimeout: raw (accumulated+interim)', { rawLength: raw.length, rawEnd: raw.slice(-100), textLength: text.length });
          if (text) {
            const words = text.split(/\s+/);
            for (let i = 1; i < words.length; i++) {
              if (words[i] !== 'I') words[i] = words[i].toLowerCase();
            }
            text = words.join(' ');
            if (text.length > 0) text = text.charAt(0).toUpperCase() + text.slice(1);
          }
          console.log('[Voice] setTimeout: calling onResult', { textLength: text?.length ?? 0, text: text?.slice(0, 80) + (text && text.length > 80 ? '...' : ''), willCall: !!text });
          if (text) onResult(text);
          onEnd?.();
        }, 0);
        return;
      }
      console.log('[Voice] onend: restarting with accumulated', { accumulatedLength: accumulated.length });
      if (recognitionRef) {
        recognitionRef.current = start(lang, accumulated);
        onProgress?.(accumulated, '');
      }
    };

    recognition.start();
    return recognition;
  };
  return { start, isSupported: !!SpeechRecognition };
}
