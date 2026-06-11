import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)

export const maxDuration = 120

export async function POST(_req: NextRequest) {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return NextResponse.json({ error: 'No API key' }, { status: 500 })

  // Monday of this week
  const weekOf = new Date()
  weekOf.setDate(weekOf.getDate() - weekOf.getDay() + 1)
  const weekStr = weekOf.toISOString().split('T')[0]

  const { data: existing } = await supabase
    .from('agent_knowledge')
    .select('id')
    .eq('agent_type', 'seo')
    .eq('week_of', weekStr)
    .maybeSingle()

  if (existing) return NextResponse.json({ skipped: true, message: 'Digest already exists for this week' })

  const sources = [
    'Google Search Central blog latest posts 2025 2026',
    'Google core algorithm update 2025 2026 SEO impact',
    'SEO best practices 2025 2026 what is working ranking factors',
    'Google helpful content system updates 2025 2026',
    'Local SEO ranking factors 2025 2026',
  ]

  const prompt = `You are an expert SEO knowledge curator. Today's date is ${new Date().toISOString().split('T')[0]}.

Search for the most important recent SEO developments and compile a knowledge digest for SEO professionals. Focus on:

1. Recent Google algorithm updates and confirmed ranking changes
2. What content strategies are currently working (backed by data, not opinion)
3. Technical SEO developments — Core Web Vitals, schema, indexing changes
4. Local SEO changes that affect service businesses
5. What has changed in the last 90 days that an SEO professional must know

Use web_search to find current information. Search for: ${sources.join(', ')}.

After searching, write a structured knowledge digest:
- Lead with the most actionable recent changes
- Include specific dates and confirmed sources where possible
- Focus on what to DO differently, not just what changed
- Keep it under 800 words
- UK English

This will be read by an AI SEO agent before every client session to stay current.`

  const makeRequest = (messages: any[]) =>
    fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'web-search-2025-03-05',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 2000,
        tools: [{ type: 'web_search_20250305', name: 'web_search' }],
        messages,
      }),
    }).then(r => r.json())

  let messages: any[] = [{ role: 'user', content: prompt }]
  let loopData = await makeRequest(messages)
  let finalText = ''
  let loops = 0

  while (loops < 6) {
    loops++
    const toolUseBlocks = (loopData.content || []).filter((b: any) => b.type === 'tool_use')

    if (loopData.stop_reason === 'end_turn' || toolUseBlocks.length === 0) {
      finalText = (loopData.content || [])
        .filter((b: any) => b.type === 'text')
        .map((b: any) => b.text)
        .join('\n')
        .trim()
      break
    }

    messages.push({ role: 'assistant', content: loopData.content })
    messages.push({
      role: 'user',
      content: toolUseBlocks.map((b: any) => ({
        type: 'tool_result',
        tool_use_id: b.id,
        content: '',
      })),
    })
    loopData = await makeRequest(messages)
  }

  if (!finalText) return NextResponse.json({ error: 'No content generated' }, { status: 500 })

  const { error } = await supabase.from('agent_knowledge').upsert({
    agent_type: 'seo',
    week_of: weekStr,
    summary: finalText,
    sources,
  }, { onConflict: 'agent_type,week_of' })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ created: true, week_of: weekStr, length: finalText.length })
}
