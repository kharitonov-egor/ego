import React from 'react'
import { Navigate, Route, Routes } from 'react-router'
import FoodLog from './Log'
import Fridge from './Fridge'

/** The phone's Log and Fridge tabs under `/food/*`. The provider sits in App, where the phone keeps it. */
export default function FoodApp(): React.ReactElement {
  return <Routes>
    <Route index element={<FoodLog />} />
    <Route path="entry/:id" element={<FoodLog />} />
    <Route path="fridge" element={<Fridge />} />
    <Route path="*" element={<Navigate to="/food" replace />} />
  </Routes>
}
