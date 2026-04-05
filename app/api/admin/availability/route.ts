// /api/admin/availability
// GET  — list blocked dates
// POST — block a date   { date: 'YYYY-MM-DD', reason?: string }
// DELETE — unblock      { id: string }
//
// Requires DB table (run once in Supabase SQL editor):
// CREATE TABLE IF NOT EXISTS blocked_dates (
//   id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
//   date date NOT NULL UNIQUE,
//   reason text,
//   created_at timestamptz DEFAULT now()
// );
// ALTER TABLE blocked_dates ENABLE ROW LEVEL SECURITY;
// CREATE POLICY "service_role_all" ON blocked_dates USING (true) WITH CHECK (true);
export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from 'next/server';
import { createServerClient }        from '@supabase/ssr';
import { createClient }              from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function requireAdmin(req: NextRequest) {
  const supabaseAuth = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { get: (n) => req.cookies.get(n)?.value, set: () => {}, remove: () => {} } }
  );
  const { data: { session } } = await supabaseAuth.auth.getSession();
  if (!session) return null;
  const { data: profile } = await supabase.from('user_profiles').select('role').eq('id', session.user.id).single();
  return profile?.role === 'admin' ? session : null;
}

export async function GET(req: NextRequest) {
  if (!await requireAdmin(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { data, error } = await supabase
    .from('blocked_dates')
    .select('*')
    .order('date', { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function POST(req: NextRequest) {
  if (!await requireAdmin(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { date, reason } = await req.json();
  if (!date) return NextResponse.json({ error: 'date required' }, { status: 400 });
  const { data, error } = await supabase
    .from('blocked_dates')
    .insert({ date, reason: reason || null })
    .select()
    .single();
  if (error) {
    if (error.code === '23505') return NextResponse.json({ error: 'That date is already blocked' }, { status: 409 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(data);
}

export async function DELETE(req: NextRequest) {
  if (!await requireAdmin(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await req.json();
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  const { error } = await supabase.from('blocked_dates').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
