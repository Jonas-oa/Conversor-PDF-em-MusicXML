import path from "node:path";

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function loadConfig(env = process.env) {
  const dataDir = path.resolve(env.OMR_DATA_DIR || "./data");
  return Object.freeze({
    host: env.HOST || "0.0.0.0",
    port: positiveInteger(env.PORT, 8081),
    dataDir,
    audiverisCommand: env.AUDIVERIS_COMMAND || "/opt/audiveris/bin/Audiveris",
    audiverisVersion: env.AUDIVERIS_VERSION || "5.11.0",
    ocrLanguageFile: env.OCR_LANGUAGE_FILE || "/usr/share/tesseract-ocr/5/tessdata/eng.traineddata",
    sourceUrl: env.SOURCE_URL || "https://github.com/Jonas-oa/Conversor-PDF-em-MusicXML",
    allowedOrigins: (env.ALLOWED_ORIGINS || "")
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
    maxUploadBytes: positiveInteger(env.MAX_UPLOAD_BYTES, 30 * 1024 * 1024),
    maxQueuedJobs: positiveInteger(env.MAX_QUEUED_JOBS, 20),
    concurrency: positiveInteger(env.OMR_CONCURRENCY, 1),
    jobTimeoutMs: positiveInteger(env.OMR_JOB_TIMEOUT_MS, 10 * 60 * 1000),
    jobTtlMs: positiveInteger(env.OMR_JOB_TTL_MS, 24 * 60 * 60 * 1000),
  });
}
