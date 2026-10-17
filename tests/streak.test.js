import { describe, it, expect } from 'vitest'
import { StreakTracker } from '../apps/ferret-heist/src/game/streak.js'

describe('StreakTracker', () => {
  it('starts with an empty streak', () => {
    const tracker = new StreakTracker()
    expect(tracker.streak).toBe(0)
  })

  it('awards a streak bonus on the second deposit', () => {
    const tracker = new StreakTracker()
    tracker.registerDeposit(100)
    const bonus = tracker.registerDeposit(100)
    expect(bonus).toBe(25)
  })
})
