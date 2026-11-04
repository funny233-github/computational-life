#!/usr/bin/env node
// Minimal static server with the COOP/COEP headers that unlock SharedArrayBuffer
// (and therefore multi-core soups). ES modules and SharedArrayBuffer both need
// http(s), so file:// cannot run the built site at all.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve("dist");
const port = Number(process.env.PORT ?? 5173);
// localhost by default; HOST=0.0.0.0 if you really want the LAN to see it
const host = process.env.HOST ?? "127.0.0.1";

const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".png": "image/png",
  ".wasm": "application/wasm",
  ".svg": "image/svg+xml",
};

// every response carries these: a 404 for a worker script would otherwise be
// a cross-origin-isolation hole in the console rather than a clean failure
const headers = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Cache-Control": "no-store",
};

function fail(res, code, text) {
  res.writeHead(code, { ...headers, "Content-Type": "text/plain; charset=utf-8" }).end(text);
}

/** map a URL path to a file under dist/, or null if it escapes the root */
function resolve(url) {
  if (url.includes("\0")) return null;
  const rel = url === "/" ? "index.html" : url.replace(/^\/+/, "");
  const file = path.resolve(root, rel);
  const inside = path.relative(root, file);
  if (!inside || inside.startsWith("..") || path.isAbsolute(inside)) return null;
  return file;
}

http
  .createServer((req, res) => {
    let url;
    try {
      // a malformed escape ("/%ZZ") throws; it must not take the process down
      url = decodeURIComponent((req.url ?? "/").split("?")[0]);
    } catch {
      fail(res, 400, "bad request");
      return;
    }
    const file = resolve(url);
    if (!file) {
      fail(res, 403, "nope");
      return;
    }
    fs.readFile(file, (err, data) => {
      if (err) {
        fail(res, 404, "not found");
        return;
      }
      res.writeHead(200, {
        ...headers,
        "Content-Type": types[path.extname(file)] ?? "application/octet-stream",
      });
      res.end(data);
    });
  })
  .listen(port, host, () => {
    console.log(`BFF 世界  http://${host}:${port}/   （多核模式）`);
    console.log(`file:// 打不开：ES module 与 SharedArrayBuffer 都需要 http(s)。`);
    if (host === "127.0.0.1" || host === "localhost") {
      console.log(`要从别的机器访问：HOST=0.0.0.0 npm run play`);
    }
  });
