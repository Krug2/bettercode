import { z } from "zod"

/** Upper bound shared by message text and inline attachment payloads. */
export const CHAT_MESSAGE_MAX_CHARS = 1024 * 1024

/**
 * An attachment on a chat message. Lives in its own module because both the
 * chat contracts and the provider runtime events carry attachments; keeping
 * it here breaks the import cycle between the two.
 */
export const chatAttachmentSchema = z
  .object({
    type: z.string().min(1).max(64).default("file"),
    filename: z.string().max(1_024).nullish(),
    mediaType: z.string().max(256).nullish(),
    url: z.string().min(1).max(CHAT_MESSAGE_MAX_CHARS),
  })
  .strict()
export type ChatAttachment = z.infer<typeof chatAttachmentSchema>
