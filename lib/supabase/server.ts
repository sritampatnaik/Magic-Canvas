import { createClient } from '@supabase/supabase-js';

export const adminClient = () => {
	const url = process.env.NEXT_PUBLIC_SUPABASE_URL as string;
	const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY as string;
	if (!url || !serviceRole) {
		throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
	}
	return createClient(url, serviceRole, {
		auth: { persistSession: false, autoRefreshToken: false },
	});
};


