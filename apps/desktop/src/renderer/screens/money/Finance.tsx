import React from 'react'
import { Navigate, Outlet, Route } from 'react-router'
import { ReceiptReaderProvider } from '../../components/money/ReceiptReader'
import Accounts from './Accounts'
import Budget from './Budget'
import Categories from './Categories'
import Overview from './Overview'
import Purchases from './Purchases'
import TransactionDetail from './Transaction'
import Transactions from './Transactions'

/** Every Finance page shares the receipt reader, so a pasted or dropped receipt works on any of them. */
function Finance(): React.ReactElement {
  return <ReceiptReaderProvider><Outlet /></ReceiptReaderProvider>
}

export const moneyRoutes = <Route path="/money" element={<Finance />}>
  <Route index element={<Navigate to="/money/overview" replace />} />
  <Route path="overview" element={<Overview />} />
  <Route path="transactions" element={<Transactions />} />
  <Route path="categories" element={<Categories />} />
  <Route path="budget" element={<Budget />} />
  <Route path="accounts" element={<Accounts />} />
  <Route path="transaction/:id" element={<TransactionDetail />} />
  <Route path="purchases" element={<Purchases />} />
  <Route path="*" element={<Navigate to="/money/overview" replace />} />
</Route>
