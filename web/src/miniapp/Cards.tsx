import { CaretRightIcon } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { plural } from "../shared/plural.ts";
import type { Nav } from "./App.tsx";
import { api, closeApp, haptic, share } from "./bridge.ts";
import type { CardState, Catalog, DeckSummary, Filters } from "./types.ts";
import { ActionBar, Header, Progress, Screen, Skeleton } from "./ui.tsx";

type Current = { session: CardState | null };

export function CatalogScreen({ nav, filters }: { nav: Nav; filters: Filters }) {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [current, setCurrent] = useState<CardState | null>(null);

  useEffect(() => {
    const query = new URLSearchParams(Object.entries(filters).filter((entry): entry is [string, string] => Boolean(entry[1])));
    void nav.run(async () => {
      const [nextCatalog, nextCurrent] = await Promise.all([api<Catalog>(`/api/decks?${query}`), api<Current>("/api/cards/current")]);
      setCatalog(nextCatalog);
      setCurrent(nextCurrent.session);
    });
  }, [filters, nav]);

  if (!catalog) return <Skeleton />;

  const change = (key: keyof Filters, value: string) => {
    const next: Filters = { ...filters };
    if (value) next[key] = value;
    else delete next[key];
    nav.go({ name: "catalog", filters: next });
  };

  const select = (key: keyof Filters, label: string, options: Record<string, string>) => (
    <select className={filters[key] ? "select set" : "select"} aria-label={label} value={filters[key] ?? ""} onChange={(event) => change(key, event.target.value)}>
      <option value="">{label}</option>
      {Object.entries(options).map(([value, title]) => (
        <option key={value} value={value}>
          {title}
        </option>
      ))}
    </select>
  );

  const resume = (id: string) =>
    nav.run(async () => nav.go({ name: "card", session: await api<CardState>(`/api/cards/sessions/${id}/resume`, {}) }));

  return (
    <Screen>
      <Header title="Колоды" subtitle="Вопросы уже готовы. Выберите колоду под настроение компании." />
      {current ? (
        <button className="tile card-button resume" onClick={() => void resume(current.id)}>
          <span className="body-strong">Продолжить «{current.deck.title}»</span>
          <span className="muted caption">
            Обсуждено {current.discussed} из {current.total}
          </span>
          <Progress value={current.discussed} total={current.total} />
        </button>
      ) : null}
      <div className="filters">
        {select("theme", "Тема", catalog.filters.themes)}
        {select("mood", "Настроение", catalog.filters.moods)}
      </div>
      <div className="stack">
        {catalog.decks.length === 0 ? (
          <div className="empty">
            <p className="body-strong">Таких колод пока нет</p>
            <p className="muted caption">Сбросьте один из фильтров, чтобы увидеть больше.</p>
            <button className="btn plain" onClick={() => nav.go({ name: "catalog", filters: {} })}>
              Сбросить фильтры
            </button>
          </div>
        ) : null}
        {catalog.decks.map((deck) => (
          <button key={deck.id} className="card card-button" onClick={() => nav.go({ name: "deck", deck, filters })}>
            <div className="row-between">
              <h2 className="body-strong">{deck.title}</h2>
              <CaretRightIcon className="muted" size={16} weight="bold" />
            </div>
            <p className="muted caption">{deck.description}</p>
            <div className="chips">
              <span className="chip">{catalog.filters.themes[deck.theme]}</span>
              <span className="chip">{catalog.filters.moods[deck.mood]}</span>
              <span className="chip">
                {deck.size} {plural(deck.size, "карточка", "карточки", "карточек")}
              </span>
            </div>
          </button>
        ))}
      </div>
    </Screen>
  );
}

export function DeckScreen({ nav, deck, filters }: { nav: Nav; deck: DeckSummary; filters: Filters }) {
  const [penalty, setPenalty] = useState(false);
  const [busy, setBusy] = useState(false);

  const start = () =>
    nav.run(async () => {
      setBusy(true);
      try {
        const session = await api<CardState>("/api/cards/sessions", { deckId: deck.id, penalty, launch: nav.launch });
        nav.go({ name: "card", session });
      } finally {
        setBusy(false);
      }
    });

  return (
    <Screen>
      <Header title={deck.title} subtitle={deck.description} />
      <p className="caption muted">
        {deck.size} {plural(deck.size, "карточка", "карточки", "карточек")}. Правильных ответов нет, важен сам разговор.
      </p>
{deck.penalties > 0 ? (
      <label className="card toggle">
        <span className="toggle-text">
          <span className="body-strong">Штрафные задания</span>
          <span className="muted caption">После каждой карточки выпадает весёлое задание.</span>
        </span>
        <input type="checkbox" className="switch" checked={penalty} onChange={(event) => setPenalty(event.target.checked)} />
      </label>
      ) : null}
      <ActionBar>
        <button className="btn" disabled={busy} onClick={() => void start()}>
          Начать
        </button>
        <button className="btn plain" onClick={() => nav.go({ name: "catalog", filters })}>
          Назад
        </button>
      </ActionBar>
    </Screen>
  );
}

