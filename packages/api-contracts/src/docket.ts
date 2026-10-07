/** Ten lowercase letters and digits, the last part of `/docket/<id>`. */
export const DOCKET_ID_PATTERN = /^[a-z0-9]{10}$/
export const DOCKET_ID_LENGTH = 10

/** One uploaded HTML file. Agents inline their images, so a version stays well under this. */
export const MAX_DOCKET_BYTES = 10 * 1024 * 1024
export const MAX_DOCKET_TITLE = 200
export const MAX_DOCKET_DESCRIPTION = 1000

/** Every CLI key starts with this, so the Worker can tell one from a device token at a glance. */
export const DOCKET_KEY_PREFIX = 'egodk_'

/** The private-docket cookie, readable only by pages under `/docket/`. */
export const DOCKET_COOKIE = 'ego_docket'
export const DOCKET_SESSION_PATH = '/docket/session'

/**
 * A private docket's page sends a signed-out browser here, with `<id>` or `<id>/v/<n>` as the
 * value. Ego signs in, sets the cookie, and goes back to the docket.
 */
export const DOCKET_OPEN_PATH = '/dockets'
export const DOCKET_OPEN_PARAM = 'open'
export const DOCKET_OPEN_TARGET = /^[a-z0-9]{10}(?:\/v\/[1-9][0-9]{0,5})?$/

export interface DocketSummary {
  id: string
  title: string
  description: string
  public: boolean
  /** `owner/name` from the git remote the CLI ran in, or null outside a repository. */
  repository: string | null
  latestVersion: number
  versionCount: number
  createdAt: string
  updatedAt: string
  /** Always shows the latest version. */
  url: string
}

export interface DocketVersion {
  version: number
  size: number
  commit: string | null
  ref: string | null
  createdAt: string
  url: string
}

export interface DocketDetail extends DocketSummary {
  /** Newest first. */
  versions: DocketVersion[]
}

export interface DocketList {
  dockets: DocketSummary[]
}

/** The `meta` part of an upload. Title and description fall back to the file's own `<title>` and meta description. */
export interface DocketUploadMeta {
  title?: string
  description?: string
  /** Left out on a new version, the docket keeps its visibility. A new docket starts private. */
  public?: boolean
  fileName?: string
  repository?: string
  commit?: string
  ref?: string
}

export interface DocketUploaded {
  docket: DocketSummary
  version: number
  versionUrl: string
}

export interface DocketUpdate {
  title?: string
  description?: string
  public?: boolean
}

export interface DocketKeySummary {
  id: string
  name: string
  createdAt: string
  lastUsedAt: string | null
}

export interface DocketKeyList {
  keys: DocketKeySummary[]
}

/** `token` is shown once. The Worker keeps only its hash. */
export interface DocketKeyCreated {
  key: DocketKeySummary
  token: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function optional(value: unknown, check: (field: unknown) => boolean): boolean {
  return value === undefined || check(value)
}

const isString = (value: unknown): boolean => typeof value === 'string'
const isBoolean = (value: unknown): boolean => typeof value === 'boolean'

export function isDocketUploadMeta(value: unknown): value is DocketUploadMeta {
  return isRecord(value) &&
    optional(value.title, isString) && optional(value.description, isString) && optional(value.public, isBoolean) &&
    optional(value.fileName, isString) && optional(value.repository, isString) &&
    optional(value.commit, isString) && optional(value.ref, isString)
}

export function isDocketUpdate(value: unknown): value is DocketUpdate {
  return isRecord(value) && optional(value.title, isString) && optional(value.description, isString) &&
    optional(value.public, isBoolean) &&
    (value.title !== undefined || value.description !== undefined || value.public !== undefined)
}
