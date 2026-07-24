import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createApp } from "../src/app.mjs";
import { loadConfig } from "../src/config.mjs";

const XML = '<?xml version="1.0"?><score-partwise version="4.0"><part-list/><part id="P1"><measure number="1"><note><pitch><step>A</step><octave>4</octave></pitch><duration>1</duration></note></measure></part></score-partwise>';

async function fixture(t, overrides = {}) {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "partitura-omr-test-"));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const config = {
    ...loadConfig({
      OMR_DATA_DIR: dataDir,
      ALLOWED_ORIGINS: "https://app.example.test",
      SOURCE_URL: "https://example.test/source",
    }),
    ...overrides,
  };
  const runner = async () => ({
    xml: XML,
    engine: "Audiveris test",
    metrics: { parts: 1, measures: 1, notes: 1, pitchedNotes: 1, rests: 0 },
    warnings: [],
  });
  const app = await createApp({ config, runner });
  await app.ready();
  t.after(() => app.close());
  return app;
}

function multipartPdf(boundary = "test-boundary") {
  return {
    boundary,
    body: Buffer.from([
      `--${boundary}\r\n`,
      'Content-Disposition: form-data; name="score"; filename="teste.pdf"\r\n',
      "Content-Type: application/pdf\r\n\r\n",
      "%PDF-1.7\nconteudo de teste\n",
      `\r\n--${boundary}--\r\n`,
    ].join("")),
  };
}

async function waitForCompletion(app, id) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const response = await app.inject({ method: "GET", url: `/v1/jobs/${id}` });
    const job = response.json();
    if (["completed", "failed"].includes(job.status)) return job;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("trabalho não terminou no teste");
}

test("aceita PDF, processa em fila e devolve MusicXML", async (t) => {
  const app = await fixture(t);
  const upload = multipartPdf();
  const response = await app.inject({
    method: "POST",
    url: "/v1/jobs",
    headers: {
      origin: "https://app.example.test",
      "content-type": `multipart/form-data; boundary=${upload.boundary}`,
    },
    payload: upload.body,
  });
  assert.equal(response.statusCode, 202);
  const created = response.json();
  const completed = await waitForCompletion(app, created.id);
  assert.equal(completed.status, "completed");
  assert.equal(completed.metrics.notes, 1);

  const result = await app.inject({ method: "GET", url: `/v1/jobs/${created.id}/result` });
  assert.equal(result.statusCode, 200);
  assert.match(result.body, /score-partwise/);
  assert.doesNotMatch(JSON.stringify(completed), /teste\.pdf/);
});

test("recusa conteúdo que apenas finge ser PDF", async (t) => {
  const app = await fixture(t);
  const upload = multipartPdf();
  upload.body = Buffer.from(upload.body.toString().replace("%PDF-", "HTML!"));
  const response = await app.inject({
    method: "POST",
    url: "/v1/jobs",
    headers: { "content-type": `multipart/form-data; boundary=${upload.boundary}` },
    payload: upload.body,
  });
  assert.equal(response.statusCode, 415);
  assert.equal(response.json().error.code, "INVALID_PDF");
});

test("expõe saúde e endereço do código-fonte", async (t) => {
  const app = await fixture(t);
  const response = await app.inject({ method: "GET", url: "/health" });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().sourceUrl, "https://example.test/source");
});
