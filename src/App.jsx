import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from './lib/supabase.js'
import { appendCoachMessage, getAchievements, getCurrentStreak, getLevelProgress, getWeekActivity, orderCoachMessages } from './lib/progress.js'
import { isKnownLesson, learningPaths } from './lib/learningPaths.js'
import { validateCoachMessage, validateGoal, validateMission, validateProfile } from './lib/validation.js'

const todayUtc = () => new Date().toISOString().slice(0, 10)
const weekStartUtc = () => {
  const date = new Date(`${todayUtc()}T00:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() - 6)
  return date.toISOString().slice(0, 10)
}
const formatDate = (value) => value
  ? new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${value}T00:00:00.000Z`))
  : 'No target date'
const edgeErrorMessage = async (error, fallback) => {
  let message = error.message
  let status = error.context?.status
  if (error.context && typeof error.context.json === 'function') {
    try {
      const responseBody = await error.context.json()
      if (responseBody?.error) message = responseBody.error
    } catch {
      message = error.message
    }
  }
  if (status === 429) return message || 'You have reached today’s request limit. Try again tomorrow.'
  if (status === 503) return message || 'This AI feature is not configured yet.'
  return message || fallback
}
const initialGoal = { title: '', category: 'Career', targetDate: '', description: '', motivation: '', progress: 0 }
const navItems = [
  { id: 'overview', label: 'Overview', icon: 'grid' },
  { id: 'goals', label: 'Goals', icon: 'target' },
  { id: 'roadmaps', label: 'Roadmaps', icon: 'route' },
  { id: 'missions', label: 'Daily missions', icon: 'check' },
  { id: 'coach', label: 'AI coach', icon: 'spark' },
  { id: 'learning', label: 'Learning', icon: 'book' },
  { id: 'insights', label: 'Insights', icon: 'chart' },
  { id: 'settings', label: 'Settings', icon: 'settings' }
]

function Icon({ name, size = 18 }) {
  const paths = {
    grid: <><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></>,
    target: <><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="4.5" /><circle cx="12" cy="12" r="1" /></>,
    route: <><circle cx="6" cy="18" r="2" /><circle cx="18" cy="6" r="2" /><path d="M8 18h3a3 3 0 0 0 3-3v-3a3 3 0 0 1 3-3h1" /><path d="m16 4 2-2 2 2" /></>,
    check: <><path d="M20 7 10 17l-5-5" /><path d="M21 12a9 9 0 1 1-5.4-8.25" /></>,
    spark: <><path d="m12 3 1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z" /><path d="m19 15 .9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9L19 15Z" /></>,
    book: <><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v16H6.5A2.5 2.5 0 0 0 4 21.5v-16Z" /><path d="M4 17a2.5 2.5 0 0 1 2.5-2.5H20" /><path d="M8 7h8M8 10h7" /></>,
    chart: <><path d="M4 19V5M4 19h17" /><path d="m7 15 4-4 3 2 5-6" /><path d="M16 7h3v3" /></>,
    settings: <><circle cx="12" cy="12" r="3" /><path d="m19.4 15 .1.1 1.4 1.1-1.4 2.4-1.7-.7a8 8 0 0 1-1.5.9L16 20.5h-2.8l-.4-1.8a8 8 0 0 1-1.6-.1l-1.1 1.4-2.4-1.4.7-1.7a8 8 0 0 1-.9-1.5L5.7 15v-2.8l1.8-.4a8 8 0 0 1 .1-1.6L6.2 9.1l1.4-2.4 1.7.7a8 8 0 0 1 1.5-.9L11.2 4h2.8l.4 1.8a8 8 0 0 1 1.6.1l1.1-1.4 2.4 1.4-.7 1.7a8 8 0 0 1 .9 1.5l1.8.4v2.8l-1.8.4a8 8 0 0 1-.3 2.3Z" /></>,
    plus: <><path d="M12 5v14M5 12h14" /></>,
    arrow: <><path d="M5 12h14M13 6l6 6-6 6" /></>,
    close: <><path d="m18 6-12 12M6 6l12 12" /></>,
    flame: <><path d="M12 22c4.4 0 7-2.7 7-6.4 0-2.6-1.5-4.4-3.3-6.2-.2 2-1.1 3.1-2.1 3.8.2-4-1.3-7-4.4-10.2.1 3.3-.8 5.3-2.7 7.4C4.8 12.2 5 14.2 5 15.7 5 19.4 7.6 22 12 22Z" /></>,
    user: <><circle cx="12" cy="8" r="3.5" /><path d="M5 20a7 7 0 0 1 14 0" /></>
  }

  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{paths[name] ?? paths.grid}</svg>
}

const goalFromRow = (row) => ({
  id: row.id,
  title: row.title,
  category: row.category,
  description: row.description,
  motivation: row.motivation,
  targetDate: row.target_date,
  status: row.status,
  progress: row.progress
})

function GoalEditor({ goal, onSave, onCancel, busy }) {
  const [form, setForm] = useState(() => goal ?? initialGoal)
  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }))

  return (
    <form className="form-stack" onSubmit={(event) => { event.preventDefault(); onSave(form) }}>
      <label>Goal name
        <input required minLength={3} maxLength={160} value={form.title} onChange={(event) => update('title', event.target.value)} placeholder="What would you like to make progress on?" />
      </label>
      <div className="field-grid">
        <label>Area
          <select value={form.category} onChange={(event) => update('category', event.target.value)}>
            {['Career', 'Health', 'Learning', 'Mindset', 'Creativity', 'Relationships', 'Personal'].map((item) => <option key={item}>{item}</option>)}
          </select>
        </label>
        <label>Target date <span className="optional-label">optional</span>
          <input type="date" value={form.targetDate ?? ''} onChange={(event) => update('targetDate', event.target.value)} />
        </label>
      </div>
      <label>What does success look like?
        <textarea rows="2" maxLength={2000} value={form.description} onChange={(event) => update('description', event.target.value)} placeholder="Describe the outcome you want to reach." />
      </label>
      <label>Why does this matter to you?
        <textarea rows="2" maxLength={2000} value={form.motivation} onChange={(event) => update('motivation', event.target.value)} placeholder="Add a little context for your future self." />
      </label>
      {goal?.id && <label>Progress <span className="field-value">{form.progress}%</span>
        <input type="range" min="0" max="100" value={form.progress} onChange={(event) => update('progress', Number(event.target.value))} />
      </label>}
      <div className="form-actions">
        {onCancel && <button type="button" className="button button-quiet" disabled={busy} onClick={onCancel}>Cancel</button>}
        <button type="submit" className="button button-primary" disabled={busy}>{busy ? 'Saving…' : goal?.id ? 'Save changes' : 'Create goal'}</button>
      </div>
    </form>
  )
}

function EmptyState({ title, detail, action, onAction }) {
  return (
    <div className="empty-state">
      <span className="empty-mark"><Icon name="spark" size={20} /></span>
      <div><h3>{title}</h3><p>{detail}</p></div>
      {action && <button className="button button-secondary" type="button" onClick={onAction}>{action}<Icon name="arrow" size={16} /></button>}
    </div>
  )
}

function GoalRow({ goal, onEdit, onStatus, onDelete, busy }) {
  return (
    <article className={`goal-row goal-${goal.status}`}>
      <div className="goal-index" aria-hidden="true"><Icon name="target" size={20} /></div>
      <div className="goal-main">
        <div className="goal-title-row">
          <h3>{goal.title}</h3>
          <span className={`status-label ${goal.status}`}>{goal.status}</span>
        </div>
        <p className="goal-description">{goal.description || goal.motivation || 'Keep the next step small and specific.'}</p>
        <div className="goal-progress-meta"><span>{goal.progress}% complete</span><span>{goal.targetDate ? `Target ${formatDate(goal.targetDate)}` : 'Open timeline'}</span></div>
        <div className="progress-track" role="progressbar" aria-label={`${goal.title} progress`} aria-valuemin="0" aria-valuemax="100" aria-valuenow={goal.progress}><span style={{ width: `${goal.progress}%` }} /></div>
      </div>
      <div className="goal-actions">
        <button type="button" className="icon-button" onClick={() => onEdit(goal)} aria-label={`Edit ${goal.title}`}><Icon name="settings" /></button>
        {goal.status !== 'completed' && <button type="button" className="button button-quiet" disabled={busy} onClick={() => onStatus(goal, goal.status === 'paused' ? 'active' : 'paused')}>{goal.status === 'paused' ? 'Resume' : 'Pause'}</button>}
        {goal.status !== 'completed' && <button type="button" className="button button-quiet" disabled={busy} onClick={() => onStatus(goal, 'completed')}>Complete</button>}
        <button type="button" className="icon-button danger-icon" onClick={() => onDelete(goal)} aria-label={`Delete ${goal.title}`}><Icon name="close" /></button>
      </div>
    </article>
  )
}

