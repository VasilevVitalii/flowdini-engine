import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { captureSnapshot } from '../src/snapshot.js';

async function tmp(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'fd-snap-'));
}

describe('captureSnapshot', () => {
  it('пишет sql-файлы и манифест с sha256', async () => {
    const dir = await tmp();
    const { manifestPath, files } = await captureSnapshot(dir, 2, [
      { objPath: 'dbo.sp_x', definition: 'CREATE PROCEDURE dbo.sp_x AS BEGIN SELECT 1 END' },
      { objPath: 'dbo.fn_y', definition: 'CREATE FUNCTION dbo.fn_y() RETURNS INT AS BEGIN RETURN 1 END' },
    ]);
    expect(files).toHaveLength(2);
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    expect(manifest.iteration).toBe(2);
    expect(manifest.objects).toHaveLength(2);
    expect(manifest.objects[0].objPath).toBe('dbo.sp_x');
    expect(manifest.objects[0].file).toBe('dbo.sp_x.sql');
    expect(manifest.objects[0].sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(await readFile(files[0], 'utf8')).toBe('CREATE PROCEDURE dbo.sp_x AS BEGIN SELECT 1 END');
  });

  it('итерации разделены по папкам', async () => {
    const dir = await tmp();
    const a = await captureSnapshot(dir, 1, [{ objPath: 'dbo.x', definition: 'SELECT 1' }]);
    const b = await captureSnapshot(dir, 2, [{ objPath: 'dbo.x', definition: 'SELECT 2' }]);
    expect(a.files[0]).toContain('/snapshots/1/');
    expect(b.files[0]).toContain('/snapshots/2/');
  });
});