export function CardScreen({ nav, session }: { nav: Nav; session: CardState }) {
  const [busy, setBusy] = useState(false);

  if (session.status === "finished") return <ResultScreen nav={nav} session={session} />;

  const resume = () =>
    nav.run(async () => nav.go({ name: "card", session: await api<CardState>(`/api/cards/sessions/${session.id}/resume`, {}) }));

  if (session.status === "paused") {
    return (
      <Screen>
        <Header title={session.deck.title} />
        <div className="banner">
          Игра на паузе. Прогресс сохранён: обсуждено {session.discussed} из {session.total}.
        </div>
        <Progress value={session.discussed} total={session.total} />
        <ActionBar>
          <button className="btn" onClick={() => void resume()}>
            Продолжить
          </button>
          <button className="btn plain" onClick={closeApp}>
            Закрыть
          </button>
        </ActionBar>
      </Screen>
    );
  }

  const discussed = () =>
    nav.run(async () => {
      setBusy(true);
      try {
        const next = await api<CardState>(`/api/cards/sessions/${session.id}/discussed`, {});
        haptic("success");
        nav.go(next.lastPenalty ? { name: "penalty", session: next } : { name: "card", session: next });
      } finally {
        setBusy(false);
      }
    });

  const exit = () =>
    nav.run(async () => nav.go({ name: "saved", session: await api<CardState>(`/api/cards/sessions/${session.id}/exit`, {}) }));

  return (
    <Screen>
      <div className="meta">
        <p className="caption muted">
          {session.deck.title}, {session.discussed + 1} из {session.total}
        </p>
        <Progress value={session.discussed} total={session.total} />
      </div>
      <article className="tile question">
        <p className="question-text">{session.current?.text}</p>
      </article>
      <p className="caption muted">Отвечайте по очереди. Когда все высказались, отметьте карточку.</p>
      <ActionBar>
        <button className="btn" disabled={busy} onClick={() => void discussed()}>
          Обсудили
        </button>
        <button className="btn plain" onClick={() => void exit()}>
          Выйти и сохранить
        </button>
      </ActionBar>
    </Screen>
  );
}

export function PenaltyScreen({ nav, session }: { nav: Nav; session: CardState }) {
  return (
    <Screen>
      <p className="caption muted">Штрафное задание</p>
      <article className="tile question">
        <p className="question-text">{session.lastPenalty}</p>
      </article>
      <ActionBar>
        <button className="btn" onClick={() => nav.go({ name: "card", session })}>
          Дальше
        </button>
      </ActionBar>
    </Screen>
  );
}

export function SavedScreen({ nav, session }: { nav: Nav; session: CardState }) {
  const resume = () =>
    nav.run(async () => nav.go({ name: "card", session: await api<CardState>(`/api/cards/sessions/${session.id}/resume`, {}) }));

  return (
    <Screen>
      <Header title="Прогресс сохранён" subtitle={`Обсуждено ${session.discussed} из ${session.total}. Бот прислал в чат кнопку, чтобы вернуться к игре.`} />
      <Progress value={session.discussed} total={session.total} />
      <ActionBar>
        <button className="btn" onClick={() => void resume()}>
          Вернуться сейчас
        </button>
        <button className="btn plain" onClick={closeApp}>
          Закрыть
        </button>
      </ActionBar>
    </Screen>
  );
}

function ResultScreen({ nav, session }: { nav: Nav; session: CardState }) {
  const result = session.result;
  if (!result) return null;
  const text = `Мы сыграли в карточки «${result.deckTitle}» и обсудили ${result.discussed} ${plural(result.discussed, "вопрос", "вопроса", "вопросов")}!`;

  return (
    <Screen>
      <Header title="Итоги встречи" subtitle={result.deckTitle} />
      <div className="stats">
        <div>
          <span className="stat-value">{result.discussed}</span>
          <span className="caption muted">{plural(result.discussed, "карточка", "карточки", "карточек")} обсуждено</span>
        </div>
        <div>
          <span className="stat-value">{result.minutes}</span>
          <span className="caption muted">{plural(result.minutes, "минута", "минуты", "минут")} разговора</span>
        </div>
        {session.penalty ? (
          <div>
            <span className="stat-value">{result.penalties}</span>
            <span className="caption muted">{plural(result.penalties, "штраф", "штрафа", "штрафов")}</span>
          </div>
        ) : null}
      </div>
      <p className="caption muted">Итоги уже в чате. Там же можно включить напоминание на завтра.</p>
      <ActionBar>
        <button className="btn" onClick={() => share(text)}>
          Поделиться
        </button>
        <button className="btn secondary" onClick={() => nav.go({ name: "catalog", filters: {} })}>
          Другая колода
        </button>
        <button className="btn plain" onClick={closeApp}>
          Закрыть
        </button>
      </ActionBar>
    </Screen>
  );
}
