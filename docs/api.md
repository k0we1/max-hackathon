# HTTP API

Все ответы в JSON. Ошибка приходит как `{ "error": "текст" }` с кодом 4xx или 5xx.

## Мини-приложение: `/api/*`

В каждом запросе нужен заголовок `X-Init-Data` со строкой данных запуска от MAX
(подробнее в [architecture.md](architecture.md#авторизация)). Пользователь берётся из неё,
передавать его id отдельно не нужно.

### Общее

| Метод | Путь | Описание |
|-------|------|----------|
| GET | `/api/me` | Текущий пользователь, `startParam` запуска и username бота |

### Карточки

| Метод | Путь | Тело | Описание |
|-------|------|------|----------|
| GET | `/api/decks?theme=&mood=` | | Каталог колод без архивных, с фильтрами |
| GET | `/api/cards/current` | | Незавершённая партия пользователя или `null` |
| POST | `/api/cards/sessions` | `{ deckId, penalty, launch }` | Начать партию |
| GET | `/api/cards/sessions/:id` | | Состояние партии |
| POST | `/api/cards/sessions/:id/resume` | | Продолжить после паузы |
| POST | `/api/cards/sessions/:id/discussed` | | Отметить текущую карточку |
| POST | `/api/cards/sessions/:id/exit` | | Выйти и сохранить прогресс |

`launch`: токен из `start_param` вида `c_<token>`. По нему итоги уходят в чат, откуда начали
игру. Можно не передавать, тогда бот напишет в личку.

### Тесты

| Метод | Путь | Тело | Описание |
|-------|------|------|----------|
| GET | `/api/tests` | | Список тестов |
| POST | `/api/tests/sessions` | `{ testId, solo, launch }` | Создать сессию. Для парного теста бот шлёт приглашение |
| GET | `/api/tests/sessions/:id` | | Состояние сессии, мини-приложение опрашивает его во время теста |
| POST | `/api/tests/sessions/:id/join` | | Присоединиться вторым игроком |
| POST | `/api/tests/sessions/:id/answer` | `{ option }` | Ответ на текущий вопрос, номер варианта с нуля |
| POST | `/api/tests/sessions/:id/away` | | Игрок свернул приложение, тест на паузе |
| POST | `/api/tests/sessions/:id/back` | | Игрок вернулся |
| POST | `/api/tests/sessions/:id/leave` | | Выйти, сессия завершается с частичным результатом |

Статусы сессии теста: `waiting`, `playing`, `finished`, `expired` (партнёр не пришёл),
`interrupted` (кто-то вышел), `timeout` (не дождались ответа).

## Админка: `/admin/api/*`

Нужен заголовок `Authorization: Bearer <ADMIN_PASSWORD>`. Если переменная не задана,
все пути отвечают 404.

| Метод | Путь | Описание |
|-------|------|----------|
| GET | `/admin/api/check` | Проверка пароля |
| GET | `/admin/api/stats` | Сводка: пользователи, партии, тесты, популярность колод и тестов |
| GET | `/admin/api/users` | Пользователи с числом игр |
| GET | `/admin/api/users/:id` | Пользователь, его партии, тесты и напоминания |
| GET | `/admin/api/decks` | Все колоды, включая архивные |
| POST | `/admin/api/decks` | Создать колоду |
| PUT | `/admin/api/decks/:id` | Изменить колоду, в том числе убрать в архив |
| GET | `/admin/api/sessions?limit=100` | Последние партии и тесты, `limit` до 500 |
| GET | `/admin/api/tests` | Тесты (только чтение) |
| GET | `/admin/api/reminders` | Напоминания |
| DELETE | `/admin/api/reminders/:key` | Удалить напоминание |
| POST | `/admin/api/broadcast` | Рассылка `{ text }` всем, кто писал боту в личку, до 4000 символов |

Тело колоды для POST и PUT:

```json
{
  "title": "Семейный ужин",
  "description": "Вопросы, которые удобно обсудить за столом",
  "theme": "family",
  "mood": "light",
  "cards": ["Какое блюдо из детства ты помнишь лучше всего?"],
  "penalties": ["Расскажи анекдот"],
  "archived": false
}
```

`theme`: `couple`, `friends`, `family`, `team`. `mood`: `light`, `deep`, `fun`.
В колоде должна быть хотя бы одна карточка.

## Статика

Всё остальное (`GET` вне `/api`) отдаётся из `public/`. Файлы из `public/assets/` кешируются
навсегда, у них хеш в имени. HTML отдаётся с `no-cache`.
