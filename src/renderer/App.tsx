import React from 'react'
import TitleBar from './components/TitleBar'
import SettingsView from './components/SettingsView'

export default function App(): React.ReactElement {
  return (
    <div className="h-screen overflow-hidden bg-surface-950 text-surface-100">
      <TitleBar />
      <div className="h-[calc(100vh-32px)]">
        <SettingsView />
      </div>
    </div>
  )
}
