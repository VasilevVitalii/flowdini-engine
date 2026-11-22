import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { FdTaskFile, textToStructure } from 'flowdini-spec';
import type { TFdContent } from 'flowdini-spec';
import { buildIndex, extractLinks, levelText, makeResolver, parseAddr, topicAddr } from './addr.js';
import { roleCovers } from './role.js';
import { level1List, sections } from './state.js';

/** Одна ошибка проверки задачи. */
export interface TFdTaskError {
  /** Относительное имя файла (как в `FdTaskFile.list` — с `.md`). */
  relativeFileName: string;
  /** Текст ошибки (на английском). */
  error: string;
}

/**
 * Проверка всех `.md`-файлов каталога: дубли заголовков, заголовки без номера,
 * поля на строке заголовка, сиротские уровни, ожидание от нескольких ролей,
 * битые ссылки (внутри файла и на другие файлы), терминальность `DONE`,
 * матрица `ISSUE`, полнота/согласованность `OBJECT`, ссылки `fd-vault`.
 * Возвращает плоский список — по одной записи на ошибку, с именем файла.
 *
 * `opts.exclude` — имена файлов (с `.md`), которые не являются fd-файлами
 * (например, человеческое сырьё `issue-draft.md`) и не проверяются.
 *
 * `opts.vaultRoot` — корень vault: если задан, файлы из `fd-vault` проверяются
 * на существование; без него такие ссылки пропускаются (проверить нечем).
 */
export interface TFdTaskCheckOptions {
  exclude?: string[];
  vaultRoot?: string;
}

export async function taskCheck(taskDir: string, opts: TFdTaskCheckOptions = {}): Promise<TFdTaskError[]> {
  const files = new FdTaskFile(taskDir);
  const exclude = opts.exclude ?? [];
  const names = (await files.list()).filter((n) => !exclude.includes(n));

  const loaded: { name: string; content: TFdContent }[] = [];
  for (const name of names) {
    const text = await files.read(name);
    loaded.push({ name, content: textToStructure(text, true) });
  }

  const index = buildIndex(loaded.map(({ name, content }) => ({ filePath: stripMd(name), content })));
  const resolveExternal = makeResolver(index);

  const result: TFdTaskError[] = [];
  for (const { name, content } of loaded) {
    for (const error of checkContent(content, resolveExternal)) {
      result.push({ relativeFileName: name, error });
    }
    if (opts.vaultRoot !== undefined) {
      for (const error of await checkVault(content, opts.vaultRoot)) {
        result.push({ relativeFileName: name, error });
      }
    }
  }
  return result;
}

/** Допустимые переходы `ISSUE` (отправитель → адресат), по сегментам. */
const ISSUE_ALLOWED: ReadonlyArray<readonly [string, string]> = [
  ['AI.WRITER', 'AI.ANALYST'],
  ['HUMAN', 'AI.ANALYST'],
  ['AI.ANALYST', 'AI.CODER'],
  ['AI.ANALYST', 'AI.REVIEWER'],
];

