const TOKEN_URL = 'https://oauth2.googleapis.com/token';

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
