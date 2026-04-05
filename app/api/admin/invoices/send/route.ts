// POST /api/admin/invoices/send  { bookingId }
// Manually send (or resend) the invoice for a completed booking
export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse }         from 'next/server';
import { createServerClient }                from '@supabase/ssr';
import { createClient }                      from '@supabase/supabase-js';
import { Resend }                            from 'resend';
import { buildInvoiceEmail, makeInvoiceNumber } from '@/lib/invoice-email';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

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

  const { data: booking, error: bErr } = await supabase
    .from('bookings')
    .select(`
      id, pickup_date, pickup_address, dropoff_address, distance_km, deposit_paid,
      customers ( id, name, email, phone ),
      bikes ( make, model, year, bike_type, condition ),
      quotes ( base_rate, km_loaded, km_return, km_rate_loaded, km_rate_return,
               condition_surcharge, multi_bike_discount, fuel_levy_amount, total_aud, version )
    `)
    .eq('id', bookingId)
    .single();

  if (bErr || !booking) return NextResponse.json({ error: 'Booking not found' }, { status: 404 });

  const customer = booking.customers as any;
  const bikes    = booking.bikes    as any[];
  const quotes   = booking.quotes   as any[];
  const quote    = quotes?.sort((a: any, b: any) => b.version - a.version)[0];

  if (!quote) return NextResponse.json({ error: 'No quote found for this booking' }, { status: 400 });

  const { data: rc } = await supabase.from('rate_card').select('abn, bank_name, bank_bsb, bank_account').limit(1).single();
  const bizDetails = {
    abn: rc?.abn || null, bankName: rc?.bank_name || null,
    bankBsb: rc?.bank_bsb || null, bankAccount: rc?.bank_account || null,
  };

  const invoiceNum  = makeInvoiceNumber(booking.id);
  const invoiceDate = new Date().toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' });

  const resend = new Resend(process.env.RESEND_API_KEY!);
  await resend.emails.send({
    from:    FROM_EMAIL,
    to:      [customer.email],
    cc:      [ADMIN_EMAIL],
    subject: `Invoice ${invoiceNum} — Caspers Transport`,
    html:    buildInvoiceEmail({ booking, customer, bikes, quote, invoiceNum, invoiceDate, bizDetails }),
  });

  await supabase.from('comms_log').insert({
    booking_id: bookingId,
    comms_type: 'invoice_email',
    status:     'sent',
    recipient:  customer.email,
    subject:    `Invoice ${invoiceNum} — Caspers Transport`,
    sent_at:    new Date().toISOString(),
  });

  return NextResponse.json({ success: true, invoiceNum });
}
