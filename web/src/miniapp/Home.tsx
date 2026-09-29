import { CaretRightIcon } from "@phosphor-icons/react";
import type { Nav } from "./App.tsx";
import { Header, Screen } from "./ui.tsx";

export function HomeScreen({ nav }: { nav: Nav }) {
  return (
    <Screen>
      <Header hero title="Поговорим" subtitle="Игры для разговоров в чате: с парой, друзьями, семьёй или командой." />
      <div className="stack">
        <button className="card card-button mode" onClick={() => nav.go({ name: "catalog", filters: {} })}>
          <h2 className="tagline">Карточки для обсуждения</h2>
          <p className="muted">Готовые колоды вопросов. Тяните карточку и говорите по очереди.</p>
          <span className="link-button">
            Открыть <CaretRightIcon size={14} weight="bold" />
          </span>
        </button>
        <button className="tile card-button mode" onClick={() => nav.go({ name: "tests" })}>
          <h2 className="tagline">Тест на совместимость</h2>
          <p className="muted">Отвечайте вдвоём одновременно и посмотрите, как сочетаются ваши стили.</p>
          <span className="link-button">
            Открыть <CaretRightIcon size={14} weight="bold" />
          </span>
        </button>
      </div>
    </Screen>
  );
}
