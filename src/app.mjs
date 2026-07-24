import crypto from "node:crypto";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import Fastify from "fastify";
import { createAudiverisRunner } from "./audiveris.mjs";
import { JobQueue } from "./job-queue.mjs";
import { JobStore } from "./job-store.mjs";

function publicJob(job) {
  if (!job) return null;
  const { originalName: _originalName, ...safe } = job;
  return safe.status === "completed"
    ? { ...safe, resultUrl: `/v1/jobs/${safe.id}/result` }
    : safe;
}

function safeFileName(value) {
  return String(value || "partitura.pdf")
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}._ -]+/gu, "_")
    .slice(0, 160);
}

export async function createApp({
  config,
  runner = createAudiverisRunner(config),
  logger = false,
} = {}) {
  const app = Fastify({
    logger,
    bodyLimit: config.maxUploadBytes + 1024 * 1024,
    requestTimeout: 60_000,
  });
  const store = new JobStore(config.dataDir);
  await store.initialize();
  const queue = new JobQueue({ store, runner, concurrency: config.concurrency });

  await app.register(cors, {
    origin(origin, callback) {
      if (!origin || config.allowedOrigins.includes("*") || config.allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error("Origem não autorizada."), false);
      }
    },
    methods: ["GET", "POST", "OPTIONS"],
  });
  await app.register(multipart, {
    limits: { files: 1, fileSize: config.maxUploadBytes, fields: 4 },
  });

  app.get("/health", async () => ({
    status: "ok",
    engine: `Audiveris ${config.audiverisVersion}`,
    queue: { pending: queue.pending.length, running: queue.running },
    sourceUrl: config.sourceUrl,
  }));

  app.get("/source", async (_request, reply) => reply.redirect(config.sourceUrl));

  app.post("/v1/jobs", async (request, reply) => {
    if (queue.size >= config.maxQueuedJobs) {
      return reply.code(503).send({
        error: { code: "QUEUE_FULL", message: "O servidor está ocupado. Tente novamente em alguns minutos." },
      });
    }
    const part = await request.file();
    if (!part) {
      return reply.code(400).send({ error: { code: "PDF_REQUIRED", message: "Envie um arquivo PDF." } });
    }
    if (!/\.pdf$/i.test(part.filename || "") && part.mimetype !== "application/pdf") {
      part.file.resume();
      return reply.code(415).send({ error: { code: "PDF_ONLY", message: "Somente arquivos PDF são aceitos." } });
    }
    const chunks = [];
    for await (const chunk of part.file) chunks.push(chunk);
    if (part.file.truncated) {
      return reply.code(413).send({ error: { code: "PDF_TOO_LARGE", message: "O PDF ultrapassa o limite permitido." } });
    }
    const bytes = Buffer.concat(chunks);
    if (bytes.length < 5 || bytes.subarray(0, 5).toString("ascii") !== "%PDF-") {
      return reply.code(415).send({ error: { code: "INVALID_PDF", message: "O arquivo não possui uma estrutura PDF reconhecível." } });
    }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const job = {
      id,
      status: "queued",
      message: "PDF recebido. Aguardando o motor de reconhecimento…",
      createdAt: now,
      updatedAt: now,
      originalName: safeFileName(part.filename),
      size: bytes.length,
      engine: `Audiveris ${config.audiverisVersion}`,
      metrics: null,
      warnings: [],
      sourceUrl: config.sourceUrl,
      error: null,
    };
    await store.create(job, bytes);
    queue.enqueue(id);
    return reply.code(202).send(publicJob(job));
  });

  app.get("/v1/jobs/:id", async (request, reply) => {
    const job = await store.get(request.params.id);
    if (!job) return reply.code(404).send({ error: { code: "NOT_FOUND", message: "Conversão não encontrada." } });
    return publicJob(job);
  });

  app.get("/v1/jobs/:id/result", async (request, reply) => {
    const job = await store.get(request.params.id);
    if (!job) return reply.code(404).send({ error: { code: "NOT_FOUND", message: "Conversão não encontrada." } });
    if (job.status !== "completed") {
      return reply.code(409).send({ error: { code: "NOT_READY", message: "O MusicXML ainda não está disponível." } });
    }
    const xml = await store.result(job.id);
    return reply
      .header("content-type", "application/vnd.recordare.musicxml+xml; charset=utf-8")
      .header("content-disposition", `attachment; filename="${job.id}.musicxml"`)
      .send(xml);
  });

  app.addHook("onReady", async () => {
    for (const job of await store.recoverableJobs()) {
      await store.update(job.id, { status: "queued", message: "Trabalho recuperado após reinicialização." });
      queue.enqueue(job.id);
    }
  });

  const cleanupTimer = setInterval(() => {
    store.cleanup(Date.now() - config.jobTtlMs).catch((error) => app.log.error(error));
  }, Math.min(config.jobTtlMs, 60 * 60 * 1000));
  cleanupTimer.unref();
  app.addHook("onClose", async () => clearInterval(cleanupTimer));

  return app;
}
