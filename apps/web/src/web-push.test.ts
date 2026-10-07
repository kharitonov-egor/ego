import { describe, expect, it } from 'vitest'
import { base64UrlToBytes, subscriptionInput, vapidKey } from './web-push'

const base64url = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64url')
const filled = (length: number, first = 0): Uint8Array => Uint8Array.from({ length }, (_, index) => index === 0 ? first : (index * 37) % 256)

describe('base64UrlToBytes', () => {
  it('reads every length, with or without padding', () => {
    for (let length = 0; length <= 70; length += 1) {
      const bytes = filled(length, 251)
      expect(base64UrlToBytes(base64url(bytes))).toEqual(bytes)
      expect(base64UrlToBytes(Buffer.from(bytes).toString('base64').replace(/\+/g, '-').replace(/\//g, '_'))).toEqual(bytes)
    }
  })

  it('turns down plain base64 and anything else', () => {
    expect(() => base64UrlToBytes('ab+/')).toThrow()
    expect(() => base64UrlToBytes('ab cd')).toThrow()
    expect(() => base64UrlToBytes('a')).toThrow()
  })
})

describe('vapidKey', () => {
  it('takes only an uncompressed P-256 point', () => {
    const point = filled(65, 4)
    expect(vapidKey(base64url(point))).toEqual(point)
    expect(vapidKey(base64url(filled(65, 2)))).toBeNull()
    expect(vapidKey(base64url(filled(33, 4)))).toBeNull()
    expect(vapidKey('not a key')).toBeNull()
    expect(vapidKey('')).toBeNull()
  })
})

describe('subscriptionInput', () => {
  const keys = { p256dh: base64url(filled(65, 4)), auth: base64url(filled(16)) }
  const endpoint = 'https://fcm.googleapis.com/fcm/send/abc123'

  it('keeps the endpoint and the two keys the Worker encrypts for', () => {
    expect(subscriptionInput({ endpoint, expirationTime: null, keys: { ...keys, extra: 'x' } })).toEqual({ endpoint, keys })
  })

  it('gives null for a subscription the Worker would refuse', () => {
    expect(subscriptionInput({ endpoint, expirationTime: null })).toBeNull()
    expect(subscriptionInput({ endpoint: 'http://push.example/abc', keys })).toBeNull()
    expect(subscriptionInput({ keys })).toBeNull()
    expect(subscriptionInput({ endpoint, keys: { p256dh: keys.p256dh } })).toBeNull()
  })
})
