import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { execFile } from "node:child_process";

const execFileAsync = promisify(execFile);

export const DEFAULT_PORT = 4317;
export const MAX_STATE_BYTES = 1024 * 1024;
export const MAX_ATTACHMENTS_BYTES = 25 * 1024 * 1024;
export const MAX_MESSAGE_BODY_BYTES = 36 * 1024 * 1024;
export const MAX_MEDIA_BYTES = 25 * 1024 * 1024;

const DEFAULT_STATE = Object.freeze({
  version: 1,
  projects: [],
  missions: [],
  ui: {},
});

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEX_64_RE = /^[0-9a-f]{64}$/i;
const MEDIA_FILENAME_RE = /^([0-9a-f]{64})\.([a-z0-9]{1,8})$/;
const BASE64_RE =
  /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const DANGEROUS_STATE_KEYS = new Set(["__proto__", "prototype", "constructor"]);

export class AdapterError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = "AdapterError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function badRequest(message, details) {
  throw new AdapterError(400, "INVALID_REQUEST", message, details);
}

async function isExecutable(candidate) {
  if (!candidate) return false;
  try {
    await access(candidate, fsConstants.X_OK);
    return (await stat(candidate)).isFile();
  } catch {
    return false;
  }
}

/** Resolve the existing Buzz CLI without downloading or building anything. */
export async function resolveCliPath(env = process.env) {
  const explicit = env.BUZZ_CLI_PATH?.trim();
  if (explicit) return (await isExecutable(explicit)) ? explicit : null;

  const installed = "/Applications/Buzz.app/Contents/MacOS/buzz";
  if (await isExecutable(installed)) return installed;

  for (const directory of (env.PATH ?? "").split(path.delimiter)) {
    if (!directory) continue;
    const candidate = path.join(directory, "buzz");
    if (await isExecutable(candidate)) return candidate;
  }
  return null;
}

export async function resolveManagedAgentsPath(env = process.env) {
  const explicit = env.BUZZ_COCKPIT_AGENTS_PATH?.trim();
  if (explicit) return explicit;

  const base = path.join(
    homedir(),
    "Library",
    "Application Support",
    "xyz.block.buzz.app",
  );
  const candidates = [
    path.join(base, "agents", "managed-agents.json"),
    path.join(base, "managed-agents.json"),
  ];
  for (const candidate of candidates) {
    try {
      if ((await stat(candidate)).isFile()) return candidate;
    } catch {
      // Try the next known Buzz Desktop location.
    }
  }
  return candidates[0];
}

export function resolveStatePath(env = process.env) {
  const explicit = env.BUZZ_COCKPIT_STATE_PATH?.trim();
  if (explicit) return explicit;
  return path.join(
    homedir(),
    "Library",
    "Application Support",
    "xyz.block.buzz.cockpit",
    "state.json",
  );
}

function agentRecords(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") {
    for (const key of ["agents", "managed_agents", "managedAgents"]) {
      if (Array.isArray(value[key])) return value[key];
    }
  }
  return [];
}

