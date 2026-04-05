// GET /api/admin/analytics
// Returns aggregated data: revenue by month, jobs by status, top-level totals
export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from 'next/server';
import { createServerClient }        from '@supabase/ssr';
import { createClient }              from '@supabase/supabase-js';

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

  const { data: bookings, error } = await supabase
    .from('bookings')
    .select(`
      id, pickup_date, status, invoice_paid, invoice_paid_at,
      quotes ( total_aud, version )
    `)
    .order('pickup_date', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Build last 12 months labels
  const now = new Date();
  const months: { key: string; label: string; revenue: number; jobs: number }[] = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const label = d.toLocaleDateString('en-AU', { month: 'short', year: '2-digit' });
    months.push({ key, label, revenue: 0, jobs: 0 });
  }

  // Jobs by status counts
  const byStatus: Record<string, number> = {};
  let totalRevenue = 0;
  let completedCount = 0;

  for (const bk of bookings || []) {
    byStatus[bk.status] = (byStatus[bk.status] || 0) + 1;

    if (bk.status === 'completed') {
      completedCount++;
      const quotes = (bk.quotes as any[]) || [];
      const q = quotes.sort((a: any, b: any) => b.version - a.version)[0];
      const amount = q ? parseFloat(q.total_aud || 0) : 0;

      // Revenue by month (using pickup_date)
      const monthKey = bk.pickup_date?.slice(0, 7);
      const monthEntry = months.find(m => m.key === monthKey);
      if (monthEntry) {
        monthEntry.revenue += amount;
        monthEntry.jobs++;
      }
      totalRevenue += amount;
    }
  }

  const avgJobValue = completedCount > 0 ? totalRevenue / completedCount : 0;

  // Invoices outstanding
  const { data: unpaidData } = await supabase
    .from('bookings')
    .select('id')
    .eq('status', 'completed')
    .eq('invoice_paid', false);

  return NextResponse.json({
    totalRevenue,
    completedCount,
    avgJobValue,
    totalBookings: (bookings || []).length,
    unpaidInvoices: (unpaidData || []).length,
    byStatus,
    byMonth: months,
  });
}
