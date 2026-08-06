import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_PORT,
  resolveAgentDraftCredentials,
  resolveCliPath,
  resolveManagedAgentsPath,
  resolveOwnerIdentity,
  resolveRelayUrl,
  resolveStatePath,
  runBuzzOperation,
} from "./adapter.mjs";
import { createCockpitServer } from "./server.mjs";

const serverDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(serverDir, "..");

function parsePort(value) {
  if (value === undefined || value === "") return DEFAULT_PORT;
  if (!/^\d+$/.test(value)) return null;
  const port = Number(value);
  return Number.isInteger(port) && port >= 1 && port <= 65_535 ? port : null;
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  const dev = argv.includes("--dev");
  const port = parsePort(env.BUZZ_COCKPIT_PORT);
  if (port === null) {
    process.stderr.write(
      "BUZZ_COCKPIT_PORT must be an integer between 1 and 65535\n",
    );
    process.exitCode = 1;
    return;
  }

  const agentsPath = await resolveManagedAgentsPath(env);
  const [cliPath, relayUrl, privateKey] = await Promise.all([
    resolveCliPath(env),
    resolveRelayUrl({ env, agentsPath }),
    resolveOwnerIdentity(env).catch(() => null),
  ]);
  const runtime = {
    cliPath,
    relayUrl,
    privateKey,
    authTag: env.BUZZ_AUTH_TAG?.trim() || null,
    agentsPath,
    statePath: resolveStatePath(env),
    runOperation: runBuzzOperation,
    resolveDraftCredentials: (agentName) =>
      resolveAgentDraftCredentials({ agentsPath, agentName }),
  };

  const server = await createCockpitServer({ rootDir, runtime, dev });
  server.on("error", (error) => {
    process.stderr.write(
      `Buzz Cockpit failed to start: ${error.code ?? "server error"}\n`,
    );
    process.exitCode = 1;
  });
  server.listen(port, "127.0.0.1", () => {
    process.stdout.write(`Buzz Cockpit: http://127.0.0.1:${port}\n`);
  });

  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.once(signal, () => server.close());
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await main();
}
