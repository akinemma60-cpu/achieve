export const getLevelProgress = (xp) => ({
  level: Math.floor(xp / 120) + 1,
  withinLevel: xp % 120,
  nextLevelAt: (Math.floor(xp / 120) + 1) * 120
})

export const getCurrentStreak = (progress, today = new Date().toISOString().slice(0, 10)) => {
  if (!progress?.last_active_date || !progress.current_streak) return 0
  const yesterday = new Date(`${today}T00:00:00.000Z`)
  yesterday.setUTCDate(yesterday.getUTCDate() - 1)
  const yesterdayIso = yesterday.toISOString().slice(0, 10)
  return progress.last_active_date === today || progress.last_active_date === yesterdayIso
    ? progress.current_streak
    : 0
}

export const getWeekActivity = (missions, today = new Date()) => {
  const days = Array.from({ length: 7 }, (_, offset) => {
    const date = new Date(Date.UTC(
      today.getUTCFullYear(),
      today.getUTCMonth(),
      today.getUTCDate() - (6 - offset)
    ))
    return {
      date: date.toISOString().slice(0, 10),
      label: new Intl.DateTimeFormat('en', { weekday: 'short', timeZone: 'UTC' }).format(date),
      count: 0
    }
  })

  const byDate = new Map(days.map((day) => [day.date, day]))
  missions.forEach((mission) => {
    if (!mission.completed_at) return
    const date = mission.mission_date
    const day = byDate.get(date)
    if (day) day.count += 1
  })
  return days
}

// Coach conversations render oldest first. `seq` is a monotonic sequence assigned
// by the database, so it orders messages deterministically even when two rows
// share the same `created_at` timestamp. Messages without a sequence (for
// example an optimistic entry that has not been saved yet) sort last, which
// keeps them at the end of the conversation where they belong.
export const orderCoachMessages = (messages) => messages
  .slice()
  .sort((a, b) => (a.seq ?? Infinity) - (b.seq ?? Infinity))

export const appendCoachMessage = (messages, message) => [
  ...(messages ?? []),
  message
]

export const getAchievements = ({ completedMissionCount, completedGoalCount, completedLessons, roadmapCount }) => [
  {
    id: 'first-step',
    title: 'First step',
    description: 'Complete your first daily mission.',
    unlocked: completedMissionCount >= 1
  },
  {
    id: 'steady-practice',
    title: 'Steady practice',
    description: 'Complete ten daily missions.',
    unlocked: completedMissionCount >= 10
  },
  {
    id: 'goal-finished',
    title: 'Goal complete',
    description: 'Finish a goal you set for yourself.',
    unlocked: completedGoalCount >= 1
  },
  {
    id: 'plan-maker',
    title: 'Plan maker',
    description: 'Create a personalized roadmap.',
    unlocked: roadmapCount >= 1
  },
  {
    id: 'curious-mind',
    title: 'Curious mind',
    description: 'Complete your first learning lesson.',
    unlocked: completedLessons >= 1
  }
]
