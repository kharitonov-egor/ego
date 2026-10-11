import { app, net, shell } from 'electron'
import { access, writeFile } from 'node:fs/promises'
import { join, parse } from 'node:path'
import { DOCKET_PDF_TIMEOUT_MS, docketPdfName } from '@ego/api-contracts'
import { resultFrom, type EgoApi } from '@ego/local/api-client'

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

/** `Plan.pdf`, then `Plan (2).pdf`, so a second download never replaces the first. */
async function freePath(directory: string, name: string): Promise<string> {
  const { name: base, ext } = parse(name)
  let candidate = join(directory, name)
  for (let copy = 2; await exists(candidate); copy += 1) candidate = join(directory, `${base} (${copy})${ext}`)
  return candidate
}

/** Saves the PDF in Downloads and shows it in Explorer, the way a browser download ends. */
export async function saveDocketPdf(api: Pick<EgoApi, 'docketPdfUrl' | 'authHeaders'>, id: string, title: string): Promise<string | null> {
  let response: Response
  try {
    response = await net.fetch(api.docketPdfUrl(id), { headers: api.authHeaders(), signal: AbortSignal.timeout(DOCKET_PDF_TIMEOUT_MS) })
  } catch {
    return 'The Ego server is unreachable'
  }
  if (!response.ok) {
    const result = resultFrom(response.status, await response.text())
    return result.ok ? 'The PDF did not download' : result.error.message
  }
  const path = await freePath(app.getPath('downloads'), docketPdfName(title))
  await writeFile(path, Buffer.from(await response.arrayBuffer()))
  shell.showItemInFolder(path)
  return null
}
