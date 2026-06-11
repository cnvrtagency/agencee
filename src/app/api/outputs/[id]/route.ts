import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!)

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const { data: output, error: loadError } = await supabase
    .from('content_outputs')
    .select('id, images')
    .eq('id', id)
    .single()

  if (loadError || !output) {
    return NextResponse.json({ success: false, error: 'Output not found' }, { status: 404 })
  }

  // Remove any stored images from the blog-images bucket (best effort)
  const paths = (Array.isArray(output.images) ? output.images : [])
    .map((img: { storage_path?: string }) => img?.storage_path)
    .filter((p: string | undefined): p is string => !!p)

  if (paths.length) {
    const { error: storageError } = await supabase.storage.from('blog-images').remove(paths)
    if (storageError) console.error('Failed to remove images for output', id, storageError.message)
  }

  // Delete version history rows, then the output itself
  await supabase.from('output_versions').delete().eq('output_id', id)

  const { error: deleteError } = await supabase.from('content_outputs').delete().eq('id', id)
  if (deleteError) {
    return NextResponse.json({ success: false, error: deleteError.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
