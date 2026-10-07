import React from 'react'
import { Outlet } from 'react-router'
import { HealthProvider } from '../../lib/health/context'

/** The phone's Health stack: one provider for the overview and every metric under it. */
export default function Health(): React.ReactElement {
  return <HealthProvider><Outlet /></HealthProvider>
}