function OnboardingPage({ profile, step, setStep, setPage, complete, onSkip, busy }) {
  const [name, setName] = useState(profile?.display_name ?? '')
  const [focus, setFocus] = useState(profile?.focus ?? '')
  const [goalTitle, setGoalTitle] = useState('')
  const [goalCategory, setGoalCategory] = useState('Personal')

  const currentStep = step ?? 1

  const saveProfile = async () => {
    const trimmedName = name.trim()
    const trimmedFocus = focus.trim()
    if (!trimmedName) return
    const { error } = await supabase.from('profiles').upsert(
      { id: profile?.id, display_name: trimmedName, focus: trimmedFocus },
      { onConflict: 'id' },
    )
    if (!error) {
      setData((current) => ({
        ...current,
        profile: { display_name: trimmedName, focus: trimmedFocus },
      }))
    }
  }

  const createGoal = async () => {
    if (!goalTitle.trim()) return
    const { error } = await supabase.from('goals').insert({
      user_id: profile?.id,
      title: goalTitle.trim(),
      category: goalCategory,
      status: 'active',
      progress: 0,
    })
    if (!error) {
      await refreshData()
    }
  }

  const stepLabels = { 1: 'Your name', 2: 'Your focus', 3: 'First goal' }

  return (
    <div className="page-content onboarding-page">
      <section className="page-intro">
        <div>
          <span className="eyebrow">WELCOME TO ACHIEVE</span>
          <h2>Letâ€™s set you up.</h2>
          <p>
            A few quick choices to personalize your space. You can skip any step and
            finish setup later from Settings.
          </p>
        </div>
      </section>

      <section className="onboarding-steps">
        {[1, 2, 3].map((n) => (
          <div
            key={n}
            className={`onboarding-step ${n === currentStep ? 'active' : ''} ${n < currentStep ? 'done' : ''}`}
          >
            <span className="onboarding-step-number">{n}</span>
            <span className="onboarding-step-label">{stepLabels[n]}</span>
          </div>
        ))}
      </section>

      {currentStep === 1 && (
        <form className="onboarding-form" onSubmit={(event) => {
          event.preventDefault()
          void saveProfile().then(() => setStep(2))
        }}>
          <label>
            What should we call you?
            <input
              autoComplete="name"
              maxLength={80}
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Your name"
            />
          </label>
          <p className="onboarding-hint">
            This is how ACHIEVE addresses you throughout the app.
          </p>
          <div className="onboarding-actions">
            <button
              type="button"
              className="button button-quiet"
              onClick={onSkip}
              disabled={busy === 'profile'}
            >
              Skip
            </button>
            <button
              type="submit"
              className="button button-primary"
              disabled={busy === 'profile' || !name.trim()}
            >
              Next
            </button>
          </div>
        </form>
      )}

      {currentStep === 2 && (
        <form className="onboarding-form" onSubmit={(event) => {
          event.preventDefault()
          void saveProfile().then(() => setStep(3))
        }}>
          <label>
            What are you focusing on right now?
            <textarea
              rows={2}
              maxLength={200}
              value={focus}
              onChange={(event) => setFocus(event.target.value)}
              placeholder="e.g. Building better work habits"
            />
          </label>
          <p className="onboarding-hint">
            Your focus appears in the sidebar to keep your intention visible.
          </p>
          <div className="onboarding-actions">
            <button
              type="button"
              className="button button-quiet"
              onClick={() => setStep(1)}
              disabled={busy === 'profile'}
            >
              Back
            </button>
            <button type="button" className="button button-quiet" onClick={onSkip} disabled={busy === 'profile'}>
              Skip
            </button>
            <button
              type="submit"
              className="button button-primary"
              disabled={busy === 'profile'}
            >
              Next
            </button>
          </div>
        </form>
      )}

      {currentStep === 3 && (
        <form className="onboarding-form" onSubmit={(event) => {
          event.preventDefault()
          void createGoal().then(() => {
            complete()
            setPage('goals')
          })
        }}>
          <label>
            Whatâ€™s one goal you want to work toward?
            <input
              maxLength={160}
              value={goalTitle}
              onChange={(event) => setGoalTitle(event.target.value)}
              placeholder="e.g. Run a 5K"
            />
          </label>
          <label>
            Area
            <select value={goalCategory} onChange={(event) => setGoalCategory(event.target.value)}>
              {['Career', 'Health', 'Learning', 'Mindset', 'Creativity', 'Relationships', 'Personal'].map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>
          <p className="onboarding-hint">
            You can always add more goals later. A goal becomes active when you save it.
          </p>
          <div className="onboarding-actions">
            <button
              type="button"
              className="button button-quiet"
              onClick={() => setStep(2)}
              disabled={busy === 'goal'}
            >
              Back
            </button>
            <button type="button" className="button button-quiet" onClick={complete} disabled={busy === 'goal'}>
              Skip goal
            </button>
            <button
              type="submit"
              className="button button-primary"
              disabled={busy === 'goal' || !goalTitle.trim()}
            >
              Create goal
            </button>
          </div>
        </form>
      )}

      <p className="page-footnote">
        Your name and focus are saved to your profile. You can edit them anytime in
        Settings.
      </p>
    </div>
  )
}

function App({ user, onSignOut }) {
  const [page, setPage] = useState('overview')
  const [profileMenuOpen, setProfileMenuOpen] = useState(false)
  const [mobileMoreOpen, setMobileMoreOpen] = useState(false)
  const [data, setData] = useState({
    profile: null, goals: [], roadmaps: [], missions: [], progress: null, xpTransactions: [], learningProgress: [], loaded: false
  })
  const loading = !data.loaded
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [dataLoadError, setDataLoadError] = useState('')
  const [notice, setNotice] = useState('')
  const [goalEditor, setGoalEditor] = useState(null)
  const [missionForm, setMissionForm] = useState(false)
  const [missionDraft, setMissionDraft] = useState({ goalId: '', title: '', description: '' })
  const [profileDraft, setProfileDraft] = useState({ display_name: '', focus: '' })
  const [coachInput, setCoachInput] = useState('')
  const [coachBusy, setCoachBusy] = useState(false)
  const roadmapRequestIds = useRef(new Map())
  const [onboardingStep, setOnboardingStep] = useState()
  const [onboardingDismissed, setOnboardingDismissed] = useState(false)

  useEffect(() => {
    const dismissed = localStorage.getItem('achieve_onboarding_dismissed')
    // oxlint-disable-next-line react/set-state-in-effect
    setOnboardingDismissed(dismissed === 'true')
  }, [])

  const profile = data.profile ?? null
  const needsOnboarding =
    data.loaded &&
    !onboardingDismissed &&
    (!profile || !profile.display_name?.trim())

  const completeOnboarding = () => {
    setOnboardingDismissed(true)
    localStorage.setItem('achieve_onboarding_dismissed', 'true')
    setOnboardingStep(undefined)
  }

  const refreshData = useCallback(async (isCurrent = () => true) => {
    try {
      const [profileResult, goalsResult, roadmapsResult, missionsResult, progressResult, xpResult, learningResult, xpCountResult, coachResult] = await Promise.all([
        supabase.from('profiles').select('display_name, focus').eq('id', user.id).maybeSingle(),
        supabase.from('goals').select('*').order('created_at', { ascending: false }),
        supabase.from('roadmaps').select('id, goal_id, title, content, created_at').order('created_at', { ascending: false }),
        supabase.from('daily_missions').select('id, goal_id, title, description, mission_date, xp_reward, completed_at').gte('mission_date', weekStartUtc()).lte('mission_date', todayUtc()).order('created_at', { ascending: false }),
        supabase.from('user_progress').select('xp, current_streak, last_active_date').eq('user_id', user.id).maybeSingle(),
        supabase.from('xp_transactions').select('id, amount, created_at').gte('created_at', new Date(Date.now() - 30 * 86400000).toISOString()).order('created_at', { ascending: false }),
        supabase.from('learning_progress').select('path_id, lesson_id, completed_at'),
        supabase.from('xp_transactions').select('id', { count: 'exact', head: true }),
        supabase.from('coach_messages').select('role, content, seq').order('seq', { ascending: false }).limit(40)
      ])
      if (!isCurrent()) return
      const failures = [profileResult, goalsResult, roadmapsResult, missionsResult, progressResult, xpResult, learningResult, xpCountResult, coachResult]
        .filter((result) => result.error)
      if (failures.length) {
        // A missing table reports 42P01/PGRST205, a missing function PGRST203, and
        // a missing column 42703/PGRST204. The coach conversation selects the
        // `seq` column, so an unapplied ordering migration surfaces as a missing
        // column and must be recognised as the same "migrations not applied"
        // situation rather than as a raw database error.
        const missingFeatureTable = failures.some((result) => result.error?.code === '42P01'
          || result.error?.code === 'PGRST205'
          || result.error?.code === 'PGRST203'
          || result.error?.code === '42703'
          || result.error?.code === 'PGRST204')
        throw new Error(missingFeatureTable
          ? 'ACHIEVE’s database migrations are not fully applied to this Supabase project yet. Saved account data is hidden until the required tables are available.'
          : failures[0].error.message || 'Account data could not be loaded.')
      }

      const profile = profileResult.data ?? null
      setData({
        profile,
        goals: (goalsResult.data ?? []).map(goalFromRow),
        roadmaps: roadmapsResult.data ?? [],
        missions: missionsResult.data ?? [],
        progress: progressResult.data ?? { xp: 0, current_streak: 0, last_active_date: null },
        xpTransactions: xpResult.data ?? [],
        learningProgress: (learningResult.data ?? []).filter(({ path_id, lesson_id }) =>
          isKnownLesson(path_id, lesson_id)
        ),
        completedMissionCount: xpCountResult.count ?? 0,
        coachMessages: orderCoachMessages((coachResult.data ?? []).map(({ role, content, seq }) => ({ role, content, seq }))),
        loaded: true
      })
      if (profile) {
        setProfileDraft({
          display_name: profile.display_name ?? '',
          focus: profile.focus ?? ''
        })
      }
      setDataLoadError('')
    } catch (loadError) {
      if (!isCurrent()) return
      setDataLoadError(loadError.message || 'Could not reach Supabase. Check the connection and try again.')
    }
  }, [user.id])

  useEffect(() => {
    let isMounted = true
    // The async Supabase queries provide the initial state.
    // oxlint-disable-next-line react/set-state-in-effect
    void refreshData(() => isMounted)
    return () => { isMounted = false }
  }, [refreshData])

  const activeGoals = data.goals.filter((goal) => goal.status === 'active')
  const todayMissions = data.missions.filter((mission) => mission.mission_date === todayUtc())
  const weekActivity = useMemo(() => getWeekActivity(data.missions), [data.missions])
  const level = getLevelProgress(data.progress?.xp ?? 0)
  const streak = getCurrentStreak(data.progress)
  const achievements = getAchievements({
    completedMissionCount: data.completedMissionCount ?? 0,
    completedGoalCount: data.goals.filter((goal) => goal.status === 'completed').length,
    completedLessons: data.learningProgress.length,
    roadmapCount: data.roadmaps.length
  })
  const unlockedAchievements = achievements.filter((achievement) => achievement.unlocked)
  const coachMessages = data.coachMessages ?? []
  const firstName = data.profile?.display_name?.trim() || user.email?.split('@')[0] || 'there'
  const pageInfo = navItems.find((item) => item.id === page) ?? navItems[0]

  const reportError = (message) => {
    setError(message)
    setNotice('')
  }
  const reportNotice = (message) => {
    setNotice(message)
    setError('')
    window.setTimeout(() => setNotice(''), 4500)
  }
  const signOut = async () => {
    try {
      await onSignOut()
    } catch (signOutError) {
      reportError(signOutError.message || 'Could not sign out. Please try again.')
    }
  }

  const saveGoal = async (form) => {
    const problems = validateGoal(form)
    if (problems.length) return reportError(problems[0])
    setBusy('goal')
    setError('')
    const payload = {
      title: form.title.trim(),
      category: form.category,
      target_date: form.targetDate || null,
      description: form.description.trim(),
      motivation: form.motivation.trim(),
      progress: Number(form.progress) || 0
    }
    const result = form.id
      ? await supabase.from('goals').update(payload).eq('id', form.id).select().single()
      : await supabase.from('goals').insert({ ...payload, user_id: user.id }).select().single()
    setBusy('')
    if (result.error) return reportError(result.error.message || 'Could not save this goal.')
    setGoalEditor(null)
    reportNotice(form.id ? 'Goal updated.' : 'Goal created. Choose one next step and start there.')
    await refreshData()
  }

  const updateGoalStatus = async (goal, status) => {
    setBusy(goal.id)
    const { error: updateError } = await supabase.from('goals').update({
      status,
      ...(status === 'completed' ? { progress: 100 } : {})
    }).eq('id', goal.id)
    setBusy('')
    if (updateError) return reportError(updateError.message || 'Could not update this goal.')
    reportNotice(status === 'completed' ? 'Goal completed. Take a moment to recognize that progress.' : `Goal ${status === 'paused' ? 'paused' : 'resumed'}.`)
    await refreshData()
  }

  const deleteGoal = async (goal) => {
    if (!window.confirm(`Delete “${goal.title}”? Its saved roadmaps and missions will remain in your account, but will no longer be linked to this goal. This cannot be undone.`)) return
    setBusy(goal.id)
    const { error: deleteError } = await supabase.from('goals').delete().eq('id', goal.id)
    setBusy('')
    if (deleteError) return reportError(deleteError.message || 'Could not delete this goal.')
    reportNotice('Goal deleted. Its saved roadmaps and missions remain in your account, now unlinked.')
    await refreshData()
  }

  const createMission = async (event) => {
    event.preventDefault()
    const problems = validateMission(missionDraft)
    if (problems.length) return reportError(problems[0])
    if (!missionDraft.goalId || !missionDraft.title.trim()) return
    setBusy('mission')
    setError('')
    const { error: createError } = await supabase.rpc('create_daily_mission', {
      p_goal_id: missionDraft.goalId,
      p_title: missionDraft.title.trim(),
      p_description: missionDraft.description.trim()
    })
    setBusy('')
    if (createError) return reportError(createError.message || 'Could not create this mission.')
    setMissionDraft({ goalId: '', title: '', description: '' })
    setMissionForm(false)
    reportNotice('Mission added for today. XP is awarded once when it is completed.')
    await refreshData()
  }

  const completeMission = async (mission) => {
    if (mission.completed_at || mission.mission_date !== todayUtc()) return
    setBusy(mission.id)
    setError('')
    const { error: completionError } = await supabase.rpc('complete_daily_mission', { p_mission_id: mission.id })
    setBusy('')
    if (completionError) return reportError(completionError.message || 'Could not complete this mission.')
    reportNotice(`Mission complete. +${mission.xp_reward} XP added to your account.`)
    await refreshData()
  }

  const generateRoadmap = async (goal) => {
    const requestId = roadmapRequestIds.current.get(goal.id) ?? crypto.randomUUID()
    roadmapRequestIds.current.set(goal.id, requestId)
    setBusy('roadmap')
    setError('')
    try {
      const { data: savedRoadmap, error: functionError } = await supabase.functions.invoke('generate-roadmap', {
        body: { goalId: goal.id, requestId }
      })
      if (functionError) throw functionError
      if (savedRoadmap?.id !== requestId) {
        throw new Error('The roadmap could not be confirmed as saved. Retry to check its status.')
      }
      roadmapRequestIds.current.delete(goal.id)
      reportNotice('Your roadmap is ready.')
      await refreshData()
      setPage('roadmaps')
    } catch (generationError) {
      reportError(await edgeErrorMessage(generationError, 'Roadmap generation failed. Check that the Edge Function and AI secret are configured.'))
    } finally {
      setBusy('')
    }
  }

  const updateRoadmapAction = async (roadmap, action, completed) => {
    const completedActions = new Set(roadmap.content?.completedActions ?? [])
    if (completed) completedActions.add(action)
    else completedActions.delete(action)
    const content = { ...roadmap.content, completedActions: [...completedActions] }
    setBusy(`roadmap:${roadmap.id}`)
    const { error: updateError } = await supabase.from('roadmaps').update({ content }).eq('id', roadmap.id)
    setBusy('')
    if (updateError) return reportError(updateError.message || 'Could not save roadmap progress.')
    setData((current) => ({
      ...current,
      roadmaps: current.roadmaps.map((item) => item.id === roadmap.id ? { ...item, content } : item)
    }))
  }

  const addRoadmapActionToMission = async (roadmap, action) => {
    const goal = data.goals.find((item) => item.id === roadmap.goal_id && item.status === 'active')
    if (!goal) return reportError('Resume this goal before adding one of its actions as a mission.')
    setBusy('mission')
    const { error: createError } = await supabase.rpc('create_daily_mission', {
      p_goal_id: goal.id,
      p_title: action,
      p_description: `A next step from “${roadmap.title}”.`
    })
    setBusy('')
    if (createError) return reportError(createError.message || 'Could not add this roadmap action.')
    reportNotice('Roadmap action added to today’s missions.')
    await refreshData()
  }

  const sendCoachMessage = async (event) => {
    event.preventDefault()
    const text = coachInput.trim()
    const problems = validateCoachMessage(text)
    if (problems.length) return reportError(problems[0])
    if (!text || coachBusy) return
    setCoachInput('')
    const { data: savedPrompt, error: promptError } = await supabase.from('coach_messages').insert({
      user_id: user.id,
      role: 'user',
      content: text
    }).select('role, content, seq').single()
    if (promptError) return reportError(promptError.message || 'Could not save your message.')
    setData((current) => ({ ...current, coachMessages: appendCoachMessage(current.coachMessages, savedPrompt) }))
    setCoachBusy(true)
    setError('')
    try {
      const { data: response, error: functionError } = await supabase.functions.invoke('coach-chat', {
        body: {
          message: text,
          history: coachMessages.slice(-4).map((item) => ({ role: item.role, content: item.content.slice(0, 1000) })),
          goals: activeGoals.slice(0, 5).map(({ title, category, description }) => ({ title, category, description: description.slice(0, 100) }))
        }
      })
      if (functionError) throw functionError
      if (typeof response?.reply !== 'string') throw new Error('The coach returned an unexpected response.')
      setData((current) => ({
        ...current,
        coachMessages: appendCoachMessage(current.coachMessages, { role: 'assistant', content: response.reply, seq: response.seq ?? null })
      }))
    } catch (coachError) {
      reportError(await edgeErrorMessage(coachError, 'The coach is unavailable. Please try again later.'))
      setCoachInput(text)
    } finally {
      setCoachBusy(false)
    }
  }

  const toggleLesson = async (pathId, lessonId) => {
    const completed = data.learningProgress.some((entry) => entry.path_id === pathId && entry.lesson_id === lessonId)
    setBusy(`lesson:${lessonId}`)
    // `learning_progress` is unique on (user_id, path_id, lesson_id). Toggling with a
    // plain insert can fail with a unique violation when the saved state and the
    // state on screen disagree, so the insert is upserted with ignoreDuplicates to
    // make repeating the same action safe.
    const result = completed
      ? await supabase.from('learning_progress').delete().eq('user_id', user.id).eq('path_id', pathId).eq('lesson_id', lessonId)
      : await supabase.from('learning_progress').upsert(
          { user_id: user.id, path_id: pathId, lesson_id: lessonId },
          { onConflict: 'user_id,path_id,lesson_id', ignoreDuplicates: true }
        )
    setBusy('')
    if (result.error) return reportError(result.error.message || 'Could not update lesson progress.')
    reportNotice(completed ? 'Lesson marked as not complete.' : 'Lesson completed. Nice work.')
    await refreshData()
  }

  const saveProfile = async (event) => {
    event.preventDefault()
    const problems = validateProfile(profileDraft)
    if (problems.length) return reportError(problems[0])
    setBusy('profile')
    setError('')
    // An upsert rather than a plain update: a profile row is normally created
    // by the signup trigger, but if it is missing the update would silently
    // match zero rows and the user would be told their profile was saved when
    // nothing was written.
    const { error: profileError } = await supabase.from('profiles').upsert({
      id: user.id,
      display_name: profileDraft.display_name.trim(),
      focus: profileDraft.focus.trim()
    }, { onConflict: 'id' })
    setBusy('')
    if (profileError) return reportError(profileError.message || 'Could not save your profile.')
    reportNotice('Profile saved.')
    await refreshData()
  }

  const deleteAccount = async () => {
    if (
      !window.confirm(
        'Delete your account and all your data? This removes your goals, missions, roadmaps, progress, and conversations. This cannot be undone.',
      )
    )
      return
    setBusy('account')
    try {
      const { error } = await supabase.auth.deleteUser()
      if (error) throw error
      reportNotice('Your account has been deleted.')
      await onSignOut()
    } catch (deleteError) {
      setBusy('')
      reportError(deleteError.message || 'Could not delete your account. Please try again.')
    }
  }

  const sendPasswordRecovery = async () => {
    setBusy('recovery')
    const { error: recoveryError } = await supabase.auth.resetPasswordForEmail(user.email, {
      redirectTo: `${window.location.origin}/`
    })
    setBusy('')
    if (recoveryError) return reportError(recoveryError.message || 'Could not send a password recovery email.')
    reportNotice('If password recovery is enabled for your account, a link will arrive by email.')
  }

  if (loading || dataLoadError) {
    return (
      <main className="load-state">
        <span className="loading-mark">{dataLoadError ? '!' : 'A'}</span>
        <p className="eyebrow">{dataLoadError ? 'ACCOUNT DATA UNAVAILABLE' : 'RESTORING YOUR SPACE'}</p>
        <h1>{dataLoadError ? 'Your saved progress is not available yet.' : 'Preparing your space…'}</h1>
        {dataLoadError && <><p>{dataLoadError}</p><button type="button" className="button button-primary" onClick={() => refreshData()}>Try again</button></>}
      </main>
    )
  }

  if (needsOnboarding) {
    return (
      <OnboardingPage
        profile={profile}
        step={onboardingStep}
        setStep={setOnboardingStep}
        setPage={setPage}
        complete={completeOnboarding}
        onSkip={() => {
          setOnboardingStep(undefined)
          completeOnboarding()
        }}
        busy={busy}
      />
    )
  }

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">Skip to main content</a>
      <aside className="sidebar">
        <div className="brand-lockup">
          <div className="brand-mark"><span>A</span></div>
          <div><span className="brand-overline">YOUR NEXT CHAPTER</span><strong>ACHIEVE</strong></div>
        </div>
        <div className="side-caption">WORKSPACE</div>
        <nav className="sidebar-nav" aria-label="Main navigation">
          {navItems.map((item) => (
            <button type="button" key={item.id} className={`nav-btn ${page === item.id ? 'active' : ''}`} aria-current={page === item.id ? 'page' : undefined} onClick={() => { setPage(item.id); setProfileMenuOpen(false); setMobileMoreOpen(false) }}>
              <Icon name={item.icon} /><span>{item.label}</span>{item.id === 'missions' && todayMissions.some((mission) => !mission.completed_at) && <span className="nav-count">{todayMissions.filter((mission) => !mission.completed_at).length}</span>}
            </button>
          ))}
        </nav>
        <div className="sidebar-spacer" />
        <div className="sidebar-focus">
          <div className="focus-orbit"><Icon name="target" size={20} /></div>
          <span className="side-caption">YOUR FOCUS</span>
          <strong>{data.profile?.focus || 'Start with one goal'}</strong>
          <span className="focus-meta">{activeGoals.length} active {activeGoals.length === 1 ? 'goal' : 'goals'}</span>
        </div>
        <button type="button" className="account-button" onClick={() => setPage('settings')}>
          <span className="avatar">{firstName.slice(0, 1).toUpperCase()}</span>
          <span className="account-copy"><strong>{firstName}</strong><small>{user.email}</small></span>
          <Icon name="settings" size={16} />
        </button>
      </aside>

      <main className="main-panel" id="main-content">
        <header className="topbar">
          <div className="mobile-brand"><span className="brand-mark small">A</span><strong>ACHIEVE</strong></div>
          <div className="page-heading">
            <p className="eyebrow">{pageInfo.label}</p>
            <h1>{page === 'overview' ? `Good to see you, ${firstName}.` : pageInfo.label}</h1>
          </div>
          <div className="topbar-actions">
            <div className="topbar-progress"><span className="level-chip">LVL {level.level}</span><span>{data.progress?.xp ?? 0} XP</span></div>
            <div className="profile-menu-wrap">
              <button type="button" className="avatar avatar-button" aria-label="Open account menu" aria-expanded={profileMenuOpen} onClick={() => setProfileMenuOpen((value) => !value)}>{firstName.slice(0, 1).toUpperCase()}</button>
              {profileMenuOpen && <div className="profile-menu"><button type="button" onClick={() => { setPage('settings'); setProfileMenuOpen(false) }}>Profile & settings</button><button type="button" onClick={signOut}>Sign out</button></div>}
            </div>
          </div>
        </header>

        {error && <div className="feedback-banner error-banner" role="alert"><span>{error}</span><button className="banner-close" aria-label="Dismiss error" onClick={() => setError('')}><Icon name="close" size={16} /></button></div>}
        {notice && <div className="feedback-banner success-banner" role="status"><span>{notice}</span><button className="banner-close" aria-label="Dismiss message" onClick={() => setNotice('')}><Icon name="close" size={16} /></button></div>}

        {page === 'overview' && (
          <Dashboard
            goals={data.goals}
            activeGoals={activeGoals}
            missions={todayMissions}
            progress={data.progress}
            level={level}
            streak={streak}
            activity={weekActivity}
            achievements={unlockedAchievements}
            roadmaps={data.roadmaps}
            busy={busy}
            loading={loading}
            onPage={setPage}
            onCompleteMission={completeMission}
            onNewGoal={() => setGoalEditor(initialGoal)}
            onGenerateRoadmap={generateRoadmap}
            onUpdateGoal={updateGoalStatus}
            onEditGoal={(goal) => setGoalEditor(goal)}
            onDeleteGoal={deleteGoal}
          />
        )}
        {page === 'goals' && (
          <GoalsPage
            goals={data.goals}
            busy={busy}
            onNew={() => setGoalEditor(initialGoal)}
            onEdit={setGoalEditor}
            onStatus={updateGoalStatus}
            onDelete={deleteGoal}
          />
        )}
        {page === 'roadmaps' && (
          <RoadmapsPage
            roadmaps={data.roadmaps}
            goals={data.goals}
            activeGoals={activeGoals}
            busy={busy}
            onGenerate={generateRoadmap}
            onToggleAction={updateRoadmapAction}
            onAddMission={addRoadmapActionToMission}
            onGoGoals={() => setPage('goals')}
          />
        )}
        {page === 'missions' && (
          <MissionsPage
            missions={todayMissions}
            goals={data.goals}
            activeGoals={activeGoals}
            formOpen={missionForm}
            draft={missionDraft}
            setDraft={setMissionDraft}
            onCreate={createMission}
            onToggleForm={() => setMissionForm((value) => !value)}
            onComplete={completeMission}
            busy={busy}
          />
        )}
        {page === 'coach' && (
          <CoachPage
            messages={coachMessages}
            input={coachInput}
            setInput={setCoachInput}
            onSubmit={sendCoachMessage}
            busy={coachBusy}
            goals={activeGoals}
          />
        )}
        {page === 'learning' && (
          <LearningPage paths={learningPaths} progress={data.learningProgress} busy={busy} onToggle={toggleLesson} />
        )}
        {page === 'insights' && (
          <InsightsPage
            goals={data.goals}
            progress={data.progress}
            transactions={data.xpTransactions}
            activity={weekActivity}
            achievements={achievements}
            roadmaps={data.roadmaps}
            learningProgress={data.learningProgress}
          />
        )}
        {page === 'settings' && (
          <SettingsPage
            user={user}
            draft={profileDraft}
            setDraft={setProfileDraft}
            onSave={saveProfile}
            onRecovery={sendPasswordRecovery}
            onSignOut={signOut}
            onDeleteAccount={deleteAccount}
            setOnboardingStep={setOnboardingStep}
            busy={busy}
          />
        )}
      </main>

      {goalEditor && (
        <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && busy !== 'goal') setGoalEditor(null) }}>
          <section
            className="goal-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="goal-dialog-title"
            onKeyDown={(event) => {
              if (event.key === 'Escape' && busy !== 'goal') {
                event.stopPropagation()
                setGoalEditor(null)
                return
              }
              if (event.key === 'Tab') {
                const focusable = [...event.currentTarget.querySelectorAll(
                  'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])'
                )]
                const first = focusable[0]
                const last = focusable[focusable.length - 1]
                if (event.shiftKey && document.activeElement === first) {
                  event.preventDefault()
                  last?.focus()
                } else if (!event.shiftKey && document.activeElement === last) {
                  event.preventDefault()
                  first?.focus()
                }
              }
            }}
          >
            <div className="dialog-heading"><div><p className="eyebrow">{goalEditor.id ? 'REFINE YOUR INTENTION' : 'MAKE IT REAL'}</p><h2 id="goal-dialog-title">{goalEditor.id ? 'Edit goal' : 'Set a meaningful goal'}</h2></div><button type="button" className="icon-button" autoFocus disabled={busy === 'goal'} onClick={() => setGoalEditor(null)} aria-label="Close dialog"><Icon name="close" /></button></div>
            <GoalEditor key={goalEditor.id ?? 'new-goal'} goal={goalEditor.id ? goalEditor : null} onSave={saveGoal} onCancel={() => setGoalEditor(null)} busy={busy === 'goal'} />
          </section>
        </div>
      )}

      {mobileMoreOpen && <div className="mobile-more-menu" role="menu" aria-label="More sections">{navItems.filter((item) => ['roadmaps', 'coach', 'insights', 'settings'].includes(item.id)).map((item) => <button type="button" role="menuitem" key={item.id} onClick={() => { setPage(item.id); setMobileMoreOpen(false) }}><Icon name={item.icon} size={17} />{item.label}</button>)}</div>}
      <nav className="mobile-nav" aria-label="Mobile navigation">
        {navItems.filter((item) => ['overview', 'goals', 'missions', 'learning'].includes(item.id)).map((item) => <button type="button" key={item.id} className={page === item.id ? 'active' : ''} aria-label={item.label} aria-current={page === item.id ? 'page' : undefined} onClick={() => { setPage(item.id); setMobileMoreOpen(false) }}><Icon name={item.icon} size={20} /><span>{item.label}</span></button>)}
        <button type="button" className={['roadmaps', 'coach', 'insights', 'settings'].includes(page) || mobileMoreOpen ? 'active' : ''} aria-label="More sections" aria-expanded={mobileMoreOpen} onClick={() => setMobileMoreOpen((value) => !value)}><Icon name="grid" size={20} /><span>More</span></button>
      </nav>
    </div>
  )
}

