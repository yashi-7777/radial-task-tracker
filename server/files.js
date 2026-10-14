"use strict";
const path = require("path");
const { Worker } = require("worker_threads");

const TYPES = {
  pdf: "PDF", xlsx: "Excel (.xlsx)", xls: "Excel (.xls)", docx: "Word (.docx)", csv: "CSV", tsv: "TSV", txt: "Text", md: "Markdown", text: "Text"
};
const HELP = "Supported: PDF (text-based), Excel (.xlsx, .xls), Word (.docx), CSV, TXT, MD.";
let active = 0;
const MAX_ACTIVE = 3;
const TIMEOUT_MS = 30000;

class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const startsWith = (buf, bytes) => bytes.every((b, i) => buf[i] === b);

// Decide the file type from its name AND content, so a renamed file cannot slip through.
function detectType(fileName, buf) {
  const ext = path.extname(fileName || "").slice(1).toLowerCase();
  if (!ext) throw new ApiError(415, "unsupported_type", `The file has no extension. ${HELP}`);
  if (["doc", "ppt", "pptx", "rtf", "odt", "pages", "key", "numbers", "jpg", "jpeg", "png", "gif", "heic", "webp", "zip", "rar"].includes(ext)) {
    const hint = ext === "doc" || ext === "odt" || ext === "rtf" || ext === "pages" ? " Save it as .docx or PDF first." : ext.match(/jpe?g|png|gif|heic|webp/) ? " Images are not supported (no OCR). Type or paste the syllabus text instead." : "";
    throw new ApiError(415, "unsupported_type", `.${ext} files are not supported.${hint} ${HELP}`);
  }
  if (!TYPES[ext]) throw new ApiError(415, "unsupported_type", `.${ext} files are not supported. ${HELP}`);
  const isPdf = buf.slice(0, 1024).includes("%PDF-");
  const isZip = startsWith(buf, [0x50, 0x4b, 0x03, 0x04]);
  const isOle = startsWith(buf, [0xd0, 0xcf, 0x11, 0xe0]);
  const bad = () => new ApiError(422, "invalid_file", `This file's contents do not match its .${ext} extension.`);
  if (ext === "pdf") { if (!isPdf) throw bad(); }
  else if (ext === "xlsx" || ext === "docx") { if (!isZip) throw bad(); }
  else if (ext === "xls") { if (!isOle) throw bad(); }
  else {
    if (isPdf || isZip || isOle) throw bad();
    if (buf.slice(0, 8192).includes(0)) throw bad();
  }
  return ext === "text" ? "txt" : ext;
}

function parseFile(type, buf) {
  if (active >= MAX_ACTIVE) return Promise.reject(new ApiError(429, "busy", "The server is busy parsing other files. Try again in a few seconds."));
  active++;
  return new Promise((resolve, reject) => {
    const data = new Uint8Array(buf);
    const w = new Worker(path.join(__dirname, "parse-worker.js"), {
      workerData: { type, data },
      resourceLimits: { maxOldGenerationSizeMb: 768, maxYoungGenerationSizeMb: 64 }
    });
    let settled = false;
    const done = (fn, v) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      active--;
      w.terminate();
      fn(v);
    };
    const timer = setTimeout(() => done(reject, new ApiError(422, "parse_timeout", "Reading this file took too long. Try a smaller or simpler file.")), TIMEOUT_MS);
    w.once("message", (m) => (m.ok ? done(resolve, m.result) : done(reject, new ApiError(422, m.code, m.message))));
    w.once("error", () => done(reject, new ApiError(422, "parse_failed", "This file could not be read. It may be corrupted or too complex.")));
    w.once("exit", () => done(reject, new ApiError(422, "parse_failed", "This file could not be read.")));
  });
}

module.exports = { detectType, parseFile, ApiError, TYPES, HELP };