export function normalizeRelayUrl(value) {
  if (typeof value !== "string" || value.trim() === "") return null;
  let candidate = value.trim();
  if (candidate.startsWith("wss://"))
    candidate = `https://${candidate.slice(6)}`;
  if (candidate.startsWith("ws://")) candidate = `http://${candidate.slice(5)}`;
  try {
    const parsed = new URL(candidate);
    if (!new Set(["http:", "https:"]).has(parsed.protocol)) return null;
    if (parsed.username || parsed.password) return null;
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

export async function resolveRelayUrl({ env = process.env, agentsPath } = {}) {
  const explicit = env.BUZZ_COCKPIT_RELAY_URL?.trim();
  if (explicit) return normalizeRelayUrl(explicit);

  const filePath = agentsPath ?? (await resolveManagedAgentsPath(env));
  try {
    const parsed = JSON.parse(await readFile(filePath, "utf8"));
    for (const record of agentRecords(parsed)) {
      const relay = normalizeRelayUrl(record?.relay_url);
      if (relay) return relay;
    }
  } catch {
    return null;
  }
  return null;
}

export function parseKeychainSecretStore(raw) {
  const parsed = parseKeychainSecretStoreObject(raw);
  const identity = parsed.identity;
  if (typeof identity !== "string" || identity.trim() === "") {
    throw new AdapterError(
      500,
      "IDENTITY_UNAVAILABLE",
      "Buzz identity is unavailable",
    );
  }
  return identity.trim();
}

export function parseKeychainSecretStoreObject(raw) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new AdapterError(
      500,
      "IDENTITY_UNAVAILABLE",
      "Buzz identity is unavailable",
    );
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new AdapterError(
      500,
      "IDENTITY_UNAVAILABLE",
      "Buzz identity is unavailable",
    );
  }
  return parsed;
}

async function readKeychainSecretStore() {
  try {
    const { stdout } = await execFileAsync(
      "/usr/bin/security",
      ["find-generic-password", "-s", "buzz-desktop", "-a", "secrets", "-w"],
      { encoding: "utf8", maxBuffer: 2 * 1024 * 1024 },
    );
    return parseKeychainSecretStoreObject(stdout);
  } catch (error) {
    if (error instanceof AdapterError) throw error;
    throw new AdapterError(
      500,
      "IDENTITY_UNAVAILABLE",
      "Buzz identity is unavailable",
    );
  }
}

/** Read the same owner identity used by Buzz Desktop; callers must keep it private. */
export async function resolveOwnerIdentity(env = process.env) {
  const explicit = env.BUZZ_PRIVATE_KEY?.trim();
  if (explicit) return explicit;

  const store = await readKeychainSecretStore();
  const identity = store.identity;
  if (typeof identity !== "string" || identity.trim() === "") {
    throw new AdapterError(
      500,
      "IDENTITY_UNAVAILABLE",
      "Buzz identity is unavailable",
    );
  }
  return identity.trim();
}

function draftCredentialError() {
  return new AdapterError(
    401,
    "CLI_ERROR",
    "agent draft requests require an existing managed-agent credential",
    { category: "auth", exitCode: 3 },
  );
}

export function selectAgentDraftCredentials(
  recordsValue,
  secretStore,
  agentName,
) {
  if (typeof agentName !== "string" || agentName.trim() === "")
    throw draftCredentialError();
  const needle = agentName.trim().toLocaleLowerCase("en-US");
  const concrete = agentRecords(recordsValue).filter(
    (record) =>
      record &&
      typeof record === "object" &&
      HEX_64_RE.test(record.pubkey ?? ""),
  );
  const matches = (field) =>
    concrete.filter(
      (record) =>
        typeof record[field] === "string" &&
        record[field].trim().toLocaleLowerCase("en-US") === needle,
    );
  const candidates =
    matches("name").length > 0
      ? matches("name")
      : matches("display_name").length > 0
        ? matches("display_name")
        : matches("slug");
  if (candidates.length !== 1) throw draftCredentialError();

  const record = candidates[0];
  const authTag =
    typeof record.auth_tag === "string" ? record.auth_tag.trim() : "";
  const privateKey = secretStore?.[`agent:${record.pubkey.toLowerCase()}`];
  if (!authTag || typeof privateKey !== "string" || privateKey.trim() === "") {
    throw draftCredentialError();
  }
  return { privateKey: privateKey.trim(), authTag };
}

/** Resolve credentials only for the selected managed agent's review request. */
export async function resolveAgentDraftCredentials({ agentsPath, agentName }) {
  let records;
  let secrets;
  try {
    [records, secrets] = await Promise.all([
      readFile(agentsPath, "utf8").then(JSON.parse),
      readKeychainSecretStore(),
    ]);
  } catch {
    throw draftCredentialError();
  }
  return selectAgentDraftCredentials(records, secrets, agentName);
}

