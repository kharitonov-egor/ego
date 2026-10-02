/**
 * The phone keeps small settings in SecureStore. Here the main process keeps them in its settings
 * file, under the same `ego.*` keys, so ported screens read and write them the same way.
 */
export const SecureStore = {
  getItemAsync: (key: string): Promise<string | null> => window.api.preferenceGet(key),
  setItemAsync: (key: string, value: string): Promise<void> => window.api.preferenceSet(key, value),
  deleteItemAsync: (key: string): Promise<void> => window.api.preferenceSet(key, null)
}
