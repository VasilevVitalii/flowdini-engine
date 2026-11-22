import { describe, expect, it } from 'vitest';
import { buildIndex, makeResolver, parseAddr } from '../src/addr.js';
import type { TFdContent } from 'flowdini-spec';

describe('parseAddr', () => {
  it('внутрифайловый адрес', () => {
    expect(parseAddr('#L1 1#L2 1')).toEqual({ filePath: '', parts: ['L1 1', 'L2 1'] });
  });

  it('адрес на другой файл', () => {
    expect(parseAddr('example1#DESIGN 1#D 1')).toEqual({
      filePath: 'example1',
      parts: ['DESIGN 1', 'D 1'],
    });
  });

  it('без `#` — null', () => {
    expect(parseAddr('example1')).toBeNull();
  });

  it('пустые компоненты сохраняются (двойной `#` не маскируется)', () => {
    expect(parseAddr('#L1 1##L3 1')).toEqual({ filePath: '', parts: ['L1 1', '', 'L3 1'] });
  });
});

describe('buildIndex + makeResolver', () => {
  const files: { filePath: string; content: TFdContent }[] = [
    {
      filePath: 'a',
      content: {
        inlineList: [],
        itemList: [
          { topic: { level1: { title: 'CODE', idx: 1 }, level2: { title: 'C', idx: 1 }, level3: null, inlineList: [] }, text: null },
        ],
        text: null,
      },
    },
    {
      filePath: 'b',
      content: {
        inlineList: [],
        itemList: [
          { topic: { level1: { title: 'RUN', idx: 1 }, level2: null, level3: null, inlineList: [] }, text: null },
        ],
        text: null,
      },
    },
  ];

  it('находит существующий адрес', () => {
    const resolveExternal = makeResolver(buildIndex(files));
    expect(resolveExternal('a', 'CODE 1#C 1')).toBe(true);
    expect(resolveExternal('b', 'RUN 1')).toBe(true);
  });

  it('не находит отсутствующий адрес или файл', () => {
    const resolveExternal = makeResolver(buildIndex(files));
    expect(resolveExternal('a', 'CODE 1#C 9')).toBe(false);
    expect(resolveExternal('missing', 'CODE 1')).toBe(false);
  });
});
