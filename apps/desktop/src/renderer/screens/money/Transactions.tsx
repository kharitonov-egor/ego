import React from 'react'
import { SignInPrompt } from '../../components/money/Common'
import LocalActivity from '../../components/money/LocalActivity'
import { Screen } from '../../components/screen'
import { useLedger } from '../../lib/ledger'
import { FinanceHeader } from './header'

export default function Transactions(): React.ReactElement {
  const ledger = useLedger()
  return <Screen>
    <FinanceHeader />
    <div className="flex min-h-0 flex-1 flex-col">{ledger.enabled ? <LocalActivity /> : <SignInPrompt />}</div>
  </Screen>
}
