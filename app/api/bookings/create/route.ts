export const dynamic = 'force-dynamic';
// app/api/bookings/create/route.ts
// Handles the full booking creation flow

import { NextRequest, NextResponse } from 'next/server';
import { createClient }              from '@supabase/supabase-js';
import { getResend, getStripe }      from '@/lib/clients';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const APP_URL   = process.env.NEXT_PUBLIC_APP_URL!;
const ADMIN_EMAIL = 'admin@casperstransport.com.au';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      name, email, phone,
      pickup_address, pickup_lat, pickup_lng,
      dropoff_address, dropoff_lat, dropoff_lng,
      pickup_date, pickup_time,
      payment_method, notes,
      bikes, quote, needs_review, review_reason,
      _admin_created,
    } = body;

    // ---- 1. Upsert customer ----
    const { data: customerData, error: customerError } = await supabase
      .rpc('upsert_customer', { p_name: name, p_email: email, p_phone: phone });

    if (customerError) throw new Error(`Customer upsert failed: ${customerError.message}`);
    const customerId: string = customerData;

    // ---- 2. Create booking ----
    const { data: bookingData, error: bookingError } = await supabase
      .from('bookings')
      .insert({
        customer_id:     customerId,
        status:          'pending_quote',
        trip_type:       'same_day_return',
        pickup_date,
        pickup_time:     pickup_time || null,
        pickup_address,
        pickup_lat:      pickup_lat  || null,
        pickup_lng:      pickup_lng  || null,
        dropoff_address,
        dropoff_lat:     dropoff_lat  || null,
        dropoff_lng:     dropoff_lng  || null,
        distance_km:     quote?.kmLoaded  || null,
        return_km:       quote?.kmReturn  || null,
        payment_method:  payment_method,
        notes:           notes || null,
        internal_notes:  needs_review && review_reason ? `AUTO-FLAGGED: ${review_reason}` : null,
      })
      .select('id')
      .single();

    if (bookingError) throw new Error(`Booking insert failed: ${bookingError.message}`);
    const bookingId: string = bookingData.id;

    // ---- 3. Insert bikes ----
    if (bikes && bikes.length > 0) {
      const bikeRows = bikes.map((b: any) => ({
        booking_id: bookingId,
        bike_type:  b.type,
        condition:  b.condition,
        make:       b.make  || null,
        model:      b.model || null,
        year:       b.year  ? parseInt(b.year) : null,
      }));

      const { error: bikesError } = await supabase.from('bikes').insert(bikeRows);
      if (bikesError) throw new Error(`Bikes insert failed: ${bikesError.message}`);
    }

    // ---- 4. Create quote record ----
    let quoteId: string | null = null;
    if (quote) {
      const { data: rc } = await supabase.from('rate_card').select('*').limit(1).single();

      const { data: quoteData, error: quoteError } = await supabase
        .from('quotes')
        .insert({
          booking_id:          bookingId,
          version:             1,
          rate_card_snapshot:  rc || {},
          base_rate:           quote.base            || 0,
          km_loaded:           quote.kmLoaded        || 0,
          km_return:           quote.kmReturn        || 0,
          km_rate_loaded:      rc?.km_rate_loaded    || 0,
          km_rate_return:      rc?.km_rate_return    || 0,
          condition_surcharge: quote.condSurcharge   || 0,
          multi_bike_discount: quote.multiDiscount   || 0,
          overnight_total:     0,
          subtotal:            quote.subtotal        || 0,
          fuel_levy_pct:       quote.fuelLevyPct     || 0,
          fuel_levy_amount:    quote.fuelLevy        || 0,
          total_aud:           quote.total           || 0,
          generated_by:        'auto',
          sent_at:             new Date().toISOString(),
        })
        .select('id')
        .single();

      if (!quoteError) quoteId = quoteData?.id;

      if (!_admin_created) {
        await supabase.from('bookings')
          .update({ status: 'quote_sent' })
          .eq('id', bookingId);
      }
    }

    // ---- 5. Send quote email ----
    let stripeUrl: string | null = null;

    if (!_admin_created) {
      const resend = getResend();
      const bikesSummary = bikes.map((b: any) =>
        `${b.make || ''} ${b.model || ''} ${b.year || ''}`.trim() ||
        `${b.type.replace(/_/g, ' ')} (${b.condition.replace(/_/g, ' ')})`
      ).join(', ');

      const quoteTotal = quote?.total ? `A$${quote.total.toFixed(2)}` : 'to be confirmed';
      const depositAmt = quote?.deposit ? `A$${quote.deposit.toFixed(2)}` : null;

      const acceptUrl   = `${APP_URL}/booking/accept?id=${bookingId}`;
      const stripeParam = payment_method === 'stripe_deposit' ? '&method=stripe' : '';

      await resend.emails.send({
        from:    'Caspers Transport <bookings@casperstransport.com.au>',
        to:      [email],
        subject: `Your transport quote — ${quoteTotal}`,
        html:    buildQuoteEmail({
          name, bikesSummary, pickup_address, dropoff_address,
          pickup_date, quoteTotal, depositAmt,
          payment_method, acceptUrl: acceptUrl + stripeParam,
          quote,
        }),
      });

      // Send admin notification
      await resend.emails.send({
        from:    'Caspers Bookings <bookings@casperstransport.com.au>',
        to:      [ADMIN_EMAIL],
        subject: `New booking request — ${name}`,
        html:    buildAdminNotificationEmail({
          name, email, phone, bikesSummary,
          pickup_address, dropoff_address, pickup_date,
          quoteTotal, payment_method, bookingId, notes,
        }),
      });

      // Log comms
      await supabase.from('comms_log').insert([
        { booking_id: bookingId, comms_type: 'quote_email',       status: 'sent', recipient: email,       sent_at: new Date().toISOString() },
        { booking_id: bookingId, comms_type: 'admin_notification', status: 'sent', recipient: ADMIN_EMAIL, sent_at: new Date().toISOString() },
      ]);

      // ---- 6. Stripe checkout (non-fatal — falls back to follow-up if keys not set) ----
      if (payment_method === 'stripe_deposit' && quote?.deposit > 0) {
        try {
          const stripe = getStripe();
          const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            mode:                 'payment',
            line_items: [{
              price_data: {
                currency:     'aud',
                product_data: {
                  name:        `Caspers Transport — Deposit`,
                  description: `Transport deposit for ${bikesSummary}. Pickup: ${pickup_date}`,
                },
                unit_amount: Math.round(quote.deposit * 100),
              },
              quantity: 1,
            }],
            metadata: { booking_id: bookingId },
            success_url: `${APP_URL}/booking/payment-success?booking=${bookingId}`,
            cancel_url:  `${APP_URL}/booking/payment-cancelled?booking=${bookingId}`,
            customer_email: email,
          });

          stripeUrl = session.url;

          await supabase.from('bookings')
            .update({ stripe_payment_id: session.id })
            .eq('id', bookingId);
        } catch (stripeErr: any) {
          console.error('Stripe checkout failed (non-fatal):', stripeErr.message);
        }
      }
    }

    return NextResponse.json({ success: true, bookingId, stripeUrl });

  } catch (err: any) {
    console.error('booking/create error:', err);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

function buildQuoteEmail({ name, bikesSummary, pickup_address, dropoff_address,
  pickup_date, quoteTotal, depositAmt, payment_method, acceptUrl, quote }: any) {

  const dateFormatted = new Date(pickup_date).toLocaleDateString('en-AU', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
  });

  const breakdownRows = quote ? `
    <tr><td style="padding:6px 0;color:#666;">Base call-out</td><td style="text-align:right;">A$${quote.base?.toFixed(2)}</td></tr>
    <tr><td style="padding:6px 0;color:#666;">Transport (loaded)</td><td style="text-align:right;">A$${quote.kmCostLoaded?.toFixed(2)}</td></tr>
    <tr><td style="padding:6px 0;color:#666;">Return run</td><td style="text-align:right;">A$${quote.kmCostReturn?.toFixed(2)}</td></tr>
    ${quote.condSurcharge > 0 ? `<tr><td style="padding:6px 0;color:#666;">Condition surcharge</td><td style="text-align:right;">A$${quote.condSurcharge?.toFixed(2)}</td></tr>` : ''}
    ${quote.multiDiscount > 0 ? `<tr><td style="padding:6px 0;color:#666;">Multi-bike discount</td><td style="text-align:right;">-A$${quote.multiDiscount?.toFixed(2)}</td></tr>` : ''}
    <tr style="border-top:1px solid #eee;font-weight:600;"><td style="padding:10px 0 0;">Total (inc. GST)</td><td style="text-align:right;padding-top:10px;">${quoteTotal}</td></tr>
  ` : '';

  const ctaButton = payment_method === 'stripe_deposit' && depositAmt
    ? `<a href="${acceptUrl}" style="display:inline-block;background:#4FC1DB;color:white;padding:14px 32px;border-radius:6px;font-weight:700;font-size:16px;text-decoration:none;letter-spacing:0.03em;">Pay Deposit ${depositAmt} →</a>`
    : `<a href="${acceptUrl}" style="display:inline-block;background:#4FC1DB;color:white;padding:14px 32px;border-radius:6px;font-weight:700;font-size:16px;text-decoration:none;letter-spacing:0.03em;">Confirm Booking →</a>`;

  return `
    <div style="font-family:'Helvetica Neue',Arial,sans-serif;max-width:600px;margin:0 auto;background:#fff;">
      <div style="background:#0D0D0D;padding:24px 32px;">
        <span style="font-size:20px;font-weight:700;color:white;letter-spacing:0.05em;text-transform:uppercase;">
          CASPERS <span style="color:#4FC1DB;">TRANSPORT</span>
        </span>
      </div>
      <div style="padding:32px;">
        <p style="font-size:18px;font-weight:600;margin:0 0 8px;">Hi ${name},</p>
        <p style="color:#666;margin:0 0 24px;">Thanks for your booking request. Here's your quote:</p>
        <div style="background:#F5F5F4;border-radius:6px;padding:20px;margin-bottom:24px;">
          <p style="margin:0 0 6px;font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:0.08em;color:#898880;">Bike(s)</p>
          <p style="margin:0 0 16px;font-weight:500;">${bikesSummary}</p>
          <p style="margin:0 0 6px;font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:0.08em;color:#898880;">Pickup</p>
          <p style="margin:0 0 4px;">${pickup_address}</p>
          <p style="margin:0 0 16px;font-size:13px;color:#666;">→ ${dropoff_address}</p>
          <p style="margin:0 0 6px;font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:0.08em;color:#898880;">Date</p>
          <p style="margin:0;">${dateFormatted}</p>
        </div>
        ${breakdownRows ? `<table style="width:100%;border-collapse:collapse;font-size:15px;margin-bottom:24px;">${breakdownRows}</table>` : ''}
        <div style="text-align:center;margin:32px 0;">${ctaButton}</div>
        ${payment_method === 'follow_up' ? `<p style="text-align:center;font-size:13px;color:#898880;margin-top:16px;">A member of our team will be in touch to arrange payment and confirm your booking.</p>` : `<p style="text-align:center;font-size:13px;color:#898880;margin-top:16px;">Click the button above to pay your deposit and lock in your booking.</p>`}
        <hr style="border:none;border-top:1px solid #E8E7E5;margin:32px 0;">
        <p style="font-size:13px;color:#898880;margin:0;">Questions? Call or text us at <a href="tel:0434271510" style="color:#4FC1DB;">0434 271 510</a> or reply to this email.<br><em>Note: This quote is an estimate. Final price confirmed before booking is locked in.</em></p>
      </div>
    </div>
  `;
}