function Dashboard({ goals, activeGoals, missions, progress, level, streak, activity, achievements, roadmaps, busy, loading, onPage, onCompleteMission, onNewGoal, onGenerateRoadmap, onUpdateGoal, onEditGoal, onDeleteGoal }) {
  const currentDate = todayUtc()
  const dateLabel = new Intl.DateTimeFormat('en', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${currentDate}T00:00:00.000Z`))
  const nextMission = missions.find((mission) => !mission.completed_at)
  const recommendedGoal = activeGoals[0]
  const nextRoadmap = roadmaps.find((roadmap) => roadmap.goal_id === recommendedGoal?.id)
  const actionCount = missions.length
  const completedCount = missions.filter((mission) => mission.completed_at).length

  return (
    <div className="page-content dashboard-page">
      <section className="dashboard-context" aria-label="Today's overview">
        <div><span className="eyebrow">YOUR JOURNEY</span><strong>{dateLabel}</strong></div>
        <span className="context-divider" aria-hidden="true" />
        <span>{activeGoals.length} active {activeGoals.length === 1 ? 'goal' : 'goals'}</span>
        <span className="context-missions">{completedCount} of {actionCount} quests complete today</span>
      </section>

      <section className="dashboard-hero">
        <div className="hero-copy">
          <span className="hero-kicker"><span className="live-dot" /> YOUR NEXT MOVE</span>
          <h2>{nextMission?.title ?? (recommendedGoal ? `What's one small step toward “${recommendedGoal.title}”?` : 'What would you like to change?')}</h2>
          <p className="hero-detail">{nextMission?.description || (recommendedGoal ? 'Open your goal, choose a task you can finish today, and start there.' : 'Set a goal that matters to you. We’ll help you turn it into a practical next step.')}</p>
          <div className="hero-actions">
            {nextMission
              ? <button type="button" className="button button-primary" disabled={busy === nextMission.id} onClick={() => onCompleteMission(nextMission)}>{busy === nextMission.id ? 'Saving…' : 'Complete today’s step'}<Icon name="arrow" size={16} /></button>
              : <button type="button" className="button button-primary" disabled={Boolean(recommendedGoal && !nextRoadmap && busy === 'roadmap')} onClick={recommendedGoal ? nextRoadmap ? () => onPage('roadmaps') : () => onGenerateRoadmap(recommendedGoal) : onNewGoal}>{recommendedGoal ? nextRoadmap ? 'Continue your roadmap' : busy === 'roadmap' ? 'Creating roadmap…' : 'Build a roadmap' : 'Set your first goal'}<Icon name="arrow" size={16} /></button>}
            <button type="button" className="button button-glass" onClick={() => onPage('missions')}>View today <span className="action-count">{completedCount}/{actionCount}</span></button>
          </div>
        </div>
        <div className="hero-art" role="img" aria-label={`Level ${level.level}, ${level.withinLevel} of 120 XP earned toward the next level`} style={{ '--level-progress': `${(level.withinLevel / 120) * 100}%` }}>
          <div className="hero-ring hero-ring-outer" />
          <div className="hero-ring hero-ring-inner" />
          <div className="hero-center"><span>YOUR LEVEL</span><strong>{level.level}</strong><span>{level.withinLevel} / 120 XP</span></div>
          <span className="hero-orbit orbit-one" aria-hidden="true" />
          <span className="hero-orbit orbit-two" aria-hidden="true" />
        </div>
      </section>

      <section className="stat-ribbon" aria-label="Your real progress">
        <div className="stat-cell"><span className="stat-icon lime"><Icon name="spark" /></span><span className="stat-label">TOTAL XP</span><strong>{progress?.xp ?? 0}</strong><small>earned through completed missions</small></div>
        <div className="stat-cell"><span className="stat-icon violet"><Icon name="target" /></span><span className="stat-label">ACTIVE GOALS</span><strong>{activeGoals.length}</strong><small>you’re working toward</small></div>
        <div className="stat-cell"><span className="stat-icon orange"><Icon name="flame" /></span><span className="stat-label">CURRENT STREAK</span><strong>{streak}<small className="stat-unit"> days</small></strong><small>keep showing up at your pace</small></div>
        <div className="stat-cell level-cell"><div className="level-ring" style={{ '--level-progress': `${(level.withinLevel / 120) * 100}%` }}><span>{level.level}</span></div><div><span className="stat-label">YOUR LEVEL</span><strong>Level {level.level}</strong><small>{level.nextLevelAt - (progress?.xp ?? 0)} XP to next level</small></div></div>
      </section>
      {loading ? (
        <>
          <div className="stat-cell skeleton-stat" aria-label="Loading total XP" />
          <div className="stat-cell skeleton-stat" aria-label="Loading active goals" />
          <div className="stat-cell skeleton-stat" aria-label="Loading current streak" />
        </>
      ) : null}

      <div className="dashboard-columns">
        <section className="section-block">
          <div className="section-heading"><div><p className="eyebrow">THE THINGS THAT MATTER</p><h2>Your goals</h2></div><button className="text-action" type="button" onClick={() => onPage('goals')}>All goals <Icon name="arrow" size={15} /></button></div>
          {loading ? <div className="skeleton-block" aria-label="Loading goals" /> : activeGoals.length
            ? <div className="goal-stack">{activeGoals.slice(0, 3).map((goal) => <GoalRow key={goal.id} goal={goal} onEdit={onEditGoal} onStatus={onUpdateGoal} onDelete={onDeleteGoal} busy={busy === goal.id} />)}</div>
            : <EmptyState title="Your goals start here" detail="Name an outcome that matters to you. Make it specific enough to begin." action="Create a goal" onAction={onNewGoal} />}
          {goals.some((goal) => goal.status === 'paused') && <button className="paused-link" type="button" onClick={() => onPage('goals')}>{goals.filter((goal) => goal.status === 'paused').length} paused goal{goals.filter((goal) => goal.status === 'paused').length === 1 ? '' : 's'} · pick up when ready</button>}
        </section>

        <section className="section-block mission-block">
          <div className="section-heading"><div><p className="eyebrow">TODAY, AT YOUR PACE</p><h2>Daily missions</h2></div><button className="icon-button" type="button" aria-label="Go to daily missions" onClick={() => onPage('missions')}><Icon name="arrow" /></button></div>
          <div className="mission-summary"><span>{completedCount} of {actionCount} complete</span><span>{actionCount ? Math.round(completedCount / actionCount * 100) : 0}%</span></div>
          <div className="progress-track mission-progress"><span style={{ width: `${actionCount ? completedCount / actionCount * 100 : 0}%` }} /></div>
          {missions.length ? <div className="mission-preview">{missions.slice(0, 3).map((mission) => <MissionRow key={mission.id} mission={mission} onComplete={onCompleteMission} busy={busy === mission.id} />)}</div>
            : <div className="mission-empty"><p>No missions on your list today.</p><span>Add one small action when you’re ready.</span><button className="text-action" type="button" onClick={() => onPage('missions')}>Create a mission <Icon name="arrow" size={15} /></button></div>}
        </section>
      </div>

      <section className="section-block momentum-block">
        <div className="section-heading"><div><p className="eyebrow">SHOWING UP COUNTS</p><h2>This week’s activity</h2></div><button className="text-action" type="button" onClick={() => onPage('insights')}>More insights <Icon name="arrow" size={15} /></button></div>
        <ActivityChart activity={activity} />
      </section>

      <section className="closing-row">
        <div className="closing-roadmap"><div className="closing-icon"><Icon name="route" size={20} /></div><div><p className="eyebrow">YOUR PLAN, YOUR PACE</p><h3>{roadmaps.length ? `${roadmaps.length} roadmap${roadmaps.length === 1 ? '' : 's'} ready to continue` : 'Turn an intention into a clear plan'}</h3><p>{roadmaps.length ? 'Pick up where you left off, or make a small adjustment.' : 'Build a practical set of steps around one of your active goals.'}</p></div><button type="button" className="button button-secondary" onClick={() => roadmaps.length ? onPage('roadmaps') : recommendedGoal && onGenerateRoadmap(recommendedGoal)} disabled={!roadmaps.length && (!recommendedGoal || busy === 'roadmap')}>{busy === 'roadmap' ? 'Creating…' : roadmaps.length ? 'Continue' : 'Create roadmap'}<Icon name="arrow" size={15} /></button></div>
        <div className="closing-achievements"><div className="achievement-stamp"><Icon name="spark" size={22} /></div><div><p className="eyebrow">MILESTONES EARNED</p><h3>{achievements.length}</h3><button type="button" className="text-action" onClick={() => onPage('insights')}>View achievements <Icon name="arrow" size={14} /></button></div></div>
      </section>
    </div>
  )
}

