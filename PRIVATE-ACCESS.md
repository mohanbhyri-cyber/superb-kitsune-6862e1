# Private Single-User Access

This app is configured for **password-only private access**. There is no username, signup, or multi-user registration.

## Cloudflare deployment

Set exactly one secret:

```powershell
npx wrangler secret put APP_PASSWORD
```

When prompted, enter your private app password. The password is stored as a Cloudflare secret and is not embedded in the browser code.

Then deploy:

```powershell
npx wrangler deploy
```

## Local development

Create a `.dev.vars` file (never commit it):

```text
APP_PASSWORD=your_private_password
```

The Worker protects the dashboard and API routes with an HttpOnly, Secure, SameSite session cookie. Upstox credentials remain server-side.

## Changing the password

Run `npx wrangler secret put APP_PASSWORD` again and deploy if required by your deployment workflow.
