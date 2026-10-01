import { createReadStream, existsSync } from 'node:fs';
import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

const ID_RE = /^[0-9a-f-]{36}$/i;

/** Dateisystem-Ablage der Archive: <archivesDir>/<archiveId>/<relativer Pfad>. */
export class ArchiveStorage {
  constructor(private readonly root: string) {}

  dirFor(archiveId: string): string {
    if (!ID_RE.test(archiveId)) throw new Error('Ungültige Archiv-ID');
    return path.join(this.root, archiveId);
  }

  /**
   * Löst einen relativen URL-Pfad innerhalb des Archivverzeichnisses auf.
   * Gibt null zurück, wenn der Pfad das Verzeichnis verlassen würde (Path Traversal).
   */
  resolve(archiveId: string, relPath: string): string | null {
    const base = this.dirFor(archiveId);
    if (relPath.includes('\0') || relPath.includes('\\')) return null;
    const full = path.resolve(base, relPath);
    return full.startsWith(base + path.sep) ? full : null;
  }

  async write(archiveId: string, relPath: string, data: Buffer | string): Promise<void> {
    const full = this.resolve(archiveId, relPath);
    if (!full) throw new Error(`Unzulässiger Pfad: ${relPath}`);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, data);
  }

  async remove(archiveId: string): Promise<void> {
    await rm(this.dirFor(archiveId), { recursive: true, force: true });
  }

  exists(archiveId: string): boolean {
    return existsSync(this.dirFor(archiveId));
  }

  async statFile(full: string): Promise<{ size: number; mtime: Date } | null> {
    try {
      const s = await stat(full);
      return s.isFile() ? { size: s.size, mtime: s.mtime } : null;
    } catch {
      return null;
    }
  }

  openRead(full: string) {
    return createReadStream(full);
  }
}
