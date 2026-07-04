const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
const APP_REDIRECT = 'reverse1999tracker://oauth';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });
}

function appRedirect(params) {
  const target = APP_REDIRECT + '?' + new URLSearchParams(params).toString();
  const html = '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<body style="background:#0B0E24;color:#fff;font-family:sans-serif;text-align:center;padding-top:48px">'
    + '<script>location.replace(' + JSON.stringify(target) + ')</script>'
    + '<p>Returning to the app…</p>'
    + '<p><a style="color:#7B8CFF" href="' + target + '">Tap here if nothing happens</a></p></body>';
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

async function googleToken(params) {
  const res  = await fetch(TOKEN_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    new URLSearchParams(params),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS });
    }

    const url  = new URL(request.url);
    const path = url.pathname;

    if (path === '/oauth/exchange' && request.method === 'POST') {
      const { code } = await request.json().catch(() => ({}));
      if (!code) return json({ error: 'missing code' }, 400);

      const { ok, status, data } = await googleToken({
        code,
        client_id:     env.GOOGLE_CLIENT_ID,
        client_secret: env.GOOGLE_CLIENT_SECRET,
        redirect_uri:  'postmessage',
        grant_type:    'authorization_code',
      });
      if (!ok) return json({ error: data.error || 'exchange failed', detail: data.error_description }, status);

      return json({
        access_token:  data.access_token,
        expires_in:    data.expires_in,
        refresh_token: data.refresh_token || null,
      });
    }

    if (path === '/oauth/refresh' && request.method === 'POST') {
      const { refresh_token } = await request.json().catch(() => ({}));
      if (!refresh_token) return json({ error: 'missing refresh_token' }, 400);

      const { ok, status, data } = await googleToken({
        client_id:     env.GOOGLE_CLIENT_ID,
        client_secret: env.GOOGLE_CLIENT_SECRET,
        refresh_token,
        grant_type:    'refresh_token',
      });
      if (!ok) return json({ error: data.error || 'refresh failed', detail: data.error_description }, status);

      return json({ access_token: data.access_token, expires_in: data.expires_in });
    }

    if (path === '/oauth/start') {
      const redirect = url.origin + '/oauth/callback';
      const auth = AUTH_URL + '?' + new URLSearchParams({
        client_id:              env.GOOGLE_CLIENT_ID,
        redirect_uri:           redirect,
        response_type:          'code',
        scope:                  DRIVE_SCOPE,
        access_type:            'offline',
        prompt:                 'consent',
        include_granted_scopes: 'true',
      }).toString();
      return Response.redirect(auth, 302);
    }

    if (path === '/oauth/callback') {
      const err = url.searchParams.get('error');
      const code = url.searchParams.get('code');
      if (err || !code) return appRedirect({ error: err || 'no_code' });

      const { ok, data } = await googleToken({
        code,
        client_id:     env.GOOGLE_CLIENT_ID,
        client_secret: env.GOOGLE_CLIENT_SECRET,
        redirect_uri:  url.origin + '/oauth/callback',
        grant_type:    'authorization_code',
      });
      if (!ok || !data.refresh_token) {
        return appRedirect({ error: data.error || 'no_refresh_token' });
      }
      return appRedirect({
        refresh_token: data.refresh_token,
        access_token:  data.access_token || '',
        expires_in:    String(data.expires_in || 3600),
      });
    }

    const target = url.searchParams.get('url');
    if (!target) return new Response('Missing ?url= parameter', { status: 400, headers: CORS });
    if (!target.startsWith('https://game-re-en-service.sl916.com/')) {
      return new Response('Forbidden', { status: 403, headers: CORS });
    }

    const response = await fetch(target);
    const data     = await response.json();
    return json(data);
  },
};
