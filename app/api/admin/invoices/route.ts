// GET /api/admin/invoices
// Returns all completed bookings with invoice + payment status
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

  // Fetch all completed bookings with customer + quote
  const { data: bookings, error } = await supabase
    .from('bookings')
    .select(`
      id, pickup_date, pickup_address, dropoff_address,
      deposit_paid, invoice_paid, invoice_paid_at, created_at,
      customers ( id, name, email, phone ),
      quotes ( total_aud, version ),
      bikes ( make, model, year, bike_type )
    `)
    .eq('status', 'completed')
    .order('pickup_date', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Fetch comms_log for invoice_email and invoice_reminder per booking
  const bookingIds = (bookings || []).map((b: any) => b.id);
  let commsMap: Record<string, { invoiceSentAt: string | null; lastReminderAt: string | null; reminderCount: number }> = {};

  if (bookingIds.length > 0) {
    const { data: comms } = await supabase
      .from('comms_log')
      .select('booking_id, comms_type, sent_at, status')
      .in('booking_id', bookingIds)
      .in('comms_type', ['invoice_email', 'invoice_reminder'])
      .eq('status', 'sent')
      .order('sent_at', { ascending: true });

    for (const c of comms || []) {
      if (!commsMap[c.booking_id]) commsMap[c.booking_id] = { invoiceSentAt: null, lastReminderAt: null, reminderCount: 0 };
      if (c.comms_type === 'invoice_email' && !commsMap[c.booking_id].invoiceSentAt) {
        commsMap[c.booking_id].invoiceSentAt = c.sent_at;
      }
      if (c.comms_type === 'invoice_reminder') {
        commsMap[c.booking_id].lastReminderAt = c.sent_at;
        commsMap[c.booking_id].reminderCount++;
      }
    }
  }

  const now = Date.now();
  const invoices = (bookings || []).map((b: any) => {
    const quote     = (b.quotes || []).sort((a: any, z: any) => z.version - a.version)[0];
    const total     = parseFloat(quote?.total_aud || 0);
    const deposit   = b.deposit_paid ? total * 0.2 : 0;
    const balance   = total - deposit;
    const comms     = commsMap[b.id] || { invoiceSentAt: null, lastReminderAt: null, reminderCount: 0 };
    const bike      = b.bikes?.[0];
    const bikeName  = bike
      ? `${bike.make || ''} ${bike.model || ''} ${bike.year || ''}`.trim() || (bike.bike_type || '').replace(/_/g, ' ')
      : '—';

    let daysOverdue = 0;
    let payStatus   = 'not_sent';  // not_sent | outstanding | overdue | paid
    if (b.invoice_paid) {
      payStatus = 'paid';
    } else if (comms.invoiceSentAt) {
      daysOverdue = Math.floor((now - new Date(comms.invoiceSentAt).getTime()) / 86_400_000);
      payStatus   = daysOverdue >= 7 ? 'overdue' : 'outstanding';
    }

    const ym         = new Date(b.pickup_date).toISOString().slice(0, 7).replace('-', '');
    const invoiceNum = `INV-${ym}-${b.id.slice(-4).toUpperCase()}`;

    return {
      id:             b.id,
      invoiceNum,
      customer:       b.customers,
      pickupDate:     b.pickup_date,
      bikeName:       `${bikeName}${b.bikes?.length > 1 ? ` +${b.bikes.length - 1}` : ''}`,
      total:          total.toFixed(2),
      balance:        balance.toFixed(2),
      payStatus,
      daysOverdue,
      invoiceSentAt:  comms.invoiceSentAt,
      lastReminderAt: comms.lastReminderAt,
      reminderCount:  comms.reminderCount,
      invoicePaidAt:  b.invoice_paid_at,
    };
  });

  return NextResponse.json({ invoices });
}
