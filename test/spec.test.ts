import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { mcpMatrix, parseSpec, readSpec, resolveRole, validateSpec } from '../src/spec.js';

const YAML = `
reviewLimit: 2
roles:
  AI.CODER:
    model: deepseek-v4-pro
    tools: [execute_sql, get_definition]
  AI.CODER.SENIOR:
    model: claude-sonnet
  AI.REVIEWER:
    tools: [get_definition]
`;

describe('parseSpec', () => {
  it('парсит YAML в конфиг', () => {
    const c = parseSpec(YAML);
    expect(c.reviewLimit).toBe(2);
    expect(c.roles['AI.CODER'].model).toBe('deepseek-v4-pro');
    expect(c.roles['AI.CODER'].tools).toEqual(['execute_sql', 'get_definition']);
  });

  it('пустой YAML — пустые роли', () => {
    expect(parseSpec('')).toEqual({ roles: {} });
  });

  it('без reviewLimit — поле отсутствует', () => {
    expect(parseSpec('roles: {}\n').reviewLimit).toBeUndefined();
  });
});

describe('validateSpec', () => {
  it('валидный конфиг — без ошибок', () => {
    expect(validateSpec(parseSpec(YAML))).toEqual([]);
  });

  it('невалидная нотация роли', () => {
    const errs = validateSpec({ roles: { BAD: {} } });
    expect(errs).toEqual([
      { path: 'roles.BAD', error: 'invalid role notation: "BAD" (expect KIND.FUNC[.INSTANCE])' },
    ]);
  });

  it('нецелый reviewLimit', () => {
    const errs = validateSpec({ roles: {}, reviewLimit: -1 });
    expect(errs).toEqual([
      { path: 'reviewLimit', error: 'must be a non-negative integer, got -1' },
    ]);
  });

  it('tools не массив строк — ошибка', () => {
    const errs = validateSpec({ roles: { 'AI.CODER': { tools: [1] as unknown as string[] } } });
    expect(errs).toEqual([{ path: 'roles.AI.CODER.tools', error: 'must be an array of strings' }]);
  });
});

describe('resolveRole', () => {
  it('INSTANCE наследует FUNC и перекрывает model', () => {
    const c = parseSpec(YAML);
    const r = resolveRole(c, 'AI.CODER.SENIOR');
    expect(r.model).toBe('claude-sonnet');
    expect(r.tools).toEqual(['execute_sql', 'get_definition']);
  });

  it('точный FUNC без INSTANCE', () => {
    expect(resolveRole(parseSpec(YAML), 'AI.CODER').model).toBe('deepseek-v4-pro');
  });

  it('роли нет — пустой spec', () => {
    expect(resolveRole(parseSpec(YAML), 'AI.WRITER')).toEqual({});
  });
});

describe('mcpMatrix', () => {
  it('матрица роль → инструменты с наследованием INSTANCE→FUNC', () => {
    const c = parseSpec(`roles:\n  AI.CODER:\n    tools: [execute_sql, get_definition]\n  AI.CODER.SENIOR:\n    tools: [get_definition]\n  AI.REVIEWER:\n    tools: [get_definition, list_tables]\n  HUMAN.ANALYST: {}\n`);
    expect(mcpMatrix(c)).toEqual({
      'AI.CODER': ['execute_sql', 'get_definition'],
      'AI.CODER.SENIOR': ['get_definition'],
      'AI.REVIEWER': ['get_definition', 'list_tables'],
    });
  });

  it('роли без tools опускаются', () => {
    expect(mcpMatrix(parseSpec('roles:\n  HUMAN.ANALYST: {}\n'))).toEqual({});
  });
});

describe('readSpec', () => {
  it('читает файл', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'fd-spec-'));
    const p = join(dir, 'fd.spec.yaml');
    await writeFile(p, 'reviewLimit: 1\nroles: {}\n');
    expect((await readSpec(p)).reviewLimit).toBe(1);
  });
});
