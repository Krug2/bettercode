import fs from "node:fs"

const MAX_METADATA_BYTES = 1024 * 1024
// Nonblocking open prevents a substituted FIFO from hanging a metadata read.
const READ_FLAGS = fs.constants.O_RDONLY | (fs.constants.O_NONBLOCK ?? 0)

/** Local CLI metadata is optional; reject oversized/nonregular files. */
export function readGrokMetadataFile(filePath: string): string | null {
  let fd: number | undefined
  try {
    fd = fs.openSync(filePath, READ_FLAGS)
    const stat = fs.fstatSync(fd)
    if (!stat.isFile() || stat.size > MAX_METADATA_BYTES) return null
    const buffer = Buffer.alloc(MAX_METADATA_BYTES + 1)
    let offset = 0
    while (offset < buffer.length) {
      const bytes = fs.readSync(fd, buffer, offset, buffer.length - offset, offset)
      if (bytes === 0) return buffer.subarray(0, offset).toString("utf8")
      offset += bytes
    }
    return null
  } catch {
    return null
  } finally {
    if (fd !== undefined) fs.closeSync(fd)
  }
}

export async function readGrokMetadataFileAsync(filePath: string): Promise<string | null> {
  let handle: fs.promises.FileHandle | undefined
  try {
    handle = await fs.promises.open(filePath, READ_FLAGS)
    const stat = await handle.stat()
    if (!stat.isFile() || stat.size > MAX_METADATA_BYTES) return null
    const buffer = Buffer.alloc(MAX_METADATA_BYTES + 1)
    let offset = 0
    while (offset < buffer.length) {
      const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, offset)
      if (bytesRead === 0) return buffer.subarray(0, offset).toString("utf8")
      offset += bytesRead
    }
    return null
  } catch {
    return null
  } finally {
    await handle?.close().catch(() => undefined)
  }
}