export function redactSecretText(value, secrets = []) {
  let text = typeof value === "string" ? value : String(value ?? "");
  for (const secret of secrets) {
    if (typeof secret === "string" && secret.length > 0) {
      text = text.split(secret).join("[REDACTED]");
    }
  }
  return text
    .replace(/nsec1[023456789ac-hj-np-z]{20,}/gi, "[REDACTED]")
    .replace(/(BUZZ_PRIVATE_KEY\s*[:=]\s*)\S+/gi, "$1[REDACTED]")
    .replace(/("identity"\s*:\s*)"[^"]+"/gi, '$1"[REDACTED]"');
}

function requireString(value, field, { min = 1, max = 65_536 } = {}) {
  if (typeof value !== "string") badRequest(`${field} must be a string`);
  const size = Buffer.byteLength(value, "utf8");
  if (size < min || size > max) {
    badRequest(`${field} must be between ${min} and ${max} UTF-8 bytes`);
  }
  return value;
}

export function requireUuid(value, field = "channelId") {
  const string = requireString(value, field, { min: 36, max: 36 });
  if (!UUID_RE.test(string)) badRequest(`${field} must be a UUID`);
  return string;
}

export function requireEventId(value, field = "event") {
  const string = requireString(value, field, { min: 64, max: 64 });
  if (!HEX_64_RE.test(string))
    badRequest(`${field} must be a 64-character hex event id`);
  return string.toLowerCase();
}

/** Accept only a lowercase Blossom content hash followed by one safe extension. */
export function validateMediaFilename(value) {
  const filename = requireString(value, "media filename", {
    min: 66,
    max: 73,
  });
  const match = MEDIA_FILENAME_RE.exec(filename);
  if (!match) {
    badRequest(
      "media filename must be a lowercase sha256 followed by one file extension",
    );
  }
  return { filename, sha256: match[1], extension: match[2] };
}

/** Build the one binary-output CLI command exposed by the media route. */
export function buildMediaCliInvocation(value) {
  const { filename } = validateMediaFilename(value);
  return { args: ["media", "get", filename] };
}

function optionalInteger(
  value,
  field,
  { min = 0, max = Number.MAX_SAFE_INTEGER } = {},
) {
  if (value === undefined || value === null || value === "") return undefined;
  const text = String(value);
  if (!/^-?\d+$/.test(text)) badRequest(`${field} must be an integer`);
  const number = Number(text);
  if (!Number.isSafeInteger(number) || number < min || number > max) {
    badRequest(`${field} must be between ${min} and ${max}`);
  }
  return number;
}

function appendOption(args, name, value) {
  if (value !== undefined && value !== null) args.push(name, String(value));
}

function validateMentions(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 50) {
    badRequest("mentions must be an array with at most 50 pubkeys");
  }
  return [
    ...new Set(
      value.map((mention, index) =>
        requireEventId(mention, `mentions[${index}]`),
      ),
    ),
  ];
}

function validateInternalFiles(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) badRequest("files must be an array");
  return value.map((file, index) => {
    if (
      typeof file !== "string" ||
      !path.isAbsolute(file) ||
      file.includes("\0")
    ) {
      badRequest(`files[${index}] is invalid`);
    }
    return file;
  });
}

/**
 * Build one of the fixed Buzz CLI invocations. There is intentionally no raw
 * command escape hatch: HTTP input can only fill validated flag values.
 */
