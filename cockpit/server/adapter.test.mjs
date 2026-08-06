import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  AdapterError,
  buildCliInvocation,
  parseKeychainSecretStore,
  projectSafeAgents,
  readState,
  redactSecretText,
  runBuzzOperation,
  selectAgentDraftCredentials,
  validateState,
  withTempAttachments,
  writeState,
} from "./adapter.mjs";

const CHANNEL = "11111111-2222-3333-4444-555555555555";
const EVENT = "a".repeat(64);
const PUBKEY = "b".repeat(64);

test("CLI operation allowlist builds arrays and keeps message content on stdin", () => {
  const invocation = buildCliInvocation("messages:send", {
    channelId: CHANNEL,
    content: "`touch /tmp/nope` && $(whoami)",
    replyTo: EVENT,
    mentions: [PUBKEY],
    files: ["/tmp/cockpit-file"],
  });
  assert.deepEqual(invocation.args.slice(0, 6), [
    "--format",
    "json",
    "messages",
    "send",
    "--channel",
    CHANNEL,
  ]);
  assert.equal(invocation.stdin, "`touch /tmp/nope` && $(whoami)");
  assert.equal(invocation.args.includes(invocation.stdin), false);
  assert.throws(
    () => buildCliInvocation("shell:run", { command: "rm -rf /" }),
    (error) =>
      error instanceof AdapterError && error.code === "OPERATION_NOT_ALLOWED",
  );
});

test("CLI validation rejects invalid route values and limits", () => {
  assert.deepEqual(
    buildCliInvocation("feed:get", { limit: "120" }).args.slice(-2),
    ["--limit", "50"],
  );
  assert.throws(() =>
    buildCliInvocation("messages:get", { channelId: "../../etc/passwd" }),
  );
  assert.throws(() =>
    buildCliInvocation("messages:thread", {
      channelId: CHANNEL,
      event: "not-an-event",
    }),
  );
  assert.throws(() => buildCliInvocation("feed:get", { limit: "501" }));
  assert.deepEqual(
    buildCliInvocation("messages:search", {
      query: "checkout",
      author: "Honey",
      since: "1",
      limit: "20",
    }).args.slice(2),
    [
      "messages",
      "search",
      "--query",
      "checkout",
      "--author",
      "Honey",
      "--since",
      "1",
      "--limit",
      "20",
    ],
  );
  assert.throws(() => buildCliInvocation("messages:search", {}));
  assert.deepEqual(
    buildCliInvocation("channels:get", { channelId: CHANNEL }).args.slice(2),
    ["channels", "get", "--channel", CHANNEL],
  );
});

test("state validation rejects unsafe keys and oversized payloads", () => {
  const dangerous = JSON.parse('{"projects":[],"__proto__":{"polluted":true}}');
  assert.throws(() => validateState(dangerous), /not allowed/);
  assert.throws(
    () => validateState({ text: "x".repeat(1024 * 1024) }),
    (error) =>
      error instanceof AdapterError && error.code === "STATE_TOO_LARGE",
  );
});

