import { CaretRightIcon, CheckIcon, UsersIcon, UserIcon } from "@phosphor-icons/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { plural } from "../shared/plural.ts";
import type { Nav } from "./App.tsx";
import { api, closeApp, haptic, share, signal } from "./bridge.ts";
import type { QuizState, TestSummary } from "./types.ts";
import { ActionBar, clock, Header, Progress, Screen, Skeleton } from "./ui.tsx";

const POLL_MS = 1500;

export function TestsScreen({ nav }: { nav: Nav }) {
  const [tests, setTests] = useState<TestSummary[] | null>(null);

  useEffect(() => {
    void nav.run(async () => setTests((await api<{ tests: TestSummary[] }>("/api/tests")).tests));
  }, [nav]);

  if (!tests) return <Skeleton />;

  return (
    <Screen>
      <Header title="Тесты" subtitle="Проходите вдвоём одновременно или в одиночку." />
      <div className="stack">
        {tests.map((test) => (
          <button key={test.id} className="card card-button" onClick={() => nav.go({ name: "test", test })}>
            <div className="row-between">
              <h2 className="body-strong">{test.title}</h2>
              <CaretRightIcon className="muted" size={16} weight="bold" />
            </div>
            <p className="muted caption">{test.description}</p>
            <div className="chips">
              <span className="chip">
                {test.joint ? <UsersIcon size={12} /> : <UserIcon size={12} />}
                {test.joint ? "Вдвоём" : "Одиночный"}
              </span>
              <span className="chip">
                {test.size} {plural(test.size, "вопрос", "вопроса", "вопросов")}
              </span>
            </div>
          </button>
        ))}
      </div>
    </Screen>
  );
}

export function TestScreen({ nav, test }: { nav: Nav; test: TestSummary }) {
  const [busy, setBusy] = useState(false);

  const start = (solo: boolean) =>
    nav.run(async () => {
      setBusy(true);
      try {
        const session = await api<QuizState>("/api/tests/sessions", { testId: test.id, solo, launch: nav.launch });
        nav.go({ name: "quiz", session });
      } finally {
        setBusy(false);
      }
    });

  return (
    <Screen>
      <Header title={test.title} subtitle={test.description} />
      <div className="card">
        <p className="body-strong">Как это работает</p>
        <p className="muted caption">
          {test.joint
            ? `${test.size} ${plural(test.size, "вопрос", "вопроса", "вопросов")}. Вы оба отвечаете на один и тот же вопрос, следующий открывается, когда ответили оба. В конце покажем типы и карту совместимости.`
            : `${test.size} ${plural(test.size, "вопрос", "вопроса", "вопросов")}. В конце покажем ваш тип.`}
        </p>
      </div>
      <ActionBar>
        {test.joint ? (
          <button className="btn" disabled={busy} onClick={() => void start(false)}>
            Пройти вдвоём
          </button>
        ) : null}
        <button className={test.joint ? "btn secondary" : "btn"} disabled={busy} onClick={() => void start(true)}>
          Пройти одному
        </button>
        <button className="btn plain" onClick={() => nav.go({ name: "tests" })}>
          Назад
        </button>
      </ActionBar>
    </Screen>
  );
}

