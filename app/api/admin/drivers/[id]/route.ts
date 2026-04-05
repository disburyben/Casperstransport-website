// PATCH /api/admin/drivers/[id] — update driver (reset PIN, toggle active, update details)
// DELETE /api/admin/drivers/[id] — remove driver
export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from 'next/server';
import { createServerClient }        from '@supabase/ssr';
import { createClient }              from '@supabase/supabase-js';
import { hashPin }                   from '@/lib/driver-auth';

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

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  if (!await requireAdmin(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();
  const update: Record<string, any> = {};

  if (body.name    !== undefined) update.name    = body.name;
  if (body.vehicle !== undefined) update.vehicle = body.vehicle;
  if (body.phone   !== undefined) update.phone   = body.phone;
  if (body.active  !== undefined) update.active  = body.active;
  if (body.pin) {
    if (!/^\d{4}$/.test(body.pin)) return NextResponse.json({ error: 'PIN must be 4 digits' }, { status: 400 });
    update.pin_hash = hashPin(body.pin);
    // Invalidate all existing sessions when PIN is reset
    await supabase.from('driver_sessions').delete().eq('driver_id', params.id);
  }

  const { data, error } = await supabase
    .from('drivers')
    .update(update)
    .eq('id', params.id)
    .select('id, name, vehicle, phone, active')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ driver: data });
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  if (!await requireAdmin(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Sessions cascade delete via FK
  const { error } = await supabase.from('drivers').delete().eq('id', params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
