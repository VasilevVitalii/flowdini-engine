import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TFdContent, TFdInlineField, TFdItem, TFdTopic } from 'flowdini-spec';
import { contentPretty } from '../src/pretty.js';

function field(
  param: string,
  valueList: string[],
  source?: 'topic' | 'body',
): TFdInlineField {
  return source === undefined ? { param, valueList } : { param, valueList, source };
}

function topic(
  fields: TFdInlineField[] = [],
  l1?: [string, number],
  l2?: [string, number],
  l3?: [string, number],
): TFdTopic {
  return {
    level1: l1 ? { title: l1[0], idx: l1[1] } : null,
    level2: l2 ? { title: l2[0], idx: l2[1] } : null,
    level3: l3 ? { title: l3[0], idx: l3[1] } : null,
    inlineList: fields,
  };
}

function item(t: TFdTopic, text: string | null = null): TFdItem {
  return { topic: t, text };
}

function content(items: TFdItem[], inlineList: TFdInlineField[] = [], text: string | null = null): TFdContent {
  return { inlineList, itemList: items, text };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-14T10:30:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('contentPretty', () => {
  it('создаёт fd-createdAt и упорядочивает свойства', () => {
    const c = content([
      item(
        topic(
          [
            field('fd-to', ['AI.REVIEWER'], 'topic'),
            field('fd-from', ['AI.CODER'], 'topic'),
          ],
          ['CODE', 1],
          ['C', 1],
        ),
        'body',
      ),
    ]);
    expect(contentPretty(c)).toBe(
      '## C 1\n' +
        '[fd-from:: AI.CODER] [fd-createdAt:: 2026-11-14T10:30:00Z] [fd-to:: AI.REVIEWER]\n' +
        '\n' +
        'body',
    );
  });

  it('fd-createdAt сохраняется, если уже есть', () => {
    const c = content([
      item(
        topic(
          [
            field('fd-createdAt', ['2026-11-14T12:00:00Z'], 'topic'),
            field('fd-from', ['AI.CODER'], 'topic'),
          ],
          ['CODE', 1],
        ),
        'body',
      ),
    ]);
    expect(contentPretty(c)).toBe(
      '# CODE 1\n' +
        '[fd-from:: AI.CODER] [fd-createdAt:: 2026-11-14T12:00:00Z]\n' +
        '\n' +
        'body',
    );
  });

  it('канонические поля в порядке, остальные — после', () => {
    const c = content([
      item(
        topic(
          [
            field('fd-note', ['x'], 'topic'),
            field('fd-reply', ['[[#X 1]]'], 'topic'),
            field('fd-from', ['AI.CODER'], 'topic'),
          ],
          ['CODE', 1],
        ),
        'body',
      ),
    ]);
    expect(contentPretty(c)).toBe(
      '# CODE 1\n' +
        '[fd-from:: AI.CODER] [fd-createdAt:: 2026-11-14T10:30:00Z] [fd-reply:: [[#X 1]]] [fd-note:: x]\n' +
        '\n' +
        'body',
    );
  });

  it('контейнер (без тела и свойств) — только заголовок', () => {
    const c = content([item(topic([], ['CODE', 1]))]);
    expect(contentPretty(c)).toBe('# CODE 1');
  });

  it('свойства без тела — не теряются', () => {
    const c = content([item(topic([field('fd-reply', ['[[#X 1]]'], 'topic')], ['Q', 1]), null)]);
    expect(contentPretty(c)).toBe('# Q 1\n[fd-reply:: [[#X 1]]]');
  });

  it('пустая строка между соседними топиками', () => {
    const c = content([
      item(topic([], ['A', 1]), 'a-body'),
      item(topic([], ['B', 1]), 'b-body'),
    ]);
    expect(contentPretty(c)).toBe('# A 1\n\na-body\n\n# B 1\n\nb-body');
  });

  it('объектное описание (без fd-from) не получает fd-createdAt', () => {
    const c = content([
      item(
        topic(
          [
            field('obj-kind', ['function'], 'topic'),
            field('obj-path', ['db.sch.obj'], 'topic'),
          ],
          ['ISSUE', 1],
          ['OBJECT', 1],
        ),
        'описание объекта',
      ),
    ]);
    expect(contentPretty(c)).toBe(
      '## OBJECT 1\n[obj-kind:: function] [obj-path:: db.sch.obj]\n\nописание объекта',
    );
  });

  it('преамбула — пустая строка перед первым заголовком', () => {
    const c = content([item(topic([], ['CODE', 1]), 'body')], [field('project', ['returns'])]);
    expect(contentPretty(c)).toBe('[project:: returns]\n\n# CODE 1\n\nbody');
  });

  it('преамбула-текст выводится перед полями', () => {
    const c = content(
      [item(topic([], ['CODE', 1]), 'body')],
      [field('project', ['returns'])],
      'Вводный текст.',
    );
    expect(contentPretty(c)).toBe('Вводный текст.\n[project:: returns]\n\n# CODE 1\n\nbody');
  });

  it('now-параметр: детерминированный вывод', () => {
    const c = content([
      item(topic([field('fd-from', ['AI.CODER'], 'topic')], ['CODE', 1]), 'body'),
    ]);
    const now = (): Date => new Date('2026-11-14T08:00:00Z');
    expect(contentPretty(c, now)).toBe(
      '# CODE 1\n[fd-from:: AI.CODER] [fd-createdAt:: 2026-11-14T08:00:00Z]\n\nbody',
    );
  });
});