export function buildCliInvocation(operation, input = {}) {
  const args = ["--format", "json"];
  let stdin;

  switch (operation) {
    case "channels:list": {
      args.push("channels", "list", "--member", "--limit", "500");
      break;
    }
    case "channels:get": {
      args.push("channels", "get", "--channel", requireUuid(input.channelId));
      break;
    }
    case "channels:search": {
      args.push(
        "channels",
        "search",
        "--query",
        requireString(input.query, "query", { min: 1, max: 200 }),
        "--exact",
        "--include-archived",
        "--limit",
        "1000",
      );
      break;
    }
    case "channels:members": {
      args.push(
        "channels",
        "members",
        "--channel",
        requireUuid(input.channelId),
      );
      break;
    }
    case "messages:get": {
      const limit = optionalInteger(input.limit, "limit", { min: 1, max: 200 });
      const since = optionalInteger(input.since, "since");
      const before = optionalInteger(input.before, "before");
      args.push("messages", "get", "--channel", requireUuid(input.channelId));
      appendOption(args, "--limit", limit);
      appendOption(args, "--since", since);
      appendOption(args, "--before", before);
      args.push("--kinds", "9,40002,40003,40008,45001,45003");
      break;
    }
    case "messages:thread": {
      args.push(
        "messages",
        "thread",
        "--channel",
        requireUuid(input.channelId),
        "--event",
        requireEventId(input.event),
        "--limit",
        "500",
      );
      break;
    }
    case "messages:search": {
      const query =
        input.query === undefined
          ? undefined
          : requireString(input.query, "query", { min: 1, max: 1_000 });
      const author =
        input.author === undefined
          ? undefined
          : requireString(input.author, "author", { min: 1, max: 200 });
      if (!query && !author) badRequest("query or author is required");
      const since = optionalInteger(input.since, "since");
      const limit = optionalInteger(input.limit, "limit", { min: 1, max: 100 });
      args.push("messages", "search");
      appendOption(args, "--query", query);
      appendOption(args, "--author", author);
      appendOption(args, "--since", since);
      appendOption(args, "--limit", limit);
      break;
    }
    case "feed:get": {
      const since = optionalInteger(input.since, "since");
      const requestedLimit = optionalInteger(input.limit, "limit", {
        min: 1,
        max: 500,
      });
      const limit =
        requestedLimit === undefined ? undefined : Math.min(requestedLimit, 50);
      args.push("feed", "get");
      appendOption(args, "--since", since);
      appendOption(args, "--limit", limit);
      break;
    }
    case "users:presence": {
      const values =
        typeof input.pubkeys === "string"
          ? input.pubkeys.split(",")
          : input.pubkeys;
      if (
        !Array.isArray(values) ||
        values.length === 0 ||
        values.length > 100
      ) {
        badRequest("pubkeys must contain between 1 and 100 pubkeys");
      }
      const pubkeys = [
        ...new Set(
          values.map((value, index) =>
            requireEventId(value.trim(), `pubkeys[${index}]`),
          ),
        ),
      ];
      args.push("users", "presence", "--pubkeys", pubkeys.join(","));
      break;
    }
    case "messages:send": {
      const channelId = requireUuid(input.channelId);
      const mentions = validateMentions(input.mentions);
      const files = validateInternalFiles(input.files);
      const content = typeof input.content === "string" ? input.content : "";
      if (Buffer.byteLength(content, "utf8") > 65_536) {
        badRequest("content must be at most 65536 UTF-8 bytes");
      }
      if (content.length === 0 && files.length === 0) {
        badRequest("content or at least one attachment is required");
      }
      args.push("messages", "send", "--channel", channelId, "--content", "-");
      if (input.replyTo !== undefined) {
        args.push("--reply-to", requireEventId(input.replyTo, "replyTo"));
      }
      for (const mention of mentions) args.push("--mention", mention);
      for (const file of files) args.push("--file", file);
      stdin = content;
      break;
    }
    case "agents:draft-update": {
      const channelId = requireUuid(input.channelId);
      const agentName = requireString(input.agentName, "agentName", {
        min: 1,
        max: 200,
      });
      const optionNames = [
        "displayName",
        "systemPrompt",
        "runtime",
        "provider",
        "model",
        "respondTo",
      ];
      if (!optionNames.some((name) => input[name] !== undefined)) {
        badRequest("at least one agent update field is required");
      }
      args.push(
        "agents",
        "draft-update",
        "--channel",
        channelId,
        "--agent-name",
        agentName,
      );
      if (input.displayName !== undefined) {
        args.push(
          "--display-name",
          requireString(input.displayName, "displayName", { min: 1, max: 200 }),
        );
      }
      if (input.systemPrompt !== undefined) {
        stdin = requireString(input.systemPrompt, "systemPrompt", {
          min: 1,
          max: 65_536,
        });
        args.push("--system-prompt", "-");
      }
      for (const [field, flag] of [
        ["runtime", "--runtime"],
        ["provider", "--provider"],
        ["model", "--model"],
      ]) {
        if (input[field] !== undefined) {
          args.push(
            flag,
            requireString(input[field], field, { min: 1, max: 200 }),
          );
        }
      }
      if (input.respondTo !== undefined) {
        if (!new Set(["owner-only", "anyone"]).has(input.respondTo)) {
          badRequest("respondTo must be owner-only or anyone");
        }
        args.push("--respond-to", input.respondTo);
      }
      break;
    }
    default:
      throw new AdapterError(
        404,
        "OPERATION_NOT_ALLOWED",
        "Operation is not allowed",
      );
  }

  return { args, stdin };
}

