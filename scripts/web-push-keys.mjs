#!/usr/bin/env node
// Prints a new VAPID key pair for the Worker's Web Push. Run it once, then from apps/api:
//   npx wrangler secret put WEB_PUSH_PUBLIC_KEY   (paste the public key)
//   npx wrangler secret put WEB_PUSH_PRIVATE_KEY  (paste the private key)
// A new pair cuts off every browser that subscribed with the old one until it subscribes again.
import { webcrypto } from 'node:crypto'

const pair = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
const publicRaw = new Uint8Array(await webcrypto.subtle.exportKey('raw', pair.publicKey))
const privateJwk = await webcrypto.subtle.exportKey('jwk', pair.privateKey)
const base64url = (bytes) => Buffer.from(bytes).toString('base64url')

console.log(`WEB_PUSH_PUBLIC_KEY=${base64url(publicRaw)}`)
console.log(`WEB_PUSH_PRIVATE_KEY=${privateJwk.d}`)
