import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/** Объект для снапшота: obj-path (schema.name) и его определение. */
export interface TSnapshotObject {
  /** obj-path (schema.name) — ключ объекта, объявленный в `OBJECT`. */
  objPath: string;
  /** Текст определения (get_definition), как его вернул MCP. */
  definition: string;
}

/** Манифест снапшота (sha256 + таймстамп). */
export interface TSnapshotManifest {
  iteration: number;
  capturedAt: string;
  objects: { objPath: string; file: string; sha256: string }[];
}

/**
 * Снять снапшот определений после CODE/FIX: пишет `<taskDir>/snapshots/<n>/<objPath>.sql`
 * и `manifest.json` (sha256 каждого файла + таймстамп). Снапшот read-only, снимает движок;
 * определения получает MCP-агент (движок сам в БД не ходит — получает готовый текст).
 */
export async function captureSnapshot(
  taskDir: string,
  iteration: number,
  objects: TSnapshotObject[],
): Promise<{ manifestPath: string; files: string[] }> {
  const dir = join(taskDir, 'snapshots', String(iteration));
  await mkdir(dir, { recursive: true });
  const files: string[] = [];
  const manifestObjects: TSnapshotManifest['objects'] = [];
  for (const obj of objects) {
    const file = `${safeName(obj.objPath)}.sql`;
    const sha256 = createHash('sha256').update(obj.definition).digest('hex');
    await writeFile(join(dir, file), obj.definition);
    files.push(join(dir, file));
    manifestObjects.push({ objPath: obj.objPath, file, sha256 });
  }
  const manifest: TSnapshotManifest = {
    iteration,
    capturedAt: new Date().toISOString(),
    objects: manifestObjects,
  };
  const manifestPath = join(dir, 'manifest.json');
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  return { manifestPath, files };
}

/** Безопасное имя файла из obj-path (без создания подпапок). */
function safeName(objPath: string): string {
  return objPath.replace(/[^\w.-]+/g, '_');
}
