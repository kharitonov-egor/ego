export interface ContentKey { id: string; name: string; createdAt: string }
export interface ContentKeyList { keys: ContentKey[] }
export interface ContentKeyCreated { key: ContentKey; token: string }
