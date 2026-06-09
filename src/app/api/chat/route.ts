import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  const body = await req.json()

  // Wrap system prompt with cache_control if it's a plain string
  let system = body.system
  if (typeof system === 'string' && system.length > 0) {
    system = [
      {
        type: 'text',
        text: system,
        cache_control: { type: 'ephemeral' },
      },
    ]
  }

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY!,
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'prompt-caching-2024-07-31',
    },
    body: JSON.stringify({ ...body, system }),
  })

  const data = await response.json()
  return NextResponse.json(data)
}
