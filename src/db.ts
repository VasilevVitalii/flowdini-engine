import type { TFdContent } from 'flowdini-spec';
import type { TFdSnapshotObject } from './snapshot.js';
import { topicFields } from './addr.js';

/** Виды объектов БД, которые правит кодер. */
export type TFdDbObjectKind = 'procedure' | 'function' | 'view';

/** Объект БД, объявленный в `## OBJECT`: obj-path + тип + действие. */
export interface TFdDbObject {
  /** obj-path (schema.name) — ключ объекта, объявленный в `OBJECT`. */
  objPath: string;
  /** Тип объекта: `procedure` | `function` | `view` (кодер правит только их). Валидируется в `validateDbObject`. */
  objKind: string;
  /** Действие: `create` (объекта ещё нет) или `edit` (уже есть). Валидируется в `validateDbObject`. */
  objAction: string;
}

/**
 * Факт о существовании и типе объекта в БД (результат MCP-агента).
 * Адаптер нетипизирован: `exists: true` может прийти с `kind: null` (тип не
 * определили), а `exists: null` — с причиной (напр. расхождение префикса БД).
 * Эти случаи `validateDbObject` превращает в ошибки, а не в исключения.
 */
export type TFdDbFact =
  | { exists: true; kind: TFdDbObjectKind | null }
  | { exists: false; kind: null }
  | { exists: null; kind: null; reason?: string };

/** Запрос факта БД по obj-path. Реализует MCP-агент через `vv-db-mcp` (ядро в БД не ходит). */
export type TFdDbLookup = (objPath: string) => Promise<TFdDbFact>;

/** Получение текста определения объекта (`get_definition` MCP). */
export type TFdGetDefinition = (objPath: string) => Promise<string>;

/** Ошибка сверки объекта с БД. */
export interface TFdDbError {
  objPath: string;
  error: string;
}

/** Валидные `obj-kind` (кодеру даём procedure/function/view, DDL таблиц — человек). */
export const VALID_KINDS = new Set(['procedure', 'function', 'view']);

/**
 * Вытащить объекты БД из `## OBJECT`-топиков журнала. Неполные `OBJECT`
 * (без `obj-kind`/`obj-action`/`obj-path`) пропускаются — их ловит `taskCheck`.
 */
export function extractDbObjects(content: TFdContent): TFdDbObject[] {
  const objects: TFdDbObject[] = [];
  for (const item of content.itemList) {
    const l2 = item.topic.level2;
    if (l2 === null || l2.title !== 'OBJECT' || item.topic.level3 !== null) continue;
    // Читаем только свойства топика (не тело): поле в прозе не объявляет объект.
    const objPaths = topicFields(item.topic, 'obj-path');
    const kinds = topicFields(item.topic, 'obj-kind').filter((v) => v.trim() !== '');
    const actions = topicFields(item.topic, 'obj-action').filter((v) => v.trim() !== '');
    // Ровно один kind/action: конфликтные (`[obj-kind:: a, b]`) пропускаем — их ловит
    // `taskCheck`; молча брать первое значение было бы расхождением с валидатором.
    if (objPaths.length === 0 || kinds.length !== 1 || actions.length !== 1) continue;
    for (const objPath of objPaths) {
      objects.push({ objPath, objKind: kinds[0], objAction: actions[0] });
    }
  }
  return objects;
}

/**
 * Сверка объектов с живой БД (рантайм, вне `taskCheck`):
 * - `obj-kind` — только `procedure`/`function`/`view`;
 * - `create` ⇒ объекта нет; `edit` ⇒ объект есть;
 * - тип объекта в БД совпадает с `obj-kind`.
 * Факты БД даёт `lookup` (MCP-агент) — ядро детерминировано.
 */
export async function validateDbObject(
  objects: TFdDbObject[],
  lookup: TFdDbLookup,
): Promise<TFdDbError[]> {
  const errors: TFdDbError[] = [];
  for (const obj of objects) {
    if (!VALID_KINDS.has(obj.objKind.toLowerCase())) {
      errors.push({ objPath: obj.objPath, error: `invalid obj-kind: "${obj.objKind}"` });
      continue;
    }
    if (obj.objAction !== 'create' && obj.objAction !== 'edit') {
      errors.push({ objPath: obj.objPath, error: `invalid obj-action: "${obj.objAction}"` });
      continue;
    }
    // Lookup может бросить (недоверенный адаптер) — превращаем исключение в ошибку,
    // а не даём ему уронить весь run().
    let fact: TFdDbFact;
    try {
      fact = await lookup(obj.objPath);
    } catch (e) {
      errors.push({
        objPath: obj.objPath,
        error: `lookup failed: ${String((e as { message?: unknown })?.message ?? e)}`,
      });
      continue;
    }
    if (fact.exists === null) {
      errors.push({
        objPath: obj.objPath,
        error: fact.reason !== undefined
          ? `cannot verify existence: ${fact.reason}`
          : `cannot verify existence: "${obj.objPath}"`,
      });
      continue;
    }
    if (fact.exists) {
      if (fact.kind === null) {
        errors.push({ objPath: obj.objPath, error: `exists but kind unknown: "${obj.objPath}"` });
        continue;
      }
      if (obj.objAction === 'create') {
        errors.push({ objPath: obj.objPath, error: `object already exists: "${obj.objPath}"` });
      } else if (fact.kind.toLowerCase() !== obj.objKind.toLowerCase()) {
        errors.push({
          objPath: obj.objPath,
          error: `object kind mismatch: "${obj.objPath}" is "${fact.kind}", expected "${obj.objKind}"`,
        });
      }
    } else if (obj.objAction === 'edit') {
      errors.push({ objPath: obj.objPath, error: `object not found: "${obj.objPath}"` });
    }
  }
  return errors;
}

/**
 * Собрать снапшот-объекты: `get_definition` по каждому `OBJECT` (определения
 * получает MCP-агент; движок сам в БД не ходит — фиксирует готовый текст через
 * `captureSnapshot`).
 */
export async function collectSnapshot(
  objects: TFdDbObject[],
  getDefinition: TFdGetDefinition,
  opts?: { onError?: (objPath: string, error: unknown) => void },
): Promise<TFdSnapshotObject[]> {
  const result: TFdSnapshotObject[] = [];
  for (const obj of objects) {
    try {
      result.push({ objPath: obj.objPath, definition: await getDefinition(obj.objPath) });
    } catch (error) {
      if (opts?.onError) opts.onError(obj.objPath, error);
      else throw error;
    }
  }
  return result;
}
