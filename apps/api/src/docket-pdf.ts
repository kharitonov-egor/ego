import type { BrowserWorker } from '@cloudflare/puppeteer'

/** One docket's HTML as a PDF, or the reason it could not be printed. */
export type DocketPdfRenderer = (html: string) => Promise<Uint8Array | string>

const LOAD_TIMEOUT_MS = 20_000
const PRINT_TIMEOUT_MS = 30_000
/** Chart libraries animate in for about a second after the page loads. */
const SETTLE_MS = 1_200

/**
 * Dockets are dark pages, so the PDF keeps the screen look: screen media, backgrounds printed, and
 * no page margin, which would frame every page in white. Blocks that read badly when cut in half
 * move to the next page, and headings stay with what follows them.
 */
const PRINT_STYLE = `@page { margin: 0 }
pre, figure, img, svg, canvas, tr, blockquote, .card { break-inside: avoid }
h1, h2, h3, h4 { break-after: avoid }`

export function browserPdfRenderer(binding: BrowserWorker): DocketPdfRenderer {
  return async (html) => {
    const { default: puppeteer } = await import('@cloudflare/puppeteer')
    let browser: Awaited<ReturnType<typeof puppeteer.launch>> | null = null
    try {
      browser = await puppeteer.launch(binding)
      const page = await browser.newPage()
      await page.emulateMediaType('screen')
      await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }])
      try {
        await page.setContent(html, { waitUntil: 'networkidle0', timeout: LOAD_TIMEOUT_MS })
      } catch (error) {
        // A page that keeps polling never goes idle but has usually painted by now.
        if (!(error instanceof Error && error.name === 'TimeoutError')) throw error
      }
      await page.addStyleTag({ content: PRINT_STYLE })
      await new Promise(resolve => setTimeout(resolve, SETTLE_MS))
      return new Uint8Array(await page.pdf({
        format: 'letter', printBackground: true, preferCSSPageSize: true, outline: true, timeout: PRINT_TIMEOUT_MS
      }))
    } catch (error) {
      return error instanceof Error ? error.message.slice(0, 300) : 'The page could not be printed'
    } finally {
      await browser?.close().catch(() => undefined)
    }
  }
}
