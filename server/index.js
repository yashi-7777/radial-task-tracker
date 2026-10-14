"use strict";
// Zero-framework server: serves the static app, parses uploaded syllabi, and proxies AI calls so API keys never reach the browser.
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { detectType, parseFile, ApiError, TYPES } = require("./files.js");
const ai = require("./ai.js");

const ROOT = path.join(__dirname, "..");
const STATIC = {
  "/": "index.html", "/index.html": "index.html", "/app.js": "app.js", "/pages.js": "pages.js", "/study.js": "study.js", "/study-setup.js": "study-setup.js", "/study-plan.js": "study-plan.js", "/study-chat.js": "study-chat.js",
  "/planner.js": "planner.js", "/syllabus-parse.js": "syllabus-parse.js", "/styles.css": "styles.css", "/study.css": "study.css"
};
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8" };

function loadDotEnv(file) {
  try {
    fs.readFileSync(file, "utf8").split(/\r?\n/).forEach((line) => {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, "$2");
    });
  } catch { /* no .env file */ }
}

function configFromEnv(env = process.env) {
  return {
    port: Number(env.PORT) || 8787,
    host: env.HOST || "0.0.0.0",
    apiKey: (env.ANTHROPIC_API_KEY || "").trim(),
    model: env.ANTHROPIC_MODEL || "claude-sonnet-5-5",
    base: env.ANTHROPIC_API_BASE || "https://api.anthropic.com",
    allowedOrigins: (env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean),
    accessToken: (env.ACCESS_TOKEN || "").trim(),
    maxUploadBytes: Math.round((Number(env.MAX_UPLOAD_MB) || 10) * 1024 * 1024),
    aiLimit: Number(env.AI_LIMIT_PER_10MIN) || 30,
    parseLimit: Number(env.PARSE_LIMIT_PER_10MIN) || 60,
    trustProxy: env.TRUST_PROXY === "1",
    serveStatic: env.SERVE_STATIC !== "0",
    timeoutMs: Number(env.AI_TIMEOUT_MS) || 120000
  };
}