function MissionRow({ mission, onComplete, busy }) {
  const completed = Boolean(mission.completed_at)
  return (
    <div className={`mission-row ${completed ? 'completed' : ''}`}>
      <button type="button" className="mission-check" aria-label={completed ? `${mission.title}, completed` : `Complete ${mission.title}`} disabled={completed || busy || mission.mission_date !== todayUtc()} onClick={() => onComplete(mission)}>{completed ? '✓' : ''}</button>
      <div className="mission-copy"><strong>{mission.title}</strong>{mission.description && <small>{mission.description}</small>}</div>
      <span className="mission-xp">{completed ? 'EARNED' : `+${mission.xp_reward} XP`}</span>
    </div>
  )
}

function ActivityChart({ activity }) {
  const max = Math.max(1, ...activity.map((day) => day.count))
  return (
    <div className="activity-chart" role="img" aria-label="Completed daily missions over the last seven days">
      {activity.map((day) => <div className="activity-day" key={day.date} aria-label={`${day.label}: ${day.count} completed missions`}><div className="activity-bar-track"><span className={day.count ? 'has-activity' : ''} style={{ height: `${day.count ? Math.max(16, day.count / max * 100) : 4}%` }} /></div><small>{day.label}</small></div>)}
    </div>
  )
}

function GoalsPage({ goals, busy, onNew, onEdit, onStatus, onDelete }) {
  const [filter, setFilter] = useState('active')
  const filteredGoals = goals.filter((goal) => filter === 'all' || goal.status === filter)
  return (
    <div className="page-content goals-page">
      <section className="page-intro"><div><p className="eyebrow">INTENTION INTO ACTION</p><h2>Goals that move you forward.</h2><p>Keep your commitments visible. Adjust the pace when life changes.</p></div><button type="button" className="button button-primary" onClick={onNew}><Icon name="plus" />New goal</button></section>
      <div className="filter-tabs" role="group" aria-label="Filter goals">{[['active', 'Active'], ['paused', 'Paused'], ['completed', 'Completed'], ['all', 'All']].map(([key, label]) => <button type="button" key={key} className={filter === key ? 'selected' : ''} onClick={() => setFilter(key)}>{label}<span>{key === 'all' ? goals.length : goals.filter((goal) => goal.status === key).length}</span></button>)}</div>
      {filteredGoals.length ? <div className="goal-stack">{filteredGoals.map((goal) => <GoalRow key={goal.id} goal={goal} onEdit={onEdit} onStatus={onStatus} onDelete={onDelete} busy={busy === goal.id} />)}</div>
        : <EmptyState title={filter === 'active' ? 'No active goals yet' : `No ${filter} goals`} detail={filter === 'active' ? 'Create a goal with a meaningful outcome. You can refine it as you go.' : 'Goals will appear here when their status changes.'} action={filter === 'active' ? 'Create a goal' : undefined} onAction={onNew} />}
    </div>
  )
}

