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
- `broken link: "[[...]]"` — ссылка на несуществующий заголовок или файл; `[[file]]` без `#` — ссылка на файл целиком (проверяется существование файла). Проверяются преамбула (текст до первого заголовка), поля и тела; дубли ссылок схлопываются. Ссылки внутри fenced-блоков (примеры кода) не проверяются;
- `multiple roles awaited: "<roles>"` — `fd-to` указывает несколько ролей, среди которых есть не-`HUMAN.*` (несколько `HUMAN.*` допустимо); проверяется только в свойствах (поля в заголовке запрещены);
- `section after DONE: "<level>"` — за `# DONE n` идёт раздел, отличный от `# ISSUE n` (переоткрытие); `DONE` — терминальный;
- `non-HUMAN reopen after DONE: "<level>"` — переоткрытие после `DONE` не от человека (допустим только `# ISSUE n` с `fd-from`, покрываемым `HUMAN.*`);
- `DONE fd-from must be HUMAN.*: "<role>"` — `DONE` создаёт человек;
- `DONE must have fd-from` — у `DONE` нет `fd-from`;
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

`fd-createdAt` создаётся только у топиков-сообщений (есть `fd-from`) с телом и только если его нет ни в одном поле топика (проверка по всем индексированным полям, включая тело, — иначе продублируется); объектные описания (`obj-*`) без `fd-from` метку времени не получают. Формат — UTC ISO (`YYYY-MM-DDTHH:MM:SSZ`). Необязательный `now: () => Date` задаёт источник времени для детерминированного вывода (тесты, кеш); по умолчанию — текущее время.

### Адресация

Низкоуровневые утилиты (для собственных проверок/резолвера):

- `parseAddr(raw)` — распарсить содержимое `[[...]]` в `{ filePath, parts }`;
- `extractLinks(text)` — все `[[...]]`-ссылки в строке;
- `topicAddr(topic)` / `levelText(level)` — текст адреса топика/заголовка;
- `buildIndex(files)` — индекс адресов проекта; `makeResolver(index)` — `resolveExternal` для проверки ссылок.

### Роли

Идентификатор роли — `PART1.PART2[.PART3]` (2–3 сегмента):

- `PART1` строго фиксирован: `AI` (модель), `HUMAN` (человек), `PROC` (внешний процесс);
- `PART2` — уточнение роли, определяется в рамках конкретного SPEC;
- `PART3` (опционален) — INSTANCE, перекрывающий FUNC наследованием по полям (см. `resolveRole`).

Примеры: `AI.ARCHITECT`, `AI.CODER`, `AI.CODER.SENIOR`, `HUMAN.CODER`, `HUMAN.ANALYST`, `PROC.TESTS`.

Роли задаются только через `fd-from`/`fd-to` (отдельного раздела объявления ролей нет). `fd-to` перечисляет роли, от которых ждём ответ: несколько `HUMAN.*` одновременно допустимо, любое другое сочетание нескольких ролей — ошибка `multiple roles awaited`.

### Покрытие ролей

`roleCovers(pattern, role)` — `pattern` покрывает `role` тогда и только тогда, когда `pattern` — префикс `role` по сегментам (граница — точка): `AI.CODER` покрывает `AI.CODER.JUNIOR`, а `AI.CODERX` не покрывает `AI.CODER`. Используется матрицей `ISSUE` и гибридным гейтом.

### Производное состояние (`state.ts`)

Детерминированные вычисления над журналом (в md не хранятся, выводятся из последовательности разделов):

- `level1List(content)` — заголовки уровня 1 в порядке появления;
- `sections(content)` — секции уровня 1 с их подзаголовками уровня 2;
- `reviewFixIterations(content)` — число завершённых итераций REVIEW→FIX с последнего прерывания (`ISSUE`/`QUESTIONS`/`DONE` сбрасывают). Итерация = REVIEW, на который кодер ответил FIX, стоящим ПОСЛЕ него и ссылающимся на его подзаголовок (`REVIEW N#BUG k`, не на контейнер); автора не проверяем (его ставит хост). `## A` — ответ человека на `Q`, не итерация. Порог итераций — настройка SPEC; движок лишь считает счётчик;
- `isDone(content)` — таск завершён: последний раздел — `# DONE n`.
- `isCrashed(content)` — в журнале есть `# CRASH n` (терминальный маркер аварии, процесс стоит);
- `isAccept(text)` — тело ровно `+` после trim (детерминированный accept человека);
- `acceptOf(content, arcAddr)` — accept дуги-ответа человека (`ANSWERS n#A m`, `fd-from` HUMAN.*): `true` (тело `+`) / `false` (иной ответ) / `null` (дуга не ответ человека);
- `fixReference(content, arcAddr, now?)` — справка кодеру для `fixMode: item`: предыдущие пункты этого `REVIEW` + ответы кодера на них (в порядке документа); `now` — источник времени для детерминированного вывода.

