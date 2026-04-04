// middleware.ts
// ============================================================
// Route protection middleware
// - /admin/* → redirects to /admin/login if no Supabase session cookie
// - /driver/* → redirects to /driver/login if no session (except /driver/login itself)
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient }        from '@supabase/ssr';

export async function middleware(req: NextRequest) {
  const res  = NextResponse.next();
  const url  = req.nextUrl.pathname;

  // Build Supabase server client using cookies
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name)           { return req.cookies.get(name)?.value; },
        set(name, value, o) { res.cookies.set({ name, value, ...o }); },
        remove(name, o)     { res.cookies.set({ name, value: '', ...o }); },
      },
    }
  );

  const { data: { session } } = await supabase.auth.getSession();

  // ── Protect /admin ──────────────────────────────────────
  if (url.startsWith('/admin') && url !== '/admin/login') {
    if (!session) {
      return NextResponse.redirect(new URL('/admin/login', req.url));
    }
    // Check admin role
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('role')
      .eq('id', session.user.id)
      .single();

    if (!profile || profile.role !== 'admin') {
      return NextResponse.redirect(new URL('/admin/login', req.url));
    }
  }

  // ── Protect /driver ─────────────────────────────────────
  if (url.startsWith('/driver') && url !== '/driver/login') {
    if (!session) {
      return NextResponse.redirect(new URL('/driver/login', req.url));
    }
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('role')
      .eq('id', session.user.id)
      .single();

    if (!profile || !['admin', 'driver'].includes(profile.role)) {
      return NextResponse.redirect(new URL('/driver/login', req.url));
    }
  }

  // ── Redirect logged-in users away from login pages ──────
  if (session && (url === '/admin/login' || url === '/driver/login')) {
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('role')
      .eq('id', session.user.id)
      .single();

    if (profile?.role === 'admin')  return NextResponse.redirect(new URL('/admin',  req.url));
    if (profile?.role === 'driver') return NextResponse.redirect(new URL('/driver', req.url));
  }

  return res;
}

export const config = {
  matcher: [
    '/admin/:path*',
    '/driver/:path*',
  ],
};
