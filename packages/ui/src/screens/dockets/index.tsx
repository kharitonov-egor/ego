import React from 'react'
import { Navigate, Route, Routes } from 'react-router'
import DocketCli from './DocketCli'
import DocketDetail from './DocketDetail'
import DocketList from './DocketList'

/** Everything under /dockets. The pages themselves live at /docket/<id>, served by the Worker. */
export default function DocketRoutes(): React.ReactElement {
  return <Routes>
    <Route index element={<DocketList />} />
    <Route path="cli" element={<DocketCli />} />
    <Route path=":id" element={<DocketDetail />} />
    <Route path="*" element={<Navigate to="/dockets" replace />} />
  </Routes>
}
