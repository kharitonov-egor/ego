import React from 'react'
import ReactDOM from 'react-dom/client'
import { HashRouter } from 'react-router'
import App from '@ego/ui/App'
import '@ego/ui/styles/globals.css'
import TitleBar from './TitleBar'

// A file dropped where no screen takes it would replace the whole page with that file. Screens that
// accept files handle their drops before the event reaches the window.
window.addEventListener('dragover', (event) => event.preventDefault())
window.addEventListener('drop', (event) => event.preventDefault())

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <HashRouter>
      <App titleBar={<TitleBar />} />
    </HashRouter>
  </React.StrictMode>
)
