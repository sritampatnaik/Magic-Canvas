import { createClient } from '@supabase/supabase-js';

export const browserClient = () => {
	const url = process.env.NEXT_PUBLIC_SUPABASE_URL as string;
	const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string;
	if (!url || !anon) {
		throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY');
	}
	return createClient(url, anon, {
		auth: { autoRefreshToken: true, persistSession: false },
		realtime: { params: { eventsPerSecond: 40 } },
	});
};


