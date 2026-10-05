import { createContext, useCallback, useContext, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import * as api from './api';
import { disablePush } from './push';
import { prepareIntroScene } from './intro';
import type { IntroKind } from './intro';
import LoginIntro from './LoginIntro';
import './auth.css';

interface AuthContextValue {
  user: string | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  register: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  // The intro to play over the app as it opens (LoginIntro.tsx), or null
  // once it has played: on every load with a saved session, and after every
  // sign-in and registration.
  intro: IntroKind | null;
  finishIntro: () => void;
}

const AuthContext = createContext<AuthContextValue>(null!);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [intro, setIntro] = useState<IntroKind | null>(() => (api.getToken() ? 'return' : null));
  const finishIntro = useCallback(() => setIntro(null), []);

  useEffect(() => {
    let active = true;
    (async () => {
      if (!api.getToken()) {
        setLoading(false);
        return;
      }
      // The intro covers the screen while the session is checked; have its
      // scene built meanwhile.
      prepareIntroScene();
      try {
        const m = await api.me();
        if (active) setUser(m.username);
      } catch {
        api.setToken(null);
        if (active) setIntro(null);
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
    setIntro('return');
    setUser(r.username);
  };

  const register = async (username: string, password: string) => {
    const r = await api.register(username, password);
    api.setToken(r.token);
    setIntro('welcome');
    setUser(r.username);
  };

  const logout = async () => {
    // The next account on this browser must not get this one's pushes.
    await disablePush().catch(() => undefined);
    await api.logout();
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout, intro, finishIntro }}>
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
// either renders children (authenticated) or the login page. The intro plays
// over the app; with a saved session it already covers the screen while the
// token is checked, and it stays the same element when the app mounts under
// it, so the shot runs on unbroken.
export function AuthGate({ children }: { children: ReactNode }) {
  const { user, loading, intro, finishIntro } = useAuth();
  if (!loading && !user) return <LoginPage />;
  if (loading && !intro) {
    return (
      <div className="auth-page">
        <div className="auth-card auth-card-loading">Загрузка…</div>
      </div>
    );
  }
  return (
    <>
      {user ? children : null}
      {intro && <LoginIntro kind={intro} user={user} onDone={finishIntro} />}
    </>
  );
}

export function LoginPage() {
  const { login, register } = useAuth();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // The intro plays the moment the sign-in goes through; build its scene
  // while the form is being filled in.
  useEffect(() => {
    prepareIntroScene();
  }, []);

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
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="next"
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
              enterKeyHint="go"
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
