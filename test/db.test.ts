import { textToStructure } from 'flowdini-spec';
import type { TFdContent } from 'flowdini-spec';
import { describe, expect, it } from 'vitest';
import { collectSnapshot, extractDbObjects, validateDbObject } from '../src/db.js';
import type { TFdDbFact } from '../src/db.js';

function contentOf(md: string): TFdContent {
  return textToStructure(md, true);
}

describe('extractDbObjects', () => {
  it('вытаскивает OBJECT-объекты; неполные пропускает', () => {
    const c = contentOf(`# ISSUE 1

## OBJECT 1
[fd-from:: AI.ANALYST] [fd-to:: AI.CODER] [obj-kind:: function] [obj-action:: create] [obj-path:: dbo.f_a]

body

## OBJECT 2
[fd-from:: AI.ANALYST] [fd-to:: AI.CODER] [obj-kind:: procedure] [obj-action:: edit] [obj-path:: dbo.p_b]

body

## OBJECT 3
[fd-from:: AI.ANALYST] [fd-to:: AI.CODER] [obj-kind:: view]

неполный
`);
    expect(extractDbObjects(c)).toEqual([
      { objPath: 'dbo.f_a', objKind: 'function', objAction: 'create' },
      { objPath: 'dbo.p_b', objKind: 'procedure', objAction: 'edit' },
    ]);
  });

  it('obj-path с несколькими значениями даёт по объекту на каждое', () => {
    const c = contentOf(`# ISSUE 1

## OBJECT 1
[obj-kind:: function] [obj-action:: create] [obj-path:: dbo.f_a, dbo.f_b]

body
`);
    expect(extractDbObjects(c)).toEqual([
      { objPath: 'dbo.f_a', objKind: 'function', objAction: 'create' },
      { objPath: 'dbo.f_b', objKind: 'function', objAction: 'create' },
    ]);
  });

  it('obj-path в теле OBJECT не объявляет объект (только свойства топика)', () => {
    const c = contentOf(`# ISSUE 1

## OBJECT 1
[obj-kind:: function] [obj-action:: create]

[obj-path:: dbo.ghost] — упомянут только в прозе
`);
    expect(extractDbObjects(c)).toEqual([]);
  });

  it('несколько obj-kind (конфликт) — OBJECT пропускается', () => {
    const c = contentOf(`# ISSUE 1

## OBJECT 1
[obj-kind:: function, procedure] [obj-action:: create] [obj-path:: dbo.f_a]

body
`);
    expect(extractDbObjects(c)).toEqual([]);
  });
});

