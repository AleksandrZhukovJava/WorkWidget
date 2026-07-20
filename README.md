# Jira Widget

![CI](https://github.com/AleksandrZhukovJava/WorkWidget/actions/workflows/ci.yml/badge.svg)

Десктоп-виджет для Windows: задачи Jira прямо на рабочем столе — анимированный орб поверх
окон, панель «мои задачи», смена статуса, комментарии, остаток **SLA** из Jira Service
Management, плюс интеграция с **GitLab** (merge request'ы, ревью) и кодер-агент.

## Возможности

- 🟢 Always-on-top виджет: число активных задач + индикатор худшего SLA (пульсирует красным
  при просрочке). Перетаскивается, позиция запоминается. Набор скинов.
- 📋 Панель задач: приоритеты, блоки-группы, «текущая задача», блокировки, локальный архив.
- 🗂 Детальный вид задачи: описание из Jira (рендер wiki-разметки), действия, и локальный
  **чеклист** пунктов выполнения (перетаскивание, сохранение между сессиями).
- 🔄 Смена статуса (в т.ч. мультишаг по воркфлоу), 💬 комментарии, ➕ создание задач.
- 🦊 **GitLab**: создание MR (ветка→ветка), назначение ревьюверов, «где я ревьювер»,
  связь задача↔MR по ключу. Без merge/force-push — по дизайну.
- 🤖 Кодер-агент: ветка → патч → коммит → push.
- 🔐 Токены — в **Windows Credential Manager** (`@napi-rs/keyring`), не в открытом виде.
- 🔔 Уведомления, 🖥 трей, автозапуск, ⬆️ **автообновление** из GitHub Releases.

## Технологии

Electron + electron-vite, TypeScript, React, electron-builder (NSIS), electron-updater.

## Разработка

```bash
npm install
npm run dev        # запуск Electron-приложения
npm run dev:web    # предпросмотр UI в браузере (http://localhost:5174) с мок-данными
npm run typecheck  # проверка типов (node + web)
```

## Сборка установщика (локально)

```bash
# Windows PowerShell:
$env:CSC_IDENTITY_AUTO_DISCOVERY='false'; npm run build
# → dist/Jira Widget-<version>-setup.exe (без публикации)
```

Релизы обычно собираются **не локально**, а в GitHub Actions по git-тегу — см.
[docs/RELEASING.md](docs/RELEASING.md).

## Релизы и версии

- Каждая версия = тег `vX.Y.Z` + GitHub Release с установщиком и фидом автообновления.
- Выпуск: `npm run release:patch|minor|major` → `git push --follow-tags` → Actions соберёт
  и опубликует Release. Полный процесс и **как откатиться к версии** — в
  [docs/RELEASING.md](docs/RELEASING.md).

## Подключение к Jira

Два режима (в окне настроек): **Jira Server/DC** — Personal Access Token; **Jira Cloud** —
вход через браузер (OAuth 3LO) или API token. Для self-hosted инстанса используется PAT:
в Jira → профиль → *Personal Access Tokens* → создать → вставить в настройки виджета,
указать base URL, «Проверить» → «Сохранить».

Для Jira Cloud (OAuth): создать OAuth 2.0 (3LO) приложение на
https://developer.atlassian.com/console/myapps/, scopes `read:jira-work`, `write:jira-work`,
`read:jira-user` (+ `read:servicedesk-request` для SLA), callback
`http://localhost:53682/callback`, затем Client ID/Secret в настройки.

## Заметки

- **SLA** доступен только для задач Jira Service Management.
- **Архив** — локальный (скрытие из виджета).
- JQL «мои задачи» и «моё поле» (Assignee / Исполнитель) настраиваются в окне настроек.
- Данные пинятся в `~/.jira-widget` (устойчиво к MSIX-виртуализации %APPDATA%).
