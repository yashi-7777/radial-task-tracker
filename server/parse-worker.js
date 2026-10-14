"use strict";
// Runs inside a worker thread so a malformed or hostile file can only hang/crash this thread:
// the parent enforces a timeout and a memory limit, and any prototype pollution stays inside the worker.
const { parentPort, workerData } = require("worker_threads");
const SP = require("../syllabus-parse.js");

const MAX_PAGES = 400;
const MAX_CHARS = 600000;
const MAX_ROWS = 5000;
const MAX_COLS = 40;

class ParseError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function pageToLines(items) {
  const rows = [];
  for (const it of items) {
    if (!it.str || !it.transform) continue;
    const y = it.transform[5];
    let row = rows.find((r) => Math.abs(r.y - y) < 2.5);
    if (!row) rows.push((row = { y, items: [] }));
    row.items.push({ x: it.transform[4], w: it.width || 0, s: it.str });
  }
  rows.sort((a, b) => b.y - a.y);
  const lines = rows.map((r) => {
    r.items.sort((a, b) => a.x - b.x);
    let line = "";
    let prevEnd = null;
    for (const i of r.items) {
      if (prevEnd != null && i.x - prevEnd > 1.5 && !line.endsWith(" ") && !i.s.startsWith(" ")) line += " ";
      line += i.s;
      prevEnd = i.x + i.w;
    }
    return { x: r.items[0] ? r.items[0].x : 0, text: line.replace(/\s+$/, "") };
  }).filter((l) => l.text.trim());
  const minX = Math.min(...lines.map((l) => l.x), 1e9);
  return lines.map((l) => " ".repeat(Math.min(12, Math.round((l.x - minX) / 6))) + l.text);
}

async function parsePdf(data) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  let doc;
  try {
    doc = await pdfjs.getDocument({ data: new Uint8Array(data), useSystemFonts: true, isEvalSupported: false, disableFontFace: true, verbosity: 0 }).promise;
  } catch (e) {
    if (e && e.name === "PasswordException") throw new ParseError("encrypted_pdf", "This PDF is password-protected. Remove the password and upload it again.");
    throw new ParseError("invalid_file", "This PDF could not be read. It may be corrupted.");
  }
  const pages = Math.min(doc.numPages, MAX_PAGES);
  const out = [];
  let chars = 0;
  for (let p = 1; p <= pages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const lines = pageToLines(content.items);
    chars += lines.join("").replace(/\s/g, "").length;
    out.push(lines.join("\n"));
    if (out.join("\n").length > MAX_CHARS) break;
  }
  await doc.destroy();
  if (chars < 30 * Math.max(1, out.length)) {
    throw new ParseError("scanned_pdf", "This PDF looks scanned (it is mostly images, with almost no selectable text). OCR is not supported. Upload a text-based PDF, an Excel/Word/TXT version, or paste the syllabus text.");
  }
  return { text: out.join("\n\n"), pages: doc.numPages, warnings: doc.numPages > MAX_PAGES ? [`Only the first ${MAX_PAGES} pages were read.`] : [] };
}

function parseSheets(data) {
  const XLSX = require("xlsx");
  const wb = XLSX.read(Buffer.from(data), { type: "buffer", cellDates: false, sheetRows: MAX_ROWS });
  const sheets = [];
  for (const name of wb.SheetNames.slice(0, 20)) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: false, defval: "", blankrows: false })
      .slice(0, MAX_ROWS).map((r) => r.slice(0, MAX_COLS).map((c) => String(c).slice(0, 500)));
    if (rows.some((r) => r.some((c) => String(c).trim()))) sheets.push({ name: String(name).slice(0, 60), rows });
  }
  if (!sheets.length) throw new ParseError("empty", "The spreadsheet has no data.");
  return { sheets, warnings: [] };
}

async function parseDocx(data) {
  const mammoth = require("mammoth");
  try {
    const r = await mammoth.extractRawText({ buffer: Buffer.from(data) });
    return { text: r.value.slice(0, MAX_CHARS), warnings: [] };
  } catch {
    throw new ParseError("invalid_file", "This Word file could not be read. Save it as .docx (not .doc) and try again.");
  }
}

function decodeText(data) {
  const buf = Buffer.from(data);
  let text = buf.toString("utf8");
  if (text.includes("�")) text = buf.toString("latin1");
  return text.replace(/^﻿/, "").slice(0, MAX_CHARS);
}

(async () => {
  try {
    const { type, data } = workerData;
    let result;
    if (type === "pdf") result = await parsePdf(data);
    else if (type === "xlsx" || type === "xls") result = parseSheets(data);
    else if (type === "docx") result = await parseDocx(data);
    else if (type === "csv" || type === "tsv") {
      const rows = SP.parseDelimited(decodeText(data), type === "tsv" ? "\t" : ",").slice(0, MAX_ROWS).map((r) => r.slice(0, MAX_COLS));
      if (!rows.some((r) => r.some((c) => c.trim()))) throw new ParseError("empty", "The file has no data.");
      result = { sheets: [{ name: "Sheet1", rows }], warnings: [] };
    } else result = { text: decodeText(data), warnings: [] };
    if (result.text !== undefined && !result.text.trim()) throw new ParseError("empty", "No text could be read from this file.");
    parentPort.postMessage({ ok: true, result });
  } catch (e) {
    parentPort.postMessage({ ok: false, code: e.code || "parse_failed", message: e.code ? e.message : "This file could not be read." });
  }
})();
