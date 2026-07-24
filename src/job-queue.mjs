import path from "node:path";

export class JobQueue {
  constructor({ store, runner, concurrency = 1 }) {
    this.store = store;
    this.runner = runner;
    this.concurrency = concurrency;
    this.pending = [];
    this.running = 0;
  }

  enqueue(id) {
    if (!this.pending.includes(id)) this.pending.push(id);
    queueMicrotask(() => this.drain());
  }

  get size() {
    return this.pending.length + this.running;
  }

  async drain() {
    while (this.running < this.concurrency && this.pending.length) {
      const id = this.pending.shift();
      this.running += 1;
      this.process(id)
        .catch(() => {})
        .finally(() => {
          this.running -= 1;
          this.drain();
        });
    }
  }

  async process(id) {
    const job = await this.store.update(id, {
      status: "processing",
      message: "Reconhecendo pautas, compassos, notas e ritmos…",
      startedAt: new Date().toISOString(),
    });
    if (!job) return;
    const jobDir = this.store.jobDir(id);
    try {
      const result = await this.runner({
        id,
        jobDir,
        inputPath: path.join(jobDir, "input.pdf"),
        outputDir: path.join(jobDir, "output"),
      });
      await this.store.saveResult(id, result.xml);
      await this.store.update(id, {
        status: "completed",
        message: "MusicXML gerado e validado.",
        completedAt: new Date().toISOString(),
        engine: result.engine,
        metrics: result.metrics,
        warnings: result.warnings,
        error: null,
      });
    } catch (error) {
      await this.store.update(id, {
        status: "failed",
        message: "A conversão não pôde ser concluída.",
        completedAt: new Date().toISOString(),
        error: { code: "OMR_FAILED", message: error.message },
      });
    }
  }
}
