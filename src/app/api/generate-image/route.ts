import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)

export async function POST(req: NextRequest) {
  const { prompt, filename, client_id, workspace_id, resolution = '1K' } = await req.json()
  if (!prompt) return NextResponse.json({ error: 'prompt required' }, { status: 400 })

  const resolutionMap: Record<string, string> = {
    '1K': '1024x1024',
    '2K': '2048x2048',
    '4K': '4096x4096',
  }
  const outputSize = resolutionMap[resolution] || '1024x1024'

  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) return NextResponse.json({ error: 'GEMINI_API_KEY not set' }, { status: 500 })

  let imageBase64: string
  let imageMimeType: string

  try {
    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-image:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            responseModalities: ['IMAGE', 'TEXT'],
            imageGenerationConfig: {
              outputOptions: { mimeType: 'image/jpeg', compressionQuality: 85 },
              numberOfImages: 1,
            },
          },
        }),
      },
    )

    const geminiData = await geminiRes.json()

    if (!geminiRes.ok) {
      console.error('[generate-image] Gemini error:', geminiData.error)
      return NextResponse.json({ error: `Gemini API error: ${geminiData.error?.message}` }, { status: 500 })
    }

    const parts = geminiData.candidates?.[0]?.content?.parts || []
    const imagePart = parts.find((p: any) => p.inlineData)

    if (!imagePart?.inlineData?.data) {
      console.error('[generate-image] No image in response:', JSON.stringify(geminiData).slice(0, 200))
      return NextResponse.json({ error: 'No image returned from Gemini' }, { status: 500 })
    }

    imageBase64 = imagePart.inlineData.data
    imageMimeType = imagePart.inlineData.mimeType || 'image/jpeg'
  } catch (err: any) {
    console.error('[generate-image] Fetch error:', err.message)
    return NextResponse.json({ error: `Image generation failed: ${err.message}` }, { status: 500 })
  }

  // Upload to Supabase Storage (bucket: blog-images, public)
  const slug = (filename || Date.now()).toString().toLowerCase().replace(/[^a-z0-9-]/g, '-')
  const ext = imageMimeType.includes('jpeg') ? 'jpg' : 'webp'
  const storageFilename = `${slug}.${ext}`
  const storagePath = workspace_id && client_id
    ? `${workspace_id}/${client_id}/${storageFilename}`
    : `general/${storageFilename}`

  const { error: uploadError } = await supabase.storage
    .from('blog-images')
    .upload(storagePath, Buffer.from(imageBase64, 'base64'), { contentType: imageMimeType, upsert: true })

  if (uploadError) {
    console.error('[generate-image] Storage upload failed:', uploadError.message)
    return NextResponse.json({ error: `Storage upload failed: ${uploadError.message}` }, { status: 500 })
  }

  const { data: { publicUrl } } = supabase.storage.from('blog-images').getPublicUrl(storagePath)

  return NextResponse.json({
    url: publicUrl,
    filename: storageFilename,
    storage_path: storagePath,
    mime_type: imageMimeType,
  })
}
