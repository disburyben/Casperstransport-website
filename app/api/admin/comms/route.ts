// GET /api/admin/comms
// Returns full comms_log with customer info, optionally filtered by type
// ?type=quote_email|invoice_email|invoice_reminder|booking_reminder|review_request
// ?search=customer name
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
  const typeFilter   = searchParams.get('type');
  const searchFilter = searchParams.get('search')?.toLowerCase();

  let query = supabase
    .from('comms_log')
    .select(`
      id, booking_id, comms_type, status, recipient, subject, sent_at,
      bookings (
        pickup_date,
        customers ( name )
      )
    `)
    .order('sent_at', { ascending: false })
    .limit(300);

  if (typeFilter && typeFilter !== 'all') {
    query = query.eq('comms_type', typeFilter);
  }

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  let result = (data || []).map(row => {
    const bk  = (row.bookings as any) || {};
    const cust = bk.customers || {};
    return {
      id:         row.id,
      bookingId:  row.booking_id,
      type:       row.comms_type,
      status:     row.status,
      recipient:  row.recipient,
      subject:    row.subject,
      sentAt:     row.sent_at,
      customer:   cust.name || row.recipient,
      pickupDate: bk.pickup_date || null,
    };
  });

  if (searchFilter) {
    result = result.filter(r =>
      r.customer.toLowerCase().includes(searchFilter) ||
      r.recipient.toLowerCase().includes(searchFilter)
    );
  }

  return NextResponse.json(result);
}
