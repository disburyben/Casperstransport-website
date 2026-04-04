export const dynamic = 'force-dynamic';
// app/api/webhooks/stripe/route.ts
// Handles Stripe checkout.session.completed
// Updates booking status to confirmed when deposit is paid

import { NextRequest, NextResponse } from 'next/server';
import { createClient }              from '@supabase/supabase-js';
import { Resend }                    from 'resend';
import Stripe                        from 'stripe';

const stripe    = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2024-06-20' });
const supabase  = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);
const resend    = new Resend(process.env.RESEND_API_KEY!);
const APP_URL   = process.env.NEXT_PUBLIC_APP_URL!;

export async function POST(req: NextRequest) {
  const body      = await req.text();
  const signature = req.headers.get('stripe-signature')!;

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(
      body, signature, process.env.STRIPE_WEBHOOK_SECRET!
    );
  } catch (err: any) {
    return NextResponse.json({ error: `Webhook error: ${err.message}` }, { status: 400 });
  }

  if (event.type === 'checkout.session.completed') {
    const session   = event.data.object as Stripe.Checkout.Session;
    const bookingId = session.metadata?.booking_id;

    if (!bookingId) return NextResponse.json({ received: true });

    // Update booking — confirmed + deposit paid
    const { data: booking, error: bookingError } = await supabase
      .from('bookings')
      .update({
        status:           'confirmed',
        deposit_paid:     true,
        stripe_payment_id: session.payment_intent as string,
      })
      .eq('id', bookingId)
      .select(`
        *,
        customers ( name, email, phone ),
        bikes ( bike_type, condition, make, model, year )
      `)
      .single();

    if (bookingError) {
      console.error('Booking update failed:', bookingError);
      return NextResponse.json({ error: 'DB update failed' }, { status: 500 });
    }

    // Create calendar blocks
    await createCalendarBlocks(bookingId, booking);

    // Update customer stats
    const { data: quote } = await supabase
      .from('quotes')
      .select('total_aud')
      .eq('booking_id', bookingId)
      .order('version', { ascending: false })
      .limit(1)
      .single();

    if (quote) {
      await supabase.rpc('update_customer_stats', {
        p_customer_id: booking.customer_id,
        p_amount:      quote.total_aud,
      });
    }

    // Send confirmation email to customer
    await sendConfirmationEmail(booking);

    // Log comms
    await supabase.from('comms_log').insert({
      booking_id: bookingId,
      comms_type: 'confirmation_email',
      status:     'sent',
      recipient:  booking.customers.email,
      sent_at:    new Date().toISOString(),
    });
  }

  return NextResponse.json({ received: true });
}

// ---- Create calendar blocks from booking data ----
async function createCalendarBlocks(bookingId: string, booking: any) {
  const { data: rc } = await supabase.from('rate_card').select('*').limit(1).single();
  if (!rc) return;

  const pickupDateTime = new Date(`${booking.pickup_date}T${booking.pickup_time || '09:00:00'}`);

  // Work backwards from pickup time to get departure from base
  const driveToPickupMin = Math.ceil((booking.distance_km || 0) / 1); // rough estimate
  const loadTimeMin      = rc.load_time_standard_min;
  const driveLoadedMin   = Math.ceil((booking.distance_km || 0) / 1);
  const driveReturnMin   = Math.ceil((booking.return_km   || 0) / 1);

  const departureTime = new Date(pickupDateTime.getTime() - driveToPickupMin * 60000);
  const loadEnd       = new Date(pickupDateTime.getTime() + loadTimeMin * 60000);
  const dropoffTime   = new Date(loadEnd.getTime() + driveLoadedMin * 60000);
  const returnEnd     = new Date(dropoffTime.getTime() + driveReturnMin * 60000 + rc.buffer_minutes * 60000);

  const blocks = [
    { block_type: 'drive_to_pickup', starts_at: departureTime,    ends_at: pickupDateTime },
    { block_type: 'job_loaded',      starts_at: pickupDateTime,   ends_at: dropoffTime    },
    { block_type: 'drive_return',    starts_at: dropoffTime,      ends_at: returnEnd      },
  ];

  await supabase.from('calendar_blocks').insert(
    blocks.map(b => ({
      ...b,
      booking_id: bookingId,
      starts_at:  b.starts_at.toISOString(),
      ends_at:    b.ends_at.toISOString(),
    }))
  );
}

// ---- Confirmation email ----
async function sendConfirmationEmail(booking: any) {
  const customer = booking.customers;
  const bikes    = booking.bikes || [];

  const bikesSummary = bikes.map((b: any) =>
    `${b.make || ''} ${b.model || ''} ${b.year || ''}`.trim() ||
    `${(b.bike_type || '').replace(/_/g, ' ')}`
  ).join(', ');

  const dateFormatted = new Date(booking.pickup_date).toLocaleDateString('en-AU', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
  });

  await resend.emails.send({
    from:    'Caspers Transport <bookings@casperstransport.com.au>',
    to:      [customer.email],
    subject: `Booking confirmed — ${dateFormatted}`,
    html: `
      <div style="font-family:'Helvetica Neue',Arial,sans-serif;max-width:600px;margin:0 auto;background:#fff;">
        <div style="background:#0D0D0D;padding:24px 32px;">
          <span style="font-size:20px;font-weight:700;color:white;letter-spacing:0.05em;text-transform:uppercase;">
            CASPERS <span style="color:#4FC1DB;">TRANSPORT</span>
          </span>
        </div>
        <div style="padding:32px;">
          <div style="background:#EAF5EE;border-radius:6px;padding:16px 20px;margin-bottom:24px;">
            <p style="margin:0;font-weight:700;color:#1A7A4A;font-size:16px;">✓ Booking Confirmed</p>
          </div>

          <p style="font-size:18px;font-weight:600;margin:0 0 8px;">Hi ${customer.name},</p>
          <p style="color:#666;margin:0 0 24px;">Your booking is locked in. Here are your details:</p>

          <div style="background:#F5F5F4;border-radius:6px;padding:20px;margin-bottom:24px;">
            <table style="width:100%;border-collapse:collapse;font-size:14px;">
              <tr><td style="padding:5px 0;color:#666;width:120px;">Bike(s)</td><td style="font-weight:500;">${bikesSummary}</td></tr>
              <tr><td style="padding:5px 0;color:#666;">Pickup from</td><td>${booking.pickup_address}</td></tr>
              <tr><td style="padding:5px 0;color:#666;">Delivering to</td><td>${booking.dropoff_address}</td></tr>
              <tr><td style="padding:5px 0;color:#666;">Date</td><td style="font-weight:600;">${dateFormatted}</td></tr>
              ${booking.pickup_time ? `<tr><td style="padding:5px 0;color:#666;">Time</td><td>${booking.pickup_time}</td></tr>` : ''}
            </table>
          </div>

          <p style="font-size:14px;color:#666;">
            Our driver will be in touch closer to the date with an exact arrival time.
            Any questions, call or text us at <a href="tel:+61XXXXXXXXXX" style="color:#4FC1DB;">0X XXXX XXXX</a>.
          </p>
        </div>
      </div>
    `,
  });
}
