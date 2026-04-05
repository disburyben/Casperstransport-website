// GET /api/admin/drivers — list all drivers
// POST /api/admin/drivers — create driver { name, pin, vehicle, phone }
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

export async function GET(req: NextRequest) {
  if (!await requireAdmin(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data, error } = await supabase
    .from('drivers')
    .select('id, name, vehicle, phone, active, created_at')
    .order('name');

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ drivers: data });
}

export async function POST(req: NextRequest) {
  if (!await requireAdmin(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { name, pin, vehicle, phone } = await req.json();

  if (!name || !pin) return NextResponse.json({ error: 'name and pin are required' }, { status: 400 });
  if (!/^\d{4}$/.test(pin)) return NextResponse.json({ error: 'PIN must be 4 digits' }, { status: 400 });

  const { data, error } = await supabase
    .from('drivers')
    .insert({ name, pin_hash: hashPin(pin), vehicle: vehicle || null, phone: phone || null, active: true })
    .select('id, name, vehicle, phone, active')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ driver: data });
}

// PATCH /api/admin/drivers  { id, pin?, active?, name?, vehicle?, phone? }
export async function PATCH(req: NextRequest) {
  if (!await requireAdmin(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();
  const { id, ...rest } = body;
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const update: Record<string, any> = {};
  if (rest.name    !== undefined) update.name    = rest.name;
  if (rest.vehicle !== undefined) update.vehicle = rest.vehicle;
  if (rest.phone   !== undefined) update.phone   = rest.phone;
  if (rest.active  !== undefined) update.active  = rest.active;
  if (rest.pin) {
    if (!/^\d{4}$/.test(rest.pin)) return NextResponse.json({ error: 'PIN must be 4 digits' }, { status: 400 });
    update.pin_hash = hashPin(rest.pin);
    await supabase.from('driver_sessions').delete().eq('driver_id', id);
  }

  const { data, error } = await supabase
    .from('drivers')
    .update(update)
    .eq('id', id)
    .select('id, name, vehicle, phone, active')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ driver: data });
}

// DELETE /api/admin/drivers  { id }
export async function DELETE(req: NextRequest) {
  if (!await requireAdmin(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await req.json();
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const { error } = await supabase.from('drivers').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
