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
  BOOKING_QUERY, FROM_EMAIL, ADMIN_EMAIL
} from '@/automation/triggers';

export async function POST(req: NextRequest) {
  if (!validateCronSecret(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Find completed bookings that haven't had an invoice sent
  const { data: bookings, error } = await supabase
    .from('bookings')
    .select(BOOKING_QUERY)
    .eq('status', 'completed')
    .not('id', 'in', `(
      select booking_id from comms_log
      where comms_type = 'invoice_email'
      and status = 'sent'
    )`);

  if (error) {
    console.error('Invoice query failed:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!bookings || bookings.length === 0) {
    return NextResponse.json({ sent: 0, message: 'No invoices pending' });
  }

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

      // Generate invoice number: INV-YYYYMM-XXXX (from booking id suffix)
      const invoiceNum = `INV-${new Date().toISOString().slice(0, 7).replace('-', '')}-${booking.id.slice(-4).toUpperCase()}`;
      const invoiceDate = new Date().toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' });

      await resend.emails.send({
        from:    FROM_EMAIL,
        to:      [customer.email],
        cc:      [ADMIN_EMAIL],
        subject: `Invoice ${invoiceNum} — Caspers Transport`,
        html:    buildInvoiceEmail({ booking, customer, bikes, quote, invoiceNum, invoiceDate }),
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

// ============================================================
// INVOICE EMAIL TEMPLATE
// ============================================================
function buildInvoiceEmail({ booking, customer, bikes, quote, invoiceNum, invoiceDate }: any) {
  const bikeRows = bikes.map((b: any, i: number) => {
    const name = `${b.make || ''} ${b.model || ''} ${b.year || ''}`.trim() ||
      `${(b.bike_type || '').replace(/_/g, ' ')} (Bike ${i + 1})`;
    return `<tr>
      <td style="padding:8px 0;border-bottom:1px solid #EEEEEC;">${name}</td>
      <td style="padding:8px 0;border-bottom:1px solid #EEEEEC;color:#666;">${(b.condition || '').replace(/_/g, ' ')}</td>
    </tr>`;
  }).join('');

  const pickupDateFormatted = new Date(booking.pickup_date + 'T12:00:00').toLocaleDateString('en-AU', {
    day: 'numeric', month: 'long', year: 'numeric'
  });

  const base   = parseFloat(quote.base_rate      || 120).toFixed(2);
  const kmCost = parseFloat(quote.km_loaded       || 0).toFixed(2);
  const condS  = parseFloat(quote.condition_surcharge || 0).toFixed(2);
  const disc   = parseFloat(quote.multi_bike_discount || 0).toFixed(2);
  const fuel   = parseFloat(quote.fuel_levy_amount    || 0).toFixed(2);
  const total  = parseFloat(quote.total_aud).toFixed(2);
  const deposit = booking.deposit_paid
    ? (parseFloat(total) * (parseFloat(quote.stripe_deposit_pct || 20) / 100)).toFixed(2)
    : '0.00';
  const balance = (parseFloat(total) - parseFloat(deposit)).toFixed(2);

  return `
    <div style="font-family:'Helvetica Neue',Arial,sans-serif;max-width:640px;margin:0 auto;background:#fff;">

      <!-- Header -->
      <div style="background:#0D0D0D;padding:24px 32px;display:flex;justify-content:space-between;align-items:center;">
        <span style="font-size:20px;font-weight:700;color:white;letter-spacing:0.05em;text-transform:uppercase;">
          CASPERS <span style="color:#4FC1DB;">TRANSPORT</span>
        </span>
        <span style="font-size:13px;color:#5C5C58;font-weight:600;text-transform:uppercase;letter-spacing:0.06em;">Tax Invoice</span>
      </div>

      <div style="padding:32px;">

        <!-- Invoice meta -->
        <div style="display:flex;justify-content:space-between;margin-bottom:28px;flex-wrap:wrap;gap:12px;">
          <div>
            <p style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#898880;margin:0 0 4px;">Invoice number</p>
            <p style="font-size:18px;font-weight:700;color:#0D0D0D;margin:0;">${invoiceNum}</p>
          </div>
          <div style="text-align:right;">
            <p style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#898880;margin:0 0 4px;">Invoice date</p>
            <p style="font-size:14px;font-weight:600;color:#0D0D0D;margin:0;">${invoiceDate}</p>
          </div>
        </div>

        <!-- Bill to -->
        <div style="margin-bottom:24px;">
          <p style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#898880;margin:0 0 6px;">Bill to</p>
          <p style="font-size:15px;font-weight:600;margin:0 0 2px;">${customer.name}</p>
          <p style="font-size:13px;color:#666;margin:0;">${customer.email}</p>
          <p style="font-size:13px;color:#666;margin:0;">${customer.phone}</p>
        </div>

        <!-- Job summary -->
        <div style="background:#F5F5F4;border-radius:6px;padding:18px;margin-bottom:24px;">
          <p style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#898880;margin:0 0 10px;">Job summary</p>
          <table style="width:100%;border-collapse:collapse;font-size:13px;">
            <tr>
              <td style="padding:5px 0;color:#666;width:130px;">Service date</td>
              <td style="font-weight:500;">${pickupDateFormatted}</td>
            </tr>
            <tr>
              <td style="padding:5px 0;color:#666;">Collected from</td>
              <td>${booking.pickup_address}</td>
            </tr>
            <tr>
              <td style="padding:5px 0;color:#666;">Delivered to</td>
              <td>${booking.dropoff_address}</td>
            </tr>
            <tr>
              <td style="padding:5px 0;color:#666;">Distance</td>
              <td>${booking.distance_km ? `${booking.distance_km} km loaded` : '—'}</td>
            </tr>
          </table>

          <div style="margin-top:14px;border-top:1px solid #E8E7E5;padding-top:12px;">
            <p style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#898880;margin:0 0 8px;">Bike(s) transported</p>
            <table style="width:100%;border-collapse:collapse;font-size:13px;">
              ${bikeRows}
            </table>
          </div>
        </div>

        <!-- Line items -->
        <table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:20px;">
          <thead>
            <tr style="border-bottom:2px solid #0D0D0D;">
              <th style="text-align:left;padding:8px 0;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#898880;">Description</th>
              <th style="text-align:right;padding:8px 0;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#898880;">Amount</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style="padding:10px 0;border-bottom:1px solid #EEEEEC;">Base call-out fee</td>
              <td style="text-align:right;padding:10px 0;border-bottom:1px solid #EEEEEC;">A$${base}</td>
            </tr>
            <tr>
              <td style="padding:10px 0;border-bottom:1px solid #EEEEEC;">
                Transport — loaded run
                ${booking.distance_km ? `<span style="font-size:12px;color:#898880;"> (${booking.distance_km} km)</span>` : ''}
              </td>
              <td style="text-align:right;padding:10px 0;border-bottom:1px solid #EEEEEC;">A$${kmCost}</td>
            </tr>
            ${parseFloat(condS) > 0 ? `<tr>
              <td style="padding:10px 0;border-bottom:1px solid #EEEEEC;">Condition surcharge</td>
              <td style="text-align:right;padding:10px 0;border-bottom:1px solid #EEEEEC;">A$${condS}</td>
            </tr>` : ''}
            ${parseFloat(disc) > 0 ? `<tr>
              <td style="padding:10px 0;border-bottom:1px solid #EEEEEC;">Multi-bike discount</td>
              <td style="text-align:right;padding:10px 0;border-bottom:1px solid #EEEEEC;color:#1A7A4A;">−A$${disc}</td>
            </tr>` : ''}
            ${parseFloat(fuel) > 0 ? `<tr>
              <td style="padding:10px 0;border-bottom:1px solid #EEEEEC;">Fuel levy</td>
              <td style="text-align:right;padding:10px 0;border-bottom:1px solid #EEEEEC;">A$${fuel}</td>
            </tr>` : ''}
          </tbody>
          <tfoot>
            <tr>
              <td style="padding:12px 0 4px;font-weight:700;font-size:16px;">Total (inc. GST)</td>
              <td style="text-align:right;padding:12px 0 4px;font-weight:700;font-size:20px;color:#4FC1DB;">A$${total}</td>
            </tr>
            ${parseFloat(deposit) > 0 ? `
            <tr>
              <td style="padding:4px 0;color:#666;font-size:13px;">Deposit paid</td>
              <td style="text-align:right;padding:4px 0;color:#1A7A4A;font-size:13px;">−A$${deposit}</td>
            </tr>
            <tr>
              <td style="padding:4px 0;font-weight:700;">Balance due</td>
              <td style="text-align:right;padding:4px 0;font-weight:700;font-size:16px;">A$${balance}</td>
            </tr>` : ''}
          </tfoot>
        </table>

        ${parseFloat(balance) > 0 ? `
        <div style="background:#EAF8FC;border-radius:6px;padding:14px 18px;margin-bottom:20px;font-size:14px;color:#337D8E;">
          <strong>Balance of A$${balance} is due on receipt.</strong>
          Please EFT to the account details below or call us to arrange payment.
        </div>` : `
        <div style="background:#EAF5EE;border-radius:6px;padding:14px 18px;margin-bottom:20px;font-size:14px;color:#1A7A4A;">
          <strong>✓ Paid in full. Thank you!</strong>
        </div>`}

        <!-- Payment details (only shown if balance > 0) -->
        ${parseFloat(balance) > 0 ? `
        <div style="background:#F5F5F4;border-radius:6px;padding:16px 18px;margin-bottom:20px;">
          <p style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#898880;margin:0 0 10px;">Payment details</p>
          <table style="font-size:13px;border-collapse:collapse;">
            <tr><td style="padding:3px 0;color:#666;width:120px;">Bank</td><td style="font-weight:500;">YOUR BANK NAME</td></tr>
            <tr><td style="padding:3px 0;color:#666;">Account name</td><td style="font-weight:500;">Caspers Transport</td></tr>
            <tr><td style="padding:3px 0;color:#666;">BSB</td><td style="font-weight:500;">XXX-XXX</td></tr>
            <tr><td style="padding:3px 0;color:#666;">Account no.</td><td style="font-weight:500;">XXXXXXXXX</td></tr>
            <tr><td style="padding:3px 0;color:#666;">Reference</td><td style="font-weight:500;">${invoiceNum}</td></tr>
          </table>
        </div>` : ''}

        <!-- ABN / Business info -->
        <div style="border-top:1px solid #E8E7E5;padding-top:16px;font-size:12px;color:#898880;line-height:1.7;">
          <strong style="color:#0D0D0D;">Caspers Transport</strong><br>
          ABN: XX XXX XXX XXX<br>
          Roseworthy SA 5371<br>
          <a href="mailto:admin@casperstransport.com.au" style="color:#4FC1DB;">admin@casperstransport.com.au</a>
        </div>

      </div>
    </div>
  `;
}
