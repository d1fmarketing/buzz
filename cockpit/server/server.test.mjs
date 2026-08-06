import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createCockpitServer } from "./server.mjs";

const CHANNEL = "11111111-2222-3333-4444-555555555555";

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return server.address().port;
}

async function request(port, pathname, options = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port, path: pathname, ...options },
      (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => {
          const raw = Buffer.concat(chunks);
          const text = raw.toString("utf8");
          const contentType = response.headers["content-type"] ?? "";
          resolve({
            status: response.statusCode,
            body:
              raw.length === 0
                ? null
                : contentType.startsWith("application/json")
                  ? JSON.parse(text)
                  : raw,
            headers: response.headers,
          });
        });
      },
    );
    req.once("error", reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

test("health redacts configuration and API routes dispatch fixed operations", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "buzz-server-test-"));
  const agentsPath = path.join(directory, "agents.json");
  await writeFile(agentsPath, "[]");
  const calls = [];
  const runtime = {
    cliPath: "/fake/buzz",
    relayUrl: "https://relay.example",
    privateKey: "super-secret-private-key",
    agentsPath,
    statePath: path.join(directory, "state.json"),
    resolveDraftCredentials: async () => ({
      privateKey: "agent-secret",
      authTag: "agent-auth",
    }),
    runOperation: async (operation, input) => {
      calls.push({ operation, input });
      return [{ ok: true }];
    },
  };
  const server = await createCockpitServer({ rootDir: directory, runtime });
  const port = await listen(server);
  try {
    const health = await request(port, "/api/health");
    assert.equal(health.status, 200);
    assert.deepEqual(health.body, {
      ok: true,
      cliAvailable: true,
      relayConfigured: true,
      authenticated: true,
    });
    assert.equal(
      JSON.stringify(health.body).includes(runtime.privateKey),
      false,
    );

    const messages = await request(
      port,
      `/api/channels/${CHANNEL}/messages?limit=20&since=1`,
    );
    assert.equal(messages.status, 200);
    assert.deepEqual(calls[0], {
      operation: "messages:get",
      input: { channelId: CHANNEL, limit: "20", since: "1", before: undefined },
    });

    const search = await request(
      port,
      "/api/messages/search?query=checkout&author=Honey&limit=10",
    );
    assert.equal(search.status, 200);
    assert.deepEqual(calls[1], {
      operation: "messages:search",
      input: {
        query: "checkout",
        author: "Honey",
        since: undefined,
        limit: "10",
      },
    });

    const channel = await request(port, `/api/channels/${CHANNEL}`);
    assert.equal(channel.status, 200);
    assert.deepEqual(calls[2], {
      operation: "channels:get",
      input: { channelId: CHANNEL },
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});

test("message endpoint passes decoded files to the fixed send operation and cleans them", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "buzz-message-test-"));
  const agentsPath = path.join(directory, "agents.json");
  await writeFile(agentsPath, "[]");
  let temporaryFile;
  const runtime = {
    cliPath: "/fake/buzz",
    relayUrl: "https://relay.example",
    privateKey: "secret",
    agentsPath,
    statePath: path.join(directory, "state.json"),
    resolveDraftCredentials: async () => ({
      privateKey: "agent-secret",
      authTag: "agent-auth",
    }),
    runOperation: async (operation, input) => {
      assert.equal(operation, "messages:send");
      temporaryFile = input.files[0];
      assert.ok(temporaryFile.startsWith(tmpdir()));
      return { accepted: true };
    },
  };
  const server = await createCockpitServer({ rootDir: directory, runtime });
  const port = await listen(server);
  try {
    const payload = JSON.stringify({
      channelId: CHANNEL,
      content: "hello",
      attachments: [
        { name: "note.txt", data: Buffer.from("note").toString("base64") },
      ],
    });
    const result = await request(port, "/api/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": Buffer.byteLength(payload),
      },
      body: payload,
    });
    assert.equal(result.status, 200);
    assert.deepEqual(result.body, { accepted: true });
    await assert.rejects(readFileForTest(temporaryFile), { code: "ENOENT" });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});

async function readFileForTest(file) {
  const { readFile } = await import("node:fs/promises");
  return readFile(file);
}

test("media GET and HEAD return verified bytes through the fixed Buzz CLI path", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "buzz-media-test-"));
  const bytes = Buffer.from("generated image bytes");
  const hash = createHash("sha256").update(bytes).digest("hex");
  const filename = `${hash}.png`;
  const invocations = [];
  const runtime = {
    cliPath: "/fake/buzz",
    relayUrl: "https://relay.example",
    privateKey: "owner-private-key",
    authTag: "owner-auth-tag",
    agentsPath: path.join(directory, "agents.json"),
    statePath: path.join(directory, "state.json"),
    executeCliBytes: async (input) => {
      invocations.push(input);
      return bytes;
    },
  };
  const server = await createCockpitServer({ rootDir: directory, runtime });
  const port = await listen(server);
  try {
    const get = await request(port, `/api/media/${filename}`);
    assert.equal(get.status, 200);
    assert.deepEqual(get.body, bytes);
    assert.equal(get.headers["content-type"], "image/png");
    assert.equal(get.headers["content-length"], String(bytes.length));
    assert.equal(
      get.headers["cache-control"],
      "private, max-age=31536000, immutable",
    );
    assert.equal(get.headers["cross-origin-resource-policy"], "same-origin");
    assert.deepEqual(invocations[0].args, ["media", "get", filename]);
    assert.equal(invocations[0].env.BUZZ_PRIVATE_KEY, runtime.privateKey);
    assert.equal(invocations[0].env.BUZZ_AUTH_TAG, runtime.authTag);

    const head = await request(port, `/api/media/${filename}`, {
      method: "HEAD",
    });
    assert.equal(head.status, 200);
    assert.equal(head.body, null);
    assert.equal(head.headers["content-type"], "image/png");
    assert.equal(head.headers["content-length"], String(bytes.length));
    assert.equal(invocations.length, 2);

    const unknown = await request(port, `/api/media/${hash}.html`);
    assert.equal(unknown.status, 200);
    assert.equal(unknown.headers["content-type"], "application/octet-stream");

    const invalid = await request(port, `/api/media/${hash}.png%2Fextra`);
    assert.equal(invalid.status, 400);
    assert.equal(invalid.body.error.code, "INVALID_REQUEST");
    assert.equal(invocations.length, 3);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});
