import { execFile } from 'child_process'

export type WindowsOcrResult = { ok: true; text: string } | { ok: false; detail: string }

export interface OcrLine {
  text: string
  left: number
  top: number
  right: number
  bottom: number
}

export interface OcrPass {
  language: string
  lines: OcrLine[]
}

const POWERSHELL_OCR = `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
Add-Type -AssemblyName System.Runtime.WindowsRuntime
[Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime] | Out-Null
[Windows.Storage.FileAccessMode, Windows.Storage, ContentType = WindowsRuntime] | Out-Null
[Windows.Storage.Streams.IRandomAccessStream, Windows.Storage.Streams, ContentType = WindowsRuntime] | Out-Null
[Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics.Imaging, ContentType = WindowsRuntime] | Out-Null
[Windows.Graphics.Imaging.SoftwareBitmap, Windows.Graphics.Imaging, ContentType = WindowsRuntime] | Out-Null
[Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime] | Out-Null
[Windows.Media.Ocr.OcrResult, Windows.Foundation, ContentType = WindowsRuntime] | Out-Null

function Await($operation, [Type]$resultType) {
  $method = [System.WindowsRuntimeSystemExtensions].GetMethods() |
    Where-Object {
      $_.Name -eq 'AsTask' -and
      $_.IsGenericMethod -and
      $_.GetGenericArguments().Count -eq 1 -and
      $_.GetParameters().Count -eq 1 -and
      $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1'
    } |
    Select-Object -First 1
  $task = $method.MakeGenericMethod($resultType).Invoke($null, @($operation))
  $task.Wait()
  return $task.Result
}

$file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($env:EGO_OCR_IMAGE)) ([Windows.Storage.StorageFile])
$stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
$decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
$bitmap = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
$first = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
$languages = @([Windows.Media.Ocr.OcrEngine]::AvailableRecognizerLanguages)
if ($languages.Count -eq 0) { throw 'Install a Windows OCR language pack, then try again.' }
$languages = @($languages | Sort-Object { if ($first -and $_.LanguageTag -eq $first.RecognizerLanguage.LanguageTag) { 0 } else { 1 } })
$passes = @()
foreach ($language in $languages) {
  $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage($language)
  if ($null -eq $engine) { continue }
  $result = Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
  $lines = @()
  foreach ($line in $result.Lines) {
    $left = [double]::MaxValue; $top = [double]::MaxValue; $right = 0; $bottom = 0
    foreach ($word in $line.Words) {
      $box = $word.BoundingRect
      $left = [Math]::Min($left, $box.X); $top = [Math]::Min($top, $box.Y)
      $right = [Math]::Max($right, $box.X + $box.Width); $bottom = [Math]::Max($bottom, $box.Y + $box.Height)
    }
    $lines += [pscustomobject]@{ text = $line.Text; left = $left; top = $top; right = $right; bottom = $bottom }
  }
  $passes += [pscustomobject]@{ language = $language.LanguageTag; lines = $lines }
}
ConvertTo-Json -InputObject $passes -Depth 5 -Compress
`

export function readWithWindowsOcr(imagePath: string): Promise<WindowsOcrResult> {
  const encoded = Buffer.from(POWERSHELL_OCR, 'utf16le').toString('base64')

  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded],
      {
        encoding: 'utf8',
        env: { ...process.env, EGO_OCR_IMAGE: imagePath },
        maxBuffer: 10 * 1024 * 1024,
        windowsHide: true
      },
      (error, stdout, stderr) => {
        if (error) {
          const detail = stderr.trim() || error.message
          resolve({ ok: false, detail: detail.replace(/^.*?:\s*/s, '').trim() })
          return
        }

        const text = mergeOcrPasses(parsePasses(stdout.replace(/^\uFEFF/, '').trim()))
        resolve(
          text
            ? { ok: true, text }
            : { ok: false, detail: 'Windows OCR did not find any text in that image.' }
        )
      }
    )
  })
}

function asArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value
  return value === null || value === undefined ? [] : [value]
}

function isOcrLine(value: unknown): value is OcrLine {
  if (typeof value !== 'object' || value === null) return false
  const line = value as Record<string, unknown>
  return typeof line.text === 'string' &&
    ['left', 'top', 'right', 'bottom'].every((key) => typeof line[key] === 'number')
}

/** PowerShell 5.1 writes a one-item array as a bare object, so both shapes are accepted. */
export function parsePasses(json: string): OcrPass[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    return []
  }
  return asArray(parsed).flatMap((pass) => {
    if (typeof pass !== 'object' || pass === null) return []
    const { language, lines } = pass as Record<string, unknown>
    return typeof language === 'string' ? [{ language, lines: asArray(lines).filter(isOcrLine) }] : []
  })
}

function scriptOf(letter: string): string {
  if (/\p{Script=Latin}/u.test(letter)) return 'latin'
  if (/\p{Script=Cyrillic}/u.test(letter)) return 'cyrillic'
  if (/\p{Script=Greek}/u.test(letter)) return 'greek'
  return 'other'
}

/**
 * How believable a line reads. An engine reading a script it doesn't know leaves words with
 * digits or stray symbols inside, letters from two scripts, or a capital after a small letter
 * ("nepeHeceHa"). Switching script from word to word costs a little, which keeps the Russian
 * engine from turning English "Play a" into Cyrillic look-alikes.
 */
export function lineScore(text: string): number {
  let letters = 0
  let clean = 0
  let switches = 0
  let previous: string | null = null
  for (const word of text.split(/\s+/)) {
    const core = word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')
    const wordLetters = [...core].filter((character) => /\p{L}/u.test(character))
    if (wordLetters.length === 0) continue
    const scripts = new Set(wordLetters.map(scriptOf))
    letters += wordLetters.length
    if (scripts.size === 1 && !/[^\p{L}\p{M}'’.@/:_-]/u.test(core) && !/\p{Ll}\p{Lu}/u.test(core)) clean += wordLetters.length
    const script = scripts.size === 1 ? [...scripts][0] : 'mixed'
    if (previous !== null && script !== previous) switches++
    previous = script
  }
  return letters === 0 ? 0 : (clean / letters) * 100 - switches
}

function overlaps(a: OcrLine, b: OcrLine): boolean {
  const vertical = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
  const horizontal = Math.min(a.right, b.right) - Math.max(a.left, b.left)
  return vertical >= 0.5 * Math.min(a.bottom - a.top, b.bottom - b.top) &&
    horizontal >= 0.3 * Math.min(a.right - a.left, b.right - b.left)
}

/**
 * Windows OCR reads one language per pass, so each installed language reads the image and every
 * line keeps the pass that reads it most believably. Earlier passes win ties.
 */
export function mergeOcrPasses(passes: OcrPass[]): string {
  const groups: OcrLine[][] = []
  for (const pass of passes) {
    for (const line of pass.lines) {
      const group = groups.find((lines) => lines.some((other) => overlaps(other, line)))
      if (group) group.push(line)
      else groups.push([line])
    }
  }
  return groups
    .map((lines) => lines.reduce((best, line) => (lineScore(line.text) > lineScore(best.text) ? line : best)))
    .sort((a, b) => a.top - b.top || a.left - b.left)
    .map((line) => line.text.trim())
    .filter(Boolean)
    .join('\n')
}
