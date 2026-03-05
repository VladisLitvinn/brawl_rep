import { useState } from 'react';

const LEVELS = [
  { value: 'B1', label: 'B1' },
  { value: 'B2', label: 'B2' },
  { value: 'C1', label: 'C1' },
];

export default function SetupScreen({ onGenerate, loading, error }) {
  const [topic, setTopic] = useState('');
  const [level, setLevel] = useState('B2');
  const [iterations, setIterations] = useState(7);

  const handleSubmit = (e) => {
    e.preventDefault();
    onGenerate({ topic: topic.trim(), level, iterations });
  };

  return (
    <div className="setup-card">
      <h1>Learn words by chunks</h1>
      <p className="subtitle">
        Progressive sentence reconstruction. Set options and generate an exercise.
      </p>
      <form onSubmit={handleSubmit}>
        <label className="label" htmlFor="topic">
          Topic (optional)
        </label>
        <input
          id="topic"
          type="text"
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          placeholder="e.g. environment, work, travel"
          autoComplete="off"
        />

        <label className="label" htmlFor="level">
          CEFR level
        </label>
        <select
          id="level"
          value={level}
          onChange={(e) => setLevel(e.target.value)}
        >
          {LEVELS.map((l) => (
            <option key={l.value} value={l.value}>
              {l.label}
            </option>
          ))}
        </select>

        <label className="label" htmlFor="iterations">
          Number of steps (iterations)
        </label>
        <input
          id="iterations"
          type="number"
          min={4}
          max={12}
          value={iterations}
          onChange={(e) => setIterations(Number(e.target.value) || 6)}
        />

        {error && <p className="error-message">{error}</p>}
        <button type="submit" disabled={loading}>
          {loading ? 'Generating…' : 'Generate exercise'}
        </button>
      </form>
    </div>
  );
}
