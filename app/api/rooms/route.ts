import { NextResponse } from 'next/server';
import { customAlphabet } from 'nanoid';
import { adminClient } from '@/lib/supabase/server';

const nanoid = customAlphabet('346789ABCDEFGHJKLMNPQRTUVWXYabcdefghijkmnpqrstuvwxy', 8);

export async function POST(request: Request) {
	try {
		const origin = request.headers.get('origin') || process.env.NEXT_PUBLIC_SITE_URL || '';
		const slug = nanoid();
		const supa = adminClient();
		const { error } = await supa.from('rooms').insert({ slug });
		if (error) {
			return NextResponse.json({ error: error.message }, { status: 500 });
		}
		return NextResponse.json({ slug, url: `${origin}/room/${slug}/join` });
	} catch (e: unknown) {
		const message = e instanceof Error ? e.message : 'Unexpected error';
		return NextResponse.json({ error: message }, { status: 500 });
	}
}


