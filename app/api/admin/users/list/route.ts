export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';

export async function GET(req: NextRequest) {
  const supabaseAuth = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { get: (n) => req.cookies.get(n)?.value, set: () => {}, remove: () => {} } }
  );
  const { data: { session } } = await supabaseAuth.auth.getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  const { data: callerProfile } = await supabaseAdmin
    .from('user_profiles')
    .select('role')
    .eq('id', session.user.id)
    .single();
  if (callerProfile?.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  // Get all users from auth + their profiles
  const { data: { users }, error } = await supabaseAdmin.auth.admin.listUsers();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const { data: profiles } = await supabaseAdmin.from('user_profiles').select('id, role');
  const profileMap = Object.fromEntries((profiles || []).map(p => [p.id, p.role]));

  const result = users.map(u => ({
    id: u.id,
    email: u.email,
    name: u.user_metadata?.full_name || u.email,
    role: profileMap[u.id] || 'unknown',
    created_at: u.created_at,
    last_sign_in: u.last_sign_in_at,
    confirmed: !!u.email_confirmed_at,
  }));

  return NextResponse.json({ users: result });
}
