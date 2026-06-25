---
name: dev-server
description: Use when managing the Otto UI development server (Vite HMR + backend API). Covers start, stop, restart, troubleshooting port conflicts, git merge conflicts blocking compilation, and environment configuration for the dev script at scripts/dev-web-hmr.mjs.
license: MIT
compatibility: opencode
---

# Otto UI Dev Server

Управління development сервером Otto UI (Vite HMR + backend API).

## Архітектура

Dev server працює як два паралельних процеси:

```
scripts/dev-web-hmr.mjs
├── bun run --cwd packages/web dev:server:watch
│   └── nodemon --watch server --ext js --exec "bun server/index.js --port <PORT>"
│       └── bun server/index.js --port 3902   (Express API сервер)
└── bun x vite --host <HOST> --port <PORT> --strictPort
    └── node .../.bin/vite ...                 (Vite HMR фронтенд)
```

- **Vite HMR** — фронтенд з гарячим перезавантаженням (швидкі оновлення без перезавантаження сторінки)
- **nodemon** — стежить за змінами у `packages/web/server/` та перезапускає API
- **Vite proxy** — `/api/*`, `/auth/*`, `/ws/*` проксуються на backend API

## Порти за замовчуванням

| Компонент | Порт |
|-----------|------|
| Vite HMR (UI) | `5180` |
| Backend API | `3902` |

## Команди

### Запуск / перезапуск

```bash
bun run dev
```

або:

```bash
node ./scripts/dev-web-hmr.mjs
```

### Зупинка

`Ctrl+C` у терміналі, де запущено скрипт. Скрипт виконує каскадне завершення:
1. `SIGINT` — чекає 2.5с
2. `SIGTERM` — чекає 2.5с
3. `SIGKILL` — чекає 1с

### Альтернативний режим (build+serve)

```bash
bun run dev:web:full
```

Спочатку збирає фронтенд (`build:watch`), чекає першої успішної збірки, потім запускає API. Без HMR.

## Змінні середовища

| Змінна | Типово | Опис |
|--------|--------|------|
| `OPENCHAMBER_HMR_UI_PORT` | `5180` | Порт Vite HMR сервера |
| `OPENCHAMBER_HMR_API_PORT` | `3902` | Порт backend API |
| `OPENCHAMBER_HMR_HOST` | `127.0.0.1` | Host для Vite (`0.0.0.0` для LAN доступу) |
| `OPENCHAMBER_VITE_FORCE` | — | `1` щоб очистити Vite кеш і перезібрати залежності |
| `OPENCHAMBER_DISABLE_PWA_DEV` | — | Вимикає PWA service worker в dev режимі |
| `VITE_ENABLE_REACT_SCAN` | — | Вмикає react-scan для профілювання |

## Журнал

Лог останнього запуску зберігається у `tmp/dev-web-hmr.log`.

## Типові проблеми

### Port already in use
Якщо порт зайнятий, вбийте старий процес:
```bash
kill $(lsof -t -i:5180) $(lsof -t -i:3902) 2>/dev/null
```

### Git merge conflicts у файлах
Якщо в коді залишились конфліктні маркери (`<<<<<<< HEAD`), Vite відмовиться компілювати файл. Знайти:
```bash
grep -rn "<<<<<<< HEAD" --include="*.ts" --include="*.tsx" --include="*.js" --include="*.mjs" packages/ --exclude-dir=node_modules --exclude-dir=dist
```

### API не стартує (ECONNREFUSED)
nodemon може не встигнути перезапустити API коли Vite вже готовий. Зачекайте кілька секунд — nodemon автоматично перезапустить сервер при зміні файлів.

## Приклади

```bash
# LAN доступ (з телефону/іншого пристрою)
OPENCHAMBER_HMR_HOST=0.0.0.0 bun run dev

# Інші порти
OPENCHAMBER_HMR_UI_PORT=3000 OPENCHAMBER_HMR_API_PORT=4000 bun run dev

# З очищенням Vite кешу
OPENCHAMBER_VITE_FORCE=1 bun run dev
```
