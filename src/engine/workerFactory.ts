/**
 * Vite's inline worker is a `data:` URL, and a worker created from one has an
 * opaque origin — `postMessage` refuses to hand it a SharedArrayBuffer. The
 * same source wrapped in a `blob:` URL inherits this page's origin, so the
 * SharedArrayBuffer can be shared and the workers can run in parallel.
 *
 * Falls back to the plain constructor whenever anything looks different
 * (dev server, non-inline build, exotic CSP).
 */
export function sameOriginWorker(Ctor: new () => Worker): Worker {
  const url = captureUrl(Ctor);
  if (!url || !url.startsWith("data:")) return new Ctor();
  try {
    const comma = url.indexOf(",");
    const src = url.startsWith("data:text/javascript;base64,") || url.includes(";base64,")
      ? atob(url.slice(comma + 1))
      : decodeURIComponent(url.slice(comma + 1));
    const blobUrl = URL.createObjectURL(new Blob([src], { type: "text/javascript" }));
    return new Worker(blobUrl, { type: "module" });
  } catch {
    return new Ctor();
  }
}

/** what URL would this worker constructor use? (no worker is actually started) */
function captureUrl(Ctor: new () => Worker): string | null {
  const g = globalThis as unknown as { Worker?: typeof Worker };
  const real = g.Worker;
  if (typeof real !== "function") return null;
  let url: string | null = null;
  try {
    g.Worker = function (u: string | URL) {
      url = String(u);
      return { terminate() {}, postMessage() {}, set onerror(_v: unknown) {}, set onmessage(_v: unknown) {} };
    } as unknown as typeof Worker;
    new Ctor();
  } catch {
    /* ignore: we only wanted the URL */
  } finally {
    g.Worker = real;
  }
  return url;
}
