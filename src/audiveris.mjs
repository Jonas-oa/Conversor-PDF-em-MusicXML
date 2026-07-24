import { spawn } from "node:child_process";
import { copyFile, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { unpackMusicXml, validateMusicXml } from "./musicxml.mjs";

function runProcess(command, args, { cwd, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const runtimeHome = path.join(cwd, "audiveris-home");
    const child = spawn(command, args, {
      cwd,
      env: {
        ...process.env,
        XDG_CACHE_HOME: path.join(runtimeHome, "cache"),
        XDG_CONFIG_HOME: path.join(runtimeHome, "config"),
        XDG_DATA_HOME: path.join(runtimeHome, "data"),
        JAVA_TOOL_OPTIONS: `${process.env.JAVA_TOOL_OPTIONS || ""} -Djava.awt.headless=true -Duser.home=${runtimeHome}`.trim(),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const append = (current, chunk) => (current + chunk.toString()).slice(-2_000_000);
    child.stdout.on("data", (chunk) => { stdout = append(stdout, chunk); });
    child.stderr.on("data", (chunk) => { stderr = append(stderr, chunk); });
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 3000).unref();
    }, timeoutMs);
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(new Error(`Audiveris não pôde ser iniciado: ${error.message}`));
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(
        signal
          ? `Audiveris excedeu o limite ou foi interrompido (${signal}).`
          : `Audiveris encerrou com código ${code}: ${stderr.slice(-1200)}`,
      ));
    });
  });
}

function summarizeWarnings(output) {
  const count = (pattern) => (output.match(pattern) || []).length;
  const warnings = [];
  const missingDurations = count(/No target duration/gi);
  const unlinkedSymbols = count(/No chord linked/gi);
  const uncertainKeys = count(/No effective key before/gi);
  const missingOcr = count(/Missing support for .* language/gi);
  if (missingDurations) {
    warnings.push(`A fórmula de compasso não foi confirmada automaticamente em ${missingDurations} sistema(s).`);
  }
  if (unlinkedSymbols) {
    warnings.push(`${unlinkedSymbols} símbolo(s) musical(is) não foram associados a uma nota e precisam de revisão.`);
  }
  if (uncertainKeys) {
    warnings.push(`${uncertainKeys} acidente(s) ou armadura(s) foram reconhecidos com contexto incerto.`);
  }
  if (missingOcr) {
    warnings.push("O reconhecimento dos textos da partitura não estava disponível.");
  }
  return warnings;
}

export function createAudiverisRunner(config) {
  return async function runAudiveris({ inputPath, outputDir, jobDir }) {
    const runtimeHome = path.join(jobDir, "audiveris-home");
    const tessdataDir = path.join(runtimeHome, "config", "AudiverisLtd", "audiveris", "tessdata");
    await mkdir(tessdataDir, { recursive: true });
    try {
      await copyFile(config.ocrLanguageFile, path.join(tessdataDir, "eng.traineddata"));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    const args = [
      "-batch",
      "-transcribe",
      "-export",
      "-save",
      "-swap",
      "-output",
      outputDir,
      "--",
      inputPath,
    ];
    const processResult = await runProcess(config.audiverisCommand, args, {
      cwd: jobDir,
      timeoutMs: config.jobTimeoutMs,
    });
    await writeFile(path.join(jobDir, "audiveris.log"), [
      processResult.stdout,
      processResult.stderr,
    ].join("\n"), "utf8");

    const files = await readdir(outputDir);
    const mxlName = files.find((name) => /\.mxl$/i.test(name));
    if (!mxlName) throw new Error("Audiveris terminou sem gerar um arquivo MXL.");
    const xml = unpackMusicXml(await readFile(path.join(outputDir, mxlName)));
    const audit = validateMusicXml(xml);
    const warnings = [
      ...audit.warnings,
      ...summarizeWarnings(`${processResult.stdout}\n${processResult.stderr}`),
    ];
    return {
      xml,
      metrics: audit.metrics,
      warnings,
      engine: `Audiveris ${config.audiverisVersion}`,
    };
  };
}
