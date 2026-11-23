import { readFile } from 'node:fs/promises';
import { parse } from 'yaml';

/** Оси исполнения роли (SPEC-конфиг, ключ — `FUNC[.INSTANCE]`). */
export interface TFdRoleSpec {
  /** Модель, исполняющая роль. */
  model?: string;
  /** Инструменты MCP (матрица «роль → инструменты»). */
  tools?: string[];
  /** Права: что можно (read-only, DDL-виды, vault). */
  rights?: Record<string, unknown>;
  /** Бюджет: лимиты роли. */
  budget?: Record<string, unknown>;
  /** SPEC-биндинги — обязательный минимум контекста (файлы vault). */
  context?: string[];
}

/** Контракт исполнения проекта (один на проект). */
export interface TFdSpecConfig {
  /** Порог итераций REVIEW→FIX: после него в `REVIEW` первым идёт `## Q` к HUMAN.CODER. Не задан — гейт выключен. */
  reviewLimit?: number;
  /** Режим обработки замечаний REVIEW: `item` — отдельный FIX-раздел на каждое замечание (заголовок и свойства формирует хост; по умолчанию); `bulk` — один FIX на все замечания (заголовки и свойства пишет модель). */
  fixMode?: 'bulk' | 'item';
  /** При `fixMode: item`: подавать кодеру справку — предыдущие пункты этого REVIEW и ответы кодера на них. */
  fixReference?: boolean;
  /** Реестр ролей: ключ `FUNC[.INSTANCE]`; `INSTANCE` наследует `FUNC`. */
  roles: Record<string, TFdRoleSpec>;
}

/** Ошибка валидации SPEC. */
export interface TFdSpecError {
  /** Путь к полю (пустая строка — корень конфига). */
  path: string;
  error: string;
}

/** Нотация роли: `KIND.FUNC[.INSTANCE]` (2–3 сегмента). */
const ROLE_RE = /^(AI|HUMAN|PROC)\.[A-Za-z0-9_]+(\.[A-Za-z0-9_]+)?$/;

/** Валидировать SPEC-конфиг: нотация ролей, типы полей, `reviewLimit`. */
export function validateSpec(config: TFdSpecConfig): TFdSpecError[] {
  const errors: TFdSpecError[] = [];
  if (
    config.reviewLimit !== undefined &&
    (!Number.isInteger(config.reviewLimit) || config.reviewLimit < 0)
  ) {
    errors.push({
      path: 'reviewLimit',
      error: `must be a non-negative integer, got ${JSON.stringify(config.reviewLimit)}`,
    });
  }
  if (
    config.fixMode !== undefined &&
    config.fixMode !== 'bulk' &&
    config.fixMode !== 'item'
  ) {
    errors.push({
      path: 'fixMode',
      error: `must be 'bulk' or 'item', got ${JSON.stringify(config.fixMode)}`,
    });
  }
  if (config.fixReference !== undefined && typeof config.fixReference !== 'boolean') {
    errors.push({ path: 'fixReference', error: 'must be a boolean' });
  }
  for (const [role, spec] of Object.entries(config.roles)) {
    if (!ROLE_RE.test(role)) {
      errors.push({
        path: `roles.${role}`,
        error: `invalid role notation: "${role}" (expect KIND.FUNC[.INSTANCE])`,
      });
      continue;
    }
    if (spec.model !== undefined && (typeof spec.model !== 'string' || spec.model.trim() === '')) {
      errors.push({ path: `roles.${role}.model`, error: 'must be a non-empty string' });
    }
    if (spec.tools !== undefined && (!Array.isArray(spec.tools) || spec.tools.some((t) => typeof t !== 'string'))) {
      errors.push({ path: `roles.${role}.tools`, error: 'must be an array of strings' });
    }
    if (spec.context !== undefined && (!Array.isArray(spec.context) || spec.context.some((t) => typeof t !== 'string'))) {
      errors.push({ path: `roles.${role}.context`, error: 'must be an array of strings' });
    }
    if (spec.rights !== undefined && (typeof spec.rights !== 'object' || spec.rights === null || Array.isArray(spec.rights))) {
      errors.push({ path: `roles.${role}.rights`, error: 'must be an object' });
    }
    if (spec.budget !== undefined && (typeof spec.budget !== 'object' || spec.budget === null || Array.isArray(spec.budget))) {
      errors.push({ path: `roles.${role}.budget`, error: 'must be an object' });
    }
  }
  return errors;
}

/** Распарсить YAML в SPEC-конфиг (форма полей не валидируется — см. `validateSpec`). */
export function parseSpec(text: string): TFdSpecConfig {
  const raw = parse(text) as unknown;
  if (raw === null || raw === undefined) {
    return { roles: {} };
  }
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('SPEC: корень должен быть объектом (mapping)');
  }
  const obj = raw as Record<string, unknown>;
  const roles = obj.roles ?? {};
  if (typeof roles !== 'object' || roles === null || Array.isArray(roles)) {
    throw new Error('SPEC: roles должен быть объектом');
  }
  const config: TFdSpecConfig = { roles: roles as Record<string, TFdRoleSpec> };
  if (obj.reviewLimit !== undefined) config.reviewLimit = obj.reviewLimit as number;
  if (obj.fixMode !== undefined) config.fixMode = obj.fixMode as 'bulk' | 'item';
  if (obj.fixReference !== undefined) config.fixReference = obj.fixReference as boolean;
  return config;
}

/** Прочитать и распарсить SPEC-файл (`fd.spec.yaml`). */
export async function readSpec(path: string): Promise<TFdSpecConfig> {
  return parseSpec(await readFile(path, 'utf8'));
}

/** Резолв роли с наследованием: `INSTANCE` перекрывает `FUNC` по полям (массивы заменяются целиком). */
export function resolveRole(config: TFdSpecConfig, role: string): TFdRoleSpec {
  const parts = role.split('.');
  const func = parts.slice(0, 2).join('.');
  const base = config.roles[func] ?? {};
  const overlay = parts.length > 2 ? (config.roles[role] ?? {}) : {};
  return { ...base, ...overlay };
}

/**
 * Матрица MCP «роль → инструменты»: для каждого ключа реестра — резолвнутые
 * `tools` (с наследованием `INSTANCE`→`FUNC`). Ключи без инструментов опускаются.
 */
export function mcpMatrix(config: TFdSpecConfig): Record<string, string[]> {
  const matrix: Record<string, string[]> = {};
  for (const role of Object.keys(config.roles)) {
    const tools = resolveRole(config, role).tools;
    if (tools !== undefined && tools.length > 0) matrix[role] = tools;
  }
  return matrix;
}