function parseCliOutput(stdout) {
  const trimmed = stdout.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    const lines = trimmed.split(/\r?\n/).filter(Boolean);
    try {
      return JSON.parse(lines.at(-1));
    } catch {
      throw new AdapterError(
        502,
        "CLI_INVALID_JSON",
        "Buzz CLI returned invalid JSON",
      );
    }
  }
}

function cliStatus(exitCode) {
  if (exitCode === 1) return 400;
  if (exitCode === 2) return 502;
  if (exitCode === 3) return 401;
  if (exitCode === 5) return 409;
  return 500;
}

export function executeCli({
  cliPath,
  args,
  stdin,
  env,
  secrets = [],
  timeoutMs = 120_000,
}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cliPath, args, {
      env,
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const stdout = [];
    const stderr = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let outputTooLarge = false;

    const timer = setTimeout(() => child.kill("SIGTERM"), timeoutMs);
    timer.unref();

    child.stdout.on("data", (chunk) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > 16 * 1024 * 1024) {
        outputTooLarge = true;
        child.kill("SIGTERM");
        return;
      }
      stdout.push(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderrBytes += chunk.length;
      if (stderrBytes > 2 * 1024 * 1024) {
        outputTooLarge = true;
        child.kill("SIGTERM");
        return;
      }
      stderr.push(chunk);
    });
    child.once("error", () => {
      clearTimeout(timer);
      reject(
        new AdapterError(
          502,
          "CLI_UNAVAILABLE",
          "Buzz CLI could not be started",
        ),
      );
    });
    child.once("close", (code, signal) => {
      clearTimeout(timer);
      if (outputTooLarge) {
        reject(
          new AdapterError(
            502,
            "CLI_OUTPUT_TOO_LARGE",
            "Buzz CLI output exceeded the limit",
          ),
        );
        return;
      }
      const cleanOut = redactSecretText(
        Buffer.concat(stdout).toString("utf8"),
        secrets,
      );
      const cleanErr = redactSecretText(
        Buffer.concat(stderr).toString("utf8"),
        secrets,
      );
      if (code !== 0) {
        let parsed;
        try {
          parsed = JSON.parse(cleanErr.trim());
        } catch {
          parsed = null;
        }
        const message =
          parsed?.message ||
          cleanErr.trim() ||
          `Buzz CLI exited with ${signal ?? code}`;
        reject(
          new AdapterError(cliStatus(code), "CLI_ERROR", message, {
            category: parsed?.error ?? "cli",
            exitCode: code,
          }),
        );
        return;
      }
      try {
        resolve(parseCliOutput(cleanOut));
      } catch (error) {
        reject(error);
      }
    });

    child.stdin.end(stdin ?? "");
  });
}

