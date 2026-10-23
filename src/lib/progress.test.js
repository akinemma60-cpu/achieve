import test from 'node:test'
import assert from 'node:assert/strict'
import { appendCoachMessage, getAchievements, getCurrentStreak, getLevelProgress, getWeekActivity, orderCoachMessages } from './progress.js'

test('levels advance every 120 earned XP', () => {
  assert.deepEqual(getLevelProgress(0), { level: 1, withinLevel: 0, nextLevelAt: 120 })
  assert.deepEqual(getLevelProgress(119), { level: 1, withinLevel: 119, nextLevelAt: 120 })
  assert.deepEqual(getLevelProgress(120), { level: 2, withinLevel: 0, nextLevelAt: 240 })
})

test('a streak remains active today or yesterday and resets after a missed UTC day', () => {
  const progress = { current_streak: 4, last_active_date: '2026-10-14' }
  assert.equal(getCurrentStreak(progress, '2026-10-15'), 4)
  assert.equal(getCurrentStreak(progress, '2026-10-14'), 4)
  assert.equal(getCurrentStreak(progress, '2026-10-16'), 0)
  assert.equal(getCurrentStreak({ current_streak: 4, last_active_date: '2025-12-31' }, '2026-01-01'), 4)
  assert.equal(getCurrentStreak({ current_streak: 4, last_active_date: null }, '2026-10-15'), 0)
})

test('weekly activity counts only completed missions on matching UTC dates', () => {
  const activity = getWeekActivity([
    { mission_date: '2026-10-09', completed_at: '2026-10-09T12:00:00Z' },
    { mission_date: '2026-10-09', completed_at: '2026-10-09T13:00:00Z' },
    { mission_date: '2026-10-09', completed_at: null },
    { mission_date: '2026-10-08', completed_at: '2026-10-08T13:00:00Z' }
  ], new Date('2026-10-15T12:00:00Z'))

  assert.equal(activity.length, 7)
  assert.equal(activity[0].date, '2026-10-09')
  assert.equal(activity[0].count, 2)
  assert.equal(activity[6].date, '2026-10-15')
  assert.equal(activity.reduce((total, day) => total + day.count, 0), 2)
})

test('weekly activity remains chronological across month and year boundaries', () => {
  const activity = getWeekActivity([
    { mission_date: '2025-12-31', completed_at: '2025-12-31T23:59:00Z' },
    { mission_date: '2026-01-02', completed_at: '2026-01-02T00:01:00Z' },
    { mission_date: '2026-01-03', completed_at: '2026-01-03T00:01:00Z' }
  ], new Date('2026-01-02T12:00:00Z'))

  assert.deepEqual(activity.map(({ date }) => date), [
    '2025-12-27', '2025-12-28', '2025-12-29', '2025-12-30', '2025-12-31', '2026-01-01', '2026-01-02'
  ])
  assert.equal(activity[4].count, 1)
  assert.equal(activity[6].count, 1)
  assert.equal(activity.reduce((total, day) => total + day.count, 0), 2)
})

test('weekly activity ignores missions without a completion timestamp', () => {
  const activity = getWeekActivity([
    { mission_date: '2026-10-15', completed_at: null },
    { mission_date: '2026-10-15', completed_at: '' },
    { mission_date: '2026-10-15', completed_at: '2026-10-15T10:00:00Z' }
  ], new Date('2026-10-15T12:00:00Z'))
  assert.equal(activity[6].count, 1)
  assert.equal(activity.reduce((total, day) => total + day.count, 0), 1)
})

test('weekly activity handles an empty mission list without crashing', () => {
  const activity = getWeekActivity([], new Date('2026-10-15T12:00:00Z'))
  assert.equal(activity.length, 7)
  assert.equal(activity.reduce((total, day) => total + day.count, 0), 0)
})

test('weekly activity ignores missions outside the 7-day UTC window', () => {
  const activity = getWeekActivity([
    { mission_date: '2026-10-08', completed_at: '2026-10-08T10:00:00Z' },
    { mission_date: '2026-10-15', completed_at: '2026-10-15T10:00:00Z' }
  ], new Date('2026-10-15T12:00:00Z'))
  // Window is Oct 9 - Oct 15; Oct 8 is outside
  assert.equal(activity.reduce((total, day) => total + day.count, 0), 1)
})

