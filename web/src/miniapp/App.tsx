import { useCallback, useEffect, useMemo, useState } from "react";
import { api, webApp } from "./bridge.ts";
import { CardScreen, CatalogScreen, DeckScreen, PenaltyScreen, SavedScreen } from "./Cards.tsx";
import { HomeScreen } from "./Home.tsx";
import { QuizScreen, TestScreen, TestsScreen } from "./Quiz.tsx";
import type { CardState, DeckSummary, Filters, Me, QuizState, TestSummary } from "./types.ts";
import { Header, Screen, Skeleton } from "./ui.tsx";

export type Route =
  | { name: "loading" }
  | { name: "failed" }
  | { name: "home" }
  | { name: "catalog"; filters: Filters }
  | { name: "deck"; deck: DeckSummary; filters: Filters }
  | { name: "card"; session: CardState }
  | { name: "penalty"; session: CardState }
  | { name: "saved"; session: CardState }
  | { name: "tests" }
  | { name: "test"; test: TestSummary }
  | { name: "quiz"; session: QuizState };

export type Nav = {
  go: (route: Route) => void;
  run: (task: () => Promise<void>) => Promise<void>;
  launch: string | null;
};

function routeKey(route: Route): string {
  switch (route.name) {
    case "card":
    case "penalty":
    case "saved":
      return `${route.name}:${route.session.id}:${route.session.discussed}:${route.session.status}`;
    case "deck":
      return `deck:${route.deck.id}`;
    case "test":
      return `test:${route.test.id}`;
    case "quiz":
      return `quiz:${route.session.id}`;
    default:
      return route.name;
  }
}

export function App() {
  const [route, setRoute] = useState<Route>({ name: "loading" });
  const [error, setError] = useState<string | null>(null);
  const [launch, setLaunch] = useState<string | null>(null);

  const go = useCallback((next: Route) => {
    setError(null);
    setRoute(next);
    window.scrollTo(0, 0);
  }, []);

  const run = useCallback(async (task: () => Promise<void>) => {
    setError(null);
    try {
      await task();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    }
  }, []);

  useEffect(() => {
    webApp?.ready?.();
    void (async () => {
      try {
        const me = await api<Me>("/api/me");
        const [prefix = "", ...rest] = (me.startParam ?? "").split("_");
        const value = rest.join("_");
        if (prefix === "c" && value) {
          setLaunch(value);
          go({ name: "catalog", filters: {} });
        } else if (prefix === "t" && value) {
          setLaunch(value);
          go({ name: "tests" });
        } else if (prefix === "s" && value) {
          go({ name: "card", session: await api<CardState>(`/api/cards/sessions/${value}`) });
        } else if (prefix === "j" && value) {
          go({ name: "quiz", session: await api<QuizState>(`/api/tests/sessions/${value}`) });
        } else if (prefix === "o" && value) {
          go({ name: "quiz", session: await api<QuizState>("/api/tests/sessions", { testId: value, solo: true }) });
        } else {
          go({ name: "home" });
        }
      } catch (failure) {
        setRoute({ name: "failed" });
        setError(failure instanceof Error ? failure.message : String(failure));
      }
    })();
  }, [go]);

  const nav = useMemo<Nav>(() => ({ go, run, launch }), [go, run, launch]);

  return (
    <main className="app">
      {error && route.name !== "failed" ? (
        <div className="banner error app-error" role="alert">
          {error}
        </div>
      ) : null}
      <View key={routeKey(route)} route={route} nav={nav} />
    </main>
  );
}

function View({ route, nav }: { route: Route; nav: Nav }) {
  switch (route.name) {
    case "loading":
      return <Skeleton />;
    case "failed":
      return (
        <Screen>
          <Header title="Не получилось открыть" subtitle="Откройте приложение кнопкой из чата с ботом." />
        </Screen>
      );
    case "home":
      return <HomeScreen nav={nav} />;
    case "catalog":
      return <CatalogScreen nav={nav} filters={route.filters} />;
    case "deck":
      return <DeckScreen nav={nav} deck={route.deck} filters={route.filters} />;
    case "card":
      return <CardScreen nav={nav} session={route.session} />;
    case "penalty":
      return <PenaltyScreen nav={nav} session={route.session} />;
    case "saved":
      return <SavedScreen nav={nav} session={route.session} />;
    case "tests":
      return <TestsScreen nav={nav} />;
    case "test":
      return <TestScreen nav={nav} test={route.test} />;
    case "quiz":
      return <QuizScreen nav={nav} initial={route.session} />;
  }
}
