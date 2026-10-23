import { useEffect, useState } from 'react'
import App from './App.jsx'
import { hasSupabaseConfig, supabase } from './lib/supabase.js'
import './Auth.css'

function AuthScreen() {
  const [mode, setMode] = useState('login')
  const [displayName, setDisplayName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (event) => {
    event.preventDefault()
    setError('')
    setMessage('')
    setBusy(true)

    try {
      if (mode === 'signup') {
        const { data, error: authError } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: { data: { display_name: displayName.trim() } }
        })
        if (authError) throw authError
        if (!data.session) {
          setMessage('Check your email for a confirmation link, then return here to sign in.')
        }
      } else if (mode === 'recovery') {
        const { error: authError } = await supabase.auth.resetPasswordForEmail(email.trim(), {
          redirectTo: `${window.location.origin}/`
        })
        if (authError) throw authError
        setMessage('If an account exists for that address, a password recovery link is on its way.')
      } else {
        const { error: authError } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password
        })
        if (authError) throw authError
      }
    } catch (authError) {
      setError(authError instanceof TypeError || authError.message === 'Failed to fetch'
        ? 'Could not reach Supabase. Check that .env has your real project URL (not the example URL), then restart the Vite server.'
        : authError.message || 'Authentication failed. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  if (!hasSupabaseConfig) {
    return (
      <main className="auth-page">
        <section className="auth-card setup-card">
          <Brand />
          <p className="eyebrow">Secure account setup</p>
          <h1>Connect your Supabase project.</h1>
          <p className="auth-copy">
            Authentication is disabled because the Supabase project settings are missing or still use example placeholders.
            No user or demo account has been created.
          </p>
          <ol className="setup-steps">
            <li>In Supabase, open Project Settings → API and copy your project's actual Project URL and publishable/anon key.</li>
            <li>Put those values in the local <code>.env</code> file. Do not use <code>your-project.supabase.co</code>.</li>
            <li>Apply the checked-in migration with the Supabase CLI, then deploy the Edge Function.</li>
          </ol>
          <pre>VITE_SUPABASE_URL=https://your-project.supabase.co{'\n'}VITE_SUPABASE_ANON_KEY=your-public-anon-or-publishable-key</pre>
          <p className="auth-footnote">
            Never put the service-role key or AI provider key in this file. Use Supabase Edge Function secrets for those.
          </p>
        </section>
      </main>
    )
  }

  const title = mode === 'signup' ? 'Start building momentum.' : mode === 'recovery' ? 'Reset your password.' : 'Welcome back.'

  return (
    <main className="auth-page">
      <div className="auth-layout">
        <section className="auth-story" aria-label="About ACHIEVE">
          <p className="auth-story-kicker">A PRACTICE FOR YOUR NEXT CHAPTER</p>
          <h2>Small moves.<br /><span>A life in motion.</span></h2>
          <p>Make space for the goals that matter. Turn intention into a practical next step, then build from there.</p>
          <div className="auth-principles" aria-label="The ACHIEVE approach">
            <div><span>01</span><strong>Choose a direction</strong></div>
            <div><span>02</span><strong>Make the next move small</strong></div>
            <div><span>03</span><strong>Keep what you learn</strong></div>
          </div>
          <span className="auth-story-footer">YOUR PACE. YOUR PROGRESS.</span>
        </section>
        <section className="auth-card">
          <Brand />
          <p className="eyebrow">Your next chapter starts here</p>
          <h1>{title}</h1>
          <p className="auth-copy">A little progress, made consistently, changes everything.</p>
          <form className="auth-form" onSubmit={submit}>
            {mode === 'signup' && (
              <label>
                Your name
                <input
                  type="text"
                  autoComplete="name"
                  maxLength={80}
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                />
              </label>
            )}
            <label>
              Email address
              <input
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </label>
            {mode !== 'recovery' && (
              <label>
                Password
                <input
                  type="password"
                  autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                  minLength={8}
                  required
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </label>
            )}
            {error && <p className="auth-error" role="alert">{error}</p>}
            {message && <p className="auth-success" role="status">{message}</p>}
            <button type="submit" className="primary-btn auth-submit" disabled={busy}>
              {busy ? 'Please wait…' : mode === 'signup' ? 'Create account' : mode === 'recovery' ? 'Send recovery link' : 'Sign in'}
            </button>
          </form>
          <div className="auth-links">
            {mode === 'login' && (
              <>
                <button type="button" onClick={() => { setMode('recovery'); setMessage(''); setError('') }}>Forgot password?</button>
                <button type="button" onClick={() => { setMode('signup'); setMessage(''); setError('') }}>Create an account</button>
              </>
            )}
            {mode !== 'login' && (
              <button type="button" onClick={() => { setMode('login'); setMessage(''); setError('') }}>Back to sign in</button>
            )}
          </div>
        </section>
      </div>
    </main>
  )
}