test("state round-trips atomically and has a useful missing-file default", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "buzz-state-test-"));
  const file = path.join(directory, "nested", "state.json");
  try {
    assert.deepEqual(await readState(file), {
      version: 1,
      projects: [],
      missions: [],
      ui: {},
    });
    const state = {
      version: 1,
      projects: [{ id: "p1" }],
      missions: [],
      ui: {},
    };
    assert.deepEqual(await writeState(file, state), state);
    assert.deepEqual(JSON.parse(await readFile(file, "utf8")), state);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("temporary base64 attachments are removed after the callback", async () => {
  let captured;
  const result = await withTempAttachments(
    [{ name: "brief.txt", data: Buffer.from("hello").toString("base64") }],
    async (files) => {
      captured = files[0];
      assert.equal(await readFile(files[0], "utf8"), "hello");
      return "sent";
    },
  );
  assert.equal(result, "sent");
  await assert.rejects(readFile(captured), { code: "ENOENT" });
});

test("keychain parsing and error redaction never expose the identity", () => {
  const secret = `nsec1${"q".repeat(58)}`;
  assert.equal(
    parseKeychainSecretStore(JSON.stringify({ identity: secret })),
    secret,
  );
  const redacted = redactSecretText(
    `BUZZ_PRIVATE_KEY=${secret} {"identity":"${secret}"}`,
    [secret],
  );
  assert.equal(redacted.includes(secret), false);
  assert.match(redacted, /REDACTED/);
});

test("draft-update uses only the selected agent credential in its subprocess", async () => {
  const agentSecret = "agent-private-key";
  const agentAuth = '["auth","owner","","signature"]';
  const ownerSecret = "owner-private-key";
  const ownerAuth = "owner-auth-tag";
  const seen = [];
  const runtime = {
    cliPath: "/fake/buzz",
    relayUrl: "https://relay.example",
    privateKey: ownerSecret,
    authTag: ownerAuth,
    resolveDraftCredentials: async () => ({
      privateKey: agentSecret,
      authTag: agentAuth,
    }),
    executeCli: async (input) => {
      seen.push(input);
      return { accepted: true };
    },
  };

  await runBuzzOperation(
    "agents:draft-update",
    { channelId: CHANNEL, agentName: "Honey", model: "gpt-5.6-sol" },
    runtime,
  );
  await runBuzzOperation("channels:list", {}, runtime);

  assert.equal(seen[0].env.BUZZ_PRIVATE_KEY, agentSecret);
  assert.equal(seen[0].env.BUZZ_AUTH_TAG, agentAuth);
  assert.deepEqual(seen[0].secrets, [agentSecret, agentAuth]);
  assert.equal(seen[1].env.BUZZ_PRIVATE_KEY, ownerSecret);
  assert.equal(seen[1].env.BUZZ_AUTH_TAG, ownerAuth);
  assert.deepEqual(seen[1].secrets, [ownerSecret, ownerAuth]);
});

test("draft credential selection fails closed when auth tag or Keychain secret is absent", () => {
  const record = {
    name: "Honey",
    pubkey: PUBKEY,
    auth_tag: '["auth","owner","","signature"]',
  };
  assert.deepEqual(
    selectAgentDraftCredentials(
      [record],
      { [`agent:${PUBKEY}`]: "agent-secret" },
      "Honey",
    ),
    { privateKey: "agent-secret", authTag: record.auth_tag },
  );
  assert.throws(
    () => selectAgentDraftCredentials([record], {}, "Honey"),
    (error) =>
      error instanceof AdapterError &&
      error.code === "CLI_ERROR" &&
      error.status === 401,
  );
  assert.throws(
    () =>
      selectAgentDraftCredentials(
        [{ ...record, auth_tag: null }],
        { [`agent:${PUBKEY}`]: "agent-secret" },
        "Honey",
      ),
    (error) =>
      error instanceof AdapterError &&
      error.code === "CLI_ERROR" &&
      error.status === 401,
  );
});

test("agent projection exposes only roster fields and removes definitions", () => {
  const agents = projectSafeAgents([
    {
      name: "Honey",
      display_name: "Honey",
      slug: "honey",
      pubkey: PUBKEY,
      model: "gpt",
      runtime: "codex",
      is_active: true,
      system_prompt: "private profession memory",
      auth_tag: ["auth", "secret"],
      agent_command: "secret-command",
    },
    { name: "Honey", slug: "honey", pubkey: "", system_prompt: "duplicate" },
  ]);
  assert.equal(agents.length, 1);
  assert.equal(agents[0].displayName, "Honey");
  assert.equal(agents[0].isActive, true);
  assert.equal("system_prompt" in agents[0], false);
  assert.equal("auth_tag" in agents[0], false);
  assert.equal("agent_command" in agents[0], false);
});
