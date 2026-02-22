import { useMemo, useState } from 'react';
import { apiCall } from './api';

interface LoginProps {
  onLoginSuccess: (userId: number, userName: string, isAdmin: boolean) => void;
}

export default function Login({ onLoginSuccess }: LoginProps) {
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showPw, setShowPw] = useState(false);

  const canSubmit = useMemo(() => !!name.trim() && !!password, [name, password]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      if (!name.trim()) throw new Error('Name is required');
      if (!password) throw new Error('Password is required');

      const res = await apiCall('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ name, password }),
        credentials: 'include',
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as any).error || 'Login failed');
      }

      const user = await res.json();

      onLoginSuccess(user.id, user.name, user.isAdmin || false);

    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
      setPassword('');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <header className="auth-header">
          <div className="brand">
            <div className="brand-text">
              <h1>Veikkausliigapörssi</h1>
            </div>
          </div>

          <div className="auth-tabs" role="tablist" aria-label="Authentication mode">
            <button type="button" className="tab active" disabled={loading} role="tab" aria-selected="true">
              Kirjaudu
            </button>
            <button type="button" className="tab tab-disabled" disabled aria-disabled="true" title="Tilit luodaan ylläpidon toimesta (beta)">
              Luo tili
            </button>
          </div>
        </header>

        {error && (
          <div className="auth-error" role="alert">
            <span className="error-dot" aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="auth-form">
          <div className="field">
            <label htmlFor="name">Käyttäjänimi</label>
            <input
              id="name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={loading}
              autoComplete="username"
            />
          </div>

          <div className="field">
            <label htmlFor="password">Salasana</label>
            <div className="input-wrap">
              <input
                id="password"
                type={showPw ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={loading}
                autoComplete="current-password"
              />
              <button
                type="button"
                className="pw-toggle"
                onClick={() => setShowPw((s) => !s)}
                disabled={loading}
                aria-label={showPw ? 'Piilota salasana' : 'Näytä salasana'}
                title={showPw ? 'Piilota' : 'Näytä'}
              >
                {showPw ? '🙈' : '👁️'}
              </button>
            </div>
          </div>

          <button type="submit" className="auth-submit" disabled={!canSubmit || loading}>
            {loading ? (
              <>
                <span className="spinner" aria-hidden="true" />
                Loading…
              </>
            ) : (
              'Kirjaudu'
            )}
          </button>

          <p className="fineprint">Tämä on pelin beta versio ja ominaisuudet voivat muuttua.</p>
        </form>

        <footer className="auth-footer">
          <p>© {new Date().getFullYear()} Veikkausliigapörssi</p>
        </footer>
      </div>
    </div>
  );
}
