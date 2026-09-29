import { ArrowLeftIcon, MagnifyingGlassIcon, PlusIcon } from "@phosphor-icons/react";
import { useState } from "react";
import type { ReactNode } from "react";
import { plural } from "../shared/plural.ts";
import { formatDate } from "./api.ts";
import { navigate, PageHeader, useCall, useLoad } from "./App.tsx";
import type { CardSummary, Deck, DecksResponse, QuizSummary, Reminder, Stats, Test, UserDetail, UserRow } from "./types.ts";

const CARD_STATUS: Record<string, string> = { active: "идёт", paused: "на паузе", finished: "завершена" };
const QUIZ_STATUS: Record<string, string> = {
  waiting: "ждёт партнёра",
  playing: "идёт",
  finished: "завершён",
  expired: "партнёр не пришёл",
  interrupted: "прерван",
  timeout: "таймаут ответа",
};
const PLAYER_STATE: Record<string, string> = { active: "в игре", away: "не в приложении", left: "тест покинут" };

function Loading({ error }: { error: string | null }) {
  if (error) return <div className="banner error">{error}</div>;
  return (
    <div className="loading">
      <div className="skeleton" style={{ height: 36, width: 240 }} />
      <div className="skeleton" style={{ height: 280 }} />
    </div>
  );
}

