import type { TFdContent } from 'flowdini-spec';
import type { TSnapshotObject } from './snapshot.js';

/** Объект БД, объявленный в `## OBJECT`: obj-path + тип + действие. */
export interface TFdDbObject {
  /** obj-path (schema.name) — ключ объекта, объявленный в `OBJECT`. */
  objPath: string;
  /** Тип объекта: `procedure` | `function` | `view` (кодер правит только их). */
  objKind: string;
  /** Действие: `create` (объекта ещё нет) или `edit` (уже есть). */
  objAction: 'create' | 'edit';
}

/** Факт о существовании и типе объекта в БД (результат MCP-агента). */
export interface TFdDbFact {
  /** Объект существует в БД (`true`), нет (`false`), не удалось проверить (`null`). */
  exists: boolean | null;
  /** Тип объекта в БД (`procedure`/`function`/`view`/…), `null` — объекта нет. */
  kind: string | null;
}

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
const VALID_KINDS = new Set(['procedure', 'function', 'view']);

/**
 * Вытащить объекты БД из `## OBJECT`-топиков журнала. Неполные `OBJECT`
 * (без `obj-kind`/`obj-action`/`obj-path`) пропускаются — их ловит `taskCheck`.
 */
export function extractDbObjects(content: TFdContent): TFdDbObject[] {
  const objects: TFdDbObject[] = [];
  for (const item of content.itemList) {
    const l2 = item.topic.level2;
    if (l2 === null || l2.title !== 'OBJECT' || item.topic.level3 !== null) continue;
    const get = (p: string): string | undefined =>
      item.topic.inlineList.find((f) => f.param === p)?.valueList[0];
    const objPath = get('obj-path');
    const objKind = get('obj-kind');
    const objAction = get('obj-action');
    if (objPath === undefined || objKind === undefined || objAction === undefined) continue;
    objects.push({ objPath, objKind, objAction: objAction as TFdDbObject['objAction'] });
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
    const fact = await lookup(obj.objPath);
    if (fact.exists === null) {
      errors.push({ objPath: obj.objPath, error: `cannot verify existence: "${obj.objPath}"` });
      continue;
    }
    if (fact.exists) {
      if (obj.objAction === 'create') {
        errors.push({ objPath: obj.objPath, error: `object already exists: "${obj.objPath}"` });
      } else if (fact.kind !== null && fact.kind.toLowerCase() !== obj.objKind.toLowerCase()) {
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
): Promise<TSnapshotObject[]> {
  const result: TSnapshotObject[] = [];
  for (const obj of objects) {
    result.push({ objPath: obj.objPath, definition: await getDefinition(obj.objPath) });
  }
  return result;
}
