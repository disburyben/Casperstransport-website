export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';

// Admin-only: invite a new user and set their role
export async function POST(req: NextRequest) {
  // Verify the caller is an authenticated admin
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

  // Check caller is admin
  const { data: profile } = await supabaseAdmin
    .from('user_profiles')
    .select('role')
    .eq('id', session.user.id)
    .single();
  if (profile?.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { email, name, role = 'driver', password } = await req.json();
  if (!email || !role) return NextResponse.json({ error: 'Email and role required' }, { status: 400 });

  // Create the user via admin API
  const { data: newUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
    email,
    password: password || undefined,
    email_confirm: true,
    user_metadata: { full_name: name || email },
    ...(password ? {} : { }),
  });

  if (createError) return NextResponse.json({ error: createError.message }, { status: 400 });

  // If no password, send invite/magic link
  if (!password) {
    await supabaseAdmin.auth.admin.inviteUserByEmail(email);
  }

  // Set role in user_profiles
  const { error: profileError } = await supabaseAdmin
    .from('user_profiles')
    .upsert({ id: newUser.user.id, role }, { onConflict: 'id' });

  if (profileError) return NextResponse.json({ error: 'User created but role not set: ' + profileError.message }, { status: 500 });

  return NextResponse.json({ success: true, userId: newUser.user.id, email });
}