### Снапшот определений (`snapshot.ts`)

`captureSnapshot(taskDir, iteration, objects, now?)` пишет `<taskDir>/snapshots/<iteration>/<objPath>.sql` и `manifest.json` (sha256 каждого файла + таймстамп). `iteration` — положительное целое или `'baseline'` (иначе отклоняется); имя файла — `safeName(objPath)` (инъективное, без коллизий `dbo.sp x` vs `dbo.sp_x`); `now` — ISO-таймстамп снимка (по умолчанию — текущее время). Движок сам в БД не ходит: определения получает MCP-агент (`get_definition`), движок фиксирует готовый текст. Снапшот read-only; дифф между итерациями и сверка с живой БД — по манифесту.

```ts
import { captureSnapshot } from 'flowdini-engine';

const { manifestPath, files } = await captureSnapshot('/path/to/task', 2, [
  { objPath: 'dbo.sp_x', definition: 'CREATE PROCEDURE dbo.sp_x AS ...' },
]);
```

### SPEC-конфиг (`spec.ts`)

Декларативный контракт исполнения проекта — YAML-файл `fd.spec.yaml` (один на проект, в корне). Движок читает его и раздаёт ролям оси исполнения; сам инструменты не держит (матрица MCP — данные SPEC, не ядро).

```yaml
reviewLimit: 2          # порог итераций REVIEW→FIX; после него в REVIEW идёт ## Q к HUMAN.CODER (0 — гейт с первого REVIEW)
fixMode: item           # item (дефолт): отдельный FIX на замечание; bulk: один FIX на все
fixReference: false     # при fixMode: item — подавать кодеру справку (предыдущие пункты + ответы)

roles:
  AI.ANALYST:
    model: deepseek-v4-pro
    tools: [get_definition, describe_table]
    rights: { db: read, vault: full }
    budget: { tokens: 60000 }
    context: [vault/gi/schema.md]   # SPEC-биндинги — обязательный минимум контекста
  AI.CODER:
    model: deepseek-v4-pro
    tools: [execute_sql, get_definition]
    rights: { db: [procedure, function, view] }
  AI.CODER.SENIOR:      # INSTANCE перекрывает FUNC (наследование по полям)
    model: claude-sonnet-4
  AI.REVIEWER:
    model: deepseek-v4-pro
    tools: [get_definition, describe_table, list_views]
    rights: { db: read }
  HUMAN.ANALYST: {}
  HUMAN.CODER: {}
```

API:

- `parseSpec(text)` — YAML → `TFdSpecConfig`; неизвестный ключ верхнего уровня, неверный тип скалярных полей (`reviewLimit`/`fixMode`/`fixReference`) и структурно невалидные role-спеки (значение — объект; `model` — строка; `tools`/`context`/`vault` — массив строк) бросают до каста — диапазоны и семантику role-спеков проверяет `validateSpec`;
- `readSpec(path)` — прочитать `fd.spec.yaml`;
- `validateSpec(config)` — `TFdSpecError[]`: нотация роли (`KIND.FUNC[.INSTANCE]`, 2–3 сегмента), типы полей, `reviewLimit` (целое ≥ 0), `fixMode` (`bulk`|`item`), `budget.maxTurns` (целое ≥ 1);
- `resolveRole(config, role)` — резолв оси с наследованием: `AI.CODER.SENIOR` наследует `tools`/`rights`/`budget`/`context` от `AI.CODER` и перекрывает `model`; массивы заменяются целиком, не конкатенируются.