function buildAdminNotificationEmail({ name, email, phone, bikesSummary,
  pickup_address, dropoff_address, pickup_date, quoteTotal, payment_method,
  bookingId, notes }: any) {

  const dashboardUrl = `${process.env.NEXT_PUBLIC_APP_URL}/admin`;

  return `
    <div style="font-family:'Helvetica Neue',Arial,sans-serif;max-width:600px;margin:0 auto;">
      <div style="background:#0D0D0D;padding:20px 24px;">
        <span style="font-size:16px;font-weight:700;color:white;text-transform:uppercase;letter-spacing:0.05em;">New Booking Request</span>
      </div>
      <div style="padding:24px;background:#F5F5F4;">
        <table style="width:100%;border-collapse:collapse;font-size:14px;">
          <tr><td style="padding:6px 0;color:#666;width:140px;">Customer</td><td style="font-weight:600;">${name}</td></tr>
          <tr><td style="padding:6px 0;color:#666;">Email</td><td>${email}</td></tr>
          <tr><td style="padding:6px 0;color:#666;">Phone</td><td>${phone}</td></tr>
          <tr><td style="padding:6px 0;color:#666;">Bike(s)</td><td>${bikesSummary}</td></tr>
          <tr><td style="padding:6px 0;color:#666;">Pickup</td><td>${pickup_address}</td></tr>
          <tr><td style="padding:6px 0;color:#666;">Dropoff</td><td>${dropoff_address}</td></tr>
          <tr><td style="padding:6px 0;color:#666;">Date</td><td>${pickup_date}</td></tr>
          <tr><td style="padding:6px 0;color:#666;">Quote</td><td style="font-weight:600;">${quoteTotal}</td></tr>
          <tr><td style="padding:6px 0;color:#666;">Payment</td><td>${payment_method === 'stripe_deposit' ? 'Deposit via Stripe' : 'Follow-up required'}</td></tr>
          ${notes ? `<tr><td style="padding:6px 0;color:#666;">Notes</td><td>${notes}</td></tr>` : ''}
        </table>
        <div style="margin-top:24px;">
          <a href="${dashboardUrl}" style="background:#4FC1DB;color:white;padding:12px 24px;border-radius:6px;font-weight:700;font-size:14px;text-decoration:none;display:inline-block;">View in Dashboard →</a>
        </div>
      </div>
    </div>
  `;
}
