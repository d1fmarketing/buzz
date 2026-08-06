import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import {
  AdapterError,
  MAX_MESSAGE_BODY_BYTES,
  MAX_STATE_BYTES,
  readSafeAgents,
  readState,
  runBuzzMedia,
  runBuzzOperation,
  withTempAttachments,
  writeState,
} from "./adapter.mjs";

const MIME_TYPES = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".ico", "image/x-icon"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".map", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".webp", "image/webp"],
  [".woff2", "font/woff2"],
]);

const MEDIA_MIME_TYPES = new Map([
  ["avif", "image/avif"],
  ["gif", "image/gif"],
  ["heic", "image/heic"],
  ["jpeg", "image/jpeg"],
  ["jpg", "image/jpeg"],
  ["png", "image/png"],
  ["webp", "image/webp"],
  ["m4v", "video/x-m4v"],
  ["mov", "video/quicktime"],
  ["mp4", "video/mp4"],
  ["webm", "video/webm"],
  ["m4a", "audio/mp4"],
  ["mp3", "audio/mpeg"],
  ["ogg", "audio/ogg"],
  ["wav", "audio/wav"],
  ["pdf", "application/pdf"],
]);

function setSecurityHeaders(response) {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("X-Frame-Options", "DENY");
}

export function sendJson(response, status, value) {
  const body = JSON.stringify(value);
  setSecurityHeaders(response);
  response.writeHead(status, {
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
  });
  response.end(body);
}

function sendMedia(response, method, filename, bytes) {
  const extension = filename.slice(filename.lastIndexOf(".") + 1);
  const contentType =
    MEDIA_MIME_TYPES.get(extension) ?? "application/octet-stream";
  setSecurityHeaders(response);
  response.writeHead(200, {
    "Cache-Control": "private, max-age=31536000, immutable",
    "Content-Disposition": `inline; filename="${filename}"`,
    "Content-Type": contentType,
    "Content-Length": bytes.length,
    "Cross-Origin-Resource-Policy": "same-origin",
  });
  if (method === "HEAD") response.end();
  else response.end(bytes);
}

function publicError(error) {
  if (error instanceof AdapterError) {
    return {
      status: error.status,
      body: {
        error: {
          code: error.code,
          message: error.message,
          ...(error.details === undefined ? {} : { details: error.details }),
        },
      },
    };
  }
  return {
    status: 500,
    body: {
      error: {
        code: "INTERNAL_ERROR",
        message: "Unexpected cockpit adapter error",
      },
    },
  };
}

async function readJson(request, maxBytes) {
  const contentType = request.headers["content-type"] ?? "";
  if (!contentType.toLowerCase().startsWith("application/json")) {
    throw new AdapterError(
      415,
      "CONTENT_TYPE",
      "Content-Type must be application/json",
    );
  }
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > maxBytes) {
      throw new AdapterError(
        413,
        "BODY_TOO_LARGE",
        "Request body exceeds the endpoint limit",
      );
    }
    chunks.push(chunk);
  }
  if (chunks.length === 0) {
    throw new AdapterError(
      400,
      "INVALID_JSON",
      "JSON request body is required",
    );
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new AdapterError(
      400,
      "INVALID_JSON",
      "Request body must be valid JSON",
    );
  }
}

function decodeRoutePart(value, label) {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new AdapterError(
      400,
      "INVALID_REQUEST",
      `${label} is not URL encoded correctly`,
    );
  }
}

function queryInput(url) {
  return {
    limit: url.searchParams.get("limit") ?? undefined,
    since: url.searchParams.get("since") ?? undefined,
    before: url.searchParams.get("before") ?? undefined,
  };
}