function Panel({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="card panel">
      {title ? <h2 className="tagline">{title}</h2> : null}
      {children}
    </section>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="muted caption empty-row">{children}</p>;
}

function Back({ href, label }: { href: string; label: string }) {
  return (
    <a className="back" href={href}>
      <ArrowLeftIcon size={14} />
      {label}
    </a>
  );
}

export function StatsPage() {
  const { data, error } = useLoad<Stats>("stats");
  if (!data) return <Loading error={error} />;
  const stat = (value: number, label: string) => (
    <div className="stat" key={label}>
      <span className="stat-value">{value}</span>
      <span className="caption muted">{label}</span>
    </div>
  );
  return (
    <>
      <PageHeader title="Сводка" />
      <div className="stat-grid">
        {stat(data.users.total, "пользователей")}
        {stat(data.users.dialog, "писали боту в личку")}
        {stat(data.users.active24h, "активны за 24 часа")}
        {stat(data.users.active7d, "активны за 7 дней")}
      </div>
      <div className="stat-grid">
        {stat(data.cards.total, "игр в карточки")}
        {stat(data.cards.finished, "доиграно до конца")}
        {stat(data.cards.discussed, "карточек обсуждено")}
        {stat(data.tests.total, "тестов начато")}
        {stat(data.tests.finished, "тестов завершено")}
        {stat(data.tests.interrupted, "тестов сорвалось")}
        {stat(data.reminders, "напоминаний включено")}
      </div>
      <div className="two-col">
        <Panel title="Колоды">
          <table>
            <thead>
              <tr>
                <th>Колода</th>
                <th className="num">Игр</th>
                <th className="num">До конца</th>
              </tr>
            </thead>
            <tbody>
              {data.decks.map((deck) => (
                <tr key={deck.id} className="click" onClick={() => navigate(`#decks/${deck.id}`)}>
                  <td>{deck.title}</td>
                  <td className="num">{deck.sessions}</td>
                  <td className="num">{deck.finished}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
        <Panel title="Тесты">
          <table>
            <thead>
              <tr>
                <th>Тест</th>
                <th className="num">Начато</th>
                <th className="num">Завершено</th>
              </tr>
            </thead>
            <tbody>
              {data.testsTop.map((test) => (
                <tr key={test.id}>
                  <td>{test.title}</td>
                  <td className="num">{test.sessions}</td>
                  <td className="num">{test.finished}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      </div>
    </>
  );
}

export function UsersPage() {
  const { data, error } = useLoad<{ users: UserRow[] }>("users");
  const [query, setQuery] = useState("");
  if (!data) return <Loading error={error} />;
  const needle = query.trim().toLowerCase();
  const users = needle
    ? data.users.filter((user) => `${user.name} ${user.username ?? ""} ${user.id}`.toLowerCase().includes(needle))
    : data.users;
  return (
    <>
      <PageHeader title="Пользователи" count={data.users.length} />
      <label className="search">
        <MagnifyingGlassIcon size={16} className="muted" />
        <input className="input" type="search" placeholder="Имя, username или id" aria-label="Поиск" value={query} onChange={(event) => setQuery(event.target.value)} />
      </label>
      <Panel>
        {users.length === 0 ? (
          <Empty>{data.users.length === 0 ? "Пока никто не заходил. Пользователи появятся после первого сообщения боту." : "Никого не нашли."}</Empty>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Имя</th>
                <th>Username</th>
                <th>Личка</th>
                <th className="num">Карточки</th>
                <th className="num">Тесты</th>
                <th>Напоминание</th>
                <th>Последний визит</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id} className="click" onClick={() => navigate(`#users/${user.id}`)}>
                  <td>
                    <span className="strong">{user.name}</span>
                    <span className="muted fine block">id {user.id}</span>
                  </td>
                  <td>{user.username ? `@${user.username}` : <span className="muted">нет</span>}</td>
                  <td>{user.dialog ? "да" : <span className="muted">нет</span>}</td>
                  <td className="num">{user.cards}</td>
                  <td className="num">{user.tests}</td>
                  <td>{user.reminder ? "включено" : <span className="muted">нет</span>}</td>
                  <td>{formatDate(user.lastSeen)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </>
  );
}

function CardTable({ sessions, withUser }: { sessions: CardSummary[]; withUser: boolean }) {
  if (sessions.length === 0) return <Empty>Игр в карточки пока нет.</Empty>;
  return (
    <table>
      <thead>
        <tr>
          {withUser ? <th>Игрок</th> : null}
          <th>Колода</th>
          <th>Статус</th>
          <th className="num">Прогресс</th>
          <th>Начало</th>
          <th>Итог</th>
        </tr>
      </thead>
      <tbody>
        {sessions.map((session) => (
          <tr key={session.id}>
            {withUser ? (
              <td>
                <a href={`#users/${session.userId}`}>{session.userName}</a>
              </td>
            ) : null}
            <td>
              {session.deckTitle}
              {session.penalty ? <span className="muted fine block">со штрафами</span> : null}
            </td>
            <td>
              <span className={`chip${session.status === "finished" ? " active" : ""}`}>{CARD_STATUS[session.status] ?? session.status}</span>
            </td>
            <td className="num">
              {session.discussed} / {session.total}
            </td>
            <td>{formatDate(session.startedAt)}</td>
            <td>{session.result ? `${session.result.minutes} мин, штрафов ${session.result.penalties}` : <span className="muted">нет</span>}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function QuizTable({ sessions }: { sessions: QuizSummary[] }) {
  if (sessions.length === 0) return <Empty>Тестов пока нет.</Empty>;
  return (
    <table>
      <thead>
        <tr>
          <th>Тест</th>
          <th>Статус</th>
          <th>Игроки</th>
          <th>Создан</th>
          <th>Результат</th>
        </tr>
      </thead>
      <tbody>
        {sessions.map((session) => (
          <tr key={session.id}>
            <td>
              {session.testTitle}
              <span className="muted fine block">{session.solo ? "одиночный" : "вдвоём"}</span>
            </td>
            <td>
              <span className={`chip${session.status === "finished" ? " active" : ""}`}>{QUIZ_STATUS[session.status] ?? session.status}</span>
            </td>
            <td>
              {session.players.map((player) => (
                <span key={player.userId} className="block">
                  <a href={`#users/${player.userId}`}>{player.name}</a>
                  <span className="muted fine">
                    {" "}
                    {PLAYER_STATE[player.state] ?? player.state}, ответов {player.answered}
                  </span>
                </span>
              ))}
            </td>
            <td>{formatDate(session.createdAt)}</td>
            <td>
              {session.result ? (
                <>
                  {session.result.players.map((player) => (
                    <span key={player.userId} className="block">
                      {player.name}: <span className="strong">{player.title}</span>
                    </span>
                  ))}
                  {session.result.compatibility ? <span className="muted fine block">{session.result.compatibility}</span> : null}
                  {session.result.partial ? (
                    <span className="muted fine block">
                      частичный, {session.result.answered} из {session.result.total}
                    </span>
                  ) : null}
                </>
              ) : (
                <span className="muted">нет</span>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function UserPage({ id }: { id: string }) {
  const { data, error } = useLoad<UserDetail>(`users/${id}`);
  if (!data) return <Loading error={error} />;
  const { user } = data;
  return (
    <>
      <Back href="#users" label="Пользователи" />
      <PageHeader title={user.name} />
      <div className="chips">
        <span className="chip">id {user.id}</span>
        {user.username ? <span className="chip">@{user.username}</span> : null}
        <span className="chip">{user.dialog ? "есть личка с ботом" : "только мини-апп или группа"}</span>
        <span className="chip">с {formatDate(user.firstSeen)}</span>
        <span className="chip">последний визит {formatDate(user.lastSeen)}</span>
        {data.reminders.map((reminder) => (
          <span key={reminder.key} className="chip active">
            напоминание {formatDate(reminder.nextAt)}
          </span>
        ))}
      </div>
      <Panel title="Карточки">
        <CardTable sessions={data.cards} withUser={false} />
      </Panel>
      <Panel title="Тесты">
        <QuizTable sessions={data.tests} />
      </Panel>
    </>
  );
}

export function DecksPage() {
  const { data, error } = useLoad<DecksResponse>("decks");
  if (!data) return <Loading error={error} />;
  const { filters } = data;
  return (
    <>
      <PageHeader
        title="Колоды"
        count={data.decks.length}
        actions={
          <a className="btn small" href="#decks/new">
            <PlusIcon size={14} weight="bold" />
            Новая колода
          </a>
        }
      />
      <div className="deck-grid">
        {data.decks.map((deck) => (
          <a key={deck.id} className="card card-button deck-card" href={`#decks/${deck.id}`}>
            <div className="deck-card-head">
              <h2 className="body-strong">{deck.title}</h2>
              <span className={`chip${deck.archived ? "" : " active"}`}>{deck.archived ? "в архиве" : "в каталоге"}</span>
            </div>
            <p className="muted caption">{deck.description}</p>
            <div className="chips">
              <span className="chip">{filters.themes[deck.theme]}</span>
              <span className="chip">{filters.moods[deck.mood]}</span>
            </div>
            <p className="caption muted deck-card-foot">
              {deck.cards.length} {plural(deck.cards.length, "карточка", "карточки", "карточек")}, {deck.penalties.length}{" "}
              {plural(deck.penalties.length, "штраф", "штрафа", "штрафов")}
            </p>
          </a>
        ))}
      </div>
    </>
  );
}

const EMPTY_DECK: Omit<Deck, "id"> = {
  title: "",
  description: "",
  theme: "friends",
  mood: "light",
  lang: "ru",
  cards: [],
  penalties: [],
  archived: false,
};

function lines(value: string): string[] {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

export function DeckEditPage({ id }: { id: string }) {
  const { data, error } = useLoad<DecksResponse>("decks");
  if (!data) return <Loading error={error} />;
  const isNew = id === "new";
  const deck = isNew ? { id: "new", ...EMPTY_DECK } : data.decks.find((item) => item.id === id);
  if (!deck) return <div className="banner error">Колода не найдена</div>;
  return <DeckForm key={deck.id} deck={deck} isNew={isNew} filters={data.filters} />;
}

function DeckForm({ deck, isNew, filters }: { deck: Deck; isNew: boolean; filters: DecksResponse["filters"] }) {
  const call = useCall();
  const [form, setForm] = useState({
    title: deck.title,
    description: deck.description,
    theme: deck.theme,
    mood: deck.mood,
    lang: deck.lang,
    cards: deck.cards.join("\n"),
    penalties: deck.penalties.join("\n"),
    archived: deck.archived ?? false,
  });
  const [status, setStatus] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => setForm((previous) => ({ ...previous, [key]: value }));

  const save = async () => {
    setBusy(true);
    setStatus(null);
    try {
      const payload = { ...form, cards: lines(form.cards), penalties: lines(form.penalties) };
      const saved = await call<Deck>(isNew ? "decks" : `decks/${deck.id}`, isNew ? "POST" : "PUT", payload);
      if (isNew) navigate(`#decks/${saved.id}`);
      else setStatus({ kind: "ok", text: `Сохранено в ${new Date().toLocaleTimeString("ru-RU", { timeStyle: "short" })}` });
    } catch (failure) {
      setStatus({ kind: "error", text: failure instanceof Error ? failure.message : String(failure) });
    } finally {
      setBusy(false);
    }
  };

  const options = (values: Record<string, string>) =>
    Object.entries(values).map(([value, title]) => (
      <option key={value} value={value}>
        {title}
      </option>
    ));

  return (
    <>
      <Back href="#decks" label="Колоды" />
      <PageHeader title={isNew ? "Новая колода" : deck.title} />
      <form
        className="card panel deck-form"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <label className="field wide">
          <span>Название</span>
          <input className="input" required maxLength={100} value={form.title} onChange={(event) => set("title", event.target.value)} />
        </label>
        <label className="field wide">
          <span>Описание</span>
          <input className="input" maxLength={300} value={form.description} onChange={(event) => set("description", event.target.value)} />
        </label>
        <label className="field">
          <span>Тема</span>
          <select className="select" value={form.theme} onChange={(event) => set("theme", event.target.value)}>
            {options(filters.themes)}
          </select>
        </label>
        <label className="field">
          <span>Настроение</span>
          <select className="select" value={form.mood} onChange={(event) => set("mood", event.target.value)}>
            {options(filters.moods)}
          </select>
        </label>
        <label className="field wide">
          <span>
            Карточки, по одной на строку <span className="muted">({lines(form.cards).length})</span>
          </span>
          <textarea className="textarea" required value={form.cards} onChange={(event) => set("cards", event.target.value)} />
        </label>
        <label className="field wide">
          <span>
            Штрафные задания, по одному на строку <span className="muted">({lines(form.penalties).length})</span>
          </span>
          <textarea className="textarea short" value={form.penalties} onChange={(event) => set("penalties", event.target.value)} />
        </label>
        <label className="check wide">
          <input type="checkbox" className="switch" checked={form.archived} onChange={(event) => set("archived", event.target.checked)} />
          <span>
            В архиве
            <span className="muted caption block">Колода скрыта из каталога, начатые игры доигрываются.</span>
          </span>
        </label>
        <div className="form-actions wide">
          <button className="btn small" type="submit" disabled={busy}>
            {isNew ? "Создать колоду" : "Сохранить"}
          </button>
          {status ? <span className={status.kind === "ok" ? "caption muted" : "caption error-text"}>{status.text}</span> : null}
        </div>
      </form>
    </>
  );
}

export function SessionsPage() {
  const { data, error } = useLoad<{ cards: CardSummary[]; tests: QuizSummary[] }>("sessions?limit=200");
  if (!data) return <Loading error={error} />;
  return (
    <>
      <PageHeader title="Сессии" />
      <Panel title={`Карточки, последние ${data.cards.length}`}>
        <CardTable sessions={data.cards} withUser />
      </Panel>
      <Panel title={`Тесты, последние ${data.tests.length}`}>
        <QuizTable sessions={data.tests} />
      </Panel>
    </>
  );
}

export function RemindersPage() {
  const call = useCall();
  const { data, error, reload } = useLoad<{ reminders: Reminder[] }>("reminders");
  const [confirm, setConfirm] = useState<string | null>(null);
  if (!data) return <Loading error={error} />;

  const disable = async (key: string) => {
    if (confirm !== key) {
      setConfirm(key);
      return;
    }
    await call(`reminders/${key}`, "DELETE");
    setConfirm(null);
    reload();
  };

  return (
    <>
      <PageHeader title="Напоминания" count={data.reminders.length} />
      <Panel>
        {data.reminders.length === 0 ? (
          <Empty>Никто пока не включил напоминания. Бот предлагает их после каждой игры в карточки.</Empty>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Кто включил</th>
                <th>Куда</th>
                <th>Следующее</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.reminders.map((reminder) => (
                <tr key={reminder.key}>
                  <td>
                    <a href={`#users/${reminder.userId}`}>{reminder.userName}</a>
                  </td>
                  <td>{reminder.chatId === null ? "в личку" : `чат ${reminder.chatId}`}</td>
                  <td>{formatDate(reminder.nextAt)}</td>
                  <td className="num">
                    <button className={`btn small ${confirm === reminder.key ? "danger" : "plain"}`} onClick={() => void disable(reminder.key)}>
                      {confirm === reminder.key ? "Точно отключить?" : "Отключить"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </>
  );
}

export function BroadcastPage() {
  const call = useCall();
  const { data, error } = useLoad<Stats>("stats");
  const [text, setText] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  if (!data) return <Loading error={error} />;
  const audience = data.users.dialog;

  const send = async () => {
    if (!confirm) {
      setConfirm(true);
      return;
    }
    setBusy(true);
    setResult(null);
    try {
      const outcome = await call<{ sent: number; failed: number }>("broadcast", "POST", { text });
      setResult({ kind: "ok", text: `Доставлено ${outcome.sent}${outcome.failed ? `, не доставлено ${outcome.failed}` : ""}` });
      setText("");
    } catch (failure) {
      setResult({ kind: "error", text: failure instanceof Error ? failure.message : String(failure) });
    } finally {
      setBusy(false);
      setConfirm(false);
    }
  };

  return (
    <>
      <PageHeader title="Рассылка" />
      <form
        className="card panel"
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        <p className="caption muted">
          Получателей: {audience}. Это все, у кого есть личка с ботом. В группы рассылка не уходит.
        </p>
        <label className="field">
          <span>Текст</span>
          <textarea
            className="textarea"
            maxLength={4000}
            required
            placeholder="Например: в каталоге появилась новая колода для команды."
            value={text}
            onChange={(event) => {
              setText(event.target.value);
              setConfirm(false);
            }}
          />
        </label>
        <div className="form-actions">
          <button className={`btn small${confirm ? " danger" : ""}`} type="submit" disabled={busy || !text.trim() || audience === 0}>
            {busy ? "Отправляем" : confirm ? `Отправить ${audience}?` : "Отправить"}
          </button>
          {confirm ? (
            <button className="btn small plain" type="button" onClick={() => setConfirm(false)}>
              Отмена
            </button>
          ) : null}
          {result ? <span className={result.kind === "ok" ? "caption muted" : "caption error-text"}>{result.text}</span> : null}
        </div>
      </form>
    </>
  );
}

export function TestsPage() {
  const { data, error } = useLoad<{ tests: Test[] }>("tests");
  if (!data) return <Loading error={error} />;
  return (
    <>
      <PageHeader title="Тесты" />
      <p className="caption muted">Тесты задаются в коде (src/content.ts), здесь только просмотр.</p>
      {data.tests.map((test) => {
        const titles = Object.fromEntries(test.types.map((type) => [type.id, type.title]));
        return (
          <Panel key={test.id} title={test.title}>
            <div className="chips">
              <span className="chip">{test.joint ? "вдвоём" : "одиночный"}</span>
              <span className="chip">
                {test.questions.length} {plural(test.questions.length, "вопрос", "вопроса", "вопросов")}
              </span>
            </div>
            <p className="muted caption">{test.description}</p>
            <div className="type-grid">
              {test.types.map((type) => (
                <div key={type.id}>
                  <p className="strong">{type.title}</p>
                  <p className="muted caption">{type.description}</p>
                </div>
              ))}
            </div>
            <table>
              <thead>
                <tr>
                  <th>Вопрос</th>
                  <th>Варианты и веса</th>
                </tr>
              </thead>
              <tbody>
                {test.questions.map((question) => (
                  <tr key={question.text}>
                    <td>{question.text}</td>
                    <td>
                      {question.options.map((option) => (
                        <span key={option.text} className="block option-line">
                          {option.text}{" "}
                          {Object.entries(option.weights).map(([type, weight]) => (
                            <span key={type} className="chip">
                              {titles[type] ?? type} +{weight}
                            </span>
                          ))}
                        </span>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>
        );
      })}
    </>
  );
}