export function QuizScreen({ nav, initial }: { nav: Nav; initial: QuizState }) {
  const [session, setSession] = useState(initial);
  const [now, setNow] = useState(() => Date.now());
  const live = session.status === "waiting" || session.status === "playing";
  const idRef = useRef(session.id);

  const update = useCallback((next: QuizState) => {
    if (next.id === idRef.current) setSession(next);
  }, []);

  useEffect(() => {
    if (!live) return;
    const poll = window.setInterval(() => {
      api<QuizState>(`/api/tests/sessions/${idRef.current}`).then(update, () => undefined);
    }, POLL_MS);
    const tick = window.setInterval(() => setNow(Date.now()), 1000);
    return () => {
      window.clearInterval(poll);
      window.clearInterval(tick);
    };
  }, [live, update]);

  useEffect(() => {
    if (!live || !session.isPlayer) return;
    const onVisibility = () => {
      signal(`/api/tests/sessions/${idRef.current}/${document.visibilityState === "hidden" ? "away" : "back"}`);
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [live, session.isPlayer]);

  const act = (path: string, body: unknown = {}) =>
    nav.run(async () => update(await api<QuizState>(`/api/tests/sessions/${session.id}/${path}`, body)));

  if (!live) return <QuizEnd key={`end:${session.status}`} nav={nav} session={session} />;
  if (!session.isPlayer) return <Join key="join" session={session} now={now} onJoin={() => act("join")} />;
  if (session.status === "waiting") return <Waiting key="waiting" session={session} now={now} onCancel={() => act("leave")} />;
  return <Question key={`round:${session.round}`} session={session} now={now} onAnswer={(option) => act("answer", { option })} onLeave={() => act("leave")} />;
}

function Join({ session, now, onJoin }: { session: QuizState; now: number; onJoin: () => Promise<void> }) {
  const host = session.players[0]?.name ?? "Партнёр";
  return (
    <Screen>
      <Header title={session.test.title} subtitle={`${host} приглашает пройти тест вдвоём.`} />
      <div className="card">
        <p className="body-strong">{session.total} {plural(session.total, "вопрос", "вопроса", "вопросов")}</p>
        <p className="muted caption">Отвечаете одновременно, в конце увидите типы друг друга и карту совместимости.</p>
      </div>
      {session.joinDeadline ? (
        <p className="caption muted">Приглашение действует ещё {clock(session.joinDeadline, now)}</p>
      ) : null}
      <ActionBar>
        <button className="btn" onClick={() => void onJoin()}>
          Присоединиться
        </button>
      </ActionBar>
    </Screen>
  );
}

function Waiting({ session, now, onCancel }: { session: QuizState; now: number; onCancel: () => Promise<void> }) {
  const invite = session.inviteLink ?? "";
  return (
    <Screen>
      <Header title="Ждём партнёра" subtitle="Приглашение уже в чате. Ссылку можно переслать напрямую." />
      <div className="card invite">
        <span className="caption muted">Ссылка для партнёра</span>
        <span className="invite-link">{invite}</span>
      </div>
      <div className="waiting">
        <span className="pulse-dot" aria-hidden="true" />
        <span className="caption muted">
          {session.joinDeadline ? `Ждём ещё ${clock(session.joinDeadline, now)}` : "Ждём"}
        </span>
      </div>
      <ActionBar>
        <button className="btn" onClick={() => share(`Пройдём тест «${session.test.title}» вместе? ${invite}`)}>
          Отправить приглашение
        </button>
        <button className="btn plain" onClick={() => void onCancel()}>
          Отменить
        </button>
      </ActionBar>
    </Screen>
  );
}

function Question({
  session,
  now,
  onAnswer,
  onLeave,
}: {
  session: QuizState;
  now: number;
  onAnswer: (option: number) => Promise<void>;
  onLeave: () => Promise<void>;
}) {
  const [confirm, setConfirm] = useState(false);
  const [pending, setPending] = useState<number | null>(null);
  const chosen = session.myAnswer ?? pending;
  const answered = chosen !== null;
  const partner = session.players.find((player) => !player.me);

  const choose = async (option: number) => {
    if (answered) return;
    setPending(option);
    haptic("success");
    try {
      await onAnswer(option);
    } finally {
      setPending(null);
    }
  };

  const partnerStatus = partner
    ? partner.state === "away"
      ? `${partner.name} не в приложении`
      : partner.answered
        ? `${partner.name}: ответ готов`
        : `${partner.name} выбирает ответ`
    : null;

  return (
    <Screen>
      <div className="meta">
        <p className="caption muted">
          {session.test.title}, вопрос {session.round + 1} из {session.total}
        </p>
        <Progress value={session.round} total={session.total} />
      </div>
      {session.paused ? <div className="banner">Тест на паузе, пока все не вернутся в приложение. Таймер остановлен.</div> : null}
      <h2 className="tagline">{session.question?.text}</h2>
      <div className="stack options" role="radiogroup">
        {session.question?.options.map((option, index) => (
          <button
            key={option}
            role="radio"
            aria-checked={chosen === index}
            className={`card card-button option${chosen === index ? " selected" : ""}${answered && chosen !== index ? " dimmed" : ""}`}
            disabled={answered}
            onClick={() => void choose(index)}
          >
            <span>{option}</span>
            {chosen === index ? <CheckIcon size={18} weight="bold" /> : null}
          </button>
        ))}
      </div>
      <div className="quiz-status caption muted">
        {!session.solo && partnerStatus ? <span>{partnerStatus}</span> : null}
        {answered && !session.solo && !partner?.answered ? <span>Ваш ответ принят, ждём партнёра</span> : null}
        {session.roundDeadline ? <span>На ответ {clock(session.roundDeadline, now)}</span> : null}
      </div>
      <ActionBar>
        {confirm ? (
          <>
            <button className="btn danger" onClick={() => void onLeave()}>
              Точно покинуть тест?
            </button>
            <p className="caption muted action-note">Сохранится частичный результат.</p>
            <button className="btn plain" onClick={() => setConfirm(false)}>
              Остаться
            </button>
          </>
        ) : (
          <button className="btn plain" onClick={() => setConfirm(true)}>
            Покинуть тест
          </button>
        )}
      </ActionBar>
    </Screen>
  );
}

const END_TITLES: Record<string, string> = {
  finished: "Общий результат",
  interrupted: "Тест прерван",
  timeout: "Время ответа вышло",
  expired: "Партнёр не присоединился",
};

function QuizEnd({ nav, session }: { nav: Nav; session: QuizState }) {
  const result = session.result;
  const players = result?.players ?? [];
  const summary = [...players.map((player) => `${player.name}: ${player.title}`), result?.compatibility ?? ""].filter(Boolean).join("\n");

  const solo = () =>
    nav.run(async () => nav.go({ name: "quiz", session: await api<QuizState>("/api/tests/sessions", { testId: session.test.id, solo: true }) }));

  return (
    <Screen>
      <Header
        title={END_TITLES[session.status] ?? "Тест завершён"}
        subtitle={
          session.status === "expired"
            ? "Приглашение истекло. Тест можно пройти в одиночку."
            : result?.partial
              ? `Частичный результат: ${result.answered} из ${result.total}.`
              : session.test.title
        }
      />
      {players.map((player) => (
        <div key={player.userId} className="card">
          <span className="caption muted">{player.name}</span>
          <h2 className="tagline">{player.title}</h2>
          <p className="muted caption">{player.description}</p>
        </div>
      ))}
      {result?.compatibility ? (
        <div className="tile">
          <span className="caption muted">Карта совместимости</span>
          <p className="compat">{result.compatibility}</p>
        </div>
      ) : null}
      <ActionBar>
        {players.length > 0 ? (
          <button className="btn" onClick={() => share(`Результат теста «${session.test.title}»\n${summary}`)}>
            Поделиться
          </button>
        ) : null}
        {session.status === "expired" ? (
          <button className="btn" onClick={() => void solo()}>
            Пройти одному
          </button>
        ) : null}
        <button className="btn secondary" onClick={() => nav.go({ name: "tests" })}>
          К каталогу тестов
        </button>
        <button className="btn plain" onClick={closeApp}>
          Закрыть
        </button>
      </ActionBar>
    </Screen>
  );
}
