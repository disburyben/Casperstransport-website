export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';

// DELETE — remove a user | PATCH — change role or send password reset
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const supabaseAdmin = await getAdminClient(req);
  if (!supabaseAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { error } = await supabaseAdmin.auth.admin.deleteUser(params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await supabaseAdmin.from('user_profiles').delete().eq('id', params.id);
  return NextResponse.json({ success: true });
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const supabaseAdmin = await getAdminClient(req);
  if (!supabaseAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await req.json();

  if (body.action === 'reset_password') {
    const { data: user } = await supabaseAdmin.auth.admin.getUserById(params.id);
    if (!user.user?.email) return NextResponse.json({ error: 'User not found' }, { status: 404 });
    const { error } = await supabaseAdmin.auth.resetPasswordForEmail(user.user.email, {
      redirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/admin/reset-password`,
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true });
  }

  if (body.role) {
    const { error } = await supabaseAdmin
      .from('user_profiles')
      .upsert({ id: params.id, role: body.role }, { onConflict: 'id' });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ error: 'No action specified' }, { status: 400 });
}

async function getAdminClient(req: NextRequest) {
  const supabaseAuth = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { get: (n) => req.cookies.get(n)?.value, set: () => {}, remove: () => {} } }
  );
  const { data: { session } } = await supabaseAuth.auth.getSession();
  if (!session) return null;

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
  const { data: profile } = await admin.from('user_profiles').select('role').eq('id', session.user.id).single();
  if (profile?.role !== 'admin') return null;
  return admin;
}
