import { NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabase/server';

const BUCKET = 'canvas-uploads';

export async function POST(req: Request) {
  try {
    const { dataUrl, contentType } = await req.json();
    if (!dataUrl) {
      return NextResponse.json({ error: 'Missing dataUrl' }, { status: 400 });
    }
    const supa = adminClient();
    // ensure bucket exists (public)
    try {
      const { data: buckets } = await (supa.storage as any).listBuckets?.();
      const exists = Array.isArray(buckets) && buckets.some((b: any) => b.name === BUCKET);
      if (!exists && (supa.storage as any).createBucket) {
        await (supa.storage as any).createBucket(BUCKET, { public: true });
      }
    } catch {}

    // decode data URL
    const [meta, b64] = (dataUrl as string).split(',');
    const ct = contentType || /data:(.*?);base64/.exec(meta)?.[1] || 'image/png';
    const bin = Buffer.from(b64, 'base64');
    const path = `${Date.now()}-${Math.random().toString(36).slice(2)}.png`;

    const { error: upErr } = await supa.storage.from(BUCKET).upload(path, bin, {
      contentType: ct,
      upsert: true,
    });
    if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

    const { data } = supa.storage.from(BUCKET).getPublicUrl(path);
    return NextResponse.json({ url: data.publicUrl });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Upload failed' }, { status: 500 });
  }
}


