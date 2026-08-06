import assert from "node:assert/strict";
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
          const text = Buffer.concat(chunks).toString("utf8");
          resolve({
            status: response.statusCode,
            body: text ? JSON.parse(text) : null,
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
