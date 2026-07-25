import crypto from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
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

function authorized(request, accessKey) {
  if (!accessKey) return true;
  const header = request.headers["x-omr-key"];
  const bearer = request.headers.authorization?.replace(/^Bearer\s+/i, "");
  const provided = String(header || bearer || "");
  const expected = Buffer.from(accessKey);
  const candidate = Buffer.from(provided);
  return expected.length === candidate.length
    && expected.length > 0
    && crypto.timingSafeEqual(expected, candidate);
}

async function requireAccess(request, reply, accessKey) {
  if (authorized(request, accessKey)) return;
  return reply.code(401).send({
    error: { code: "UNAUTHORIZED", message: "Chave de acesso do conversor ausente ou inválida." },
  });
}

async function readPdf(request, reply) {
  const part = await request.file();
  if (!part) {
    reply.code(400).send({ error: { code: "PDF_REQUIRED", message: "Envie um arquivo PDF." } });
    return null;
  }
  if (!/\.pdf$/i.test(part.filename || "") && part.mimetype !== "application/pdf") {
    part.file.resume();
    reply.code(415).send({ error: { code: "PDF_ONLY", message: "Somente arquivos PDF são aceitos." } });
    return null;
  }
  const chunks = [];
  for await (const chunk of part.file) chunks.push(chunk);
  if (part.file.truncated) {
    reply.code(413).send({ error: { code: "PDF_TOO_LARGE", message: "O PDF ultrapassa o limite permitido." } });
    return null;
  }
  const bytes = Buffer.concat(chunks);
  if (bytes.length < 5 || bytes.subarray(0, 5).toString("ascii") !== "%PDF-") {
    reply.code(415).send({ error: { code: "INVALID_PDF", message: "O arquivo não possui uma estrutura PDF reconhecível." } });
    return null;
  }
  return { bytes, filename: safeFileName(part.filename) };
}

export async function createApp({
  config,
  runner = createAudiverisRunner(config),
  logger = false,
} = {}) {
  const app = Fastify({
    logger,
    bodyLimit: config.maxUploadBytes + 1024 * 1024,
    requestTimeout: config.jobTimeoutMs + 60_000,
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
    allowedHeaders: ["content-type", "authorization", "x-omr-key"],
  });
  await app.register(multipart, {
    limits: { files: 1, fileSize: config.maxUploadBytes, fields: 4 },
  });

  app.get("/health", async () => ({
    status: "ok",
    engine: `Audiveris ${config.audiverisVersion}`,
    queue: { pending: queue.pending.length, running: queue.running },
    synchronous: { endpoint: "/v1/convert", running: synchronousRunning },
    accessKeyRequired: Boolean(config.accessKey),
    sourceUrl: config.sourceUrl,
  }));

  app.get("/source", async (_request, reply) => reply.redirect(config.sourceUrl));

  let synchronousRunning = 0;

  // Endpoint próprio para plataformas serverless. A requisição permanece
  // aberta enquanto o Audiveris trabalha, garantindo CPU no Cloud Run. Todos
  // os arquivos vivem apenas em /tmp e são apagados antes da resposta terminar.
  app.post("/v1/convert", {
    preHandler: (request, reply) => requireAccess(request, reply, config.accessKey),
  }, async (request, reply) => {
    if (synchronousRunning >= config.concurrency) {
      return reply.code(503).send({
        error: { code: "BUSY", message: "O conversor está ocupado. Tente novamente em alguns instantes." },
      });
    }
    const upload = await readPdf(request, reply);
    if (!upload) return reply;

    const id = crypto.randomUUID();
    const jobDir = path.join(config.dataDir, `sync-${id}`);
    const outputDir = path.join(jobDir, "output");
    let statusCode = 200;
    let responseBody;
    synchronousRunning += 1;
    try {
      await mkdir(outputDir, { recursive: true });
      const inputPath = path.join(jobDir, "input.pdf");
      await writeFile(inputPath, upload.bytes);
      const result = await runner({ id, jobDir, inputPath, outputDir });
      responseBody = {
        status: "completed",
        message: "MusicXML gerado e validado.",
        engine: result.engine,
        metrics: result.metrics,
        warnings: result.warnings,
        sourceUrl: config.sourceUrl,
        xml: result.xml,
      };
    } catch (error) {
      request.log.error(error);
      statusCode = 422;
      responseBody = {
        error: { code: "OMR_FAILED", message: error.message },
      };
    } finally {
      synchronousRunning -= 1;
      await rm(jobDir, { recursive: true, force: true });
    }
    return reply.code(statusCode).send(responseBody);
  });

  app.post("/v1/jobs", {
    preHandler: (request, reply) => requireAccess(request, reply, config.accessKey),
  }, async (request, reply) => {
    if (queue.size >= config.maxQueuedJobs) {
      return reply.code(503).send({
        error: { code: "QUEUE_FULL", message: "O servidor está ocupado. Tente novamente em alguns minutos." },
      });
    }
    const upload = await readPdf(request, reply);
    if (!upload) return reply;

    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const job = {
      id,
      status: "queued",
      message: "PDF recebido. Aguardando o motor de reconhecimento…",
      createdAt: now,
      updatedAt: now,
      originalName: upload.filename,
      size: upload.bytes.length,
      engine: `Audiveris ${config.audiverisVersion}`,
      metrics: null,
      warnings: [],
      sourceUrl: config.sourceUrl,
      error: null,
    };
    await store.create(job, upload.bytes);
    queue.enqueue(id);
    return reply.code(202).send(publicJob(job));
  });

  app.get("/v1/jobs/:id", {
    preHandler: (request, reply) => requireAccess(request, reply, config.accessKey),
  }, async (request, reply) => {
    const job = await store.get(request.params.id);
    if (!job) return reply.code(404).send({ error: { code: "NOT_FOUND", message: "Conversão não encontrada." } });
    return publicJob(job);
  });

  app.get("/v1/jobs/:id/result", {
    preHandler: (request, reply) => requireAccess(request, reply, config.accessKey),
  }, async (request, reply) => {
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
