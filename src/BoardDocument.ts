import { App, EventRef, Notice, TAbstractFile, TFile, debounce } from 'obsidian';

import { hasFrontmatterKeyRaw } from './helpers';
import { merge3 } from './helpers/merge3';

export interface BoardDocumentHost {
  /** Show `text` as the board; when `save` is set, the result still has to be written. */
  applyText(text: string, save: boolean): Promise<void>;
  /** The file was deleted or is no longer a Kanban board; saving has stopped. */
  sourceLost(error: Error): void;
}

/**
 * Personal build: the single owner of one board file's text and its connection to disk,
 * shared by every view of the file (workspace tabs and owned embeds alike).
 *
 * - `text` is the serialized board; `lastSaved` is what we believe is on disk.
 * - Saves are debounced like Obsidian's TextFileView (2 s after the first change), run
 *   one at a time, and compare-and-write through `vault.process`.
 * - External changes reload a clean board and are merged into pending edits, as Obsidian
 *   does for its own text views. The echo of our own write is recognized and ignored.
 * - A deleted or converted (non-Kanban) source stops all saving.
 */
export class BoardDocument {
  text: string;
  private lastSaved: string;
  private queue: Promise<void> = Promise.resolve();
  private lost?: Error;
  private disposed = false;
  private refs: EventRef[];

  requestSave = debounce(() => {
    this.save().catch((error) => new Notice(`Kanban save failed: ${String(error)}`));
  }, 2000);

  constructor(
    private app: App,
    readonly file: TFile,
    text: string,
    private host: BoardDocumentHost
  ) {
    this.text = this.lastSaved = text;
    const { vault } = app;
    this.refs = [
      vault.on('modify', (changed) => {
        if (changed === this.file) this.enqueue(() => this.onExternalChange());
      }),
      vault.on('delete', (changed: TAbstractFile) => {
        if (changed === this.file) this.loseSource(new Error('Kanban source was deleted.'));
      }),
    ];
  }

  get isDirty() {
    return this.text !== this.lastSaved;
  }

  /** The board was re-serialized; save it after the delay if it differs from disk. */
  update(text: string) {
    this.text = text;
    if (this.isDirty) this.requestSave();
  }

  /** Write pending edits now. Rejects if the write fails or the source was lost. */
  save(): Promise<void> {
    this.requestSave.cancel();
    return this.enqueue(() => this.write());
  }

  /** Resolves once queued saves and external changes have been handled. */
  settled(): Promise<void> {
    return this.queue.catch(() => undefined);
  }

  /** Stop listening; a pending edit is still written. Idempotent. */
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.refs.forEach((ref) => this.app.vault.offref(ref));
    if (this.isDirty && !this.lost) {
      this.save().catch((error) => new Notice(`Kanban save failed: ${String(error)}`));
    } else {
      this.requestSave.cancel();
    }
  }

  // A failed step is reported to its caller and does not block the steps after it.
  private enqueue(step: () => Promise<void>) {
    const run = this.queue.catch(() => undefined).then(step);
    this.queue = run;
    return run;
  }

  private loseSource(error: Error) {
    if (this.lost) return;
    this.lost = error;
    this.requestSave.cancel();
    this.host.sourceLost(error);
  }

  private async write() {
    if (this.lost) throw this.lost;
    if (this.app.vault.getAbstractFileByPath(this.file.path) !== this.file) {
      this.loseSource(new Error('Kanban source was deleted.'));
      throw this.lost;
    }
    const text = this.text;
    const previous = this.lastSaved;
    if (text === previous) return;

    let written = text;
    let converted: Error | undefined;
    try {
      await this.app.vault.process(this.file, (disk) => {
        if (!hasFrontmatterKeyRaw(disk)) {
          converted = new Error('Source is no longer a Kanban board.');
          throw converted;
        }
        // Merge a change that reached disk before its modify event reached us.
        written = disk === previous ? text : merge3(previous, text, disk);
        // Set before the write so the modify event of this write is recognized as ours.
        this.lastSaved = written;
        return written;
      });
    } catch (error) {
      this.lastSaved = previous;
      if (error === converted) this.loseSource(converted);
      throw error;
    }

    if (written !== text) {
      this.text = written;
      this.notifyMerged();
      await this.host.applyText(written, false);
    }
  }

  private notifyMerged() {
    new Notice(`${this.file.basename} changed on disk; your unsaved board edits were merged in.`);
  }

  private async onExternalChange() {
    if (this.disposed || this.lost) return;
    const disk = await this.app.vault.read(this.file);
    if (this.disposed || disk === this.lastSaved) return;
    if (disk === this.text) {
      this.lastSaved = disk;
      return;
    }
    if (!hasFrontmatterKeyRaw(disk)) {
      this.loseSource(new Error('Source is no longer a Kanban board.'));
      return;
    }

    const previous = this.lastSaved;
    this.lastSaved = disk;
    if (this.text === previous) {
      this.text = disk;
      await this.host.applyText(disk, false);
      return;
    }

    this.text = merge3(previous, this.text, disk);
    this.notifyMerged();
    await this.host.applyText(this.text, true);
  }
}
