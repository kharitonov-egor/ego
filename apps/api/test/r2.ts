type Body = ReadableStream | ArrayBuffer | ArrayBufferView | string | Blob | null

interface Stored {
  bytes: Uint8Array
  contentType: string | undefined
  etag: string
}

async function bytesOf(value: Body): Promise<Uint8Array> {
  if (value === null) return new Uint8Array()
  return new Uint8Array(await new Response(value).arrayBuffer())
}

function contentTypeOf(metadata: R2HTTPMetadata | Headers | undefined): string | undefined {
  if (!metadata) return undefined
  return metadata instanceof Headers ? metadata.get('content-type') ?? undefined : metadata.contentType
}

/** Just enough of R2 for the diary routes: whole objects, one byte range, and multipart uploads. */
export function createTestBucket(): { bucket: R2Bucket; objects: Map<string, Stored> } {
  const objects = new Map<string, Stored>()
  const uploads = new Map<string, { key: string; contentType: string | undefined; parts: Map<number, Uint8Array> }>()
  let counter = 0

  const describe = (key: string, stored: Stored, range?: { offset: number; length: number }) => ({
    key,
    size: stored.bytes.length,
    etag: stored.etag,
    httpEtag: `"${stored.etag}"`,
    httpMetadata: { contentType: stored.contentType },
    range,
    writeHttpMetadata: (headers: Headers) => {
      if (stored.contentType) headers.set('content-type', stored.contentType)
    }
  })

  const store = (key: string, bytes: Uint8Array, contentType: string | undefined) => {
    counter += 1
    const stored: Stored = { bytes, contentType, etag: `etag-${counter}` }
    objects.set(key, stored)
    return describe(key, stored)
  }

  const bucket = {
    head: async (key: string) => {
      const stored = objects.get(key)
      return stored ? describe(key, stored) : null
    },
    get: async (key: string, options?: { range?: { offset: number; length: number } }) => {
      const stored = objects.get(key)
      if (!stored) return null
      const range = options?.range
      const slice = range ? stored.bytes.slice(range.offset, range.offset + range.length) : stored.bytes
      return { ...describe(key, stored, range), body: new Response(slice).body }
    },
    put: async (key: string, value: Body, options?: R2PutOptions) =>
      store(key, await bytesOf(value), contentTypeOf(options?.httpMetadata)),
    delete: async (keys: string | string[]) => {
      for (const key of Array.isArray(keys) ? keys : [keys]) objects.delete(key)
    },
    createMultipartUpload: async (key: string, options?: R2MultipartOptions) => {
      counter += 1
      const uploadId = `upload/${counter}+x`
      uploads.set(uploadId, { key, contentType: contentTypeOf(options?.httpMetadata), parts: new Map() })
      return { key, uploadId }
    },
    resumeMultipartUpload: (key: string, uploadId: string) => ({
      key,
      uploadId,
      uploadPart: async (partNumber: number, value: Body) => {
        const upload = uploads.get(uploadId)
        if (!upload || upload.key !== key) throw new Error('No such upload')
        upload.parts.set(partNumber, await bytesOf(value))
        return { partNumber, etag: `part-${partNumber}` }
      },
      complete: async (parts: R2UploadedPart[]) => {
        const upload = uploads.get(uploadId)
        if (!upload || upload.key !== key) throw new Error('No such upload')
        const chunks = parts.map((part) => upload.parts.get(part.partNumber) ?? new Uint8Array())
        const joined = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.length, 0))
        let offset = 0
        for (const chunk of chunks) {
          joined.set(chunk, offset)
          offset += chunk.length
        }
        uploads.delete(uploadId)
        return store(key, joined, upload.contentType)
      },
      abort: async () => {
        uploads.delete(uploadId)
      }
    })
  }
  return { bucket: bucket as unknown as R2Bucket, objects }
}
