import React from 'react'
import { useLedger } from '../../lib/ledger-context'
import { ConflictEntries } from '../ConflictEntries'
import { BottomSheet } from '../money/Common'

/** Needs attention for the gym screens. The header's sync button opens it instead of Activity. */
export function GymReviewSheet({ visible, onClose }: { visible: boolean; onClose: () => void }): React.ReactElement {
  const ledger = useLedger()
  return <BottomSheet visible={visible} title="Needs attention" onClose={onClose}>
    <ConflictEntries
      entries={ledger.conflicts}
      onKeepMine={(entry) => void ledger.resolveKeepMine(entry).then(onClose)}
      onUseSaved={(entry) => void ledger.resolveUseSaved(entry).then(onClose)}
    />
  </BottomSheet>
}