function RoadmapsPage({ roadmaps, goals, activeGoals, busy, onGenerate, onToggleAction, onAddMission, onGoGoals }) {
  const [selectedGoalId, setSelectedGoalId] = useState('')
  const goalId = activeGoals.some((goal) => goal.id === selectedGoalId) ? selectedGoalId : activeGoals[0]?.id ?? ''
  return (
    <div className="page-content roadmaps-page">
      <section className="page-intro"><div><p className="eyebrow">A PLAN THAT ADAPTS</p><h2>Make the next step visible.</h2><p>Break an important goal into stages. Adjust the plan as you learn.</p></div></section>
      {activeGoals.length > 0 && <form className="roadmap-create" onSubmit={(event) => { event.preventDefault(); const goal = activeGoals.find((item) => item.id === goalId); if (goal) onGenerate(goal) }}><div><span className="ai-mark"><Icon name="spark" /></span><div><strong>Build a roadmap for a goal</strong><small>AI will use the goal context you saved to make a practical plan.</small></div></div><select aria-label="Select goal for roadmap" value={goalId} onChange={(event) => setSelectedGoalId(event.target.value)}>{activeGoals.map((goal) => <option key={goal.id} value={goal.id}>{goal.title}</option>)}</select><button className="button button-primary" disabled={busy === 'roadmap' || !goalId}>{busy === 'roadmap' ? 'Creating…' : 'Generate roadmap'}<Icon name="arrow" size={15} /></button></form>}
      {!roadmaps.length ? <EmptyState title="Your plans will live here" detail={activeGoals.length ? 'Choose an active goal above and generate a plan with practical stages and actions.' : 'Create or resume an active goal first. Then turn it into a tailored roadmap.'} action={activeGoals.length ? undefined : 'Go to goals'} onAction={onGoGoals} />
        : <div className="roadmap-list">{roadmaps.map((roadmap, index) => <RoadmapCard key={roadmap.id} roadmap={roadmap} goal={goals.find((item) => item.id === roadmap.goal_id)} busy={busy === `roadmap:${roadmap.id}`} onToggle={onToggleAction} onAddMission={onAddMission} index={index} />)}</div>}
    </div>
  )
}

