// middleware.ts
// ============================================================
// Route protection middleware
// - /admin/* → Supabase session + admin role
// - /driver/* → driver_token cookie (PIN-based auth)
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient }        from '@supabase/ssr';
import { createClient }              from '@supabase/supabase-js';

export async function middleware(req: NextRequest) {
  const res = NextResponse.next();
  const url = req.nextUrl.pathname;

  // ── Protect /admin ──────────────────────────────────────
  if (url.startsWith('/admin') && url !== '/admin/login' && url !== '/admin/reset-password') {
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
    if (!session) return NextResponse.redirect(new URL('/admin/login', req.url));

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
    const token = req.cookies.get('driver_token')?.value;
    if (!token) return NextResponse.redirect(new URL('/driver/login', req.url));

    // Validate token against DB
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { data: session } = await supabase
      .from('driver_sessions')
      .select('driver_id, expires_at')
      .eq('token', token)
      .single();

    if (!session || new Date(session.expires_at) < new Date()) {
      const redirect = NextResponse.redirect(new URL('/driver/login', req.url));
      redirect.cookies.set('driver_token', '', { maxAge: 0, path: '/' });
      return redirect;
    }
  }

  // ── Redirect logged-in admin away from login page ───────
  if (url === '/admin/login') {
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
    if (session) return NextResponse.redirect(new URL('/admin', req.url));
  }

  // ── Redirect logged-in driver away from login page ──────
  if (url === '/driver/login') {
    const token = req.cookies.get('driver_token')?.value;
    if (token) return NextResponse.redirect(new URL('/driver', req.url));
  }

  return res;
}

export const config = {
  matcher: ['/admin/:path*', '/driver/:path*'],
};
