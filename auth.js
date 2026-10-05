// auth.js
// Single-user access control for the SMRT Algo Pro Cloudflare Worker.
// Credentials are supplied only through Cloudflare secrets:
//   APP_PASSWORD

const COOKIE_NAME = "__Host-smrt_session";
const SESSION_SECONDS = 60 * 60 * 24 * 7;

function b64url(bytes) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64url(value) {
  const s = value.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((value.length + 3) % 4);
  const bin = atob(s);
  return Uint8Array.from(bin, c => c.charCodeAt(0));
}

async function hmac(secret, text) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
  return new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(text))
  );
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

function cookieValue(request) {
  const header = request.headers.get("cookie") || "";
  const match = header.match(new RegExp(`(?:^|;\\s*)${COOKIE_NAME}=([^;]+)`));
  return match ? match[1] : null;
}

async function validSession(request, env) {
  if (!env.APP_PASSWORD) return false;
  const raw = cookieValue(request);
  if (!raw) return false;

  const [payload, signature] = raw.split(".");
  if (!payload || !signature) return false;

  try {
    const data = JSON.parse(new TextDecoder().decode(fromB64url(payload)));
    if (!data?.u || !data?.exp || Number(data.exp) < Math.floor(Date.now() / 1000)) {
      return false;
    }

    const expected = await hmac(env.APP_PASSWORD, payload);
    return timingSafeEqual(expected, fromB64url(signature));
  } catch {
    return false;
  }
}

async function createSession(user, env) {
  const payload = b64url(
    new TextEncoder().encode(JSON.stringify({
      u: "owner",
      exp: Math.floor(Date.now() / 1000) + SESSION_SECONDS,
    }))
  );
  const signature = b64url(await hmac(env.APP_PASSWORD, payload));
  return `${payload}.${signature}`;
}

export function loginPage(message = "") {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>SMRT Algo Pro — Private Access</title>
<style>
body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0b1020;color:#eef2ff;font-family:Arial,sans-serif}
.card{width:min(420px,calc(100% - 40px));padding:32px;background:#121a2e;border:1px solid #293657;border-radius:18px;box-sizing:border-box;box-shadow:0 20px 60px #0008}
h1{margin:0 0 8px;font-size:24px}.sub{color:#9eabc7;margin-bottom:24px}
label{display:block;margin:14px 0 7px;color:#cbd5e1;font-size:13px}
input{width:100%;box-sizing:border-box;padding:12px;border-radius:10px;border:1px solid #3a496c;background:#0b1020;color:white;font-size:16px}
button{width:100%;margin-top:20px;padding:12px;border:0;border-radius:10px;background:#eef2ff;color:#0b1020;font-weight:700;cursor:pointer}
.err{color:#ff9b9b;min-height:20px;margin-top:12px;font-size:13px}
small{display:block;margin-top:18px;color:#71809f}
</style>
</head>
<body>
<form class="card" method="post" action="/login">
<h1>SMRT Algo Pro</h1>
<div class="sub">Private single-user access</div>
<label>Password</label>
<input type="password" name="password" autocomplete="current-password" required autofocus>
${message ? `<div class="err">${message}</div>` : ""}
<button type="submit">Enter Trading Desk</button>
<small>This application is restricted to the configured owner account.</small>
</form>
</body>
</html>`;
}

export async function authResponse(request, env) {
  if (!env.APP_PASSWORD) {
    return new Response(
      "Private access is not configured. Set the Cloudflare secret APP_PASSWORD.",
      { status: 503, headers: { "content-type": "text/plain; charset=utf-8" } }
    );
  }

  if (await validSession(request, env)) return null;

  const url = new URL(request.url);

  if (url.pathname === "/login") {
    if (request.method === "GET") {
      return new Response(loginPage(), {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
      });
    }

    if (request.method === "POST") {
      const form = await request.formData().catch(() => null);
      const password = String(form?.get("password") || "");

      if (password === env.APP_PASSWORD) {
        const session = await createSession("owner", env);
        return new Response(null, {
          status: 302,
          headers: {
            location: "/",
            "set-cookie": `${COOKIE_NAME}=${session}; Path=/; Max-Age=${SESSION_SECONDS}; HttpOnly; Secure; SameSite=Strict`,
            "cache-control": "no-store",
          },
        });
      }

      return new Response(loginPage("Invalid password."), {
        status: 401,
        headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
      });
    }
  }

  if (url.pathname === "/logout") {
    return new Response(null, {
      status: 302,
      headers: {
        location: "/login",
        "set-cookie": `${COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`,
        "cache-control": "no-store",
      },
    });
  }

  // Protect all dashboard pages and API routes.
  return new Response(null, {
    status: 302,
    headers: {
      location: "/login",
      "cache-control": "no-store",
    },
  });
}
