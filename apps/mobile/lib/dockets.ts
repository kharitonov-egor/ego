import { Directory, File, Paths } from 'expo-file-system'
import { fetch as expoFetch } from 'expo/fetch'
import { DOCKET_PDF_TIMEOUT_MS, docketPdfName, type DocketSummary } from '@ego/api-contracts'
import { resultFrom, type EgoApi } from '@ego/local/api-client'
import { openWithAnotherApp } from './diary/media'

/**
 * Downloads the latest version's PDF once into the cache and hands it to the phone's PDF viewer,
 * which can save or share it. Throws with the Worker's reason when it could not make one.
 */
export async function openDocketPdf(api: Pick<EgoApi, 'docketPdfUrl' | 'authHeaders'>, docket: DocketSummary): Promise<void> {
  const folder = new Directory(Paths.cache, 'docket-pdf', docket.id, `v${docket.latestVersion}`)
  const target = new File(folder, docketPdfName(docket.title))
  if (!target.exists) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), DOCKET_PDF_TIMEOUT_MS)
    try {
      let response: Awaited<ReturnType<typeof expoFetch>>
      try {
        response = await expoFetch(api.docketPdfUrl(docket.id), { headers: api.authHeaders(), signal: controller.signal })
      } catch {
        throw new Error('The Ego server is unreachable')
      }
      if (!response.ok) {
        const result = resultFrom(response.status, await response.text())
        throw new Error(result.ok ? 'The PDF did not download' : result.error.message)
      }
      const bytes = new Uint8Array(await response.arrayBuffer())
      if (!folder.exists) folder.create({ intermediates: true })
      target.write(bytes)
    } finally {
      clearTimeout(timeout)
    }
  }
  await openWithAnotherApp(target, 'application/pdf')
}
