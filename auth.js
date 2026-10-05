// auth.js
// SMRT Algo Pro - password-only private access.
// Password is stored only as Cloudflare secret APP_PASSWORD.

const COOKIE_NAME = "__Host-smrt_session";
const SESSION_SECONDS = 60 * 60 * 24 * 7;

function b64url(bytes) {
  let text = "";
  for (const byte of bytes) text += String.fromCharCode(byte);

  return btoa(text)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function fromB64url(value) {
  const padded =
    value.replace(/-/g, "+").replace(/_/g, "/") +
    "===".slice((value.length + 3) % 4);

  const binary = atob(padded);
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}

async function hmac(secret, text) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  return new Uint8Array(
    await crypto.subtle.sign(
      "HMAC",
      key,
      new TextEncoder().encode(text)
    )
  );
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;

  let difference = 0;

  for (let i = 0; i < a.length; i++) {
    difference |= a[i] ^ b[i];
  }

  return difference === 0;
}

function getCookie(request) {
  const header = request.headers.get("cookie") || "";

  const match = header.match(
    new RegExp(`(?:^|;\\s*)${COOKIE_NAME}=([^;]+)`)
  );

  return match ? match[1] : null;
}

async function validSession(request, env) {
  if (!env.APP_PASSWORD) return false;

  const raw = getCookie(request);
  if (!raw) return false;

  const [payload, signature] = raw.split(".");

  if (!payload || !signature) return false;

  try {
    const data = JSON.parse(
      new TextDecoder().decode(fromB64url(payload))
    );

    if (
      data?.u !== "owner" ||
      !data?.exp ||
      Number(data.exp) < Math.floor(Date.now() / 1000)
    ) {
      return false;
    }

    const expected = await hmac(env.APP_PASSWORD, payload);
    const received = fromB64url(signature);

    return timingSafeEqual(expected, received);
  } catch {
    return false;
  }
}

async function createSession(env) {
  const payload = b64url(
    new TextEncoder().encode(
      JSON.stringify({
        u: "owner",
        exp:
          Math.floor(Date.now() / 1000) +
          SESSION_SECONDS
      })
    )
  );

  const signature = b64url(
    await hmac(env.APP_PASSWORD, payload)
  );

  return `${payload}.${signature}`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function loginPage(message = "") {
  const error = message
    ? `<div class="error">${escapeHtml(message)}</div>`
    : "";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport"
      content="width=device-width,initial-scale=1">

<title>SMRT Algo Pro</title>

<style>
*{box-sizing:border-box}

body{
margin:0;
min-height:100vh;
display:grid;
place-items:center;
background:#0c1113;
color:#fff;
font-family:Arial,sans-serif;
}

.card{
width:min(420px,calc(100% - 36px));
padding:32px;
background:#12191c;
border:1px solid #273237;
border-radius:18px;
box-shadow:0 20px 60px #0008;
}

h1{
margin:0 0 8px;
font-size:28px;
}

.subtitle{
color:#9aa7ad;
margin-bottom:25px;
}

label{
display:block;
font-size:13px;
margin-bottom:8px;
color:#c8d1d5;
}

input{
width:100%;
padding:13px;
font-size:16px;
border-radius:9px;
border:1px solid #354349;
background:#0c1113;
color:#fff;
outline:none;
}

input:focus{
border-color:#6dd6a8;
}

button{
width:100%;
margin-top:18px;
padding:13px;
border:0;
border-radius:9px;
background:#6dd6a8;
color:#08110d;
font-weight:700;
font-size:15px;
cursor:pointer;
}

.error{
margin-top:14px;
color:#ff8d8d;
font-size:13px;
}

.note{
margin-top:18px;
color:#738188;
font-size:12px;
}
</style>
</head>

<body>

<form class="card"
      method="post"
      action="/login">

<h1>SMRT Algo Pro</h1>

<div class="subtitle">
Private Trading Dashboard
</div>

<label>Password</label>

<input
type="password"
name="password"
autocomplete="current-password"
required
autofocus>

${error}

<button type="submit">
Open Dashboard
</button>

<div class="note">
Private single-user access
</div>

</form>

</body>
</html>`;
}

export async function authResponse(request, env) {
  if (!env.APP_PASSWORD) {
    return new Response(
      "APP_PASSWORD is not configured in Cloudflare.",
      {
        status: 503,
        headers: {
          "content-type": "text/plain; charset=utf-8",
          "cache-control": "no-store"
        }
      }
    );
  }

  const url = new URL(request.url);

  // Logout
  if (url.pathname === "/logout") {
    return new Response(null, {
      status: 302,
      headers: {
        location: "/login",
        "set-cookie":
          `${COOKIE_NAME}=; Path=/; Max-Age=0; ` +
          "HttpOnly; Secure; SameSite=Strict",
        "cache-control": "no-store"
      }
    });
  }

  // Existing valid session
  if (await validSession(request, env)) {
    return null;
  }

  // Login page
  if (url.pathname === "/login") {
    if (request.method === "GET") {
      return new Response(loginPage(), {
        status: 200,
        headers: {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store"
        }
      });
    }

    if (request.method === "POST") {
      const form =
        await request.formData().catch(() => null);

      const password =
        String(form?.get("password") || "");

      if (password === env.APP_PASSWORD) {
        const session = await createSession(env);

        return new Response(null, {
          status: 302,
          headers: {
            location: "/",
            "set-cookie":
              `${COOKIE_NAME}=${session}; ` +
              `Path=/; Max-Age=${SESSION_SECONDS}; ` +
              "HttpOnly; Secure; SameSite=Strict",
            "cache-control": "no-store"
          }
        });
      }

      return new Response(
        loginPage("Incorrect password."),
        {
          status: 401,
          headers: {
            "content-type":
              "text/html; charset=utf-8",
            "cache-control": "no-store"
          }
        }
      );
    }

    return new Response("Method not allowed", {
      status: 405
    });
  }

  // Not logged in
  return new Response(null, {
    status: 302,
    headers: {
      location: "/login",
      "cache-control": "no-store"
    }
  });
}