/** Проверка одного файла: дубли заголовков, отсутствие номера, битые ссылки, DONE/ISSUE/OBJECT. */
function checkContent(
  content: TFdContent,
  resolveExternal: (filePath: string, addr: string) => boolean,
): string[] {
  const errors: string[] = [];

  // Дубли заголовков, отсутствие номера, сиротские заголовки.
  const seen = new Map<string, number>();
  for (const item of content.itemList) {
    const { level1, level2, level3 } = item.topic;
    const addr = topicAddr(item.topic);
    if (addr !== '') {
      const n = seen.get(addr);
      if (n === undefined) {
        seen.set(addr, 1);
      } else {
        if (n === 1) errors.push(`duplicate heading: "${addr}"`);
        seen.set(addr, n + 1);
      }
    }
    // Отсутствие номера — только у самого глубокого уровня item (иначе дублируется
    // для каждого подтопика).
    const deepest = level3 ?? level2 ?? level1;
    if (deepest !== null) {
      if (/\[[^\]\n]*::[^\]\n]*\]/.test(deepest.title)) {
        errors.push(`field on heading line: "${deepest.title}"`);
      } else if (deepest.idx === 0) {
        errors.push(`heading without number: "${deepest.title}"`);
      }
    }
    // Сирота: уровень без родителя неадресуем.
    if (
      (level2 !== null && level1 === null) ||
      (level3 !== null && (level1 === null || level2 === null))
    ) {
      errors.push(`orphan heading: "${deepest !== null ? levelText(deepest) : ''}"`);
    }
  }

  // Ожидание от нескольких ролей допустимо только если все они HUMAN.*.
  for (const item of content.itemList) {
    const roles = item.topic.inlineList
      .filter((f) => f.param === 'fd-to')
      .flatMap((f) => f.valueList);
    if (roles.length > 1 && roles.some((r) => !r.startsWith('HUMAN.'))) {
      errors.push(`multiple roles awaited: "${roles.join(', ')}"`);
    }
  }

  // Валидные внутрифайловые адреса.
  const validAddrs = new Set<string>();
  for (const item of content.itemList) {
    const addr = topicAddr(item.topic);
    if (addr !== '') validAddrs.add(addr);
  }

  // Битые ссылки: из полей (преамбула + топики) и тел.
  const collect = (text: string): void => {
    for (const raw of extractLinks(text)) {
      const parsed = parseAddr(raw);
      if (parsed === null) continue;
      const addr = parsed.parts.join('#');
      if (parsed.filePath === '') {
        if (!validAddrs.has(addr)) errors.push(`broken link: "[[${raw}]]"`);
      } else if (!resolveExternal(parsed.filePath, addr)) {
        errors.push(`broken link: "[[${raw}]]"`);
      }
    }
  };
  for (const field of content.inlineList) for (const v of field.valueList) collect(v);
  for (const item of content.itemList) {
    for (const field of item.topic.inlineList) for (const v of field.valueList) collect(v);
    if (item.text !== null) collect(stripFences(item.text));
  }

  // Терминальность DONE: `# DONE n` — последний L1-раздел; за ним допустимо
  // только переоткрытие `# ISSUE n`. DONE создаёт человек (fd-from = HUMAN.*),
  // fd-to у него отсутствует.
  const l1s = level1List(content);
  for (let i = 0; i < l1s.length; i++) {
    if (l1s[i].title !== 'DONE') continue;
    for (let j = i + 1; j < l1s.length; j++) {
      if (l1s[j].title !== 'ISSUE') {
        errors.push(`section after DONE: "${levelText(l1s[j])}"`);
      }
    }
  }
  for (const item of content.itemList) {
    const l1 = item.topic.level1;
    if (l1 === null || l1.title !== 'DONE' || item.topic.level2 !== null) continue;
    const fromVals = item.topic.inlineList.filter((f) => f.param === 'fd-from').flatMap((f) => f.valueList);
    const toVals = item.topic.inlineList.filter((f) => f.param === 'fd-to').flatMap((f) => f.valueList);
    for (const v of fromVals) {
      if (!roleCovers('HUMAN', v)) errors.push(`DONE fd-from must be HUMAN.*: "${v}"`);
    }
    if (toVals.length > 0) errors.push('DONE must not have fd-to');
  }

  // Матрица ISSUE: акт передачи, адресат определяется отправителем.
  for (const item of content.itemList) {
    const l1 = item.topic.level1;
    if (l1 === null || l1.title !== 'ISSUE' || item.topic.level2 !== null) continue;
    const fromVals = item.topic.inlineList.filter((f) => f.param === 'fd-from').flatMap((f) => f.valueList);
    const toVals = item.topic.inlineList.filter((f) => f.param === 'fd-to').flatMap((f) => f.valueList);
    if (fromVals.length === 0 || toVals.length === 0) continue;
    const from = fromVals[0];
    const to = toVals[0];
    const ok = ISSUE_ALLOWED.some(([pf, pt]) => roleCovers(pf, from) && roleCovers(pt, to));
    if (!ok) errors.push(`invalid ISSUE transfer: "${from}" → "${to}"`);
  }

  // OBJECT: полнота obj-kind/obj-action/obj-path, валидный obj-action,
  // уникальность obj-path в файле. (Соответствие типа объекта БД и
  // согласованность obj-action с существованием — вне движка, нужен MCP.)
  const objPaths = new Set<string>();
  for (const item of content.itemList) {
    const l2 = item.topic.level2;
    if (l2 === null || l2.title !== 'OBJECT' || item.topic.level3 !== null) continue;
    const fields = item.topic.inlineList;
    const has = (p: string): boolean => fields.some((f) => f.param === p);
    const missing = ['obj-kind', 'obj-action', 'obj-path'].filter((p) => !has(p));
    if (missing.length > 0) {
      errors.push(`OBJECT incomplete: missing ${missing.join('/')} ("${levelText(l2)}")`);
    }
    for (const f of fields) {
      if (f.param === 'obj-action') {
        for (const v of f.valueList) {
          if (v !== 'create' && v !== 'edit') errors.push(`invalid obj-action: "${v}"`);
        }
      }
      if (f.param === 'obj-path') {
        for (const v of f.valueList) {
          if (objPaths.has(v)) errors.push(`duplicate obj-path: "${v}"`);
          else objPaths.add(v);
        }
      }
    }
  }

  // Гибридный гейт: `## Q` в REVIEW — первым среди замечаний, адресован HUMAN.CODER.
  for (const sec of sections(content)) {
    if (sec.l1.title !== 'REVIEW') continue;
    const qIdx = sec.l2s.findIndex((l) => l.title === 'Q');
    if (qIdx !== -1 && qIdx !== 0) {
      errors.push(`gate Q must be first in REVIEW: "${levelText(sec.l2s[qIdx])}"`);
    }
  }
  for (const item of content.itemList) {
    const { level1, level2, level3 } = item.topic;
    if (level1?.title === 'REVIEW' && level2?.title === 'Q' && level3 === null) {
      const toVals = item.topic.inlineList.filter((f) => f.param === 'fd-to').flatMap((f) => f.valueList);
      for (const v of toVals) {
        if (!roleCovers('HUMAN.CODER', v)) errors.push(`gate Q must be to HUMAN.CODER: "${v}"`);
      }
    }
  }

  return errors;
}

