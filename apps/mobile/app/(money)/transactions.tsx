import React from 'react'
import LocalActivity from '../../components/money/LocalActivity'
import { SignInPrompt } from '../../components/money/Common'
import { useLedger } from '../../lib/ledger-context'

export default function Transactions(): React.ReactElement {
  const ledger = useLedger()
  return ledger.enabled ? <LocalActivity /> : <SignInPrompt />
}