/** Execute the fixed media command while preserving stdout as bytes. */
export function executeCliBytes({
  cliPath,
  args,
  env,
  secrets = [],
  maxBytes = MAX_MEDIA_BYTES,
  timeoutMs = 120_000,
}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cliPath, args, {
      env,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout = [];
    const stderr = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let outputTooLarge = false;

    const timer = setTimeout(() => child.kill("SIGTERM"), timeoutMs);
    timer.unref();

    child.stdout.on("data", (chunk) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > maxBytes) {
        outputTooLarge = true;
        child.kill("SIGTERM");
        return;
      }
      stdout.push(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderrBytes += chunk.length;
      if (stderrBytes > 2 * 1024 * 1024) {
        outputTooLarge = true;
        child.kill("SIGTERM");
        return;
      }
      stderr.push(chunk);
    });
    child.once("error", () => {
      clearTimeout(timer);
      reject(
        new AdapterError(
          502,
          "CLI_UNAVAILABLE",
          "Buzz CLI could not be started",
        ),
      );
    });
    child.once("close", (code, signal) => {
      clearTimeout(timer);
      if (outputTooLarge) {
        reject(
          new AdapterError(
            413,
            "MEDIA_TOO_LARGE",
            "Buzz media exceeds the 25 MB response limit",
          ),
        );
        return;
      }
      const cleanErr = redactSecretText(
        Buffer.concat(stderr).toString("utf8"),
        secrets,
      );
      if (code !== 0) {
        let parsed;
        try {
          parsed = JSON.parse(cleanErr.trim());
        } catch {
          parsed = null;
        }
        const message =
          parsed?.message ||
          cleanErr.trim() ||
          `Buzz CLI exited with ${signal ?? code}`;
        reject(
          new AdapterError(cliStatus(code), "CLI_ERROR", message, {
            category: parsed?.error ?? "cli",
            exitCode: code,
          }),
        );
        return;
      }
      resolve(Buffer.concat(stdout));
    });
  });
}

export async function runBuzzOperation(operation, input, runtime) {
  if (!runtime.cliPath) {
    throw new AdapterError(503, "CLI_UNAVAILABLE", "Buzz CLI is unavailable");
  }
  if (!runtime.relayUrl) {
    throw new AdapterError(
      503,
      "RELAY_UNAVAILABLE",
      "Buzz relay is not configured",
    );
  }
  const invocation = buildCliInvocation(operation, input);
  let privateKey = runtime.privateKey;
  let authTag = runtime.authTag;
  if (operation === "agents:draft-update") {
    if (typeof runtime.resolveDraftCredentials !== "function")
      throw draftCredentialError();
    const draftCredentials = await runtime.resolveDraftCredentials(
      input.agentName,
    );
    privateKey = draftCredentials.privateKey;
    authTag = draftCredentials.authTag;
  }
  if (!privateKey) {
    throw new AdapterError(
      503,
      "IDENTITY_UNAVAILABLE",
      "Buzz identity is unavailable",
    );
  }

  const childEnv = {
    ...process.env,
    BUZZ_RELAY_URL: runtime.relayUrl,
    BUZZ_PRIVATE_KEY: privateKey,
  };
  if (authTag) childEnv.BUZZ_AUTH_TAG = authTag;
  else delete childEnv.BUZZ_AUTH_TAG;

  const execute = runtime.executeCli ?? executeCli;
  return execute({
    cliPath: runtime.cliPath,
    ...invocation,
    env: childEnv,
    secrets: [privateKey, authTag].filter(Boolean),
  });
}

