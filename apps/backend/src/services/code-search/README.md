# Jev code-search harness

Enable under **Settings > Tools & MCP > Jev code search** after saving a TypeSafe
API key. It defaults off. New provider sessions discover the tools; disabling the
setting, removing/replacing the key, or stopping the backend revokes capabilities
and aborts in-flight ranking calls. After replacing a key, start a new session.
The setting and key can only be changed by the host owner.

## Ownership and provider contract

- `contracts.ts` owns validated MCP inputs/outputs, the pinned model ID and the
  dated pricing reference. `limits.ts` owns the shared resource ceilings.
- `retrieval.ts` discovers eligible paths, prioritizes path matches, then reads
  bounded disk snapshots with eight workers. There is no persistent index/cache.
- `candidate-ranking.ts` owns literal matching, import/definition heuristics,
  excerpt selection, content-hash deduplication and lexical shortlist selection.
- `jev-client.ts` is the only outbound TypeSafe client. The endpoint is fixed;
  redirects are forbidden. Paths and excerpts in results always come from local
  reads, never from model output. Scores must map exactly to supplied candidates.
- `harness.ts` owns a lazy loopback HTTP listener and its shutdown. A signed,
  revocable capability binds each client to the canonical workspace assigned by
  its provider. Tool input cannot change that root. Workspace trust is checked
  again at invocation. Clients never receive the TypeSafe key.
- Bootstrap supplies the portable MCP resolver to direct API adapters (including
  Grok), and its ACP representation to Grok CLI/Cursor. Claude Agent SDK receives
  the HTTP entry per query. Codex app-server receives a per-thread config override
  on both start and resume; no user MCP config file is modified. The server name
  `betterc0de_code_search` is reserved in the managed resolver.
- Existing provider permission gates still apply. In particular, the direct API
  adapters currently disable all MCP discovery in Ask/Plan/Security mode. This
  integration does not exempt itself from that policy or auto-approve tool calls.

## Tool behavior and limits

`file_map({prefix?, offset?, limit?})` returns sorted source/config/document paths,
coverage, duration and a next offset. A prefix restricts traversal, not just the
returned array. Each page is a new disk snapshot, so offsets are not
stable across filesystem changes. It does not return a symbol/dependency graph.
No Jev request is made. Results still reach the calling agent through normal tool
output, including its model provider.

`search_code({query, keywords?, paths?, limit?})` retrieves literal case-insensitive
keyword/path candidates and asks Jev to rank up to 64 unique files. `paths` accepts
up to eight workspace-relative prefixes and restricts traversal. Explicit keywords are useful
for identifiers or multilingual queries. A semantic match with no lexical hit
cannot be discovered. It returns captured excerpts, actual line numbers and a
SHA-256 of each complete file read. Re-read before editing: the hash is evidence
of that snapshot, not a lock on the current file. `lexicalMatchCount` counts matching
files before deduplication; `uniqueMatchCount` counts distinct matching contents.
`shortlistTruncated` compares unique matches with candidates actually ranked.

Local ranking weights matching paths, rarer terms and definitions above incidental
imports, with a soft penalty for repeatedly selecting the same parent directory.
Excerpts surround the highest-scoring matching line and nearby matches, rather
than the first occurrence. These are language-agnostic heuristics, not an AST or
proof of relevance. Identical SHA-256 content appears once; the representative path
has the most path-term matches, then the shortest path, then lexical order.

Both tools exclude gitignored paths, symlinks/junctions, common dependency/build
directories, credential-named files and unsupported extensions. `.kilo/` and
`.worktrees/` are excluded. Any nested directory with a `.git` marker is excluded,
including submodules and nested repositories; `coverage.excludedWorktrees` counts
these markers. Selecting a worktree/submodule itself as the workspace root is
supported. Content search
also skips files containing NUL bytes. This is not a
secret scanner: secrets embedded in ordinary source files can appear in excerpts.
Enabling search authorizes sending queries, candidate paths and excerpts to Jev.

| Limit | Value |
| --- | --- |
| Discovery and reads | 16,000 entries, depth 20, shared 8-second cooperative deadline |
| Read | 512 KiB/file, 64 MiB/call, eight workers; bounded ignore-file reads |
| Candidate excerpts | 64 unique contents, up to 2,400 UTF-16 code units each |
| Returned search matches | 1–20, default 10 |
| File-map page | 1–500 paths, default 100 |
| Jev | at most 16 candidates and 24 KiB serialized state/request, 64 KiB response |
| Ranking | two concurrent requests, one shared 8-second deadline for all batches |
| MCP | 16 KiB request, 20-second deadline, 8 requests / 2 concurrent tools |

The state byte ceiling leaves headroom below Jev's documented 32k state-token
limit without assuming four characters per token. Large/Unicode excerpts produce
more batches. Every batch has the same relevance criteria and candidate IDs are
checked against that exact batch. A failed batch discards the entire remote
ranking; in-flight requests settle, but further batches are not scheduled.

`timingsMs` separates retrieval, ranking and total tool time. `usage` reports
attempted requests and the sum of tokens actually reported by Jev. Missing,
malformed or failed-request usage sets `complete: false` and the cost estimate to
null; known partial tokens are retained. No token count is guessed from excerpts.
For the pinned model, `estimatedInputCostUsd` uses the published $0.042 per million
input tokens (output is free), verified 2026-09-19. For example, 40,000 reported
input tokens estimate $0.00168. Pricing metadata includes date/source; this is an
estimate, not billing reconciliation, and must be updated when rates change.

Traversal/read failures and caps are exposed in `coverage`; false `incomplete`
only describes the eligible traversal, not an exhaustive semantic code search.
`coverage.scannedFiles` counts successful content reads, `eligibleFiles` discovered
eligible paths, and `duplicateFiles` matching files removed before ranking.
API failures/timeouts/invalid responses return `ranking: "lexical-fallback"` with
an explicit warning and null relevance scores. No automatic paid retry is made.
Cancellation, disable and trust revocation fail the tool instead of returning a
successful fallback. No query, code, key or remote error body is logged here.

## Verification and upstream contracts

`harness.test.ts` uses real MCP HTTP clients and temporary workspaces, including
the direct-API bridge, isolation, pagination, ignores, junctions, revocation,
cancellation, scoped traversal, usage and fallback. `jev-client.test.ts` validates
untrusted responses, batching, Unicode state budgets, ID attribution, partial
failure and usage accounting. `retrieval.test.ts` covers import noise, implementation
excerpts, deduplication, worktrees and a 1,400-file fixture larger than 8 MiB.
Provider tests verify the SDK and app-server wiring; settings tests verify secret
persistence and owner-only writes. A smoke test against the locally installed
Codex app-server also confirmed thread startup and discovery of both tools, and
validated the enabled/disabled transport configuration without sending a model
turn. Jev responses in automated tests are fake; live latency/account access and
full Claude/Grok CLI conversations have not been exercised.

Protocol references: [TypeSafe API](https://docs.typesafe.ai/api),
[models](https://docs.typesafe.ai/models),
[Codex app-server](https://learn.chatgpt.com/docs/app-server),
[MCP transport](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports).
