import { createClient } from 'npm:@supabase/supabase-js@2'

const allowedOrigin = Deno.env.get('APP_ORIGIN') ?? 'http://localhost:5173'
const corsHeaders = {
  'Access-Control-Allow-Origin': allowedOrigin,
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Vary': 'Origin'
}

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  })

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const validText = (value: unknown, min: number, max: number): value is string =>
  typeof value === 'string' && value.trim().length >= min && value.trim().length <= max

const validUuid = (value: unknown): value is string =>
  typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return jsonResponse({ error: 'Method not allowed.' }, 405)

  const contentLength = Number(request.headers.get('Content-Length') ?? 0)
  if (contentLength > 8192) return jsonResponse({ error: 'Request body is too large.' }, 413)

  const authorization = request.headers.get('Authorization')
  if (!authorization?.startsWith('Bearer ')) return jsonResponse({ error: 'Sign in to create a roadmap.' }, 401)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const aiKey = Deno.env.get('OPENAI_API_KEY')
  if (!supabaseUrl || !anonKey || !serviceRoleKey || !aiKey) {
    console.error('Roadmap function is missing required server-side configuration.')
    return jsonResponse({ error: 'Roadmap generation is not configured yet.' }, 503)
  }

  let body: unknown
  try {
    const bodyText = await request.text()
    if (new TextEncoder().encode(bodyText).byteLength > 8192) {
      return jsonResponse({ error: 'Request body is too large.' }, 413)
    }
    body = JSON.parse(bodyText)
  } catch {
    return jsonResponse({ error: 'Request body must be valid JSON.' }, 400)
  }

  if (!isRecord(body) || !validUuid(body.goalId) || !validUuid(body.requestId)) {
    return jsonResponse({ error: 'Choose a valid goal before creating a roadmap.' }, 400)
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: authorization } }
  })

  const { data: { user }, error: userError } = await userClient.auth.getUser()
  if (userError || !user) return jsonResponse({ error: 'Your session is invalid or has expired.' }, 401)

  const { data: existingRoadmap, error: existingRoadmapError } = await userClient
    .from('roadmaps')
    .select('id, goal_id, title, content, created_at')
    .eq('id', body.requestId)
    .maybeSingle()
  if (existingRoadmapError) {
    console.error('Roadmap idempotency check failed.')
    return jsonResponse({ error: 'Could not verify your saved roadmaps. Please try again.' }, 503)
  }
  if (existingRoadmap) return jsonResponse(existingRoadmap)

  const { data: goal, error: goalError } = await userClient
    .from('goals')
    .select('id, title, category, description, motivation, target_date, status')
    .eq('id', body.goalId)
    .maybeSingle()
  if (goalError) {
    console.error('Roadmap goal lookup failed.')
    return jsonResponse({ error: 'Could not load that goal. Please try again.' }, 503)
  }
  if (!goal || goal.status !== 'active') {
    return jsonResponse({ error: 'Choose one of your active goals to create a roadmap.' }, 404)
  }

  const { data: withinLimit, error: limitError } = await userClient.rpc('consume_roadmap_rate_limit')
  if (limitError) {
    console.error('Roadmap rate-limit check failed.')
    return jsonResponse({ error: 'Could not verify your request limit. Please try again.' }, 503)
  }
  if (!withinLimit) return jsonResponse({ error: 'You have reached the roadmap limit of five requests per day.' }, 429)

  const prompt = {
    goal: goal.title,
    category: goal.category,
    description: goal.description,
    motivation: goal.motivation,
    targetDate: goal.target_date
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 30000)
  try {
    const aiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${aiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: Deno.env.get('OPENAI_MODEL') ?? 'gpt-4o-mini',
        temperature: 0.5,
        max_completion_tokens: 1600,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: 'Create a realistic, supportive personal-growth roadmap. Return only JSON with title (string), summary (string), stages (array of 3 to 6 objects with title, whyItMatters, suggestedTime, actions; actions is an array of 2 to 5 concise strings). Avoid medical, legal, financial or unsafe advice. Make actions specific and achievable.'
          },
          { role: 'user', content: JSON.stringify(prompt) }
        ]
      })
    })

    if (!aiResponse.ok) {
      console.error(`AI provider returned status ${aiResponse.status}.`)
      return jsonResponse({ error: 'The coach could not create a roadmap right now. Please try again later.' }, 502)
    }

    const providerResult: unknown = await aiResponse.json()
    if (!isRecord(providerResult) || !Array.isArray(providerResult.choices)) {
      console.error('AI provider response had an unexpected shape.')
      return jsonResponse({ error: 'The coach returned an unexpected response. Please try again.' }, 502)
    }

    const firstChoice = providerResult.choices[0]
    const message = isRecord(firstChoice) && isRecord(firstChoice.message) ? firstChoice.message.content : null
    if (typeof message !== 'string') {
      console.error('AI provider response did not contain text content.')
      return jsonResponse({ error: 'The coach returned an unexpected response. Please try again.' }, 502)
    }

    let roadmap: unknown
    try {
      roadmap = JSON.parse(message)
    } catch {
      console.error('AI provider returned invalid roadmap JSON.')
      return jsonResponse({ error: 'The coach returned an invalid roadmap. Please try again.' }, 502)
    }

    if (!isRecord(roadmap)
      || !validText(roadmap.title, 1, 160)
      || !validText(roadmap.summary, 1, 1000)
      || !Array.isArray(roadmap.stages)
      || roadmap.stages.length < 3
      || roadmap.stages.length > 6
      || !roadmap.stages.every((stage) => isRecord(stage)
        && validText(stage.title, 1, 120)
        && validText(stage.whyItMatters, 1, 500)
        && validText(stage.suggestedTime, 1, 100)
        && Array.isArray(stage.actions)
        && stage.actions.length >= 2
        && stage.actions.length <= 5
        && stage.actions.every((action) => validText(action, 1, 200)))) {
      console.error('AI provider returned a roadmap that did not match the required schema.')
      return jsonResponse({ error: 'The coach returned a roadmap in an unsupported format. Please try again.' }, 502)
    }

    const privilegedClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false }
    })
    const { error: saveError } = await privilegedClient
      .from('roadmaps')
      .upsert({
        id: body.requestId,
        user_id: user.id,
        goal_id: goal.id,
        title: roadmap.title.trim(),
        content: roadmap
      }, { onConflict: 'id', ignoreDuplicates: true })
    if (saveError) {
      console.error('Generated roadmap persistence failed.')
      return jsonResponse({ error: 'The roadmap was created but could not be saved. Please try again.' }, 503)
    }

    const { data: savedRoadmap, error: savedRoadmapError } = await privilegedClient
      .from('roadmaps')
      .select('id, goal_id, title, content, created_at')
      .eq('id', body.requestId)
      .eq('user_id', user.id)
      .maybeSingle()
    if (savedRoadmapError || !savedRoadmap) {
      console.error('Saved roadmap could not be confirmed.')
      return jsonResponse({ error: 'The roadmap may have been created, but we could not confirm it was saved. Please retry.' }, 503)
    }

    return jsonResponse(savedRoadmap)
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      return jsonResponse({ error: 'Roadmap generation took too long. Please try again.' }, 504)
    }
    console.error('Roadmap generation request failed.')
    return jsonResponse({ error: 'Roadmap generation failed. Please try again later.' }, 502)
  } finally {
    clearTimeout(timeout)
  }
})
