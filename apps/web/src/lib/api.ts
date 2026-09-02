import {
  ROUTES,
  type ApiError,
  type AskRequest,
  type AskResponse,
  type TickerEntry,
} from "@finance-demo/contracts";

export type ApiErrorCode = ApiError["error"]["code"];

/**
 * Every failure the UI can render, normalised to the shape of the contract's
 * `ApiError` so the panels have exactly one error type to deal with. Network
 * failures (backend not running) get a synthetic `INTERNAL` code plus
 * `transport: true`, which the UI uses to say "can't reach the API" rather than
 * "the API returned an error".
 */
export class RequestFailure extends Error {
  readonly code: ApiErrorCode;
  readonly detail: string | null;
  readonly status: number | null;
  readonly transport: boolean;

  constructor(init: {
    code: ApiErrorCode;
    message: string;
    detail?: string | null;
    status?: number | null;
    transport?: boolean;
  }) {
    super(init.message);
    this.name = "RequestFailure";
    this.code = init.code;
    this.detail = init.detail ?? null;
    this.status = init.status ?? null;
    this.transport = init.transport ?? false;
  }
}

function isApiError(value: unknown): value is ApiError {
  if (typeof value !== "object" || value === null) return false;
  const err = (value as { error?: unknown }).error;
  if (typeof err !== "object" || err === null) return false;
  const e = err as { code?: unknown; message?: unknown };
  return typeof e.code === "string" && typeof e.message === "string";
}

async function readFailure(res: Response): Promise<RequestFailure> {
  let body: unknown = null;
  let raw = "";
  try {
    raw = await res.text();
    body = raw ? JSON.parse(raw) : null;
  } catch {
    /* non-JSON error body — fall through to the status-derived message */
  }
  if (isApiError(body)) {
    return new RequestFailure({
      code: body.error.code,
      message: body.error.message,
      detail: body.error.detail ?? null,
      status: res.status,
    });
  }
  // A 5xx that isn't even shaped like an ApiError is almost always the Next
  // rewrite failing to reach API_ORIGIN — i.e. the API isn't running. Say so,
  // rather than blaming the API for a response it never sent.
  const unreachable = res.status >= 500 && !isApiError(body);
  return new RequestFailure({
    code: res.status >= 500 ? "INTERNAL" : "BAD_REQUEST",
    message: unreachable
      ? `The API did not return a valid response (HTTP ${res.status}). It is probably not running.`
      : `The API responded with ${res.status} ${res.statusText || "error"}.`,
    detail: raw ? raw.slice(0, 400) : null,
    status: res.status,
    transport: unreachable,
  });
}

function transportFailure(cause: unknown, what: string): RequestFailure {
  const reason = cause instanceof Error ? cause.message : String(cause);
  return new RequestFailure({
    code: "INTERNAL",
    message: `Could not reach the API while ${what}.`,
    detail: reason,
    transport: true,
  });
}

/** GET /api/tickers — the full 10k-row directory, fetched once on mount. */
export async function fetchTickers(signal?: AbortSignal): Promise<TickerEntry[]> {
  let res: Response;
  try {
    res = await fetch(ROUTES.tickers, {
      signal,
      headers: { accept: "application/json" },
    });
  } catch (cause) {
    if (signal?.aborted) throw cause;
    throw transportFailure(cause, "loading the ticker directory");
  }
  if (!res.ok) throw await readFailure(res);

  const data: unknown = await res.json();
  if (!Array.isArray(data)) {
    throw new RequestFailure({
      code: "INTERNAL",
      message: "The ticker directory came back in an unexpected shape.",
      detail: null,
    });
  }
  // Structurally validate cheaply — zod over 10k rows on the main thread is
  // not worth the frame budget, and the contract guarantees the shape.
  return data.filter(
    (row): row is TickerEntry =>
      typeof row === "object" &&
      row !== null &&
      typeof (row as TickerEntry).t === "string" &&
      typeof (row as TickerEntry).n === "string",
  );
}

/** POST /api/questions — runs the full LLM pipeline; can take many seconds. */
export async function askQuestion(
  req: AskRequest,
  signal?: AbortSignal,
): Promise<AskResponse> {
  let res: Response;
  try {
    res = await fetch(ROUTES.ask, {
      method: "POST",
      signal,
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(req),
    });
  } catch (cause) {
    if (signal?.aborted) throw cause;
    throw transportFailure(cause, "asking your question");
  }
  if (!res.ok) throw await readFailure(res);
  return (await res.json()) as AskResponse;
}

/** Human copy for each contract error code. */
export const ERROR_COPY: Record<ApiErrorCode, { title: string; hint: string }> = {
  BAD_REQUEST: {
    title: "That request wasn't valid",
    hint: "Check the ticker and make sure the question is at least a few words.",
  },
  UNKNOWN_TICKER: {
    title: "Unknown ticker",
    hint: "The SEC directory has no company filed under that symbol. Try picking one from the search.",
  },
  UPSTREAM_SEC_ERROR: {
    title: "SEC EDGAR is not responding",
    hint: "EDGAR rate-limits aggressively. Wait a moment and ask again.",
  },
  UPSTREAM_QUOTE_ERROR: {
    title: "Live quote unavailable",
    hint: "The market data provider failed. The filings research may still work — try again.",
  },
  VECTOR_STORE_ERROR: {
    title: "Filings index unavailable",
    hint: "The vector store could not be reached, so filings could not be searched.",
  },
  LLM_ERROR: {
    title: "The model failed to answer",
    hint: "Synthesis errored out. Re-running the question usually clears it.",
  },
  INTERNAL: {
    title: "Something went wrong",
    hint: "An unexpected error occurred on the server.",
  },
};
