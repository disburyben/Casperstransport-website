// POST /api/admin/quotes/resend  { bookingId }
// Resends the original quote email to the customer
export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from 'next/server';
import { createServerClient }        from '@supabase/ssr';
import { createClient }              from '@supabase/supabase-js';
import { Resend }                    from 'resend';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const APP_URL     = process.env.NEXT_PUBLIC_APP_URL!;
const FROM_EMAIL  = 'Caspers Transport <bookings@casperstransport.com.au>';
const ADMIN_EMAIL = 'admin@casperstransport.com.au';

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

export async function POST(req: NextRequest) {
  if (!await requireAdmin(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { bookingId } = await req.json();
  if (!bookingId) return NextResponse.json({ error: 'bookingId required' }, { status: 400 });

  const { data: booking, error } = await supabase
    .from('bookings')
    .select(`
      id, pickup_date, pickup_address, dropoff_address, payment_method, deposit_paid,
      customers ( name, email ),
      bikes ( make, model, year, bike_type, condition ),
      quotes ( base_rate, km_loaded, km_return, km_rate_loaded, km_rate_return,
               condition_surcharge, multi_bike_discount, fuel_levy_amount, fuel_levy_pct,
               total_aud, version )
    `)
    .eq('id', bookingId)
    .single();

  if (error || !booking) return NextResponse.json({ error: 'Booking not found' }, { status: 404 });

  const customer = (booking as any).customers;
  const bikes    = (booking as any).bikes    as any[];
  const quotes   = (booking as any).quotes   as any[];
  const quote    = quotes?.sort((a: any, b: any) => b.version - a.version)[0];

  if (!quote) return NextResponse.json({ error: 'No quote found for this booking' }, { status: 400 });

  const bikesSummary = bikes.map((b: any) =>
    `${b.make || ''} ${b.model || ''} ${b.year || ''}`.trim() ||
    `${(b.bike_type || '').replace(/_/g, ' ')} (${(b.condition || '').replace(/_/g, ' ')})`
  ).join(', ');

  const base     = parseFloat(quote.base_rate || 0);
  const kmLoaded = parseFloat(quote.km_loaded || 0) * parseFloat(quote.km_rate_loaded || 0);
  const kmReturn = parseFloat(quote.km_return || 0) * parseFloat(quote.km_rate_return || 0);
  const condS    = parseFloat(quote.condition_surcharge || 0);
  const disc     = parseFloat(quote.multi_bike_discount || 0);
  const fuel     = parseFloat(quote.fuel_levy_amount || 0);
  const total    = parseFloat(quote.total_aud) > 0
    ? parseFloat(quote.total_aud)
    : base + kmLoaded + kmReturn + condS - disc + fuel;
  const deposit  = (booking as any).deposit_paid ? total * 0.2 : null;

  const quoteTotal = `A$${total.toFixed(2)}`;
  const depositAmt = deposit ? `A$${deposit.toFixed(2)}` : null;
  const acceptUrl  = `${APP_URL}/booking/accept?id=${bookingId}`;
  const payment    = (booking as any).payment_method || 'follow_up';
  const dateFormatted = new Date(booking.pickup_date + 'T12:00:00').toLocaleDateString('en-AU', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });

  const breakdownRows = `
    <tr><td style="padding:6px 0;color:#666;">Base call-out</td><td style="text-align:right;">A$${base.toFixed(2)}</td></tr>
    <tr><td style="padding:6px 0;color:#666;">Transport (loaded)</td><td style="text-align:right;">A$${kmLoaded.toFixed(2)}</td></tr>
    <tr><td style="padding:6px 0;color:#666;">Return run</td><td style="text-align:right;">A$${kmReturn.toFixed(2)}</td></tr>
    ${condS > 0 ? `<tr><td style="padding:6px 0;color:#666;">Condition surcharge</td><td style="text-align:right;">A$${condS.toFixed(2)}</td></tr>` : ''}
    ${disc  > 0 ? `<tr><td style="padding:6px 0;color:#666;">Multi-bike discount</td><td style="text-align:right;">-A$${disc.toFixed(2)}</td></tr>` : ''}
    <tr style="border-top:1px solid #eee;font-weight:600;"><td style="padding:10px 0 0;">Total (inc. GST)</td><td style="text-align:right;padding-top:10px;">${quoteTotal}</td></tr>
  `;

  const ctaButton = payment === 'stripe_deposit' && depositAmt
    ? `<a href="${acceptUrl}&method=stripe" style="display:inline-block;background:#4FC1DB;color:white;padding:14px 32px;border-radius:6px;font-weight:700;font-size:16px;text-decoration:none;">Pay Deposit ${depositAmt} →</a>`
    : `<a href="${acceptUrl}" style="display:inline-block;background:#4FC1DB;color:white;padding:14px 32px;border-radius:6px;font-weight:700;font-size:16px;text-decoration:none;">Confirm Booking →</a>`;

  const html = `
    <div style="font-family:'Helvetica Neue',Arial,sans-serif;max-width:600px;margin:0 auto;background:#fff;">
      <div style="background:#0D0D0D;padding:24px 32px;">
        <span style="font-size:20px;font-weight:700;color:white;letter-spacing:0.05em;text-transform:uppercase;">
          CASPERS <span style="color:#4FC1DB;">TRANSPORT</span>
        </span>
      </div>
      <div style="padding:32px;">
        <p style="font-size:18px;font-weight:600;margin:0 0 8px;">Hi ${customer.name},</p>
        <p style="color:#666;margin:0 0 24px;">Here is a copy of your transport quote.</p>
        <div style="background:#F5F5F4;border-radius:6px;padding:20px;margin-bottom:24px;">
          <p style="margin:0 0 6px;font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:0.08em;color:#898880;">Bike(s)</p>
          <p style="margin:0 0 16px;font-weight:500;">${bikesSummary}</p>
          <p style="margin:0 0 6px;font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:0.08em;color:#898880;">Pickup</p>
          <p style="margin:0 0 4px;">${booking.pickup_address}</p>
          <p style="margin:0 0 16px;font-size:13px;color:#666;">→ ${booking.dropoff_address}</p>
          <p style="margin:0 0 6px;font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:0.08em;color:#898880;">Date</p>
          <p style="margin:0;">${dateFormatted}</p>
        </div>
        <table style="width:100%;border-collapse:collapse;font-size:15px;margin-bottom:24px;">${breakdownRows}</table>
        <div style="text-align:center;margin:32px 0;">${ctaButton}</div>
        <hr style="border:none;border-top:1px solid #E8E7E5;margin:32px 0;">
        <p style="font-size:13px;color:#898880;margin:0;">Questions? Call or text us at <a href="tel:0434271510" style="color:#4FC1DB;">0434 271 510</a> or reply to this email.</p>
      </div>
    </div>
  `;

  const resend = new Resend(process.env.RESEND_API_KEY!);
  await resend.emails.send({
    from:    FROM_EMAIL,
    to:      [customer.email],
    cc:      [ADMIN_EMAIL],
    subject: `Your transport quote — ${quoteTotal}`,
    html,
  });

  await supabase.from('comms_log').insert({
    booking_id: bookingId,
    comms_type: 'quote_email',
    status:     'sent',
    recipient:  customer.email,
    subject:    `Your transport quote — ${quoteTotal}`,
    sent_at:    new Date().toISOString(),
  });

  return NextResponse.json({ success: true });
}
