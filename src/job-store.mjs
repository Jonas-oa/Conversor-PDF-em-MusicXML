import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

async function atomicJson(filePath, value) {
  const temporary = `${filePath}.tmp`;
  await writeFile(temporary, JSON.stringify(value, null, 2), "utf8");
  await import("node:fs/promises").then(({ rename }) => rename(temporary, filePath));
}

export class JobStore {
  constructor(dataDir) {
    this.dataDir = dataDir;
  }

  jobDir(id) {
    return path.join(this.dataDir, id);
  }

  metadataPath(id) {
    return path.join(this.jobDir(id), "job.json");
  }

  async initialize() {
    await mkdir(this.dataDir, { recursive: true });
  }

  async create(job, pdfBytes) {
    const directory = this.jobDir(job.id);
    await mkdir(path.join(directory, "output"), { recursive: true });
    await writeFile(path.join(directory, "input.pdf"), pdfBytes);
    await atomicJson(this.metadataPath(job.id), job);
    return job;
  }

  async get(id) {
    try {
      return JSON.parse(await readFile(this.metadataPath(id), "utf8"));
    } catch (error) {
      if (error.code === "ENOENT") return null;
      throw error;
    }
  }

  async update(id, patch) {
    const current = await this.get(id);
    if (!current) return null;
    const next = { ...current, ...patch, updatedAt: new Date().toISOString() };
    await atomicJson(this.metadataPath(id), next);
    return next;
  }

  async saveResult(id, xml) {
    await writeFile(path.join(this.jobDir(id), "result.musicxml"), xml, "utf8");
  }

  async result(id) {
    return readFile(path.join(this.jobDir(id), "result.musicxml"), "utf8");
  }

  async recoverableJobs() {
    const ids = await readdir(this.dataDir);
    const jobs = [];
    for (const id of ids) {
      const job = await this.get(id);
      if (job && ["queued", "processing"].includes(job.status)) jobs.push(job);
    }
    return jobs.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async cleanup(beforeTimestamp) {
    const ids = await readdir(this.dataDir);
    for (const id of ids) {
      const job = await this.get(id);
      if (!job || !["completed", "failed", "cancelled"].includes(job.status)) continue;
      if (Date.parse(job.updatedAt) < beforeTimestamp) {
        await rm(this.jobDir(id), { recursive: true, force: true });
      }
    }
  }
}