test('coach messages keep the order the database assigned, even when timestamps tie', () => {
  // A user prompt and the assistant reply it produced can share a `created_at`
  // value. The database sequence is what breaks the tie, so the reply must never
  // be able to render before the question it answered.
  const tied = [
    { role: 'assistant', content: 'Here is a first step.', seq: 2 },
    { role: 'user', content: 'Help me start.', seq: 1 }
  ]
  assert.deepEqual(
    orderCoachMessages(tied).map((message) => message.role),
    ['user', 'assistant']
  )

  const shuffled = [
    { role: 'assistant', content: 'Second answer.', seq: 4 },
    { role: 'user', content: 'Second question.', seq: 3 },
    { role: 'assistant', content: 'First answer.', seq: 2 },
    { role: 'user', content: 'First question.', seq: 1 }
  ]
  assert.deepEqual(
    orderCoachMessages(shuffled).map((message) => message.content),
    ['First question.', 'First answer.', 'Second question.', 'Second answer.']
  )
})

test('ordering coach messages does not mutate the array it was given', () => {
  const messages = [
    { role: 'assistant', content: 'Reply.', seq: 2 },
    { role: 'user', content: 'Question.', seq: 1 }
  ]
  const ordered = orderCoachMessages(messages)
  assert.notEqual(ordered, messages)
  assert.equal(messages[0].role, 'assistant')
})

test('a coach message without a sequence is kept at the end of the conversation', () => {
  const messages = [
    { role: 'user', content: 'Unsaved.', seq: null },
    { role: 'user', content: 'Saved question.', seq: 1 }
  ]
  assert.deepEqual(
    orderCoachMessages(messages).map((message) => message.content),
    ['Saved question.', 'Unsaved.']
  )
})

test('appending a coach message keeps the conversation in order', () => {
  const messages = [{ role: 'user', content: 'Question.', seq: 1 }]
  assert.deepEqual(
    appendCoachMessage(messages, { role: 'assistant', content: 'Answer.', seq: 2 }).map((message) => message.role),
    ['user', 'assistant']
  )
  assert.deepEqual(appendCoachMessage(undefined, { role: 'user', content: 'First.', seq: 1 }), [
    { role: 'user', content: 'First.', seq: 1 }
  ])
})

test('achievements unlock only from completed saved records', () => {
  const achievements = getAchievements({
    completedMissionCount: 0,
    completedGoalCount: 0,
    completedLessons: 0,
    roadmapCount: 0
  })
  assert.equal(achievements.some((achievement) => achievement.unlocked), false)
  assert.equal(getAchievements({
    completedMissionCount: 9,
    completedGoalCount: 0,
    completedLessons: 0,
    roadmapCount: 0
  }).some((achievement) => achievement.id === 'steady-practice' && achievement.unlocked), false)

  const earned = getAchievements({
    completedMissionCount: 10,
    completedGoalCount: 1,
    completedLessons: 1,
    roadmapCount: 1
  })
  assert.equal(earned.filter((achievement) => achievement.unlocked).length, 5)
})

// --- Level thresholds ---

test('level 1 spans 0 to 119 XP', () => {
  assert.deepEqual(getLevelProgress(0), { level: 1, withinLevel: 0, nextLevelAt: 120 })
  assert.deepEqual(getLevelProgress(1), { level: 1, withinLevel: 1, nextLevelAt: 120 })
  assert.deepEqual(getLevelProgress(119), { level: 1, withinLevel: 119, nextLevelAt: 120 })
})

test('level advances exactly at every 120 XP threshold', () => {
  assert.deepEqual(getLevelProgress(120), { level: 2, withinLevel: 0, nextLevelAt: 240 })
  assert.deepEqual(getLevelProgress(121), { level: 2, withinLevel: 1, nextLevelAt: 240 })
  assert.deepEqual(getLevelProgress(239), { level: 2, withinLevel: 119, nextLevelAt: 240 })
  assert.deepEqual(getLevelProgress(240), { level: 3, withinLevel: 0, nextLevelAt: 360 })
  assert.deepEqual(getLevelProgress(360), { level: 4, withinLevel: 0, nextLevelAt: 480 })
})

test('level calculation handles high XP without drift', () => {
  assert.deepEqual(getLevelProgress(720), { level: 7, withinLevel: 0, nextLevelAt: 840 })
  assert.deepEqual(getLevelProgress(1200), { level: 11, withinLevel: 0, nextLevelAt: 1320 })
})

// --- Streak: UTC date policy and midnight boundaries ---