function RoadmapCard({ roadmap, goal, busy, onToggle, onAddMission, index }) {
  const [expanded, setExpanded] = useState(index === 0)
  const stages = roadmap.content?.stages ?? []
  const actions = stages.flatMap((stage) => stage.actions ?? [])
  const completed = new Set(roadmap.content?.completedActions ?? [])
  const completionPercent = actions.length ? Math.round(actions.filter((action) => completed.has(action)).length / actions.length * 100) : 0
  return (
    <article className="roadmap-card">
      <button type="button" className="roadmap-card-head" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>
        <span className="roadmap-number">{String(index + 1).padStart(2, '0')}</span>
        <span className="roadmap-head-copy"><span className="eyebrow">{goal?.category ?? (roadmap.goal_id ? 'GOAL UNAVAILABLE' : 'UNLINKED ROADMAP')}</span><strong>{roadmap.title}</strong><small>{goal?.title ?? roadmap.content?.summary}</small></span>
        <span className="roadmap-progress">{completionPercent}%<small>complete</small></span><Icon name={expanded ? 'close' : 'arrow'} size={17} />
      </button>
      {expanded && <div className="roadmap-content"><p className="roadmap-summary">{roadmap.content?.summary}</p><div className="roadmap-progress-track"><span style={{ width: `${completionPercent}%` }} /></div>
        <div className="roadmap-stages">{stages.map((stage, stageIndex) => <section className="roadmap-stage" key={`${stage.title}-${stageIndex}`}><div className="stage-marker">{String(stageIndex + 1).padStart(2, '0')}</div><div className="stage-body"><div className="stage-heading"><div><h3>{stage.title}</h3><p>{stage.whyItMatters}</p></div><span>{stage.suggestedTime}</span></div><ul className="stage-actions">{stage.actions.map((action) => <li key={action} className={completed.has(action) ? 'action-done' : ''}><button type="button" className="action-check" aria-label={`${completed.has(action) ? 'Mark incomplete' : 'Mark complete'}: ${action}`} disabled={busy} onClick={() => onToggle(roadmap, action, !completed.has(action))}>{completed.has(action) ? '✓' : ''}</button><span>{action}</span><button type="button" className="add-mission-link" disabled={busy || !goal || goal.status !== 'active'} onClick={() => onAddMission(roadmap, action)}>Add to today</button></li>)}</ul></div></section>)}</div>
      </div>}
    </article>
  )
}

