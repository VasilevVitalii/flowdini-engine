# flowdini-engine

Мотор исполнения для flowdini. Зависит от [`flowdini-spec`](https://github.com/VasilevVitalii/flowdini-spec) (карта: типы, парсер/сериализатор, файловый доступ).

## API

### `taskCheck(taskDir, opts?)`

Проверка всех `.md`-файлов каталога: дубли заголовков, заголовки без номера, сиротские заголовки, битые ссылки (внутри файла и на другие файлы), ожидание от нескольких ролей, терминальность `DONE`, матрица `ISSUE` (отправитель → адресат), полнота/согласованность `OBJECT` (`obj-kind`/`obj-action`/`obj-path`), гибридный гейт (`## Q` в `REVIEW`), ссылки `fd-vault`. Возвращает `Promise<{ relativeFileName, error }[]>` — плоский список, одна запись на ошибку; `relativeFileName` — относительное имя файла (с `.md`). Несуществующий `taskDir` отклоняется (`rejects`), а не даёт пустой список.

`opts.exclude` — имена файлов (с `.md`), которые не являются fd-файлами и не проверяются. Нужен для сырья, которое не обязано быть структурным: человеческого (`issue-draft.md`, пишется как есть) и бизнес-ТЗ (`issue-dom.md`, формируется кодом, но не строго структурно).

`opts.vaultRoot` — корень vault: если задан, файлы из `fd-vault` (`[fd-vault:: file1.md,file2.md]`) проверяются на существование; без него такие ссылки пропускаются (проверить нечем — vault вне каталога задачи).

Категории ошибок (текст на английском):

- `duplicate heading: "<addr>"` — два заголовка с одинаковым текстом и номером в одном scope;
- `heading without number: "<title>"` — заголовок без числового суффикса (`idx === 0`); сообщается один раз на заголовок, а не на каждый подтопик;
- `field on heading line: "<title>"` — inline-поле на строке заголовка (запрещено: свойства только отдельной строкой, иначе Obsidian не может сослаться на заголовок);
- `orphan heading: "<level>"` — заголовок уровня 2/3 без родителя (неадресуем);
- `broken link: "[[...]]"` — ссылка на несуществующий заголовок или файл; ссылки внутри fenced-блоков (примеры кода) не проверяются;
- `multiple roles awaited: "<roles>"` — `fd-to` указывает несколько ролей, среди которых есть не-`HUMAN.*` (несколько `HUMAN.*` допустимо); проверяется только в свойствах (поля в заголовке запрещены);
- `section after DONE: "<level>"` — за `# DONE n` идёт раздел, отличный от `# ISSUE n` (переоткрытие); `DONE` — терминальный;
- `DONE fd-from must be HUMAN.*: "<role>"` — `DONE` создаёт человек;
- `DONE must not have fd-to` — у `DONE` нет адресата;
- `invalid ISSUE transfer: "<from>" → "<to>"` — пара отправитель→адресат не из матрицы `ISSUE` (`AI.WRITER→AI.ANALYST`, `HUMAN.*→AI.ANALYST`, `AI.ANALYST→AI.CODER|AI.REVIEWER`);
- `OBJECT incomplete: missing ... ("<level>")` — у `## OBJECT n` нет одного из `obj-kind`/`obj-action`/`obj-path`;
- `invalid obj-action: "<v>"` — `obj-action` не `create` и не `edit`;
- `duplicate obj-path: "<v>"` — `obj-path` встречается в файле повторно;
- `gate Q must be first in REVIEW: "<level>"` — `## Q` в `REVIEW` (гибридный гейт) идёт не первым;
- `gate Q must be to HUMAN.CODER: "<role>"` — `## Q` в `REVIEW` адресован не человеку-кодеру;
- `vault file not found: "<v>"` — файл из `fd-vault` не существует (только при заданном `opts.vaultRoot`).

```ts
import { taskCheck } from 'flowdini-engine';

const errors = await taskCheck('/path/to/task', { exclude: ['issue-draft.md', 'issue-dom.md'] });
```

### `contentPretty(content, now?)`

Каноническая сериализация для записи в файл. Правила:

1. перед каждым заголовком — одна пустая строка, если выше есть контент;
2. после заголовка — свойства одной строкой (если есть), затем пустая строка и тело (если есть);
3. порядок свойств: `fd-from`, `fd-createdAt` (создаётся в UTC, если его нет и есть `fd-from`), `fd-to`, `fd-reply`, затем остальные в исходном порядке.

Текст преамбулы (`content.text`) выводится перед полями преамбулы (`inlineList`); перед первым заголовком — одна пустая строка.

`fd-createdAt` создаётся только у топиков-сообщений (есть `fd-from`) с телом и только если его нет в свойствах; объектные описания (`obj-*`) без `fd-from` метку времени не получают. Формат — UTC ISO (`YYYY-MM-DDTHH:MM:SSZ`). Необязательный `now: () => Date` задаёт источник времени для детерминированного вывода (тесты, кеш); по умолчанию — текущее время.

### Адресация

Низкоуровневые утилиты (для собственных проверок/резолвера):

- `parseAddr(raw)` — распарсить содержимое `[[...]]` в `{ filePath, parts }`;
- `extractLinks(text)` — все `[[...]]`-ссылки в строке;
- `topicAddr(topic)` / `levelText(level)` — текст адреса топика/заголовка;
- `buildIndex(files)` — индекс адресов проекта; `makeResolver(index)` — `resolveExternal` для проверки ссылок.

### Роли

Идентификатор роли — `PART1.PART2`:

- `PART1` строго фиксирован: `AI` (модель), `HUMAN` (человек), `PROC` (внешний процесс);
- `PART2` — уточнение роли, определяется в рамках конкретного SPEC.

Примеры: `AI.ARCHITECT`, `AI.CODER`, `HUMAN.CODER`, `HUMAN.ANALYST`, `PROC.TESTS`.

Роли задаются только через `fd-from`/`fd-to` (отдельного раздела объявления ролей нет). `fd-to` перечисляет роли, от которых ждём ответ: несколько `HUMAN.*` одновременно допустимо, любое другое сочетание нескольких ролей — ошибка `multiple roles awaited`.

### Покрытие ролей

`roleCovers(pattern, role)` — `pattern` покрывает `role` тогда и только тогда, когда `pattern` — префикс `role` по сегментам (граница — точка): `AI.CODER` покрывает `AI.CODER.JUNIOR`, а `AI.CODERX` не покрывает `AI.CODER`. Используется матрицей `ISSUE` и гибридным гейтом.

### Производное состояние (`state.ts`)

Детерминированные вычисления над журналом (в md не хранятся, выводятся из последовательности разделов):

- `level1List(content)` — заголовки уровня 1 в порядке появления;
- `sections(content)` — секции уровня 1 с их подзаголовками уровня 2;
- `reviewFixIterations(content)` — число непрерывных `REVIEW` с последнего прерывания (`ISSUE`/`QUESTIONS`/`DONE` сбрасывают). Порог итераций — настройка SPEC; движок лишь считает счётчик;
- `isDone(content)` — таск завершён: последний раздел — `# DONE n`.

### Снапшот определений (`snapshot.ts`)

`captureSnapshot(taskDir, iteration, objects)` пишет `<taskDir>/snapshots/<iteration>/<objPath>.sql` и `manifest.json` (sha256 каждого файла + таймстамп). Движок сам в БД не ходит: определения получает MCP-агент (`get_definition`), движок фиксирует готовый текст. Снапшот read-only; дифф между итерациями и сверка с живой БД — по манифесту.

```ts
import { captureSnapshot } from 'flowdini-engine';

const { manifestPath, files } = await captureSnapshot('/path/to/task', 2, [
  { objPath: 'dbo.sp_x', definition: 'CREATE PROCEDURE dbo.sp_x AS ...' },
]);
```

## Разработка

```sh
npm install        # ставит flowdini-spec из npm (^0.4.1)
npm test
npm run build
npm run test:smoke
```