/** Handle only /api routes. Returns false when the UI handler should run. */
export async function handleApiRequest(request, response, runtime) {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  if (!url.pathname.startsWith("/api/")) return false;

  try {
    if (request.method === "GET" && url.pathname === "/api/health") {
      const value = {
        ok: Boolean(runtime.cliPath && runtime.relayUrl && runtime.privateKey),
        cliAvailable: Boolean(runtime.cliPath),
        relayConfigured: Boolean(runtime.relayUrl),
        authenticated: Boolean(runtime.privateKey),
      };
      sendJson(response, value.ok ? 200 : 503, value);
      return true;
    }

    if (request.method === "GET" && url.pathname === "/api/channels") {
      sendJson(
        response,
        200,
        await runtime.runOperation("channels:list", {}, runtime),
      );
      return true;
    }

    if (request.method === "GET" && url.pathname === "/api/channels/search") {
      sendJson(
        response,
        200,
        await runtime.runOperation(
          "channels:search",
          { query: url.searchParams.get("query") ?? undefined },
          runtime,
        ),
      );
      return true;
    }

    if (request.method === "GET" && url.pathname === "/api/messages/search") {
      sendJson(
        response,
        200,
        await runtime.runOperation(
          "messages:search",
          {
            query: url.searchParams.get("query") ?? undefined,
            author: url.searchParams.get("author") ?? undefined,
            since: url.searchParams.get("since") ?? undefined,
            limit: url.searchParams.get("limit") ?? undefined,
          },
          runtime,
        ),
      );
      return true;
    }

    let match = url.pathname.match(/^\/api\/channels\/([^/]+)\/members$/);
    if (request.method === "GET" && match) {
      const channelId = decodeRoutePart(match[1], "channel id");
      sendJson(
        response,
        200,
        await runtime.runOperation("channels:members", { channelId }, runtime),
      );
      return true;
    }

    match = url.pathname.match(/^\/api\/channels\/([^/]+)\/messages$/);
    if (request.method === "GET" && match) {
      const channelId = decodeRoutePart(match[1], "channel id");
      sendJson(
        response,
        200,
        await runtime.runOperation(
          "messages:get",
          { channelId, ...queryInput(url) },
          runtime,
        ),
      );
      return true;
    }

    match = url.pathname.match(/^\/api\/channels\/([^/]+)\/threads\/([^/]+)$/);
    if (request.method === "GET" && match) {
      const channelId = decodeRoutePart(match[1], "channel id");
      const event = decodeRoutePart(match[2], "event id");
      sendJson(
        response,
        200,
        await runtime.runOperation(
          "messages:thread",
          { channelId, event },
          runtime,
        ),
      );
      return true;
    }

    match = url.pathname.match(/^\/api\/channels\/([^/]+)$/);
    if (request.method === "GET" && match) {
      const channelId = decodeRoutePart(match[1], "channel id");
      sendJson(
        response,
        200,
        await runtime.runOperation("channels:get", { channelId }, runtime),
      );
      return true;
    }

    if (request.method === "GET" && url.pathname === "/api/feed") {
      sendJson(
        response,
        200,
        await runtime.runOperation("feed:get", queryInput(url), runtime),
      );
      return true;
    }

    if (request.method === "GET" && url.pathname === "/api/presence") {
      sendJson(
        response,
        200,
        await runtime.runOperation(
          "users:presence",
          { pubkeys: url.searchParams.get("pubkeys") ?? "" },
          runtime,
        ),
      );
      return true;
    }

    if (request.method === "GET" && url.pathname === "/api/agents") {
      sendJson(response, 200, await readSafeAgents(runtime.agentsPath));
      return true;
    }

    const mediaMatch = url.pathname.match(/^\/api\/media\/([^/]+)$/);
    if ((request.method === "GET" || request.method === "HEAD") && mediaMatch) {
      const filename = decodeRoutePart(mediaMatch[1], "media filename");
      const bytes = await runtime.runMedia(filename, runtime);
      sendMedia(response, request.method, filename, bytes);
      return true;
    }

    if (request.method === "GET" && url.pathname === "/api/state") {
      sendJson(response, 200, await readState(runtime.statePath));
      return true;
    }

    if (request.method === "PUT" && url.pathname === "/api/state") {
      const state = await readJson(request, MAX_STATE_BYTES);
      sendJson(response, 200, await writeState(runtime.statePath, state));
      return true;
    }

    if (request.method === "POST" && url.pathname === "/api/messages") {
      const body = await readJson(request, MAX_MESSAGE_BODY_BYTES);
      const result = await withTempAttachments(body?.attachments, (files) =>
        runtime.runOperation(
          "messages:send",
          { ...body, attachments: undefined, files },
          runtime,
        ),
      );
      sendJson(response, 200, result);
      return true;
    }

    if (
      request.method === "POST" &&
      url.pathname === "/api/agents/draft-update"
    ) {
      const body = await readJson(request, MAX_STATE_BYTES);
      sendJson(
        response,
        200,
        await runtime.runOperation("agents:draft-update", body, runtime),
      );
      return true;
    }

    sendJson(response, 404, {
      error: { code: "NOT_FOUND", message: "Cockpit API endpoint not found" },
    });
    return true;
  } catch (error) {
    const { status, body } = publicError(error);
    sendJson(response, status, body);
    return true;
  }
}

