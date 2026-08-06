export type JsonRecord = Record<string, unknown>;

export function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function asNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

export function asBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") {
    return value;
  }
  if (value === "true" || value === 1) {
    return true;
  }
  if (value === "false" || value === 0) {
    return false;
  }
  return undefined;
}

export function firstString(
  record: JsonRecord,
  ...keys: string[]
): string | undefined {
  for (const key of keys) {
    const candidate = asString(record[key]);
    if (candidate) {
      return candidate;
    }
  }
  return undefined;
}

export function firstNumber(
  record: JsonRecord,
  ...keys: string[]
): number | undefined {
  for (const key of keys) {
    const candidate = asNumber(record[key]);
    if (candidate !== undefined) {
      return candidate;
    }
  }
  return undefined;
}

export function parseJsonPayload(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return value;
  }
}

/**
 * Finds a CLI result array through common localhost-adapter wrappers. The raw
 * CLI array remains the preferred path; wrappers are tolerated, not required.
 */
export function unwrapCliRows(
  input: unknown,
  collectionKeys: readonly string[],
): unknown[] {
  let current = parseJsonPayload(input);

  for (let depth = 0; depth < 5; depth += 1) {
    if (Array.isArray(current)) {
      return current;
    }
    if (!isRecord(current)) {
      return [];
    }

    let next: unknown;
    for (const key of collectionKeys) {
      if (Array.isArray(current[key])) {
        return current[key];
      }
      if (current[key] !== undefined && next === undefined) {
        next = current[key];
      }
    }

    for (const key of ["data", "result", "body", "stdout", "output"]) {
      if (current[key] !== undefined && next === undefined) {
        next = current[key];
      }
    }

    if (next === undefined) {
      return [];
    }
    current = parseJsonPayload(next);
  }

  return [];
}

export function toIsoTimestamp(value: unknown, fallback?: string): string {
  const numeric = asNumber(value);
  if (numeric !== undefined) {
    const milliseconds =
      Math.abs(numeric) < 1_000_000_000_000 ? numeric * 1000 : numeric;
    const date = new Date(milliseconds);
    if (!Number.isNaN(date.getTime())) {
      return date.toISOString();
    }
  }

  if (typeof value === "string") {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) {
      return date.toISOString();
    }
  }

  return fallback ?? new Date(0).toISOString();
}

export function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((item) => {
    const string = asString(item);
    return string ? [string] : [];
  });
}

export function stableLocalId(prefix: string, seed: string): string {
  let hash = 2_166_136_261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return `${prefix}-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}