/** Download one content-addressed relay blob with the existing owner identity. */
export async function runBuzzMedia(value, runtime) {
  if (!runtime.cliPath) {
    throw new AdapterError(503, "CLI_UNAVAILABLE", "Buzz CLI is unavailable");
  }
  if (!runtime.relayUrl) {
    throw new AdapterError(
      503,
      "RELAY_UNAVAILABLE",
      "Buzz relay is not configured",
    );
  }
  if (!runtime.privateKey) {
    throw new AdapterError(
      503,
      "IDENTITY_UNAVAILABLE",
      "Buzz identity is unavailable",
    );
  }

  const descriptor = validateMediaFilename(value);
  const invocation = buildMediaCliInvocation(descriptor.filename);
  const childEnv = {
    ...process.env,
    BUZZ_RELAY_URL: runtime.relayUrl,
    BUZZ_PRIVATE_KEY: runtime.privateKey,
  };
  if (runtime.authTag) childEnv.BUZZ_AUTH_TAG = runtime.authTag;
  else delete childEnv.BUZZ_AUTH_TAG;

  const execute = runtime.executeCliBytes ?? executeCliBytes;
  const bytes = await execute({
    cliPath: runtime.cliPath,
    ...invocation,
    env: childEnv,
    secrets: [runtime.privateKey, runtime.authTag].filter(Boolean),
    maxBytes: MAX_MEDIA_BYTES,
  });
  if (!Buffer.isBuffer(bytes) || bytes.length > MAX_MEDIA_BYTES) {
    throw new AdapterError(
      502,
      "CLI_INVALID_MEDIA",
      "Buzz CLI returned invalid media bytes",
    );
  }
  const actualHash = createHash("sha256").update(bytes).digest("hex");
  if (actualHash !== descriptor.sha256) {
    throw new AdapterError(
      502,
      "MEDIA_HASH_MISMATCH",
      "Buzz media did not match its content hash",
    );
  }
  return bytes;
}

function decodeAttachment(attachment, index) {
  if (
    !attachment ||
    typeof attachment !== "object" ||
    Array.isArray(attachment)
  ) {
    badRequest(`attachments[${index}] must be an object`);
  }
  const name = requireString(attachment.name, `attachments[${index}].name`, {
    min: 1,
    max: 255,
  });
  if (
    name !== path.basename(name) ||
    name.includes("/") ||
    name.includes("\\") ||
    name.includes("\0") ||
    name === "." ||
    name === ".."
  ) {
    badRequest(`attachments[${index}].name is invalid`);
  }
  const data = requireString(attachment.data, `attachments[${index}].data`, {
    min: 0,
    max: Math.ceil((MAX_ATTACHMENTS_BYTES * 4) / 3) + 4,
  });
  if (data.length % 4 !== 0 || !BASE64_RE.test(data)) {
    badRequest(`attachments[${index}].data must be canonical base64`);
  }
  const buffer = Buffer.from(data, "base64");
  if (buffer.toString("base64") !== data) {
    badRequest(`attachments[${index}].data must be canonical base64`);
  }
  return { name, buffer };
}

export async function withTempAttachments(attachments, callback) {
  if (attachments === undefined) return callback([]);
  if (!Array.isArray(attachments) || attachments.length > 20) {
    badRequest("attachments must be an array with at most 20 files");
  }
  const decoded = attachments.map(decodeAttachment);
  const total = decoded.reduce(
    (sum, attachment) => sum + attachment.buffer.length,
    0,
  );
  if (total > MAX_ATTACHMENTS_BYTES) {
    throw new AdapterError(
      413,
      "ATTACHMENTS_TOO_LARGE",
      "Attachments exceed the 25 MB total limit",
    );
  }
  if (decoded.length === 0) return callback([]);

  const directory = await mkdtemp(path.join(tmpdir(), "buzz-cockpit-"));
  try {
    const files = [];
    for (const [index, attachment] of decoded.entries()) {
      const file = path.join(
        directory,
        `${String(index).padStart(2, "0")}-${attachment.name}`,
      );
      await writeFile(file, attachment.buffer, { mode: 0o600 });
      files.push(file);
    }
    return await callback(files);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function validateStateNode(value, depth, budget) {
  if (depth > 20) badRequest("state nesting exceeds 20 levels");
  budget.nodes += 1;
  if (budget.nodes > 50_000) badRequest("state contains too many values");

  if (value === null || typeof value === "boolean" || typeof value === "string")
    return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) badRequest("state numbers must be finite");
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) validateStateNode(item, depth + 1, budget);
    return;
  }
  if (typeof value !== "object")
    badRequest("state must contain JSON values only");
  for (const [key, child] of Object.entries(value)) {
    if (DANGEROUS_STATE_KEYS.has(key))
      badRequest(`state key ${key} is not allowed`);
    validateStateNode(child, depth + 1, budget);
  }
}

