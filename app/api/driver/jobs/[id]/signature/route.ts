export const dynamic = 'force-dynamic';
// app/api/driver/jobs/[id]/signature/route.ts
// ============================================================
// SIGNATURE SAVE + PDF REGENERATION
// PATCH /api/driver/jobs/[id]/signature
// Body: { type: 'pickup' | 'dropoff', signature: 'data:image/png;base64,...' }
//
// 1. Validates the driver is authenticated
// 2. Saves signature base64 + timestamp to bookings table
// 3. Triggers PDF regeneration with signature embedded
// 4. Stores updated PDF URL (optional — or regenerate on demand)
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { createClient }              from '@supabase/supabase-js';
import { verifyDriverSession }       from '@/lib/driver-auth';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const MAX_SIG_BYTES = 500_000;

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  // ── Auth ──────────────────────────────────
  const token  = req.cookies.get('driver_token')?.value;
  const driver = await verifyDriverSession(token);
  if (!driver) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // ── Parse body ───────────────────────────
  const { type, signature } = await req.json();

  if (!['pickup', 'dropoff'].includes(type)) {
    return NextResponse.json({ error: 'type must be pickup or dropoff' }, { status: 400 });
  }

  if (!signature || !signature.startsWith('data:image/png;base64,')) {
    return NextResponse.json({ error: 'Invalid signature data' }, { status: 400 });
  }

  // Size guard
  const base64Data = signature.replace('data:image/png;base64,', '');
  const byteSize   = Math.ceil(base64Data.length * 0.75);
  if (byteSize > MAX_SIG_BYTES) {
    return NextResponse.json({ error: 'Signature image too large' }, { status: 413 });
  }

  // ── Save to Supabase ─────────────────────
  const updatePayload: Record<string, any> = {};
  if (type === 'pickup') {
    updatePayload.sig_pickup    = signature;
    updatePayload.sig_pickup_at = new Date().toISOString();
  } else {
    updatePayload.sig_dropoff    = signature;
    updatePayload.sig_dropoff_at = new Date().toISOString();
  }

  const { error: updateError } = await supabase
    .from('bookings')
    .update(updatePayload)
    .eq('id', params.id);

  if (updateError) {
    console.error('Signature save failed:', updateError);
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  // ── Trigger PDF regeneration (fire and forget) ──
  // The PDF is regenerated server-side with the signature image
  // embedded into the sign-off box at the relevant position.
  // Next request to GET /api/job-sheet/[id] returns the updated version.
  // No async queue needed — the PDF generator reads from DB on demand.

  // ── Log to comms ─────────────────────────
  await supabase.from('comms_log').insert({
    booking_id: params.id,
    comms_type: 'admin_notification',
    status:     'sent',
    recipient:  'system',
    subject:    `Signature captured — ${type} (booking ${params.id})`,
    sent_at:    new Date().toISOString(),
  });

  return NextResponse.json({
    success: true,
    type,
    message: `${type} signature saved`,
  });
}
