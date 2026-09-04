type RemoteD1Config = {
  accountId: string;
  databaseId: string;
  apiToken: string;
};

type QuerySpec = {
  sql: string;
  params: unknown[];
};

type D1ApiEnvelope<T> = {
  success?: boolean;
  result?: T[];
  errors?: Array<{ message?: string }>;
};

type D1ApiQueryResult = {
  success?: boolean;
  meta?: Record<string, unknown>;
  results?: Array<Record<string, unknown>>;
};

type D1ApiRawResult = {
  success?: boolean;
  meta?: Record<string, unknown>;
  results?: {
    columns?: string[];
    rows?: unknown[][];
  };
};

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Scout Heroku runtime requires ${name}`);
  return value;
}

export function remoteD1ConfigFromEnv(): RemoteD1Config {
  return {
    accountId: requiredEnv("CLOUDFLARE_ACCOUNT_ID"),
    databaseId: requiredEnv("SCOUT_D1_DATABASE_ID"),
    apiToken: requiredEnv("SCOUT_D1_API_TOKEN"),
  };
}

function normalizeParam(value: unknown): string | number | null {
  if (value === null) return null;
  if (typeof value === "string" || typeof value === "number") return value;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (value instanceof Date) return value.toISOString();
  throw new Error(`Scout remote D1 cannot bind parameter type ${typeof value}`);
}

function queryBody(spec: QuerySpec) {
  return { sql: spec.sql, params: spec.params.map(normalizeParam) };
}

class RemoteD1PreparedStatement {
  private readonly database: RemoteD1Database;
  readonly sql: string;
  readonly params: unknown[];

  constructor(database: RemoteD1Database, sql: string, params: unknown[] = []) {
    this.database = database;
    this.sql = sql;
    this.params = params;
  }

  bind(...values: unknown[]) {
    return new RemoteD1PreparedStatement(this.database, this.sql, values);
  }

  querySpec(): QuerySpec {
    return { sql: this.sql, params: this.params };
  }

  async run<T = Record<string, unknown>>() {
    return this.database.query<T>(this.querySpec());
  }

  async all<T = Record<string, unknown>>() {
    return this.database.query<T>(this.querySpec());
  }

  async first<T = Record<string, unknown>>(column?: string) {
    const result = await this.database.query<T>(this.querySpec());
    const row = result.results?.[0] as Record<string, unknown> | undefined;
    if (!row) return null;
    return column ? row[column] ?? null : row;
  }

  async raw<T extends unknown[] = unknown[]>(options?: { columnNames?: boolean }) {
    const raw = await this.database.raw(this.querySpec());
    const rows = (raw.results?.rows ?? []) as T[];
    if (options?.columnNames) return [raw.results?.columns ?? [], ...rows];
    return rows;
  }
}

export class RemoteD1Database {
  private readonly config: RemoteD1Config;

  constructor(config: RemoteD1Config) {
    this.config = config;
  }

  prepare(sql: string) {
    return new RemoteD1PreparedStatement(this, sql);
  }

  async batch<T = Record<string, unknown>>(statements: Array<RemoteD1PreparedStatement>) {
    const specs = statements.map((statement) => {
      if (!(statement instanceof RemoteD1PreparedStatement)) {
        throw new Error("Scout remote D1 batch accepts only prepared statements from the same client");
      }
      return queryBody(statement.querySpec());
    });
    const envelope = await this.request<D1ApiQueryResult>("query", { batch: specs });
    return (envelope.result ?? []).map((result) => this.toD1Result<T>(result));
  }

  async exec(sql: string) {
    const envelope = await this.request<D1ApiQueryResult>("query", { sql, params: [] });
    const results = envelope.result ?? [];
    return {
      count: results.length,
      duration: results.reduce((total, result) => total + Number(result.meta?.duration ?? 0), 0),
    };
  }

  async dump(): Promise<ArrayBuffer> {
    throw new Error("Scout remote D1 dump is intentionally unavailable from the application runtime");
  }

  async query<T = Record<string, unknown>>(spec: QuerySpec) {
    const envelope = await this.request<D1ApiQueryResult>("query", queryBody(spec));
    const result = envelope.result?.[0];
    if (!result) throw new Error("Scout remote D1 returned no query result");
    return this.toD1Result<T>(result);
  }

  async raw(spec: QuerySpec) {
    const envelope = await this.request<D1ApiRawResult>("raw", queryBody(spec));
    const result = envelope.result?.[0];
    if (!result) throw new Error("Scout remote D1 returned no raw query result");
    if (result.success === false) throw new Error("Scout remote D1 raw query failed");
    return result;
  }

  private toD1Result<T>(result: D1ApiQueryResult) {
    if (result.success === false) throw new Error("Scout remote D1 query failed");
    return {
      success: true,
      meta: result.meta ?? {},
      results: (result.results ?? []) as T[],
    };
  }

  private async request<T>(endpoint: "query" | "raw", body: unknown): Promise<D1ApiEnvelope<T>> {
    const url = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(this.config.accountId)}/d1/database/${encodeURIComponent(this.config.databaseId)}/${endpoint}`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.config.apiToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(12_000),
    });
    let envelope: D1ApiEnvelope<T>;
    try {
      envelope = await response.json() as D1ApiEnvelope<T>;
    } catch {
      throw new Error(`Scout remote D1 returned invalid JSON (${response.status})`);
    }
    if (!response.ok || envelope.success === false) {
      const reason = envelope.errors?.map((error) => error.message).filter(Boolean).join("; ") || `HTTP ${response.status}`;
      throw new Error(`Scout remote D1 request failed: ${reason}`);
    }
    return envelope;
  }
}

let cachedRemoteD1: RemoteD1Database | null = null;

export function getRemoteD1Database(): D1Database {
  cachedRemoteD1 ??= new RemoteD1Database(remoteD1ConfigFromEnv());
  return cachedRemoteD1 as unknown as D1Database;
}