export function validateState(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    badRequest("state must be a JSON object");
  }
  const serialized = JSON.stringify(value);
  if (Buffer.byteLength(serialized, "utf8") > MAX_STATE_BYTES) {
    throw new AdapterError(
      413,
      "STATE_TOO_LARGE",
      "State exceeds the 1 MB limit",
    );
  }
  validateStateNode(value, 0, { nodes: 0 });
  return value;
}

export async function readState(filePath) {
  try {
    return validateState(JSON.parse(await readFile(filePath, "utf8")));
  } catch (error) {
    if (error?.code === "ENOENT") return structuredClone(DEFAULT_STATE);
    if (error instanceof AdapterError) throw error;
    throw new AdapterError(
      500,
      "STATE_INVALID",
      "Saved cockpit state is invalid",
    );
  }
}

export async function writeState(filePath, value) {
  validateState(value);
  await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temporary = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`,
  );
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await rename(temporary, filePath);
  } finally {
    await rm(temporary, { force: true });
  }
  return value;
}

function optionalSafeString(value, max = 1_000) {
  if (typeof value !== "string" || value === "") return null;
  return redactSecretText(value).slice(0, max);
}

export function projectSafeAgents(value) {
  const records = agentRecords(value).filter(
    (record) => record && typeof record === "object",
  );
  const concrete = records.filter((record) =>
    HEX_64_RE.test(record.pubkey ?? ""),
  );
  const source = concrete.length > 0 ? concrete : records;
  const seen = new Set();
  const result = [];

  for (const record of source) {
    const identity =
      record.pubkey || record.slug || record.name || record.display_name;
    if (!identity || seen.has(identity)) continue;
    seen.add(identity);
    result.push({
      pubkey: HEX_64_RE.test(record.pubkey ?? "")
        ? record.pubkey.toLowerCase()
        : null,
      name: optionalSafeString(record.name, 200),
      displayName: optionalSafeString(record.display_name, 200),
      slug: optionalSafeString(record.slug, 200),
      avatarUrl: optionalSafeString(record.avatar_url, 2_000),
      model: optionalSafeString(record.model, 200),
      provider: optionalSafeString(record.provider, 200),
      runtime: optionalSafeString(record.runtime, 200),
      relayUrl: normalizeRelayUrl(record.relay_url),
      isActive: record.is_active === true,
      isBuiltin: record.is_builtin === true,
      isRunning: Number.isInteger(record.runtime_pid) && record.runtime_pid > 0,
      respondTo: new Set(["owner-only", "anyone", "allowlist"]).has(
        record.respond_to,
      )
        ? record.respond_to
        : null,
      lastStartedAt: optionalSafeString(record.last_started_at, 100),
      lastStoppedAt: optionalSafeString(record.last_stopped_at, 100),
      lastExitCode: Number.isInteger(record.last_exit_code)
        ? record.last_exit_code
        : null,
      lastError: optionalSafeString(record.last_error, 1_000),
      updatedAt: optionalSafeString(record.updated_at, 100),
    });
  }
  return result;
}

export async function readSafeAgents(filePath) {
  try {
    return projectSafeAgents(JSON.parse(await readFile(filePath, "utf8")));
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw new AdapterError(
      500,
      "AGENTS_INVALID",
      "Buzz managed agents file is invalid",
    );
  }
}
