# Buzz Cockpit

Local browser frontend for the existing Buzz installation. The cockpit does
not run an LLM, replace the relay, or change the installed Buzz app. Its local
adapter only invokes an allowlisted set of commands from the existing `buzz`
CLI and returns their JSON output to the UI.

The original Buzz Desktop remains the review and configuration surface. The
cockpit is a second path to the same channels, threads, files, agents and relay.
It never reads an OpenAI, Anthropic or other LLM API key.

## Included in this first delivery

- automatic, idempotent import of the active Buzz channels as local project
  workspaces, keyed by the stable channel UUID;
- a project chooser followed by one isolated history per project: switching
  projects replaces the entire timeline instead of filtering a global inbox;
- complete channel-history pagination, live incremental refresh, and a thread
  navigator filterable by agent, handoff, or media;
- a human-first Reader presentation that removes strict orchestration receipts,
  mass readback acknowledgements and internal paths while Operator preserves the
  untouched Buzz events for audit;
- readable Buzz thread timeline with Markdown, reply context, mentions, and
  exact event/thread references;
- inline image galleries, native video, file cards, and full-screen image
  navigation backed by the existing authenticated `buzz media get` command;
- multiple channel or DM conversation references per mission, with a unified
  timeline and per-agent conversation views;
- chronological Chain with distinct send, relay, work, response and handoff
  receipts;
- Reader and Operator modes, plus a project-level composer backed by one
  idempotent continuous-conversation mission per Buzz channel;
- real managed-agent roster, configured model, presence signal and recent
  response activity;
- focused Attention queue for blocks, decisions and explicit handoffs;
- supervised handoff preparation that preserves parent dispatch and depth;
- existing-thread linking by root event ID;
- model-change drafts sent to the original Buzz Desktop for owner review.

Attachments follow the media formats accepted by the installed Buzz CLI:
JPEG, PNG, GIF, WebP, and MP4. The composer filters unsupported files before
they reach the relay.

## Run locally

```bash
pnpm --filter buzz-cockpit dev
```

Open `http://127.0.0.1:4317`.

For the built version:

```bash
pnpm --filter buzz-cockpit build
pnpm --filter buzz-cockpit preview
```

The adapter discovers, in order:

1. `BUZZ_CLI_PATH`, then the CLI bundled with `/Applications/Buzz.app`, then
   `buzz` on `PATH`;
2. `BUZZ_COCKPIT_RELAY_URL`, then the relay already present in Buzz's managed
   agent configuration;
3. `BUZZ_PRIVATE_KEY`, then the existing `buzz-desktop` Keychain identity on
   macOS.

The Nostr identity is used only to sign Buzz relay commands. It is never sent
to the browser, written to the cockpit state file, or printed in logs. Agent
model drafts use only the selected managed agent's existing credential and
still require review and save in Buzz Desktop.

## Optional overrides

```bash
BUZZ_COCKPIT_PORT=4317
BUZZ_COCKPIT_RELAY_URL=https://example.communities.buzz.xyz
BUZZ_CLI_PATH=/path/to/buzz
BUZZ_COCKPIT_STATE_PATH=/path/to/state.json
```

Project-to-channel links, missions, conversation links, and visual loop state
live in one local JSON file under the user's Application Support directory.
Project names and descriptions remain user-owned after import. Messages,
replies, files, presence, and profiles remain in Buzz.

The adapter binds only to `127.0.0.1`, uses `spawn(..., { shell: false })`, and
has no endpoint for arbitrary shell commands.

## Verify

```bash
pnpm --filter buzz-cockpit check
```
