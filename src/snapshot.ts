import { createHash } from 'node:crypto';
import { chmod, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/** Объект для снапшота: obj-path (schema.name) и его определение. */
export interface TFdSnapshotObject {
  /** obj-path (schema.name) — ключ объекта, объявленный в `OBJECT`. */
  objPath: string;
  /** Текст определения (get_definition), как его вернул MCP. */
  definition: string;
}

/** Манифест снапшота (sha256 + таймстамп). */
export interface TFdSnapshotManifest {
  iteration: number | string;
  capturedAt: string;
  objects: { objPath: string; file: string; sha256: string }[];
}

/**
 * Снять снапшот определений: пишет `<taskDir>/snapshots/<n|baseline>/<objPath>.sql`
 * и `manifest.json` (sha256 каждого файла + таймстамп). Снапшот read-only, снимает движок;
 * определения получает вызывающий (движок сам в БД не ходит — получает готовый текст).
 * `iteration` — номер итерации (`1`, `2`, …) или `'baseline'` для снимка «до всех изменений».
 */
export async function captureSnapshot(
  taskDir: string,
  iteration: number | string,
  objects: TFdSnapshotObject[],
  now?: string,
): Promise<{ manifestPath: string; files: string[] }> {
  const dir = join(taskDir, 'snapshots', String(iteration));
  // Повторный снимок той же итерации (повтор после отката CRASH) — стереть старое.
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  const files: string[] = [];
  const manifestObjects: TFdSnapshotManifest['objects'] = [];
  for (const obj of objects) {
    const file = `${safeName(obj.objPath)}.sql`;
    const sha256 = createHash('sha256').update(obj.definition).digest('hex');
    const full = join(dir, file);
    await writeFile(full, obj.definition);
    await chmod(full, 0o444); // снапшот read-only после снятия
    files.push(full);
    manifestObjects.push({ objPath: obj.objPath, file, sha256 });
  }
  const manifest: TFdSnapshotManifest = {
    iteration,
    capturedAt: now ?? new Date().toISOString(),
    objects: manifestObjects,
  };
  const manifestPath = join(dir, 'manifest.json');
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  await chmod(manifestPath, 0o444);
  return { manifestPath, files };
}

/** Безопасное и инъективное имя файла из obj-path (без создания подпапок, без коллизий). */
function safeName(objPath: string): string {
  let out = '';
  for (const ch of objPath) {
    if (/[A-Za-z0-9._-]/.test(ch)) out += ch;
    else out += '~' + (ch.codePointAt(0) ?? 0).toString(16) + '~';
  }
  return out;
}
