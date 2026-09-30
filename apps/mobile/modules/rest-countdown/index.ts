import { requireOptionalNativeModule } from 'expo'

interface RestCountdownModule {
  show(endsAt: number): void
  hide(): void
}

/** Android only, and missing from builds before 0.5.0. */
const native = requireOptionalNativeModule<RestCountdownModule>('RestCountdown')

function quietly(work: () => void): void {
  try {
    work()
  } catch {
    // A notification that fails to post must not take the in-app timer down with it.
  }
}

/** Posts or moves the ongoing countdown notification. Past deadlines clear it instead. */
export function showRestCountdown(endsAt: number): void {
  quietly(() => native?.show(endsAt))
}

export function hideRestCountdown(): void {
  quietly(() => native?.hide())
}
