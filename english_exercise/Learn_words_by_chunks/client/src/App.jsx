import { useState } from 'react';
import SetupScreen from './components/SetupScreen';
import TrainingScreen from './components/TrainingScreen';
import { generateExercise, validateInput, requestHint } from './services/api';

export default function App() {
  const [screen, setScreen] = useState('setup');
  const [exercise, setExercise] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleGenerate = async (opts) => {
    setLoading(true);
    setError('');
    try {
      const data = await generateExercise(opts);
      console.log('[App.handleGenerate] received', {
        sentenceLength: data.sentence?.length,
        sentencePreview: data.sentence ? JSON.stringify(data.sentence.slice(0, 80)) : null,
        stepsCount: data.steps?.length,
        sessionId: data.sessionId,
      });
      setExercise({
        sentence: data.sentence,
        steps: data.steps,
        currentStep: data.currentStep,
        totalSteps: data.totalSteps,
        displaySentence: data.steps[data.currentStep],
      });
      setScreen('training');
    } catch (err) {
      setError(err.message || 'Failed to generate exercise.');
    } finally {
      setLoading(false);
    }
  };

  const handleBack = () => {
    setScreen('setup');
    setExercise(null);
    setError('');
  };

  return (
    <main className="app-container">
      {screen === 'setup' && (
        <SetupScreen
          onGenerate={handleGenerate}
          loading={loading}
          error={error}
        />
      )}
      {screen === 'training' && exercise && (
        <TrainingScreen
          exercise={exercise}
          onBack={handleBack}
          validateInput={validateInput}
          requestHint={requestHint}
        />
      )}
    </main>
  );
}
