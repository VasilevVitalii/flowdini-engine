import { FdTaskFile, textToStructure } from 'flowdini-spec';
import type { TFdContent } from 'flowdini-spec';
import { buildIndex, extractLinks, levelText, makeResolver, parseAddr, topicAddr } from './addr.js';

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
 * битые ссылки (внутри файла и на другие файлы). Возвращает плоский список —
 * по одной записи на ошибку, с именем файла.
 *
 * `opts.exclude` — имена файлов (с `.md`), которые не являются fd-файлами
 * (например, человеческое сырьё `issue-draft.md`) и не проверяются.
 */
export interface TFdTaskCheckOptions {
  exclude?: string[];
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
  }
  return result;
}

/** Проверка одного файла: дубли заголовков, отсутствие номера, битые ссылки. */
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
