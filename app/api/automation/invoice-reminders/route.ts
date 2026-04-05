// app/api/automation/invoice-reminders/route.ts
// ============================================================
// AUTO INVOICE REMINDERS
// Runs daily via Vercel Cron
// Sends reminder at 7 days overdue, then again at 14 days
// Stops if invoice is marked paid
// ============================================================
export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse }            from 'next/server';
import { validateCronSecret }                   from '@/automation/triggers';
import { createClient }                         from '@supabase/supabase-js';
import { Resend }                               from 'resend';
import { buildReminderEmail, makeInvoiceNumber } from '@/lib/invoice-email';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const FROM_EMAIL  = 'Caspers Transport <bookings@casperstransport.com.au>';
const ADMIN_EMAIL = 'admin@casperstransport.com.au';

export async function POST(req: NextRequest) {
  if (!validateCronSecret(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Get all completed, unpaid bookings that have had an invoice sent
  const { data: bookings, error } = await supabase
    .from('bookings')
    .select(`
      id, pickup_date, deposit_paid, invoice_paid,
      customers ( name, email, phone ),
      quotes ( total_aud, version )
    `)
    .eq('status', 'completed')
    .eq('invoice_paid', false);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!bookings?.length) return NextResponse.json({ sent: 0, message: 'No unpaid invoices' });

  // Load bank details once
  const { data: rc } = await supabase.from('rate_card').select('abn, bank_name, bank_bsb, bank_account').limit(1).single();
  const bizDetails = {
    abn: rc?.abn || null, bankName: rc?.bank_name || null,
    bankBsb: rc?.bank_bsb || null, bankAccount: rc?.bank_account || null,
  };

  const resend  = new Resend(process.env.RESEND_API_KEY!);
  const results = [];
  const now     = Date.now();

  for (const booking of bookings) {
    // Get comms history for this booking
    const { data: comms } = await supabase
      .from('comms_log')
      .select('comms_type, sent_at')
      .eq('booking_id', booking.id)
      .in('comms_type', ['invoice_email', 'invoice_reminder'])
      .eq('status', 'sent')
      .order('sent_at', { ascending: true });

    const invoiceSent = comms?.find(c => c.comms_type === 'invoice_email');
    if (!invoiceSent) continue; // no invoice sent yet — skip

    const reminders   = comms?.filter(c => c.comms_type === 'invoice_reminder') || [];
    const daysOverdue = Math.floor((now - new Date(invoiceSent.sent_at).getTime()) / 86_400_000);

    // First reminder: 7 days — only if no reminders sent yet
    // Second reminder: 14 days — only if exactly 1 reminder sent
    // After 2 reminders, stop auto-sending
    const shouldSend =
      (daysOverdue >= 7  && daysOverdue < 14 && reminders.length === 0) ||
      (daysOverdue >= 14 && reminders.length === 1);

    if (!shouldSend) continue;

    const customer = (booking as any).customers;
    const quotes   = (booking as any).quotes as any[];
    const quote    = quotes?.sort((a: any, b: any) => b.version - a.version)[0];
    const total    = parseFloat(quote?.total_aud || 0);
    const deposit  = (booking as any).deposit_paid ? total * 0.2 : 0;
    const balance  = (total - deposit).toFixed(2);

    const invoiceNum  = makeInvoiceNumber(booking.id);
    const invoiceDate = new Date(invoiceSent.sent_at).toLocaleDateString('en-AU', {
      day: 'numeric', month: 'long', year: 'numeric',
    });

    try {
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
        booking_id: booking.id,
        comms_type: 'invoice_reminder',
        status:     'sent',
        recipient:  customer.email,
        subject:    `Payment reminder — ${invoiceNum} — Caspers Transport`,
        sent_at:    new Date().toISOString(),
      });

      results.push({ id: booking.id, customer: customer.name, daysOverdue, reminder: reminders.length + 1 });
    } catch (err: any) {
      console.error(`Reminder failed for booking ${booking.id}:`, err);
      results.push({ id: booking.id, status: 'failed', error: err.message });
    }
  }

  return NextResponse.json({ sent: results.filter(r => !r.status).length, results });
}

// Vercel cron sends GET
export { POST as GET };
