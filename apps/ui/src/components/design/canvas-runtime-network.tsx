import {
  ArrowDownUpIcon,
  ChevronRightIcon,
  PlayIcon,
  RouteIcon,
  Trash2Icon,
} from "lucide-react"
import {
  canReplayEndpoint,
  formatMillis,
  isDevelopmentRequest,
  type EndpointSummary,
  type PreviewRequestEntry,
} from "./canvas-runtime"

function RequestStatus({
  code,
  error,
}: {
  code: number | null
  error: string | null
}) {
  const tone =
    error || (code ?? 0) >= 500
      ? "error"
      : (code ?? 0) >= 400
        ? "warning"
        : code !== null && code >= 200 && code < 300
          ? "success"
          : "neutral"
  return (
    <span
      className="runtime-status"
      data-tone={tone}
      title={error ?? (code === 101 ? "Switching protocols" : undefined)}
    >
      {error ? "ERR" : (code ?? "—")}
    </span>
  )
}

function requestPath(url: string): string {
  try {
    return new URL(url).pathname
  } catch {
    return url
  }
}

export function RuntimeRequestList({
  requests,
  totalCount,
  apiOnly,
  onApiOnlyChange,
  onClear,
}: {
  requests: readonly PreviewRequestEntry[]
  totalCount: number
  apiOnly: boolean
  onApiOnlyChange: (value: boolean) => void
  onClear: () => void
}) {
  return (
    <div className="runtime-network">
      <div className="runtime-filterbar">
        <div
          className="runtime-filters"
          role="group"
          aria-label="Request filter"
        >
          <button
            type="button"
            aria-pressed={apiOnly}
            onClick={() => onApiOnlyChange(true)}
          >
            API only
          </button>
          <button
            type="button"
            aria-pressed={!apiOnly}
            onClick={() => onApiOnlyChange(false)}
          >
            All requests
          </button>
        </div>
        <button
          type="button"
          className="runtime-icon-button"
          aria-label="Clear requests"
          title="Clear captured requests"
          onClick={onClear}
          disabled={!totalCount}
        >
          <Trash2Icon />
        </button>
      </div>
      <div className="runtime-scroll">
        <div className="runtime-request-columns" aria-hidden="true">
          <span />
          <span>Method</span>
          <span>Path</span>
          <span>Status</span>
          <span>Time</span>
        </div>
        {requests.length === 0 ? (
          <div className="runtime-empty">
            <ArrowDownUpIcon aria-hidden="true" />
            <strong>{apiOnly ? "No API calls yet" : "No requests yet"}</strong>
            <p>
              {apiOnly && totalCount
                ? "Page loads and development connections are available in All requests."
                : "Interact with the preview to see its network activity here."}
            </p>
            {apiOnly && totalCount > 0 && (
              <button
                type="button"
                className="runtime-text-button"
                onClick={() => onApiOnlyChange(false)}
              >
                View all requests
              </button>
            )}
          </div>
        ) : (
          <ul className="runtime-request-list">
            {requests.map((entry) => (
              <li key={`${entry.webContentsId}:${entry.id}`}>
                <details className="runtime-request-detail">
                  <summary
                    className="runtime-request-row"
                    aria-label={`${entry.method} ${requestPath(entry.url)}, ${entry.error ? "failed" : (entry.statusCode ?? "unknown status")}, ${formatMillis(entry.durationMs)}`}
                  >
                    <ChevronRightIcon
                      className="runtime-chevron"
                      aria-hidden="true"
                    />
                    <span className="runtime-method">{entry.method}</span>
                    <span className="runtime-request-path" title={entry.url}>
                      <span>{requestPath(entry.url)}</span>
                      <small>
                        {isDevelopmentRequest(entry)
                          ? "Development · HMR"
                          : entry.resourceType === "webSocket"
                            ? "WebSocket"
                            : entry.resourceType}
                        {entry.fromCache ? " · cached" : ""}
                      </small>
                    </span>
                    <RequestStatus
                      code={entry.statusCode}
                      error={entry.error}
                    />
                    <span className="runtime-duration">
                      {formatMillis(entry.durationMs)}
                    </span>
                  </summary>
                  <dl className="runtime-request-metadata">
                    <dt>URL</dt>
                    <dd>{entry.url}</dd>
                    <dt>Type</dt>
                    <dd>
                      {entry.resourceType}
                      {entry.fromCache ? " · served from cache" : ""}
                    </dd>
                    <dt>Started</dt>
                    <dd>{new Date(entry.startedAt).toLocaleTimeString()}</dd>
                    {entry.error && (
                      <>
                        <dt>Error</dt>
                        <dd data-tone="error">{entry.error}</dd>
                      </>
                    )}
                  </dl>
                </details>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="runtime-list-footer">
        <span>
          {requests.length !== totalCount && `${requests.length} of `}
          {totalCount} {totalCount === 1 ? "request" : "requests"}
        </span>
        <span>Newest first</span>
      </div>
    </div>
  )
}

export function RuntimeEndpointList({
  endpoints,
  onReplay,
}: {
  endpoints: readonly EndpointSummary[]
  onReplay: (endpoint: EndpointSummary) => void
}) {
  return (
    <div className="runtime-network">
      <div className="runtime-section-title">
        <RouteIcon aria-hidden="true" />
        <span>API endpoints</span>
        <span className="runtime-secondary">
          {endpoints.length} {endpoints.length === 1 ? "route" : "routes"}
        </span>
      </div>
      <div className="runtime-scroll">
        {!endpoints.length ? (
          <div className="runtime-empty">
            <RouteIcon aria-hidden="true" />
            <strong>No endpoints yet</strong>
            <p>API requests are grouped here by method and path.</p>
          </div>
        ) : (
          <ul className="runtime-request-list">
            {endpoints.map((endpoint) => (
              <li key={endpoint.key} className="runtime-endpoint-row">
                <span className="runtime-method">{endpoint.method}</span>
                <span
                  className="runtime-request-path"
                  title={`${endpoint.origin}${endpoint.path}`}
                >
                  <span>{endpoint.path}</span>
                  <small>
                    {endpoint.count} {endpoint.count === 1 ? "call" : "calls"} ·{" "}
                    {formatMillis(endpoint.averageMs)} avg
                  </small>
                </span>
                <RequestStatus
                  code={endpoint.lastStatus}
                  error={endpoint.lastError}
                />
                <button
                  type="button"
                  className="runtime-icon-button"
                  aria-label={`Replay ${endpoint.method} ${endpoint.path}`}
                  title={
                    canReplayEndpoint(endpoint)
                      ? "Send this request again from the preview"
                      : "Only reads (GET, HEAD) can be replayed"
                  }
                  disabled={!canReplayEndpoint(endpoint)}
                  onClick={() => onReplay(endpoint)}
                >
                  <PlayIcon className="runtime-play-icon" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="runtime-list-footer">
        <span>Grouped by method & path</span>
        <span>GET / HEAD replay</span>
      </div>
    </div>
  )
}
