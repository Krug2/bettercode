// Compact derived data is maintained in the same transaction as each message.
// Historical text and tool output never enter statistics queries.
export function messageUsageProjectionSql(where = ""): string {
  const validJson = "CASE WHEN json_valid(source.content_json) THEN source.content_json ELSE '{}' END"
  const inputTokens = numericJsonCoalesce(validJson, [
    "$.extra.usage.inputTokens",
    "$.extra.usage.input_tokens",
  ])
  const outputTokens = numericJsonCoalesce(validJson, [
    "$.extra.usage.outputTokens",
    "$.extra.usage.output_tokens",
  ])
  const reasoningTokens = numericJsonCoalesce(validJson, [
    "$.extra.usage.reasoningOutputTokens",
    "$.extra.usage.reasoning_output_tokens",
    "$.extra.usage.reasoningTokens",
    "$.extra.usage.reasoning_tokens",
  ])
  const cacheRead = numericJsonCoalesce(validJson, [
    "$.extra.usage.cacheReadTokens",
    "$.extra.usage.cache_read_tokens",
    "$.extra.usage.cachedInputTokens",
    "$.extra.usage.cached_input_tokens",
    "$.extra.usage.cache_read_input_tokens",
    "$.extra.usage.cache.read",
  ])
  const cacheWrite = numericJsonCoalesce(validJson, [
    "$.extra.usage.cacheCreationTokens",
    "$.extra.usage.cache_creation_tokens",
    "$.extra.usage.cacheWriteTokens",
    "$.extra.usage.cache_write_tokens",
    "$.extra.usage.cache_creation_input_tokens",
    "$.extra.usage.cache.write",
  ])
  const cost = numericJsonCoalesce(validJson, [
    "$.extra.usage.cost",
    "$.extra.usage.totalCost",
    "$.extra.usage.total_cost",
  ])
  return `INSERT INTO projection_message_usage
    (message_id, thread_id, role, created_at, runtime_sequence, model_id,
     input_tokens, output_tokens, reasoning_tokens, cache_read_tokens, cache_write_tokens, cost, tools_json)
    SELECT message_id, thread_id, role, created_at,
      json_extract(${validJson}, '$.extra.providerRuntimeSequence'),
      json_extract(${validJson}, '$.extra.modelId'),
      ${inputTokens}, ${outputTokens}, ${reasoningTokens}, ${cacheRead}, ${cacheWrite}, ${cost},
      (SELECT json_group_array(json_extract(tool.value, '$.name'))
       FROM json_each(CASE WHEN json_type(${validJson}, '$.extra.toolCalls') = 'array'
         THEN json_extract(${validJson}, '$.extra.toolCalls') ELSE '[]' END) AS tool
       WHERE tool.type = 'object' AND typeof(json_extract(tool.value, '$.name')) = 'text')
    FROM projection_messages AS source ${where || "WHERE true"}
    ON CONFLICT(message_id) DO UPDATE SET
      thread_id = excluded.thread_id, role = excluded.role, created_at = excluded.created_at,
      runtime_sequence = excluded.runtime_sequence, model_id = excluded.model_id,
      input_tokens = excluded.input_tokens, output_tokens = excluded.output_tokens,
      reasoning_tokens = excluded.reasoning_tokens, cache_read_tokens = excluded.cache_read_tokens,
      cache_write_tokens = excluded.cache_write_tokens, cost = excluded.cost, tools_json = excluded.tools_json;`
}

function numericJsonCoalesce(validJson: string, paths: readonly string[]): string {
  return `COALESCE(${paths.map((key) => `CAST(json_extract(${validJson}, '${key}') AS REAL)`).join(", ")}, 0)`
}
