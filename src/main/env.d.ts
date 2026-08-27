interface ImportMetaEnv {
  readonly MAIN_VITE_TRELLO_API_KEY?: string
  readonly MAIN_VITE_TRELLO_TOKEN?: string
  readonly MAIN_VITE_TRELLO_BOARD_ID?: string
  readonly MAIN_VITE_TRELLO_LIST_ID?: string
  readonly MAIN_VITE_WEBHOOK_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
