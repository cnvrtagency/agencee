import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { GoogleGenAI } from '@google/genai'
import { forbiddenResponse, requireUser, userCanAccessClient } from '@/lib/server/auth'
import { checkRateLimit, getRateLimitIdentity } from '@/lib/server/rate-limit'
import { readJsonWithLimit } from '@/lib/server/request-body'
import { checkUserBudget } from '@/lib/server/token-usage'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)

export const maxDuration = 60

const GEMINI_IMAGE_MODELS = [
  'gemini-3.1-flash-image',
  'gemini-3-pro-image',
  'gemini-2.5-flash-image',
  'gemini-3.1-flash-image-preview',
  'gemini-3-pro-image-preview',
  'gemini-2.5-flash-image-preview',
]

function normaliseImageSize(size: unknown): '512' | '1K' | '2K' | '4K' {
  const value = String(size || '1K').toUpperCase()
  if (value === '512' || value === '1K' || value === '2K' || value === '4K') return value
  return '1K'
}

function normaliseAspectRatio(value: unknown): string {
  const ratio = String(value || '16:9')
  const allowed = new Set(['1:1', '1:4', '1:8', '2:3', '3:2', '3:4', '4:1', '4:3', '4:5', '5:4', '8:1', '9:16', '16:9', '21:9'])
  return allowed.has(ratio) ? ratio : '16:9'
}

function buildGenerationConfig(model: string, aspectRatio: string, imageSize: string) {
  const imageConfig: Record<string, string> = { aspectRatio }
  if (model.includes('3.1-flash') || model.includes('3-pro')) {
    imageConfig.imageSize = imageSize === '512' && !model.includes('3.1-flash') ? '1K' : imageSize
  }

  return {
    responseModalities: ['IMAGE'],
    responseFormat: {
      image: imageConfig,
    },
  }
}

function findInlineImage(data: any): { data: string; mimeType: string } | null {
  const parts = data?.candidates?.[0]?.content?.parts || data?.candidates?.[0]?.parts || []
  for (const part of parts) {
    const inline = part.inlineData || part.inline_data
    if (inline?.data) {
      return {
        data: inline.data,
        mimeType: inline.mimeType || inline.mime_type || 'image/jpeg',
      }
    }
  }
  return null
}

export async function POST(req: NextRequest) {
  const authResult = await requireUser(req)
  if (!authResult.ok) return authResult.response

  const rate = checkRateLimit({
    key: `generate-image:${getRateLimitIdentity(req, authResult.auth.user.id)}`,
    limit: 20,
    windowMs: 10 * 60 * 1000,
  })
  if (!rate.ok) return rate.response

  const budgetCheck = await checkUserBudget(supabase, authResult.auth.user.id)
  if (!budgetCheck.ok && budgetCheck.response) return budgetCheck.response

  const bodyResult = await readJsonWithLimit<any>(req, 20_000)
  if (!bodyResult.ok) return bodyResult.response

  const { prompt, filename, client_id, resolution = '1K', aspect_ratio, aspectRatio } = bodyResult.data
  if (!prompt) return NextResponse.json({ error: 'prompt required' }, { status: 400 })
  if (String(prompt).length > 4000) return NextResponse.json({ error: 'prompt must be 4000 characters or fewer' }, { status: 400 })

  let workspaceId: string | null = null
  if (client_id) {
    if (!(await userCanAccessClient(supabase, authResult.auth.user.id, client_id))) return forbiddenResponse()
    const { data: client } = await supabase.from('client_profiles').select('workspace_id').eq('id', client_id).maybeSingle()
    workspaceId = client?.workspace_id || null
  }
  if (!workspaceId) {
    const { data: workspace } = await supabase.from('workspaces').select('id').eq('owner_id', authResult.auth.user.id).maybeSingle()
    workspaceId = workspace?.id || null
  }

  const imageSize = normaliseImageSize(resolution)
  const requestedAspectRatio = normaliseAspectRatio(aspect_ratio || aspectRatio)

  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    console.error('[generate-image] GEMINI_API_KEY not set')
    return NextResponse.json({
      error: 'Image generation not configured. Set GEMINI_API_KEY in Vercel environment variables.',
      skipped: true,
    }, { status: 200 })
  }

  let imageBase64: string = ''
  let imageMimeType: string = 'image/jpeg'
  let lastError = ''
  const attemptedModels: string[] = []
  const ai = new GoogleGenAI({ apiKey })

  for (const model of GEMINI_IMAGE_MODELS) {
    attemptedModels.push(model)
    try {
      const geminiData = await ai.models.generateContent({
        model,
        contents: String(prompt),
        config: buildGenerationConfig(model, requestedAspectRatio, imageSize),
      })

      const imagePart = findInlineImage(geminiData)
      if (!imagePart) {
        const responseParts = (geminiData as any).candidates?.[0]?.content?.parts || (geminiData as any).parts || []
        const text = responseParts
          .map((p: any) => p.text)
          .filter(Boolean)
          .join(' ')
          .slice(0, 180)
        lastError = `${model}: no image data in response${text ? ` (${text})` : ''}`
        console.warn('[generate-image] No image part:', JSON.stringify(geminiData).slice(0, 200))
        continue
      }

      imageBase64 = imagePart.data
      imageMimeType = imagePart.mimeType
      break
    } catch (err: any) {
      lastError = `${model}: ${err.message}`
      console.warn('[generate-image] Model exception:', lastError)
      continue
    }
  }

  if (!imageBase64) {
    console.error('[generate-image] All models failed. Last error:', lastError)
    return NextResponse.json({ error: lastError || 'All image models failed', attempted_models: attemptedModels, skipped: true }, { status: 200 })
  }

  // Upload to Supabase Storage (bucket: blog-images, public)
  const slug = (filename || Date.now()).toString().toLowerCase().replace(/[^a-z0-9-]/g, '-')
  const ext = imageMimeType.includes('jpeg') ? 'jpg' : 'webp'
  const storageFilename = `${slug}.${ext}`
  const storagePath = workspaceId && client_id
    ? `${workspaceId}/${client_id}/${storageFilename}`
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
    aspect_ratio: requestedAspectRatio,
    resolution: imageSize,
  })
}
