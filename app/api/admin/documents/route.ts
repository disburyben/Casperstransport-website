// GET /api/admin/documents
// Returns bookings with signature status (and optionally signature data)
// ?includeData=true  — includes full base64 sig data (expensive, only when viewing)
// ?id=bookingId      — single booking signatures (for modal view)
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

  const { searchParams } = new URL(req.url);
  const bookingId   = searchParams.get('id');
  const includeData = searchParams.get('includeData') === 'true';

  // Single booking — return full sig data for modal
  if (bookingId) {
    const { data, error } = await supabase
      .from('bookings')
      .select(`
        id, pickup_date, pickup_address, dropoff_address,
        sig_pickup, sig_pickup_at, sig_dropoff, sig_dropoff_at,
        customers ( name )
      `)
      .eq('id', bookingId)
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(data);
  }

  // List — exclude heavy sig data unless asked
  const selectFields = includeData
    ? 'id, pickup_date, pickup_address, dropoff_address, status, sig_pickup, sig_pickup_at, sig_dropoff, sig_dropoff_at, customers ( name )'
    : 'id, pickup_date, pickup_address, dropoff_address, status, sig_pickup_at, sig_dropoff_at, customers ( name )';

  const { data, error } = await supabase
    .from('bookings')
    .select(selectFields)
    .order('pickup_date', { ascending: false })
    .limit(200);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json((data || []).map((row: any) => ({
    id:           row.id,
    pickupDate:   row.pickup_date,
    pickup:       row.pickup_address,
    dropoff:      row.dropoff_address,
    status:       row.status,
    customer:     row.customers?.name || '—',
    hasPickupSig: !!row.sig_pickup_at,
    hasDropoffSig:!!row.sig_dropoff_at,
    pickupSigAt:  row.sig_pickup_at  || null,
    dropoffSigAt: row.sig_dropoff_at || null,
  })));
}
