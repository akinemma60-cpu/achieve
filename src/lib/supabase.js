import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

const isValidSupabaseUrl = (value) => {
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'https:'
      && parsed.hostname.endsWith('.supabase.co')
      && parsed.hostname !== 'your-project.supabase.co'
  } catch {
    return false
  }
}

const isValidPublishableKey = (value) =>
  /^sb_publishable_[A-Za-z0-9_-]+$/.test(value)
  || /^eyJ[A-Za-z0-9._-]+$/.test(value)

export const hasSupabaseConfig =
  Boolean(supabaseUrl && supabaseAnonKey)
  && isValidSupabaseUrl(supabaseUrl)
  && isValidPublishableKey(supabaseAnonKey)

export const supabase = hasSupabaseConfig
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true
      }
    })
  : null
