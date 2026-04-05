// GET /api/admin/customers
// Returns all customers with booking stats (count, total spend, last booking date)
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

  // Fetch all customers
  const { data: customers, error: custErr } = await supabase
    .from('customers')
    .select('id, name, email, phone, created_at')
    .order('name', { ascending: true });

  if (custErr) return NextResponse.json({ error: custErr.message }, { status: 500 });

  // Fetch all bookings with quote totals for stats
  const { data: bookings, error: bkErr } = await supabase
    .from('bookings')
    .select(`
      id, customer_id, pickup_date, status,
      quotes ( total_aud, version )
    `);

  if (bkErr) return NextResponse.json({ error: bkErr.message }, { status: 500 });

  // Aggregate per customer
  const statsMap: Record<string, { count: number; totalSpend: number; lastDate: string | null }> = {};
  for (const bk of bookings || []) {
    const cid = bk.customer_id;
    if (!cid) continue;
    if (!statsMap[cid]) statsMap[cid] = { count: 0, totalSpend: 0, lastDate: null };
    statsMap[cid].count++;
    const quotes = (bk.quotes as any[]) || [];
    const q = quotes.sort((a: any, b: any) => b.version - a.version)[0];
    if (q?.total_aud) statsMap[cid].totalSpend += parseFloat(q.total_aud);
    if (!statsMap[cid].lastDate || bk.pickup_date > statsMap[cid].lastDate!) {
      statsMap[cid].lastDate = bk.pickup_date;
    }
  }

  const result = (customers || []).map(c => ({
    id:         c.id,
    name:       c.name,
    email:      c.email,
    phone:      c.phone,
    createdAt:  c.created_at,
    bookings:   statsMap[c.id]?.count      || 0,
    totalSpend: statsMap[c.id]?.totalSpend || 0,
    lastDate:   statsMap[c.id]?.lastDate   || null,
  }));

  return NextResponse.json(result);
}

// DELETE /api/admin/customers  { id }
export async function DELETE(req: NextRequest) {
  if (!await requireAdmin(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await req.json();
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  // ON DELETE CASCADE handles bookings → bikes/quotes/comms_log/calendar_blocks
  const { error } = await supabase.from('customers').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ success: true });
}

// PATCH /api/admin/customers  { id, name, email, phone }
export async function PATCH(req: NextRequest) {
  if (!await requireAdmin(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id, name, email, phone } = await req.json();
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const updates: Record<string, string> = {};
  if (name  !== undefined) updates.name  = name;
  if (email !== undefined) updates.email = email;
  if (phone !== undefined) updates.phone = phone;

  const { data, error } = await supabase
    .from('customers')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
