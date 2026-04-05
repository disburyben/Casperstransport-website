// app/api/automation/invoices/route.ts
// ============================================================
// POST-JOB INVOICE
// Fires every 15 minutes via Vercel Cron
// Finds bookings just marked 'completed' that don't have an invoice sent yet
// Generates a clean invoice email and sends to customer
// Also schedules the review request (3-day delay handled by review-requests trigger)
// ============================================================

export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from 'next/server';
import {
  supabase, resend, validateCronSecret,
  BOOKING_QUERY, FROM_EMAIL, ADMIN_EMAIL, getSentBookingIds
} from '@/automation/triggers';
import { buildInvoiceEmail, makeInvoiceNumber } from '@/lib/invoice-email';

export async function POST(req: NextRequest) {
  if (!validateCronSecret(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Find completed bookings that haven't had an invoice sent
  const sentIds = await getSentBookingIds('invoice_email');
  let query = supabase.from('bookings').select(BOOKING_QUERY).eq('status', 'completed');
  if (sentIds.length > 0) query = query.not('id', 'in', `(${sentIds.join(',')})`);
  const { data: bookings, error } = await query;

  if (error) {
    console.error('Invoice query failed:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!bookings || bookings.length === 0) {
    return NextResponse.json({ sent: 0, message: 'No invoices pending' });
  }

  // Load business details from rate_card (admin can edit these in settings)
  const { data: rc } = await supabase.from('rate_card').select('abn, bank_name, bank_bsb, bank_account').limit(1).single();
  const bizDetails = {
    abn:        rc?.abn        || null,
    bankName:   rc?.bank_name  || null,
    bankBsb:    rc?.bank_bsb   || null,
    bankAccount:rc?.bank_account || null,
  };

  const results = [];

  for (const booking of bookings) {
    try {
      const customer = booking.customers as any;
      const bikes    = booking.bikes    as any[];
      const quotes   = booking.quotes   as any[];
      const quote    = quotes?.sort((a: any, b: any) => b.version - a.version)[0]; // latest version

      if (!quote) {
        console.warn(`No quote found for booking ${booking.id} — skipping invoice`);
        continue;
      }

      const invoiceNum = makeInvoiceNumber(booking.id);
      const invoiceDate = new Date().toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' });

      await resend.emails.send({
        from:    FROM_EMAIL,
        to:      [customer.email],
        cc:      [ADMIN_EMAIL],
        subject: `Invoice ${invoiceNum} — Caspers Transport`,
        html:    buildInvoiceEmail({ booking, customer, bikes, quote, invoiceNum, invoiceDate, bizDetails }),
      });

      // Update customer lifetime stats
      await supabase.rpc('update_customer_stats', {
        p_customer_id: customer.id,
        p_amount:      quote.total_aud,
      });

      // Log invoice sent
      await supabase.from('comms_log').insert({
        booking_id: booking.id,
        comms_type: 'invoice_email',
        status:     'sent',
        recipient:  customer.email,
        subject:    `Invoice ${invoiceNum} — Caspers Transport`,
        sent_at:    new Date().toISOString(),
      });

      results.push({ id: booking.id, customer: customer.name, invoice: invoiceNum, status: 'sent' });

    } catch (err: any) {
      console.error(`Invoice failed for booking ${booking.id}:`, err);

      await supabase.from('comms_log').insert({
        booking_id: booking.id,
        comms_type: 'invoice_email',
        status:     'failed',
        recipient:  (booking.customers as any)?.email || '',
        sent_at:    new Date().toISOString(),
      });

      results.push({ id: booking.id, status: 'failed', error: err.message });
    }
  }

  return NextResponse.json({
    sent: results.filter(r => r.status === 'sent').length,
    results,
  });
}


// Vercel cron sends GET — alias to POST handler
export { POST as GET };
