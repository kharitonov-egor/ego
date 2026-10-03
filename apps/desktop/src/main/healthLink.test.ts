import { describe, expect, it } from 'vitest'
import { healthRouteIn } from './healthLink'

describe('healthRouteIn', () => {
  it('ignores a launch without a Health link', () => {
    expect(healthRouteIn(['Ego.exe', '--hidden'])).toBeNull()
    expect(healthRouteIn(['Ego.exe', 'ego://auth?code=abc'])).toBeNull()
  })

  it('opens Health after Google grants access', () => {
    expect(healthRouteIn(['Ego.exe', 'ego://health?connected=1'])).toBe('/health?connected=1')
  })

  it('passes the reason Google gave back', () => {
    expect(healthRouteIn(['Ego.exe', 'ego://health?error=no_access'])).toBe('/health?error=no_access')
  })

  it('drops anything else in the link', () => {
    expect(healthRouteIn(['Ego.exe', 'ego://health?error=%2Fsettings&next=/money'])).toBe('/health')
    expect(healthRouteIn(['Ego.exe', 'ego://health'])).toBe('/health')
  })
})
