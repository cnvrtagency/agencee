import { NextRequest, NextResponse } from 'next/server'

export async function readJsonWithLimit<T = any>(
  req: NextRequest,
  maxBytes: number,
): Promise<{ ok: true; data: T } | { ok: false; response: NextResponse }> {
  const contentLength = req.headers.get('content-length')
  if (contentLength && Number(contentLength) > maxBytes) {
    return {
      ok: false,
      response: NextResponse.json({ error: `Request body too large. Limit is ${maxBytes} bytes.` }, { status: 413 }),
    }
  }

  try {
    const text = await req.text()
    if (Buffer.byteLength(text, 'utf8') > maxBytes) {
      return {
        ok: false,
        response: NextResponse.json({ error: `Request body too large. Limit is ${maxBytes} bytes.` }, { status: 413 }),
      }
    }
    return { ok: true, data: JSON.parse(text || '{}') }
  } catch {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }),
    }
  }
}