function MissionsPage({ missions, goals, activeGoals, formOpen, draft, setDraft, onCreate, onToggleForm, onComplete, busy }) {
  const completed = missions.filter((mission) => mission.completed_at).length
  return (
    <div className="page-content missions-page">
      <section className="page-intro"><div><p className="eyebrow">SMALL STEPS, REAL MOMENTUM</p><h2>Today is enough.</h2><p>Make a few useful moves. Each mission earns a single, trusted XP reward.</p></div><button type="button" className="button button-primary" onClick={onToggleForm} disabled={!activeGoals.length}><Icon name="plus" />New mission</button></section>
      <section className="mission-dayline"><div><span className="eyebrow">TODAY · UTC</span><strong>{formatDate(todayUtc())}</strong></div><div className="dayline-count"><strong>{completed}<span>/{missions.length}</span></strong><small>missions complete</small></div><div className="dayline-progress"><div className="progress-track"><span style={{ width: `${missions.length ? completed / missions.length * 100 : 0}%` }} /></div><small>{missions.length ? `${Math.round(completed / missions.length * 100)}% of today's list` : 'No pressure. Add one when you’re ready.'}</small></div></section>
      {formOpen && <form className="mission-form" onSubmit={onCreate}><label>Connect to an active goal<select required value={draft.goalId} onChange={(event) => setDraft({ ...draft, goalId: event.target.value })}><option value="">Choose a goal</option>{activeGoals.map((goal) => <option key={goal.id} value={goal.id}>{goal.title}</option>)}</select></label><label>Action to complete<input required minLength={1} maxLength={180} value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} placeholder="Make it concrete and achievable" /></label><label>Extra context <span className="optional-label">optional</span><input maxLength={1000} value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} placeholder="What will help you get started?" /></label><button type="submit" className="button button-primary" disabled={busy === 'mission'}>{busy === 'mission' ? 'Adding…' : 'Add mission · 20 XP'}</button></form>}
      {missions.length ? <div className="mission-page-list">{missions.map((mission, index) => {
        const goal = goals.find((item) => item.id === mission.goal_id)
        const goalLabel = goal
          ? `${goal.title}${goal.status === 'active' ? '' : ` · ${goal.status}`}`
          : mission.goal_id ? 'Goal unavailable' : 'Unlinked goal'
        return <article className={`mission-large ${mission.completed_at ? 'completed' : ''}`} key={mission.id}><span className="mission-sequence">{String(index + 1).padStart(2, '0')}</span><MissionRow mission={mission} onComplete={onComplete} busy={busy === mission.id} /><span className="mission-goal-name">{goalLabel}</span></article>
      })}
        {missions.length >= 5 && <p className="page-footnote">You’ve set five missions today. Leave room for rest and tomorrow.</p>}
      </div> : <EmptyState title="A clear list, no pressure" detail={activeGoals.length ? 'Choose one action tied to an active goal. It will be saved for today and can earn XP once.' : 'Create or resume an active goal before adding a daily mission.'} action={activeGoals.length ? 'Add first mission' : undefined} onAction={onToggleForm} />}
    </div>
  )
}

function CoachPage({ messages, input, setInput, onSubmit, busy, goals }) {
  return (
    <div className="page-content coach-page">
      <section className="coach-intro"><span className="coach-symbol"><Icon name="spark" size={24} /></span><div><p className="eyebrow">A THOUGHTFUL SOUNDING BOARD</p><h2>Let's work through it.</h2><p>Ask for a smaller next step, a fresh perspective, or help adapting one of your goals.</p></div><span className="coach-limit">20 messages / day</span></section>
      {!goals.length && <div className="coach-context-note">No active goals yet. Your coach can still help, but won’t have goal context until you add one.</div>}
      <section className="conversation" aria-label="Coach conversation" aria-live="polite">
        {!messages.length && <div className="coach-welcome"><span className="coach-symbol"><Icon name="spark" size={22} /></span><p className="eyebrow">A PLACE TO THINK OUT LOUD</p><h3>What feels hard right now?</h3><p>Your coach uses your active goal titles to keep suggestions relevant. It won’t claim progress you haven’t made.</p><div className="suggestion-prompts"><button type="button" onClick={() => setInput('Help me break a big goal into a first step.')}>Break down a goal</button><button type="button" onClick={() => setInput('I feel stuck. Help me find a smaller next move.')}>Find a smaller next move</button><button type="button" onClick={() => setInput('Help me adjust my plan for a busy week.')}>Adjust my plan</button></div></div>}
        {messages.map((message, index) => <div className={`chat-message ${message.role}`} key={`${message.role}-${index}`}><span className="chat-avatar">{message.role === 'assistant' ? <Icon name="spark" size={16} /> : 'Y'}</span><div><span className="chat-sender">{message.role === 'assistant' ? 'ACHIEVE COACH' : 'YOU'}</span><p>{message.content}</p></div></div>)}
        {busy && <div className="chat-message assistant"><span className="chat-avatar"><Icon name="spark" size={16} /></span><div><span className="chat-sender">ACHIEVE COACH</span><p className="typing-indicator">Thinking through the next step<span>···</span></p></div></div>}
      </section>
      <form className="coach-composer" onSubmit={onSubmit}><textarea rows="2" maxLength={2000} value={input} onChange={(event) => setInput(event.target.value)} placeholder="Share what's on your mind…" aria-label="Message the AI coach" /><div><span>{input.length}/2000 · Please avoid sharing highly sensitive information.</span><button className="button button-primary" type="submit" disabled={!input.trim() || busy}>Send message<Icon name="arrow" size={15} /></button></div></form>
      <p className="page-footnote">AI coaching can make mistakes and isn’t a substitute for professional care or advice.</p>
    </div>
  )
}

