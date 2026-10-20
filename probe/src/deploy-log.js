import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const UNFINISHED = new Set(["queued", "deploying", "accepted"]);

export class DeployLog {
  constructor(file, { limit = 10, now = () => new Date() } = {}) {
    this.file = file;
    this.limit = limit;
    this.now = now;
    this.entries = [];
    this.writing = Promise.resolve();
  }

  async load() {
    if (!this.file) return;
    try {
      const saved = JSON.parse(await readFile(this.file, "utf8"));
      if (Array.isArray(saved)) {
        this.entries = saved
          .slice(0, this.limit)
          .map((entry) => (UNFINISHED.has(entry.status) ? { ...entry, status: "interrupted" } : entry));
      }
    } catch (error) {
      if (error.code !== "ENOENT") console.error(`deploy log unreadable, starting empty: ${error.message}`);
    }
  }

  list() {
    return this.entries.map((entry) => ({ ...entry }));
  }

  find(id) {
    return this.entries.find((entry) => entry.id === id);
  }

  add(fields) {
    const entry = { id: randomUUID(), receivedAt: this.now().toISOString(), ...fields };
    this.entries = [entry, ...this.entries].slice(0, this.limit);
    this.persist();
    return entry;
  }

  update(id, patch) {
    const entry = this.find(id);
    if (!entry) return;
    Object.assign(entry, patch);
    this.persist();
  }

  persist() {
    if (!this.file) return this.writing;
    const snapshot = JSON.stringify(this.entries);
    this.writing = this.writing
      .then(async () => {
        await mkdir(dirname(this.file), { recursive: true });
        const staging = `${this.file}.tmp`;
        await writeFile(staging, snapshot);
        await rename(staging, this.file);
      })
      .catch((error) => console.error(`deploy log not saved: ${error.message}`));
    return this.writing;
  }
}
