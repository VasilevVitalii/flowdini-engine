import type { TFdContent, TFdLevel, TFdTopic } from 'flowdini-spec';

/** Текст заголовка без ведущих `#` (`title` + номер; номер опускается при `idx === 0`). */
export function levelText(level: TFdLevel): string {
  return level.idx === 0 ? level.title : `${level.title} ${level.idx}`;
}

/** Полный адрес топика: `L1#L2#L3` (младшие `null`-уровни отброшены). */
export function topicAddr(topic: TFdTopic): string {
  const parts: string[] = [];
  for (const level of [topic.level1, topic.level2, topic.level3]) {
    if (level === null) break;
    parts.push(levelText(level));
  }
  return parts.join('#');
}

/** Распарсенный адрес ссылки `[[file#L1#L2#L3]]`. */
export interface TFdAddr {
  /** Путь файла без `.md` (`''` — текущий файл). */
  filePath: string;
  /** Компоненты заголовков от уровня 1 вниз (`L1`, `L2`, `L3`). */
  parts: string[];
}

/** Все `[[...]]`-ссылки в строке (без вложенных скобок и переносов). */
export function extractLinks(text: string): string[] {
  const links: string[] = [];
  const re = /\[\[([^[\]\n]+)\]\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    links.push(m[1]);
  }
  return links;
}

/**
 * Распарсить содержимое `[[...]]` (без скобок): `#L1#L2` → `{ filePath: '', parts: ['L1','L2'] }`,
 * `file#L1#L2` → `{ filePath: 'file', parts: ['L1','L2'] }`. Ссылку без `#` (на файл целиком)
 * возвращает `null` — она не адрес заголовка.
 */
export function parseAddr(raw: string): TFdAddr | null {
  const hash = raw.indexOf('#');
  if (hash === -1) return null;
  return {
    filePath: raw.slice(0, hash),
    parts: raw.slice(hash + 1).split('#'),
  };
}

/** Индекс адресов проекта: путь файла (без `.md`) → множество адресов `L1#L2#L3`. */
export type TFdIndex = Map<string, Set<string>>;

/** Построить индекс по списку (путь файла без `.md` → распарсенный контент). */
export function buildIndex(files: { filePath: string; content: TFdContent }[]): TFdIndex {
  const index: TFdIndex = new Map();
  for (const { filePath, content } of files) {
    const addrs = new Set<string>();
    for (const item of content.itemList) {
      const addr = topicAddr(item.topic);
      if (addr !== '') addrs.add(addr);
    }
    index.set(filePath, addrs);
  }
  return index;
}

/** Фабрика `resolveExternal(filePath, addr)` для `contentCheck` по индексу. */
export function makeResolver(index: TFdIndex): (filePath: string, addr: string) => boolean {
  return (filePath, addr) => {
    const addrs = index.get(filePath);
    return addrs !== undefined && addrs.has(addr);
  };
}