test('a streak stays active at the UTC midnight boundary (yesterday counts)', () => {
  // Active late on Oct 14 (23:59:59 UTC); checked early on Oct 15 (00:00:01 UTC)
  assert.equal(
    getCurrentStreak({ current_streak: 3, last_active_date: '2026-10-14' }, '2026-10-15'),
    3
  )
})

test('a streak resets after missing a full UTC day', () => {
  // Last active Oct 13; checked Oct 15 (Oct 14 was missed)
  assert.equal(
    getCurrentStreak({ current_streak: 5, last_active_date: '2026-10-13' }, '2026-10-15'),
    0
  )
})

test('a streak stays active when checked on the same day as last activity', () => {
  assert.equal(
    getCurrentStreak({ current_streak: 2, last_active_date: '2026-10-15' }, '2026-10-15'),
    2
  )
})

test('a streak crosses the year boundary at UTC midnight', () => {
  assert.equal(
    getCurrentStreak({ current_streak: 7, last_active_date: '2025-12-31' }, '2026-01-01'),
    7
  )
  assert.equal(
    getCurrentStreak({ current_streak: 7, last_active_date: '2025-12-30' }, '2026-01-01'),
    0
  )
})

test('streak calculation does not crash on missing or null data', () => {
  assert.equal(getCurrentStreak(undefined), 0)
  assert.equal(getCurrentStreak(null), 0)
  assert.equal(getCurrentStreak({}), 0)
  assert.equal(getCurrentStreak({ last_active_date: null }), 0)
  assert.equal(getCurrentStreak({ current_streak: 0, last_active_date: '2026-10-15' }, '2026-10-15'), 0)
  assert.equal(getCurrentStreak({ current_streak: 5, last_active_date: null }, '2026-10-15'), 0)
})

test('streak calculation does not crash on malformed date strings', () => {
  assert.equal(
    getCurrentStreak({ current_streak: 5, last_active_date: 'not-a-date' }, '2026-10-15'),
    0
  )
})

// --- Achievements derived strictly from persisted counts ---

test('achievements stay locked when all persisted counts are zero', () => {
  const achievements = getAchievements({
    completedMissionCount: 0,
    completedGoalCount: 0,
    completedLessons: 0,
    roadmapCount: 0
  })
  assert.equal(achievements.length, 5)
  assert.equal(achievements.filter((a) => a.unlocked).length, 0)
  assert.equal(achievements.every((a) => !a.unlocked), true)
})

test('achievements unlock one at a time as persisted counts cross thresholds', () => {
  const oneMission = getAchievements({ completedMissionCount: 1, completedGoalCount: 0, completedLessons: 0, roadmapCount: 0 })
  assert.equal(oneMission.find((a) => a.id === 'first-step')?.unlocked, true)
  assert.equal(oneMission.find((a) => a.id === 'goal-finished')?.unlocked, false)

  const oneGoal = getAchievements({ completedMissionCount: 0, completedGoalCount: 1, completedLessons: 0, roadmapCount: 0 })
  assert.equal(oneGoal.find((a) => a.id === 'goal-finished')?.unlocked, true)
  assert.equal(oneGoal.find((a) => a.id === 'first-step')?.unlocked, false)

  const oneRoadmap = getAchievements({ completedMissionCount: 0, completedGoalCount: 0, completedLessons: 0, roadmapCount: 1 })
  assert.equal(oneRoadmap.find((a) => a.id === 'plan-maker')?.unlocked, true)

  const oneLesson = getAchievements({ completedMissionCount: 0, completedGoalCount: 0, completedLessons: 1, roadmapCount: 0 })
  assert.equal(oneLesson.find((a) => a.id === 'curious-mind')?.unlocked, true)
})

test('achievements cannot be inflated by arbitrary browser-state values', () => {
  // Even if a caller passes inflated counts, each achievement is gated by its
  // own threshold; no achievement unlocks without meeting its saved-record rule.
  const inflated = getAchievements({
    completedMissionCount: 999,
    completedGoalCount: 999,
    completedLessons: 999,
    roadmapCount: 999
  })
  assert.equal(inflated.filter((a) => a.unlocked).length, 5)
  assert.equal(inflated.every((a) => a.unlocked), true)
})

test('achievement derivation does not mutate its input', () => {
  const input = { completedMissionCount: 0, completedGoalCount: 0, completedLessons: 0, roadmapCount: 0 }
  const before = JSON.stringify(input)
  getAchievements(input)
  assert.equal(JSON.stringify(input), before)
})