/** Проверка `fd-vault`: файлы из списка обязаны существовать в корне vault. */
async function checkVault(content: TFdContent, vaultRoot: string): Promise<string[]> {
  const errors: string[] = [];
  const vals: string[] = [];
  for (const f of content.inlineList) if (f.param === 'fd-vault') vals.push(...f.valueList);
  for (const item of content.itemList) {
    for (const f of item.topic.inlineList) if (f.param === 'fd-vault') vals.push(...f.valueList);
  }
  for (const v of vals) {
    try {
      await access(join(vaultRoot, v));
    } catch {
      errors.push(`vault file not found: "${v}"`);
    }
  }
  return errors;
}

/** Убрать суффикс `.md` (путь в ссылках и ключ индекса — без `.md`). */
function stripMd(name: string): string {
  return name.endsWith('.md') ? name.slice(0, -3) : name;
}

/** Вырезать fenced-блоки (```...```), чтобы ссылки в примерах кода не проверялись. */
function stripFences(text: string): string {
  const lines = text.split('\n');
  const out: string[] = [];
  let fence: { char: string; len: number } | null = null;
  for (const line of lines) {
    if (fence) {
      if (new RegExp(`^ {0,3}${fence.char}{${fence.len},}\\s*$`).test(line)) fence = null;
      continue;
    }
    const m = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (m) {
      fence = { char: m[1][0], len: m[1].length };
      continue;
    }
    out.push(line);
  }
  return out.join('\n');
}