describe('validateDbObject', () => {
  const lookup = (facts: Record<string, TFdDbFact>) => async (p: string) => facts[p];

  it('create + объекта нет → ок; create + есть → ошибка', async () => {
    const facts: Record<string, TFdDbFact> = {
      'dbo.f_a': { exists: false, kind: null },
      'dbo.f_b': { exists: true, kind: 'function' },
    };
    const objects = [
      { objPath: 'dbo.f_a', objKind: 'function', objAction: 'create' as const },
      { objPath: 'dbo.f_b', objKind: 'function', objAction: 'create' as const },
    ];
    expect(await validateDbObject(objects, lookup(facts))).toEqual([
      { objPath: 'dbo.f_b', error: 'object already exists: "dbo.f_b"' },
    ]);
  });

  it('edit + объекта нет → ошибка; edit + есть и тип совпал → ок', async () => {
    const facts: Record<string, TFdDbFact> = {
      'dbo.p_a': { exists: false, kind: null },
      'dbo.p_b': { exists: true, kind: 'procedure' },
    };
    const objects = [
      { objPath: 'dbo.p_a', objKind: 'procedure', objAction: 'edit' as const },
      { objPath: 'dbo.p_b', objKind: 'procedure', objAction: 'edit' as const },
    ];
    expect(await validateDbObject(objects, lookup(facts))).toEqual([
      { objPath: 'dbo.p_a', error: 'object not found: "dbo.p_a"' },
    ]);
  });

  it('тип объекта в БД не совпал с obj-kind → ошибка', async () => {
    const facts: Record<string, TFdDbFact> = { 'dbo.v_a': { exists: true, kind: 'view' } };
    const objects = [{ objPath: 'dbo.v_a', objKind: 'procedure', objAction: 'edit' as const }];
    expect(await validateDbObject(objects, lookup(facts))).toEqual([
      { objPath: 'dbo.v_a', error: 'object kind mismatch: "dbo.v_a" is "view", expected "procedure"' },
    ]);
  });

  it('exists:null (сбой проверки) → ошибка "cannot verify", не "not found"', async () => {
    const facts: Record<string, TFdDbFact> = { 'dbo.p_a': { exists: null, kind: null } };
    const objects = [{ objPath: 'dbo.p_a', objKind: 'procedure', objAction: 'edit' as const }];
    expect(await validateDbObject(objects, lookup(facts))).toEqual([
      { objPath: 'dbo.p_a', error: 'cannot verify existence: "dbo.p_a"' },
    ]);
  });

  it('невалидный obj-kind → ошибка без обращения к БД', async () => {
    const objects = [
      { objPath: 'dbo.t_a', objKind: 'table', objAction: 'edit' },
    ];
    let called = false;
    const errors = await validateDbObject(objects, async () => {
      called = true;
      return { exists: true, kind: 'view' };
    });
    expect(errors).toEqual([{ objPath: 'dbo.t_a', error: 'invalid obj-kind: "table"' }]);
    expect(called).toBe(false);
  });

  it('невалидный obj-action → ошибка без обращения к БД', async () => {
    const objects = [{ objPath: 'dbo.f_a', objKind: 'function', objAction: 'drop' }];
    let called = false;
    const errors = await validateDbObject(objects, async () => {
      called = true;
      return { exists: false, kind: null };
    });
    expect(errors).toEqual([{ objPath: 'dbo.f_a', error: 'invalid obj-action: "drop"' }]);
    expect(called).toBe(false);
  });

  it('exists:true с kind:null (тип не определили) → ошибка, не сверка', async () => {
    const facts: Record<string, TFdDbFact> = { 'dbo.p_a': { exists: true, kind: null } };
    const objects = [{ objPath: 'dbo.p_a', objKind: 'procedure', objAction: 'edit' }];
    expect(await validateDbObject(objects, lookup(facts))).toEqual([
      { objPath: 'dbo.p_a', error: 'exists but kind unknown: "dbo.p_a"' },
    ]);
  });

  it('exists:null с причиной → ошибка с причиной', async () => {
    const facts: Record<string, TFdDbFact> = {
      'dbo.p_a': { exists: null, kind: null, reason: 'dbPrefix mismatch' },
    };
    const objects = [{ objPath: 'dbo.p_a', objKind: 'procedure', objAction: 'edit' }];
    expect(await validateDbObject(objects, lookup(facts))).toEqual([
      { objPath: 'dbo.p_a', error: 'cannot verify existence: dbPrefix mismatch' },
    ]);
  });

  it('lookup бросает → ошибка, не исключение', async () => {
    const objects = [{ objPath: 'dbo.p_a', objKind: 'procedure', objAction: 'edit' }];
    expect(
      await validateDbObject(objects, async () => {
        throw new Error('connection lost');
      }),
    ).toEqual([{ objPath: 'dbo.p_a', error: 'lookup failed: connection lost' }]);
  });
});

describe('collectSnapshot', () => {
  it('get_definition по каждому объекту', async () => {
    const objects = [
      { objPath: 'dbo.f_a', objKind: 'function', objAction: 'create' as const },
      { objPath: 'dbo.p_b', objKind: 'procedure', objAction: 'edit' as const },
    ];
    const defs: Record<string, string> = { 'dbo.f_a': 'CREATE FUNCTION ...', 'dbo.p_b': 'CREATE PROC ...' };
    expect(await collectSnapshot(objects, async (p) => defs[p])).toEqual([
      { objPath: 'dbo.f_a', definition: 'CREATE FUNCTION ...' },
      { objPath: 'dbo.p_b', definition: 'CREATE PROC ...' },
    ]);
  });
});