function LearningPage({ paths, progress, busy, onToggle }) {
  const [selectedPath, setSelectedPath] = useState(paths[0]?.id)
  const currentPath = paths.find((path) => path.id === selectedPath) ?? paths[0]
  const doneSet = new Set(progress.map((entry) => `${entry.path_id}:${entry.lesson_id}`))
  const completedLessons = currentPath.lessons.filter((lesson) => doneSet.has(`${currentPath.id}:${lesson.id}`)).length
  return (
    <div className="page-content learning-page">
      <section className="page-intro"><div><p className="eyebrow">LEARN BY DOING</p><h2>Skills grow through practice.</h2><p>Short lessons, one practical exercise at a time. Progress is saved to your account.</p></div></section>
      <div className="learning-layout"><aside className="learning-path-list" aria-label="Learning paths">{paths.map((path) => { const count = path.lessons.filter((lesson) => doneSet.has(`${path.id}:${lesson.id}`)).length; return <button type="button" className={path.id === currentPath.id ? 'selected' : ''} key={path.id} onClick={() => setSelectedPath(path.id)}><span className="path-category">{path.category}</span><strong>{path.title}</strong><small>{count} of {path.lessons.length} lessons</small><div className="progress-track"><span style={{ width: `${count / path.lessons.length * 100}%` }} /></div></button> })}</aside>
        <section className="learning-course"><div className="course-heading"><span className="eyebrow">{currentPath.category.toUpperCase()} · {currentPath.lessons.length} LESSONS</span><h2>{currentPath.title}</h2><p>{currentPath.description}</p><div className="course-progress-label"><span>Course progress</span><strong>{Math.round(completedLessons / currentPath.lessons.length * 100)}%</strong></div><div className="progress-track"><span style={{ width: `${completedLessons / currentPath.lessons.length * 100}%` }} /></div></div>
          <div className="lesson-list">{currentPath.lessons.map((lesson, index) => { const complete = doneSet.has(`${currentPath.id}:${lesson.id}`); return <article className={`lesson-item ${complete ? 'lesson-complete' : ''}`} key={lesson.id}><div className="lesson-number">{complete ? '✓' : String(index + 1).padStart(2, '0')}</div><div className="lesson-body"><div className="lesson-meta"><span>LESSON {index + 1}</span><span>{lesson.duration}</span></div><h3>{lesson.title}</h3><p>{lesson.content}</p><div className="lesson-exercise"><strong>TRY IT</strong><p>{lesson.exercise}</p></div><button type="button" className={`button ${complete ? 'button-quiet' : 'button-secondary'}`} disabled={busy === `lesson:${lesson.id}`} onClick={() => onToggle(currentPath.id, lesson.id)}>{busy === `lesson:${lesson.id}` ? 'Saving…' : complete ? 'Mark not complete' : 'Mark lesson complete'}{!complete && <Icon name="arrow" size={15} />}</button></div></article> })}</div>
        </section>
      </div>
      <p className="page-footnote">These practical lessons are part of ACHIEVE’s built-in starter curriculum. Completing lessons tracks learning progress; it does not award XP.</p>
    </div>
  )
}

function InsightsPage({ goals, progress, transactions, activity, achievements, roadmaps, learningProgress }) {
  const completedGoals = goals.filter((goal) => goal.status === 'completed').length
  const totalMissions = activity.reduce((sum, day) => sum + day.count, 0)
  const maxActivity = Math.max(1, ...activity.map((day) => day.count))
  return (
    <div className="page-content insights-page">
      <section className="page-intro"><div><p className="eyebrow">EVIDENCE OF YOUR EFFORT</p><h2>Progress, without the guesswork.</h2><p>Everything here comes from actions and goals saved to your account.</p></div></section>
      <div className="insight-stat-grid"><InsightStat label="Total XP" value={progress?.xp ?? 0} detail="earned from completed missions" icon="spark" /><InsightStat label="Missions completed" value={totalMissions} detail="in the last seven days" icon="check" /><InsightStat label="Goals completed" value={completedGoals} detail={`${goals.length} goals saved in total`} icon="target" /><InsightStat label="Lessons completed" value={learningProgress.length} detail="from your learning paths" icon="book" /></div>
      <section className="insight-panel"><div className="section-heading"><div><p className="eyebrow">PAST SEVEN DAYS · UTC</p><h2>Actions completed</h2></div><span className="insight-total">{totalMissions} total</span></div><div className="insight-chart">{activity.map((day) => <div className="insight-day" key={day.date}><strong>{day.count}</strong><div className="insight-bar-bg"><span style={{ height: `${day.count ? Math.max(8, day.count / maxActivity * 100) : 3}%` }} /></div><small>{day.label}</small></div>)}</div>{!totalMissions && <p className="page-footnote">Complete a mission to start seeing your activity here.</p>}</section>
      <div className="insight-bottom"><section className="insight-panel"><div className="section-heading"><div><p className="eyebrow">REWARDS THAT MEAN SOMETHING</p><h2>Achievements</h2></div><span className="insight-total">{achievements.filter((item) => item.unlocked).length}/{achievements.length}</span></div><div className="achievement-list">{achievements.map((achievement) => <article className={`achievement-row ${achievement.unlocked ? 'unlocked' : ''}`} key={achievement.id}><span className="achievement-icon"><Icon name="spark" size={18} /></span><div><strong>{achievement.title}</strong><p>{achievement.description}</p></div><span className="achievement-state">{achievement.unlocked ? 'EARNED' : 'LOCKED'}</span></article>)}</div></section>
        <section className="insight-panel"><div className="section-heading"><div><p className="eyebrow">YOUR RECENT ACTIVITY</p><h2>XP history</h2></div></div>{transactions.length ? <div className="xp-history">{transactions.slice(0, 8).map((transaction) => <div key={transaction.id}><span><span className="history-dot" />Mission completed</span><time dateTime={transaction.created_at}>{new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' }).format(new Date(transaction.created_at))}</time><strong>+{transaction.amount} XP</strong></div>)}</div> : <p className="empty-inline">Your XP history will appear after you complete a mission.</p>}<div className="insight-source-note">{roadmaps.length} saved roadmap{roadmaps.length === 1 ? '' : 's'} · {transactions.length} recent XP reward{transactions.length === 1 ? '' : 's'}</div></section></div>
    </div>
  )
}

function InsightStat({ label, value, detail, icon }) {
  return <article className="insight-stat"><span className="stat-icon lime"><Icon name={icon} /></span><span className="stat-label">{label}</span><strong>{value}</strong><small>{detail}</small></article>
}

function SettingsPage({ user, draft, setDraft, onSave, onRecovery, onSignOut, onDeleteAccount, setOnboardingStep, busy }) {
  return (
    <div className="page-content settings-page">
      <section className="page-intro"><div><p className="eyebrow">YOUR ACCOUNT, YOUR PACE</p><h2>Make this space yours.</h2><p>Update how ACHIEVE addresses you and what you’re focusing on.</p></div></section>
      <section className="settings-layout"><form className="settings-form" onSubmit={onSave}><div className="settings-section-heading"><span className="settings-section-icon"><Icon name="user" /></span><div><h3>Profile</h3><p>Your profile details and current focus.</p></div></div><label>Display name<input maxLength={80} value={draft.display_name} onChange={(event) => setDraft({ ...draft, display_name: event.target.value })} placeholder="How should we address you?" /></label><label>Email address<input type="email" value={user.email ?? ''} readOnly disabled /></label><label>Current focus<input maxLength={200} value={draft.focus} onChange={(event) => setDraft({ ...draft, focus: event.target.value })} placeholder="What are you focusing on right now?" /></label><button className="button button-primary" type="submit" disabled={busy === 'profile'}>{busy === 'profile' ? 'Saving…' : 'Save profile'}</button></form>
        <aside className="account-settings"><div className="settings-section-heading"><span className="settings-section-icon violet-icon"><Icon name="settings" /></span><div><h3>Account & privacy</h3><p>Manage access to your account.</p></div></div><div className="account-action"><div><strong>Password</strong><p>Send a secure reset link to {user.email}.</p></div><button type="button" className="button button-secondary" onClick={onRecovery} disabled={busy === 'recovery'}>{busy === 'recovery' ? 'Sending…' : 'Reset password'}</button></div><div className="account-action"><div><strong>Finish setup</strong><p>Choose your name, focus area, and first goal.</p></div><button type="button" className="button button-secondary" onClick={() => { setOnboardingStep(1); setPage('overview') }}>Complete setup</button></div><div className="account-action"><div><strong>Your private data</strong><p>Goals, missions, and progress are isolated to your account by database policies.</p></div></div><div className="account-action signout-action"><div><strong>Sign out</strong><p>End this session on this device.</p></div><button type="button" className="button button-danger" onClick={onSignOut}>Sign out</button></div><div className="account-action delete-action"><div><strong>Delete account</strong><p>Permanently remove your account and all saved data. This cannot be undone.</p></div><button type="button" className="button button-danger" onClick={onDeleteAccount} disabled={busy === 'account'}>{busy === 'account' ? 'Deleting…' : 'Delete account'}</button></div></aside>
      </section>
    </div>
  )
}

export default App