async function serveStatic(request, response, distDir) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    sendJson(response, 405, {
      error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" },
    });
    return;
  }

  let pathname;
  try {
    pathname = decodeURIComponent(
      new URL(request.url ?? "/", "http://127.0.0.1").pathname,
    );
  } catch {
    sendJson(response, 400, {
      error: { code: "INVALID_PATH", message: "Invalid request path" },
    });
    return;
  }
  if (pathname.includes("\0")) {
    sendJson(response, 400, {
      error: { code: "INVALID_PATH", message: "Invalid request path" },
    });
    return;
  }

  const root = path.resolve(distDir);
  const relative =
    pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  let candidate = path.resolve(root, relative);
  if (candidate !== root && !candidate.startsWith(`${root}${path.sep}`)) {
    sendJson(response, 404, {
      error: { code: "NOT_FOUND", message: "File not found" },
    });
    return;
  }

  try {
    if (!(await stat(candidate)).isFile()) throw new Error("not a file");
  } catch {
    candidate = path.join(root, "index.html");
    try {
      if (!(await stat(candidate)).isFile()) throw new Error("not a file");
    } catch {
      sendJson(response, 404, {
        error: { code: "UI_NOT_BUILT", message: "Cockpit UI is not built" },
      });
      return;
    }
  }

  const info = await stat(candidate);
  const contentType =
    MIME_TYPES.get(path.extname(candidate).toLowerCase()) ??
    "application/octet-stream";
  setSecurityHeaders(response);
  response.writeHead(200, {
    "Cache-Control":
      path.basename(candidate) === "index.html"
        ? "no-cache"
        : "public, max-age=31536000, immutable",
    "Content-Type": contentType,
    "Content-Length": info.size,
  });
  if (request.method === "HEAD") response.end();
  else createReadStream(candidate).pipe(response);
}

export async function createCockpitServer({
  rootDir,
  runtime,
  dev = false,
  viteFactory,
} = {}) {
  runtime.runOperation ??= runBuzzOperation;
  runtime.runMedia ??= runBuzzMedia;
  let vite;
  if (dev) {
    const createVite = viteFactory ?? (await import("vite")).createServer;
    vite = await createVite({
      root: rootDir,
      appType: "spa",
      server: { middlewareMode: true },
    });
  }

  const server = http.createServer(async (request, response) => {
    setSecurityHeaders(response);
    if (await handleApiRequest(request, response, runtime)) return;
    if (vite) {
      vite.middlewares(request, response, (error) => {
        if (error)
          sendJson(response, 500, {
            error: { code: "VITE_ERROR", message: "Vite middleware error" },
          });
      });
      return;
    }
    await serveStatic(request, response, path.join(rootDir, "dist"));
  });

  server.once("close", () => {
    void vite?.close();
  });
  return server;
}
