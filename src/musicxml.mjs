import { unzipSync, strFromU8 } from "fflate";
import { XMLParser, XMLValidator } from "fast-xml-parser";

function asArray(value) {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function findMusicXmlEntry(entries) {
  const preferred = Object.keys(entries).find((name) => /\.musicxml$/i.test(name));
  return preferred || Object.keys(entries).find((name) => /\.xml$/i.test(name) && !/META-INF\//i.test(name));
}

export function unpackMusicXml(mxlBytes) {
  let entries;
  try {
    entries = unzipSync(new Uint8Array(mxlBytes));
  } catch (error) {
    throw new Error(`O arquivo MXL gerado está corrompido: ${error.message}`);
  }
  const entry = findMusicXmlEntry(entries);
  if (!entry) throw new Error("O MXL gerado não contém um documento MusicXML.");
  return strFromU8(entries[entry]);
}

export function validateMusicXml(xml) {
  const syntax = XMLValidator.validate(xml);
  if (syntax !== true) {
    throw new Error(`MusicXML malformado: ${syntax.err?.msg || "erro de sintaxe"}.`);
  }
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    parseTagValue: false,
    trimValues: true,
  });
  const document_ = parser.parse(xml);
  const root = document_["score-partwise"] || document_["score-timewise"];
  if (!root) throw new Error("O resultado não possui raiz score-partwise ou score-timewise.");

  const parts = asArray(root.part);
  let measures = 0;
  let notes = 0;
  let pitchedNotes = 0;
  let rests = 0;
  let incompleteMeasures = 0;

  for (const part of parts) {
    for (const measure of asArray(part.measure)) {
      measures += 1;
      const measureNotes = asArray(measure.note);
      notes += measureNotes.length;
      for (const note of measureNotes) {
        if (note.rest != null) rests += 1;
        else if (note.pitch != null || note.unpitched != null) pitchedNotes += 1;
      }
      if (!measureNotes.length) incompleteMeasures += 1;
    }
  }

  const warnings = [];
  if (!parts.length) warnings.push("Nenhuma parte musical foi identificada.");
  if (!measures) warnings.push("Nenhum compasso foi identificado.");
  if (!pitchedNotes) warnings.push("Nenhuma nota com altura foi identificada.");
  if (incompleteMeasures) warnings.push(`${incompleteMeasures} compasso(s) sem notas ou pausas precisam de revisão.`);
  if (!parts.length || !measures || !pitchedNotes) {
    throw new Error(warnings.join(" "));
  }

  return {
    metrics: { parts: parts.length, measures, notes, pitchedNotes, rests },
    warnings,
  };
}
