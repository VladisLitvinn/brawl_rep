import { useState, useEffect, useRef } from 'react';
import { isSpeechSupported, useSpeechRecognition } from '../hooks/useSpeechRecognition';

export default function TrainingScreen({
  exercise,
  onBack,
  validateInput,
  requestHint,
}) {
  const {
    sentence: originalSentence,
    steps,
    currentStep: initialStep,
    totalSteps,
    displaySentence: initialDisplay,
  } = exercise;

  const [currentStep, setCurrentStep] = useState(initialStep);
  const [displaySentence, setDisplaySentence] = useState(
    initialDisplay ?? steps[initialStep]
  );
  const [userInput, setUserInput] = useState('');
  const [message, setMessage] = useState('');
  const [errorDetail, setErrorDetail] = useState(null);
  const [hintSentence, setHintSentence] = useState(null);
  const [done, setDone] = useState(false);
  const [listening, setListening] = useState(false);
  const [voiceError, setVoiceError] = useState('');
  const [voicePreview, setVoicePreview] = useState(''); // lower line: accumulated + interim while listening
  const [showPreviousStep, setShowPreviousStep] = useState(false);
  const recognitionRef = useRef(null);
  const stopRequestedRef = useRef(false);
  const hasAutoPlayedRef = useRef(false);

  const { start: startSpeech } = useSpeechRecognition(
    (text) => {
      console.log('[Voice UI] onResult called', { textLength: text?.length, text });
      setListening(false);
      setVoicePreview('');
      setUserInput((prev) => {
        const next = prev ? `${prev} ${text}` : text;
        console.log('[Voice UI] setUserInput', { prevLength: prev?.length, textLength: text?.length, nextLength: next?.length, next: next?.slice(0, 100) + (next && next.length > 100 ? '...' : '') });
        return next;
      });
      setVoiceError('');
    },
    (err) => {
      console.log('[Voice UI] onError', err?.message);
      setListening(false);
      setVoicePreview('');
      setVoiceError(err.message || 'Voice input failed');
    },
    () => {
      console.log('[Voice UI] onEnd');
      setListening(false);
    },
    (accumulated, interim) => {
      const line = [accumulated, interim].filter(Boolean).join(' ');
      console.log('[Voice UI] onProgress', { accumulatedLength: accumulated?.length, interimLength: interim?.length, lineLength: line?.length, lineEnd: line?.slice(-60) });
      setVoicePreview(line);
    },
    { stopRequestedRef, recognitionRef }
  );

  const toggleVoice = () => {
    setVoiceError('');
    if (listening) {
      console.log('[Voice UI] toggleVoice: STOP (user pressed Stop)');
      stopRequestedRef.current = true;
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch (_) {}
        recognitionRef.current = null;
      }
      setVoicePreview('');
      setListening(false);
      return;
    }
    console.log('[Voice UI] toggleVoice: START');
    setListening(true);
    setVoicePreview('');
    recognitionRef.current = startSpeech('en-US');
  };

  const total = totalSteps ?? steps.length;
  const progress = total > 0 ? (currentStep / total) * 100 : 0;

  useEffect(() => {
    setDisplaySentence(steps[currentStep]);
  }, [currentStep, steps]);

  const speakSentence = (text) => {
    if (!text || typeof window === 'undefined' || !window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'en-US';
    utterance.rate = 0.95;
    window.speechSynthesis.speak(utterance);
  };

  // Автопрослушивание только один раз при первом показе упражнения
  useEffect(() => {
    if (!originalSentence || hasAutoPlayedRef.current) return;
    hasAutoPlayedRef.current = true;
    speakSentence(originalSentence);
  }, [originalSentence]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setMessage('');
    setHintSentence(null);
    setErrorDetail(null);
    // Голосовой ввод попадает в userInput только после onResult; до этого текст только в voicePreview — учитываем оба. Всегда строка, чтобы в API не ушёл undefined.
    const textToSend = String((userInput ?? '') || (voicePreview ?? '')).trim();
    console.log('[TrainingScreen.handleSubmit]', {
      userInputLength: userInput.length,
      userInputPreview: JSON.stringify(userInput.slice(0, 80)),
      voicePreviewLength: voicePreview.length,
      voicePreviewPreview: JSON.stringify(voicePreview.slice(0, 80)),
      textToSendLength: textToSend.length,
      textToSendPreview: JSON.stringify(textToSend.slice(0, 80)),
      source: textToSend === userInput.trim() ? 'userInput' : textToSend === voicePreview.trim() ? 'voicePreview' : 'mixed',
    });
    try {
      const result = await validateInput(textToSend);
      console.log('[TrainingScreen.handleSubmit] result', { correct: result.correct, done: result.done, message: result.message });
      if (result.correct) {
        if (result.done) {
          setDone(true);
          setMessage('Well done! You completed the exercise.');
          return;
        }
        setCurrentStep(result.currentStep);
        setDisplaySentence(
          result.displaySentence ?? steps[result.currentStep] ?? displaySentence
        );
        setUserInput('');
      } else {
        setMessage(result.message || 'Try again. Check spelling and wording.');
        if (result.expectedSentence != null) {
          setErrorDetail({ expectedSentence: result.expectedSentence, userInput: textToSend || userInput });
        }
        console.log('[TrainingScreen.handleSubmit] mismatch', {
          expectedLength: result.expectedSentence?.length,
          sentLength: textToSend.length,
        });
      }
    } catch (err) {
      console.log('[TrainingScreen.handleSubmit] error', err?.message);
      setMessage(err.message || 'Validation failed.');
    }
  };

  const handleHint = async () => {
    setMessage('');
    try {
      const result = await requestHint();
      if (result.hintShown && result.displaySentence) {
        setHintSentence(result.displaySentence);
      } else {
        setMessage(result.message || 'No hint available for this step.');
      }
    } catch (err) {
      setMessage(err.message || 'Failed to get hint.');
    }
  };

  const canShowHint = currentStep >= 2;
  const hasPreviousStep = currentStep >= 1;
  const previousStepSentence = hasPreviousStep ? steps[currentStep - 1] : null;

  const normalizeWord = (w) => (w || '').replace(/[^a-zA-Z0-9']/g, '').toLowerCase();
  /** Умная сверка по словам: same = верно, wrong = неверное слово, missing = слово пропущено, extra = лишнее слово. */
  const getWordDiff = (expectedSentence, userInput) => {
    const expectedWords = (expectedSentence || '').trim().split(/\s+/).filter(Boolean);
    const userWords = (userInput || '').trim().split(/\s+/).filter(Boolean);
    const maxLen = Math.max(expectedWords.length, userWords.length);
    const items = [];
    for (let i = 0; i < maxLen; i++) {
      const exp = expectedWords[i];
      const user = userWords[i];
      const expNorm = normalizeWord(exp);
      const userNorm = normalizeWord(user);
      let status = 'same';
      if (exp && user) {
        status = expNorm === userNorm ? 'same' : 'wrong';
      } else if (exp && !user) {
        status = 'missing';
      } else {
        status = 'extra';
      }
      items.push({ index: i, expected: exp, user, match: status === 'same', status });
    }
    return items;
  };

  if (done) {
    return (
      <div className="training-card">
        <div className="success-message" style={{ fontSize: '1.25rem' }}>
          {message}
        </div>
        <button type="button" onClick={onBack} style={{ marginTop: '1rem' }}>
          New exercise
        </button>
      </div>
    );
  }

  return (
    <div className="training-card">
      <div className="training-header">
        <button type="button" onClick={onBack} className="back-btn">
          ← Back
        </button>
        <span className="step-indicator">
          Step {currentStep + 1} / {total}
        </span>
      </div>
      <div className="progress-bar">
        <div
          className="progress-bar-fill"
          style={{ width: `${progress}%` }}
        />
      </div>
      <p className="prompt-label">Reconstruct the full English sentence:</p>
      <div className="display-sentence-wrap">
        <div className="display-sentence" aria-live="polite">
          {displaySentence}
        </div>
        <button
          type="button"
          className="speak-btn secondary outline"
          onClick={() => speakSentence(originalSentence)}
          title="Listen again"
          aria-label="Listen to the sentence again"
        >
          🔊 Listen again
        </button>
      </div>
      {hasPreviousStep && (
        <div className="previous-step-row">
          <button
            type="button"
            className="secondary outline"
            onClick={() => setShowPreviousStep((v) => !v)}
          >
            {showPreviousStep ? 'Hide previous step' : 'View previous step'}
          </button>
          {showPreviousStep && previousStepSentence && (
            <div className="previous-step-box" role="status">
              <strong>Previous step:</strong> {previousStepSentence}
            </div>
          )}
        </div>
      )}
      {hintSentence && (
        <div className="hint-box" role="status">
          <strong>Hint (previous step):</strong> {hintSentence}
        </div>
      )}
      <form onSubmit={handleSubmit}>
        <div className="input-row">
          <div className="input-wrap">
            <textarea
              value={userInput}
              onChange={(e) => setUserInput(e.target.value)}
              placeholder="Type or use the mic to say the full English sentence…"
              autoFocus
              aria-label="Your answer"
            />
            {voicePreview && (
              <span className="interim-text" aria-live="polite">{voicePreview}</span>
            )}
          </div>
          {isSpeechSupported() && (
            <button
              type="button"
              className={`mic-btn ${listening ? 'listening' : ''}`}
              onClick={toggleVoice}
              title={listening ? 'Stop listening' : 'Voice input (speak in English)'}
              aria-label={listening ? 'Stop listening' : 'Start voice input'}
            >
              {listening ? '⏹ Stop' : '🎤 Voice'}
            </button>
          )}
        </div>
        {voiceError && <p className="error-message voice-error">{voiceError}</p>}
        <div className="actions">
          <button type="submit">Submit</button>
          {canShowHint && (
            <button type="button" onClick={handleHint} className="secondary">
              Show hint
            </button>
          )}
        </div>
      </form>
      {message && (
        <p className={message.startsWith('Well') ? 'success-message' : 'error-message'}>
          {message}
        </p>
      )}
      {errorDetail && (
        <div className="error-detail-box" role="status" aria-live="polite">
          <div className="error-detail-row">
            <strong>Expected:</strong>{' '}
            <span>{errorDetail.expectedSentence}</span>
          </div>
          <div className="error-detail-row">
            <strong>Your answer:</strong>{' '}
            <span>{errorDetail.userInput || '—'}</span>
          </div>
          <div className="error-detail-diff">
            <strong>Where to fix:</strong>
            <div className="error-detail-words">
              {getWordDiff(errorDetail.expectedSentence, errorDetail.userInput).map(
                ({ index, expected, user, status }) =>
                  status === 'same' ? (
                    <span key={index} className="diff-word same" title="Correct">
                      {user}
                    </span>
                  ) : status === 'missing' ? (
                    <span key={index} className="diff-word missing" title="Missing word">
                      <span className="diff-missing">{expected}</span>
                    </span>
                  ) : status === 'extra' ? (
                    <span key={index} className="diff-word extra" title="Extra word">
                      <span className="diff-wrong">{user}</span>
                    </span>
                  ) : (
                    <span key={index} className="diff-word diff" title="Wrong word">
                      <span className="diff-wrong">{user}</span>
                      <span className="diff-arrow">→</span>
                      <span className="diff-expected">{expected}</span>
                    </span>
                  )
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
