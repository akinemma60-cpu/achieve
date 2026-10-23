import test from 'node:test'
import assert from 'node:assert/strict'
import { isKnownLesson, learningPaths } from './learningPaths.js'

test('the built-in learning catalog contains the expected starter lessons', () => {
  assert.equal(learningPaths.length, 3)
  assert.equal(learningPaths.reduce((count, path) => count + path.lessons.length, 0), 9)
  assert.equal(isKnownLesson('clear-communication', 'one-clear-point'), true)
  assert.equal(isKnownLesson('career-direction', 'run-a-small-experiment'), true)
})

test('unknown paths and lesson IDs cannot count as completed lessons', () => {
  assert.equal(isKnownLesson('unknown-path', 'one-clear-point'), false)
  assert.equal(isKnownLesson('clear-communication', 'unlisted-lesson'), false)
})
