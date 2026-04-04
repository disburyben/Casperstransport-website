// GET /api/driver/session
// Returns the current user's access token if authenticated
// Used by driver.html to seed sessionStorage when cookie auth exists

export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient }        from '@supabase/ssr';

export async function GET(req: NextRequest) {
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name)           { return req.cookies.get(name)?.value; },
        set(name, value, o) {},
        remove(name, o)     {},
      },
    }
  );

  const { data: { session } } = await supabase.auth.getSession();
  
  if (!session) {
    return NextResponse.json({ token: null }, { status: 401 });
  }

  // Return token so client can seed sessionStorage
  return NextResponse.json({
    token: session.access_token,
    user: {
      id: session.user.id,
      email: session.user.email,
    },
  });
}
