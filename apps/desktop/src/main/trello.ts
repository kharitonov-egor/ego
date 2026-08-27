import { net } from 'electron'
import { createTrelloClient, type TrelloClient } from '@ego/core'
import { getTrelloApiKey, getTrelloToken } from './settings'

export const trello: TrelloClient = createTrelloClient({
  getCredentials: () => ({ apiKey: getTrelloApiKey(), token: getTrelloToken() }),
  // Electron's net.fetch goes through the Chromium stack, so it picks up system proxy settings.
  fetch: (url, init) => net.fetch(url, init)
})