function Brand() {
  return (
    <div className="brand-block auth-brand">
      <div className="brand-mark">A</div>
      <div>
        <p className="eyebrow">Personal growth</p>
        <h2>ACHIEVE</h2>
      </div>
    </div>
  )
}

export default function AuthGate() {
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(Boolean(supabase))
  const [authError, setAuthError] = useState('')
  const [passwordRecovery, setPasswordRecovery] = useState(false)

  useEffect(() => {
    if (!supabase) return undefined

    let active = true
    supabase.auth.getSession()
      .then(({ data, error }) => {
        if (!active) return
        if (error) setAuthError(error.message)
        setSession(data?.session ?? null)
        setLoading(false)
      })
      .catch((error) => {
        if (!active) return
        setAuthError(error.message || 'Could not restore your session.')
        setLoading(false)
      })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, nextSession) => {
      setSession(nextSession)
      if (event === 'PASSWORD_RECOVERY') setPasswordRecovery(true)
    })

    return () => {
      active = false
      subscription.unsubscribe()
    }
  }, [])

  if (!hasSupabaseConfig) return <AuthScreen />
  if (loading) return <main className="auth-page"><p className="eyebrow">Restoring your secure session…</p></main>
  if (!session) {
    return (
      <>
        {authError && <p className="auth-global-error" role="alert">{authError}</p>}
        <AuthScreen />
      </>
    )
  }

  if (passwordRecovery) {
    return (
      <PasswordRecovery
        onComplete={() => setPasswordRecovery(false)}
        onError={setAuthError}
        error={authError}
      />
    )
  }

  return (
    <App
      user={session.user}
      onSignOut={async () => {
        const { error } = await supabase.auth.signOut()
        if (error) throw error
      }}
    />
  )
}

function PasswordRecovery({ onComplete, onError, error }) {
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  const submit = async (event) => {
    event.preventDefault()
    setBusy(true)
    onError('')
    setMessage('')
    const { error } = await supabase.auth.updateUser({ password })
    setBusy(false)
    if (error) {
      onError(error.message)
      return
    }
    setMessage('Your password has been updated.')
  }

  return (
    <main className="auth-page">
      <section className="auth-card">
        <Brand />
        <p className="eyebrow">Account recovery</p>
        <h1>Choose a new password.</h1>
        <form className="auth-form" onSubmit={submit}>
          <label>
            New password
            <input
              type="password"
              autoComplete="new-password"
              minLength={8}
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          {error && <p className="auth-error" role="alert">{error}</p>}
          {message && <p className="auth-success" role="status">{message}</p>}
          <button type="submit" className="primary-btn auth-submit" disabled={busy}>
            {busy ? 'Updating…' : 'Update password'}
          </button>
        </form>
        {message && <div className="auth-links"><button type="button" onClick={onComplete}>Continue to ACHIEVE</button></div>}
      </section>
    </main>
  )
}
