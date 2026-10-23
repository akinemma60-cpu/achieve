import test from 'node:test'
import assert from 'node:assert/strict'
import {
  GOAL_CATEGORIES,
  GOAL_TITLE_MAX,
  PROFILE_FOCUS_MAX,
  PROFILE_NAME_MAX,
  validateCoachMessage,
  validateGoal,
  validateMission,
  validateProfile
} from './validation.js'

test('a valid goal produces no validation problems', () => {
  assert.deepEqual(validateGoal({
    title: 'Run a half marathon',
    category: 'Health',
    description: 'Finish the local 10k route.',
    motivation: 'I want more energy.',
    targetDate: '2026-11-01',
    progress: 20
  }), [])
})

test('goal titles are checked against the database length limits', () => {
  assert.equal(validateGoal({ title: 'ab', category: 'Personal', progress: 0 }).length, 1)
  assert.equal(validateGoal({ title: 'a'.repeat(GOAL_TITLE_MAX + 1), category: 'Personal', progress: 0 }).length, 1)
  assert.deepEqual(validateGoal({ title: 'a'.repeat(GOAL_TITLE_MAX), category: 'Personal', progress: 0 }), [])
})

test('goal text fields are limited to the same length as the database', () => {
  const problems = validateGoal({
    title: 'Learn something new',
    category: 'Learning',
    description: 'x'.repeat(2001),
    motivation: 'y'.repeat(2001),
    progress: 0
  })
  assert.equal(problems.length, 2)
})

test('a goal category outside the supported list is rejected', () => {
  assert.equal(validateGoal({ title: 'Valid title', category: 'Nope', progress: 0 }).length, 1)
  assert.deepEqual(validateGoal({ title: 'Valid title', category: GOAL_CATEGORIES[0], progress: 0 }), [])
})

test('goal progress must be a whole number between 0 and 100', () => {
  assert.equal(validateGoal({ title: 'Valid title', category: 'Personal', progress: -1 }).length, 1)
  assert.equal(validateGoal({ title: 'Valid title', category: 'Personal', progress: 101 }).length, 1)
  assert.equal(validateGoal({ title: 'Valid title', category: 'Personal', progress: 55.5 }).length, 1)
  assert.deepEqual(validateGoal({ title: 'Valid title', category: 'Personal', progress: 0 }), [])
})

test('a malformed goal target date is rejected', () => {
  assert.equal(validateGoal({ title: 'Valid title', category: 'Personal', targetDate: '01/11/2026', progress: 0 }).length, 1)
  assert.deepEqual(validateGoal({ title: 'Valid title', category: 'Personal', targetDate: '', progress: 0 }), [])
})

test('profile fields are limited to the same length as the database', () => {
  assert.deepEqual(validateProfile({ display_name: 'Sam', focus: 'Learning to cook' }), [])
  assert.equal(validateProfile({ display_name: 'a'.repeat(PROFILE_NAME_MAX + 1), focus: '' }).length, 1)
  assert.equal(validateProfile({ display_name: '', focus: 'a'.repeat(PROFILE_FOCUS_MAX + 1) }).length, 1)
})

test('a coach message must have content and fit the character limit', () => {
  assert.equal(validateCoachMessage('').length, 1)
  assert.equal(validateCoachMessage('   ').length, 1)
  assert.deepEqual(validateCoachMessage('Help me start.'), [])
  assert.equal(validateCoachMessage('a'.repeat(2001)).length, 1)
  assert.deepEqual(validateCoachMessage('a'.repeat(2000)), [])
})

test('a mission needs an active goal and a bounded action', () => {
  assert.deepEqual(validateMission({ goalId: 'goal-1', title: 'Write the outline', description: '' }), [])
  assert.equal(validateMission({ goalId: '', title: 'Write the outline', description: '' }).length, 1)
  assert.equal(validateMission({ goalId: 'goal-1', title: '   ', description: '' }).length, 1)
  assert.equal(validateMission({ goalId: 'goal-1', title: 'a'.repeat(181), description: '' }).length, 1)
  assert.equal(validateMission({ goalId: 'goal-1', title: 'Write the outline', description: 'a'.repeat(1001) }).length, 1)
})

// --- Coach message validation edge cases ---

test('coach message validation rejects null and undefined input', () => {
  assert.equal(validateCoachMessage(null).length, 1)
  assert.equal(validateCoachMessage(undefined).length, 1)
  assert.equal(validateCoachMessage(123).length, 1)
})

test('coach message validation accepts whitespace-trimmed content at the limit', () => {
  assert.deepEqual(validateCoachMessage('  a  '), [])
  assert.deepEqual(validateCoachMessage('a'.repeat(2000)), [])
})

test('coach message validation rejects content over the limit', () => {
  assert.equal(validateCoachMessage('a'.repeat(2001)).length, 1)
})
