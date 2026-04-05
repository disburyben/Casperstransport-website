// PATCH /api/admin/customers/[id]  { name, email, phone }  — update customer details
// DELETE /api/admin/customers/[id]  — delete customer + all their bookings + child records
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

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  if (!await requireAdmin(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { name, email, phone } = await req.json();
  const updates: Record<string, string> = {};
  if (name  !== undefined) updates.name  = name;
  if (email !== undefined) updates.email = email;
  if (phone !== undefined) updates.phone = phone;

  const { data, error } = await supabase
    .from('customers')
    .update(updates)
    .eq('id', params.id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  if (!await requireAdmin(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Get all booking IDs for this customer
  const { data: bookings } = await supabase
    .from('bookings')
    .select('id')
    .eq('customer_id', params.id);

  const bookingIds = (bookings || []).map(b => b.id);

  // Delete all child records for each booking
  for (const bkId of bookingIds) {
    await supabase.from('comms_log').delete().eq('booking_id', bkId);
    await supabase.from('quotes').delete().eq('booking_id', bkId);
    await supabase.from('bikes').delete().eq('booking_id', bkId);
  }

  if (bookingIds.length > 0) {
    await supabase.from('bookings').delete().in('id', bookingIds);
  }

  const { error } = await supabase.from('customers').delete().eq('id', params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ success: true });
}