function createServer(userCfg = {}) {
  const cfg = { ...configFromEnv({}), ...userCfg };
  const hits = new Map();

  const limited = (ip, bucket, max) => {
    const key = `${bucket}:${ip}`;
    const now = Date.now();
    const list = (hits.get(key) || []).filter((t) => now - t < 600000);
    if (list.length >= max) {
      hits.set(key, list);
      return true;
    }
    list.push(now);
    hits.set(key, list);
    return false;
  };
  const sweep = setInterval(() => { const now = Date.now(); hits.forEach((v, k) => { if (!v.some((t) => now - t < 600000)) hits.delete(k); }); }, 300000);
  sweep.unref();

  const clientIp = (req) => (cfg.trustProxy && req.headers["x-forwarded-for"] ? String(req.headers["x-forwarded-for"]).split(",")[0].trim() : req.socket.remoteAddress) || "?";

  function originAllowed(req) {
    const origin = req.headers.origin;
    if (!origin) return true;
    if (cfg.allowedOrigins.includes("*") || cfg.allowedOrigins.includes(origin)) return true;
    try { return new URL(origin).host === req.headers.host; } catch { return false; }
  }

  function cors(req, res) {
    const origin = req.headers.origin;
    if (origin && originAllowed(req)) {
      res.setHeader("Access-Control-Allow-Origin", cfg.allowedOrigins.includes("*") ? "*" : origin);
      res.setHeader("Vary", "Origin");
      res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type, X-Filename");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.setHeader("Access-Control-Max-Age", "600");
    }
  }

  const send = (res, status, obj) => {
    const body = JSON.stringify(obj);
    res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
    res.end(body);
  };
  const fail = (res, e) => {
    if (e instanceof ApiError) return send(res, e.status, { error: { code: e.code, message: e.message } });
    console.error("Unhandled error:", e && e.message);
    return send(res, 500, { error: { code: "server_error", message: "Something went wrong on the server." } });
  };

  function readBody(req, limit) {
    return new Promise((resolve, reject) => {
      const len = Number(req.headers["content-length"]);
      if (len > limit) return reject(new ApiError(413, "too_large", `That is too large. The limit is ${Math.round(limit / 1048576)} MB.`));
      const chunks = [];
      let size = 0;
      req.on("data", (c) => {
        size += c.length;
        if (size > limit) {
          reject(new ApiError(413, "too_large", `That is too large. The limit is ${Math.round(limit / 1048576)} MB.`));
          req.destroy();
          return;
        }
        chunks.push(c);
      });
      req.on("end", () => resolve(Buffer.concat(chunks)));
      req.on("error", () => reject(new ApiError(400, "bad_request", "The upload was interrupted.")));
    });
  }

  const readJson = async (req, limit = 700 * 1024) => {
    const buf = await readBody(req, limit);
    try { return JSON.parse(buf.toString("utf8")); } catch { throw new ApiError(400, "bad_request", "Invalid JSON."); }
  };

  function authorized(req) {
    if (!cfg.accessToken) return true;
    const m = String(req.headers.authorization || "").match(/^Bearer\s+(.+)$/i);
    if (!m) return false;
    const a = crypto.createHash("sha256").update(m[1]).digest();
    const b = crypto.createHash("sha256").update(cfg.accessToken).digest();
    return crypto.timingSafeEqual(a, b);
  }

  const aiCfg = () => ({ apiKey: cfg.apiKey, model: cfg.model, base: cfg.base, timeoutMs: cfg.timeoutMs });

  async function handleApi(req, res, pathname) {
    cors(req, res);
    if (!originAllowed(req)) throw new ApiError(403, "origin_not_allowed", "This site is not allowed to use this server. Add its origin to ALLOWED_ORIGINS.");
    if (req.method === "OPTIONS") { res.writeHead(204); return res.end(); }

    if (pathname === "/api/status" && req.method === "GET") {
      return send(res, 200, {
        ok: true,
        ai: { configured: !!cfg.apiKey, model: cfg.apiKey ? cfg.model : null },
        authRequired: !!cfg.accessToken,
        authorized: authorized(req),
        parse: { formats: Object.keys(TYPES).filter((k) => k !== "text"), maxBytes: cfg.maxUploadBytes }
      });
    }
    if (!authorized(req)) throw new ApiError(401, "unauthorized", "This server needs an access token. Enter it in the planner's connection settings.");
    const ip = clientIp(req);

    if (pathname === "/api/parse" && req.method === "POST") {
      if (limited(ip, "parse", cfg.parseLimit)) throw new ApiError(429, "rate_limited", "Too many uploads. Try again in a few minutes.");
      let name = "";
      try { name = decodeURIComponent(String(req.headers["x-filename"] || "")); } catch { /* ignore */ }
      name = path.basename(name).slice(0, 200);
      const buf = await readBody(req, cfg.maxUploadBytes);
      if (!buf.length) throw new ApiError(422, "empty", "The file is empty.");
      const type = detectType(name, buf);
      const result = await parseFile(type, buf);
      return send(res, 200, { fileName: name, type, ...result });
    }
    if (pathname === "/api/analyze" && req.method === "POST") {
      if (limited(ip, "ai", cfg.aiLimit)) throw new ApiError(429, "rate_limited", "Too many AI requests. Try again in a few minutes.");
      const body = await readJson(req);
      return send(res, 200, await ai.analyze(aiCfg(), { text: body.text, fileName: body.fileName }));
    }
    if (pathname === "/api/chat" && req.method === "POST") {
      if (limited(ip, "ai", cfg.aiLimit)) throw new ApiError(429, "rate_limited", "Too many AI requests. Try again in a few minutes.");
      const body = await readJson(req);
      return send(res, 200, await ai.chat(aiCfg(), body));
    }
    throw new ApiError(404, "not_found", "Unknown endpoint.");
  }

  const server = http.createServer(async (req, res) => {
    try {
      const pathname = new URL(req.url, "http://x").pathname;
      if (pathname.startsWith("/api/")) return await handleApi(req, res, pathname);
      if (cfg.serveStatic && (req.method === "GET" || req.method === "HEAD") && STATIC[pathname]) {
        const file = path.join(ROOT, STATIC[pathname]);
        const data = fs.readFileSync(file);
        res.writeHead(200, { "Content-Type": MIME[path.extname(file)], "Cache-Control": "no-cache", "X-Content-Type-Options": "nosniff" });
        return res.end(req.method === "HEAD" ? undefined : data);
      }
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not found");
    } catch (e) {
      if (!res.headersSent) fail(res, e);
      else res.end();
    }
  });
  server.requestTimeout = 180000;
  return server;
}

if (require.main === module) {
  loadDotEnv(path.join(ROOT, ".env"));
  const cfg = configFromEnv();
  createServer(cfg).listen(cfg.port, cfg.host, () => {
    console.log(`Radial Task Tracker running at http://localhost:${cfg.port}`);
    console.log(cfg.apiKey ? `AI: enabled (model ${cfg.model})` : "AI: NOT configured. Set ANTHROPIC_API_KEY in .env to enable AI analysis and the assistant.");
    if (!cfg.accessToken && cfg.allowedOrigins.includes("*")) console.warn("Warning: ALLOWED_ORIGINS=* with no ACCESS_TOKEN lets anyone spend your API credits. Set ACCESS_TOKEN.");
  });
}

module.exports = { createServer, configFromEnv };
