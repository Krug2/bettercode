export interface ThreadSaveMessage {
  message_id: string
  turn_id: string | null
  role: string
  content: string
  created_at: string
  extra: Record<string, unknown>
}

export interface ThreadMetaUpsertRequest {
  thread_id: string
  title: string
  project_name: string
  project_path: string
  env_mode?: string | null
  branch?: string | null
  worktree_path?: string | null
  base_branch?: string | null
  worktree_state?: string | null
  parent_thread_id?: string | null
  created_at: string
  updated_at: string
  codex_thread_id: string | null
}

export interface ThreadSaveRequest extends ThreadMetaUpsertRequest {
  messages: ThreadSaveMessage[]
}

export interface ThreadMessageUpsertRequest {
  thread_id: string
  message: ThreadSaveMessage
}

export interface ThreadUserMessageDispatchRequest {
  thread_id: string
  title: string
  project_name: string
  project_path: string
  created_at: string
  message: ThreadSaveMessage
}

export interface ThreadCompactionCommitRequest {
  thread_id: string
  request_id: string
  command_message: ThreadSaveMessage
  checkpoint_message: ThreadSaveMessage
}

export interface ThreadCompactionCommitResult {
  alreadyCommitted: boolean
  generation: number
  messageId: string
}

export interface ThreadTruncateRequest {
  thread_id: string
  message_id: string
  updated_at: string
}

export interface ThreadCheckpointRevertRequest {
  thread_id: string
  turn_count: number
  stale_checkpoint_refs: string[]
  updated_at: string
}