Поля роли: `model` (модель), `tools` (матрица MCP «роль → инструменты»), `rights` (что можно: read-only, DDL-виды, vault), `budget` (лимиты, в т.ч. `maxTurns` — лимит tool-calling ходов), `context` (SPEC-биндинги). Все опциональны; `reviewLimit` не задан → гейт `## Q` выключен; `reviewLimit: 0` → гейт с первого REVIEW; `fixMode` не задан → `item` (дефолт в драйвере, парсер копирует поле только если задано).

### Оркестратор (`orchestrator.ts`)

Детерминированное ядро runtime-планирования: читает журнал как состояние (открытые дуги) и говорит, кто ходит следующим и с какими осями. LLM/MCP-исполнение ролей — снаружи, здесь только планирование.

- `openArcs(content)` — состояние: топики с `fd-to`, не закрытые ни одним `fd-reply` (внутри файла), в причинном порядке (дуга закрывается ответом с `fd-reply` на адрес `L1#L2[#L3]`, стоящим позже в документе), НЕ считая всё до последнего рулевого `ISSUE` от `HUMAN.*` (`steeringCutoff`) и всё после `# DONE n` (задача закрыта — открытых дуг нет). Автор дуги — `fd-from` топика.
- `nextStep(content)` — следующий ход: HUMAN-дуги приоритетнее (гибридный гейт — пока человек не ответил, AI не приступает), иначе первая AI-дуга. Рекомендуемый раздел: `ISSUE→CODE/REVIEW`, `CODE/FIX→REVIEW`, `REVIEW→FIX`, `QUESTIONS→ANSWERS`; `ISSUE→AI.ANALYST` — `null` (аналитик решает сам).
- `gateDue(content, spec)` — нужен ли `## Q` в следующем `REVIEW`: число REVIEW-итераций достигло `spec.reviewLimit` (без порога — выключен).
- `roleBrief(spec, role, content)` — поручение роли: оси (резолв с наследованием), SPEC-биндинги `context`, `fd-vault` из адресованных `ISSUE`, открытые дуги этой роли.

Цикл исполнения (вне ядра): `nextStep` → `roleBrief` → агент-роль пишет раздел → `taskCheck` → снапшот после `CODE`/`FIX` → снова `nextStep`, пока не `DONE`.

### Рантайм БД (`db.ts`)

Детерминированная сверка `OBJECT` с живой БД. Ядро в БД не ходит: факты существования/типа и текст определения передаёт MCP-агент (`vv-db-mcp`) через колбэки — так ядро остаётся тестируемым без сети.

- `extractDbObjects(content)` — объекты из `## OBJECT`-топиков (`obj-path`/`obj-kind`/`obj-action`); неполные пропускаются (их ловит `taskCheck`).
- `validateDbObject(objects, lookup)` — сверка против фактов БД: `obj-kind` ∈ {`procedure`,`function`,`view`}, `obj-action` ∈ {`create`,`edit`}; `create` ⇒ объекта нет; `edit` ⇒ объект есть; тип в БД совпадает с `obj-kind`. Факт `exists: true` с `kind: null` (тип не определили) и `exists: null` с `reason` — ошибки, не исключения; исключение из `lookup` тоже превращается в `TFdDbError`. Возвращает `TFdDbError[]` (`objPath` + `error`).
- `collectSnapshot(objects, getDefinition, { onError? })` — определения (`get_definition` MCP) → `TFdSnapshotObject[]` для `captureSnapshot`; `onError` ловит сбой (объект пропускается) вместо throw.
- `mcpMatrix(spec)` (в `spec.ts`) — матрица «роль → инструменты» из `roles[*].tools` с наследованием `INSTANCE`→`FUNC`; роли без `tools` опускаются.

Колбэки: `TFdDbLookup = (objPath) => Promise<TFdDbFact>`, `TFdGetDefinition = (objPath) => Promise<string>`. `TFdDbFact` — `{ exists: true, kind }` (kind может быть `null`: тип не определили) | `{ exists: false, kind: null }` | `{ exists: null, kind: null, reason? }` (не удалось проверить, с причиной). Адаптер нетипизирован: его исключения `validateDbObject` ловит и превращает в ошибки.

## Разработка

```sh
npm install        # ставит flowdini-spec из npm (^0.5.0)
npm test
npm run build
npm run test:smoke
```
