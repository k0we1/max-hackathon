import { SignOutIcon } from "@phosphor-icons/react";
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { adminApi, AuthError, readPassword, writePassword } from "./api.ts";
import { BroadcastPage, DeckEditPage, DecksPage, RemindersPage, SessionsPage, StatsPage, TestsPage, UserPage, UsersPage } from "./Pages.tsx";

type Call = <T>(path: string, method?: string, body?: unknown) => Promise<T>;

const CallContext = createContext<Call | null>(null);

export function useCall(): Call {
  const call = useContext(CallContext);
  if (!call) throw new Error("Нет доступа к API");
  return call;
}

export function useLoad<T>(path: string): { data: T | null; error: string | null; reload: () => void } {
  const call = useCall();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let alive = true;
    setError(null);
    call<T>(path).then(
      (value) => {
        if (alive) setData(value);
      },
      (failure: unknown) => {
        if (alive && !(failure instanceof AuthError)) setError(failure instanceof Error ? failure.message : String(failure));
      },
    );
    return () => {
      alive = false;
    };
  }, [call, path, version]);

  return { data, error, reload: () => setVersion((value) => value + 1) };
}

export function navigate(hash: string): void {
  location.hash = hash;
}

const TABS: [string, string][] = [
  ["stats", "Сводка"],
  ["users", "Пользователи"],
  ["decks", "Колоды"],
  ["sessions", "Сессии"],
  ["reminders", "Напоминания"],
  ["broadcast", "Рассылка"],
  ["tests", "Тесты"],
];

function useHash(): string[] {
  const [hash, setHash] = useState(() => location.hash);
  useEffect(() => {
    const onChange = () => {
      setHash(location.hash);
      window.scrollTo(0, 0);
    };
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return hash.replace(/^#/, "").split("/").filter(Boolean);
}

export function App() {
  const [password, setPassword] = useState(readPassword);
  const [notice, setNotice] = useState<string | null>(null);
  const [section = "stats", id] = useHash();

  const logout = useCallback((message: string | null) => {
    writePassword("");
    setPassword("");
    setNotice(message);
  }, []);

  const call = useCallback<Call>(
    async <T,>(path: string, method = "GET", body?: unknown) => {
      try {
        return await adminApi<T>(password, path, method, body);
      } catch (failure) {
        if (failure instanceof AuthError) logout(failure.message);
        throw failure;
      }
    },
    [password, logout],
  );

  if (!password) {
    return (
      <Login
        notice={notice}
        onLogin={(value) => {
          writePassword(value);
          setNotice(null);
          setPassword(value);
        }}
      />
    );
  }

  return (
    <CallContext.Provider value={call}>
      <header className="global-nav">
        <div className="global-nav-inner">
          <a className="brand" href="#stats">
            Поговорим
          </a>
          <nav>
            {TABS.map(([key, title]) => (
              <a key={key} href={`#${key}`} className={section === key ? "active" : ""}>
                {title}
              </a>
            ))}
          </nav>
          <button className="utility" onClick={() => logout(null)}>
            <SignOutIcon size={14} />
            Выйти
          </button>
        </div>
      </header>
      <main className="page enter" key={`${section}/${id ?? ""}`}>
        <Page section={section} id={id} />
      </main>
    </CallContext.Provider>
  );
}

function Page({ section, id }: { section: string; id: string | undefined }) {
  if (section === "users" && id) return <UserPage id={id} />;
  if (section === "decks" && id) return <DeckEditPage id={id} />;
  switch (section) {
    case "users":
      return <UsersPage />;
    case "decks":
      return <DecksPage />;
    case "sessions":
      return <SessionsPage />;
    case "reminders":
      return <RemindersPage />;
    case "broadcast":
      return <BroadcastPage />;
    case "tests":
      return <TestsPage />;
    default:
      return <StatsPage />;
  }
}

function Login({ notice, onLogin }: { notice: string | null; onLogin: (password: string) => void }) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(notice);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await adminApi(value, "check");
      onLogin(value);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="login enter">
      <form
        className="card login-card"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <h1 className="display">Админка</h1>
        <p className="muted caption">Поговорим: колоды, игроки и рассылки.</p>
        {error ? <div className="banner error">{error}</div> : null}
        <label className="field">
          <span>Пароль</span>
          <input className="input" type="password" autoComplete="current-password" autoFocus required value={value} onChange={(event) => setValue(event.target.value)} />
        </label>
        <button className="btn" type="submit" disabled={busy || !value}>
          Войти
        </button>
      </form>
    </main>
  );
}

export function PageHeader({ title, count, actions }: { title: string; count?: number; actions?: ReactNode }) {
  return (
    <div className="page-header">
      <h1 className="display">
        {title}
        {count !== undefined ? <span className="count"> {count}</span> : null}
      </h1>
      {actions}
    </div>
  );
}
