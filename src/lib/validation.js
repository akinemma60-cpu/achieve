// Input validation shared by the write paths in App.jsx.
//
// The database enforces these limits with CHECK constraints, but a constraint
// violation reaches the user as a raw Postgres error such as
// `check_violation` on `goals_title_check`. Validating before the request
// keeps malformed data out of the write and gives an actionable message.

export const GOAL_CATEGORIES = [
  'Career',
  'Health',
  'Learning',
  'Mindset',
  'Creativity',
  'Relationships',
  'Personal'
]

export const GOAL_TITLE_MIN = 3
export const GOAL_TITLE_MAX = 160
export const GOAL_TEXT_MAX = 2000
export const PROFILE_NAME_MAX = 80
export const PROFILE_FOCUS_MAX = 200

const isBlank = (value) => typeof value !== 'string' || value.trim().length === 0

// Returns a list of human-readable problems. An empty list means the input is
// safe to send to the database.
export const validateGoal = (form) => {
  const problems = []
  const title = typeof form?.title === 'string' ? form.title.trim() : ''

  if (title.length < GOAL_TITLE_MIN) {
    problems.push(`Give your goal a name of at least ${GOAL_TITLE_MIN} characters.`)
  }
  if (title.length > GOAL_TITLE_MAX) {
    problems.push(`Goal names are limited to ${GOAL_TITLE_MAX} characters.`)
  }
  if (form?.category && !GOAL_CATEGORIES.includes(form.category)) {
    problems.push('Choose one of the listed areas for this goal.')
  }

  for (const [key, label] of [['description', 'success'], ['motivation', 'motivation']]) {
    const value = typeof form?.[key] === 'string' ? form[key] : ''
    if (value.length > GOAL_TEXT_MAX) {
      problems.push(`The ${label} field is limited to ${GOAL_TEXT_MAX} characters.`)
    }
  }

  const progress = Number(form?.progress)
  if (!Number.isInteger(progress) || progress < 0 || progress > 100) {
    problems.push('Progress must be a whole number between 0 and 100.')
  }

  if (form?.targetDate && !/^\d{4}-\d{2}-\d{2}$/.test(form.targetDate)) {
    problems.push('Enter the target date as a calendar date.')
  }

  return problems
}

export const validateProfile = (draft) => {
  const problems = []
  const displayName = typeof draft?.display_name === 'string' ? draft.display_name.trim() : ''
  const focus = typeof draft?.focus === 'string' ? draft.focus.trim() : ''

  if (displayName.length > PROFILE_NAME_MAX) {
    problems.push(`Display names are limited to ${PROFILE_NAME_MAX} characters.`)
  }
  if (focus.length > PROFILE_FOCUS_MAX) {
    problems.push(`Focus notes are limited to ${PROFILE_FOCUS_MAX} characters.`)
  }

  return problems
}

export const validateCoachMessage = (message) => {
  const problems = []
  const text = typeof message === 'string' ? message.trim() : ''

  if (isBlank(text)) {
    problems.push('Write a message before sending it to your coach.')
  }
  if (text.length > 2000) {
    problems.push('Messages are limited to 2000 characters.')
  }

  return problems
}

export const MISSION_TITLE_MAX = 180
export const MISSION_DESCRIPTION_MAX = 1000

export const validateMission = (draft) => {
  const problems = []
  const title = typeof draft?.title === 'string' ? draft.title.trim() : ''
  const description = typeof draft?.description === 'string' ? draft.description : ''

  if (!draft?.goalId) {
    problems.push('Connect the mission to one of your active goals.')
  }
  if (title.length < 1) {
    problems.push('Describe the action you want to complete.')
  }
  if (title.length > MISSION_TITLE_MAX) {
    problems.push(`Actions are limited to ${MISSION_TITLE_MAX} characters.`)
  }
  if (description.length > MISSION_DESCRIPTION_MAX) {
    problems.push(`Extra context is limited to ${MISSION_DESCRIPTION_MAX} characters.`)
  }

  return problems
}
