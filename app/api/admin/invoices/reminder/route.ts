// POST /api/admin/invoices/reminder  { bookingId }
// Manually send a payment reminder for an outstanding invoice
export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse }            from 'next/server';
import { createServerClient }                   from '@supabase/ssr';
import { createClient }                         from '@supabase/supabase-js';
import { Resend }                               from 'resend';
import { buildReminderEmail, makeInvoiceNumber } from '@/lib/invoice-email';

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
      id, pickup_date, deposit_paid, invoice_paid,
      customers ( name, email, phone ),
      quotes ( total_aud, version )
    `)
    .eq('id', bookingId)
    .single();

  if (bErr || !booking) return NextResponse.json({ error: 'Booking not found' }, { status: 404 });
  if ((booking as any).invoice_paid)  return NextResponse.json({ error: 'Invoice already marked as paid' }, { status: 400 });

  const customer = (booking as any).customers;
  const quotes   = (booking as any).quotes as any[];
  const quote    = quotes?.sort((a: any, b: any) => b.version - a.version)[0];

  const { data: rc } = await supabase.from('rate_card').select('abn, bank_name, bank_bsb, bank_account').limit(1).single();
  const bizDetails = {
    abn: rc?.abn || null, bankName: rc?.bank_name || null,
    bankBsb: rc?.bank_bsb || null, bankAccount: rc?.bank_account || null,
  };

  const invoiceNum  = makeInvoiceNumber(booking.id);
  const invoiceDate = new Date().toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' });

  const total   = parseFloat(quote?.total_aud || 0);
  const deposit = (booking as any).deposit_paid ? total * 0.2 : 0;
  const balance = (total - deposit).toFixed(2);

  // Determine how many days since invoice was sent (for urgency tone)
  const { data: invoiceLog } = await supabase
    .from('comms_log')
    .select('sent_at')
    .eq('booking_id', bookingId)
    .eq('comms_type', 'invoice_email')
    .eq('status', 'sent')
    .order('sent_at', { ascending: true })
    .limit(1)
    .single();

  const daysOverdue = invoiceLog?.sent_at
    ? Math.floor((Date.now() - new Date(invoiceLog.sent_at).getTime()) / 86_400_000)
    : 0;

  const resend = new Resend((process.env.RESEND_API_KEY || '').trim());
  await resend.emails.send({
    from:    FROM_EMAIL,
    to:      [customer.email],
    cc:      [ADMIN_EMAIL],
    subject: `Payment reminder — ${invoiceNum} — Caspers Transport`,
    html:    buildReminderEmail({
      customer,
      invoiceNum,
      invoiceDate,
      total:  total.toFixed(2),
      balance,
      bizDetails,
      daysOverdue,
    }),
  });

  await supabase.from('comms_log').insert({
    booking_id: bookingId,
    comms_type: 'invoice_reminder',
    status:     'sent',
    recipient:  customer.email,
    subject:    `Payment reminder — ${invoiceNum} — Caspers Transport`,
    sent_at:    new Date().toISOString(),
  });

  return NextResponse.json({ success: true, invoiceNum, daysOverdue });
}
