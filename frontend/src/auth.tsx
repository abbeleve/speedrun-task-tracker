import { createContext, useContext, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import * as api from './api';
import './auth.css';

interface AuthContextValue {
  user: string | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  register: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>(null!);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    (async () => {
      if (!api.getToken()) {
        setLoading(false);
        return;
      }
      try {
        const m = await api.me();
        if (active) setUser(m.username);
      } catch {
        api.setToken(null);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const login = async (username: string, password: string) => {
    const r = await api.login(username, password);
    api.setToken(r.token);
    setUser(r.username);
  };

  const register = async (username: string, password: string) => {
    const r = await api.register(username, password);
    api.setToken(r.token);
    setUser(r.username);
  };

  const logout = async () => {
    await api.logout();
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

// Context files naturally export both a provider component and hooks.
// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}

// Gate shown around the main app: waits while the token is validated, then
// either renders children (authenticated) or the login page.
export function AuthGate({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="auth-page">
        <div className="auth-card auth-card-loading">Загрузка…</div>
      </div>
    );
  }
  if (!user) return <LoginPage />;
  return <>{children}</>;
}

export function LoginPage() {
  const { login, register } = useAuth();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (mode === 'login') await login(username, password);
      else await register(username, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        <h1 className="auth-title">
          <span className="icon">⏱</span> SpeedRun Tasks
        </h1>
        <p className="auth-subtitle">
          {mode === 'login' ? 'Войдите, чтобы продолжить' : 'Создайте аккаунт'}
        </p>

        <div className="auth-tabs">
          <button
            type="button"
            className={`auth-tab ${mode === 'login' ? 'active' : ''}`}
            onClick={() => { setMode('login'); setError(null); }}
          >
            Вход
          </button>
          <button
            type="button"
            className={`auth-tab ${mode === 'register' ? 'active' : ''}`}
            onClick={() => { setMode('register'); setError(null); }}
          >
            Регистрация
          </button>
        </div>

        <form className="auth-form" onSubmit={submit}>
          <label className="auth-field">
            <span>Имя пользователя</span>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              autoFocus
            />
          </label>
          <label className="auth-field">
            <span>Пароль</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            />
          </label>

          {error && <div className="auth-error">{error}</div>}

          <button type="submit" className="btn btn-start auth-submit" disabled={busy}>
            {busy ? '…' : mode === 'login' ? 'Войти' : 'Зарегистрироваться'}
          </button>
        </form>
      </div>
    </div>
  );
}
