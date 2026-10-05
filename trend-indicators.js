# Configure password-only private access in Cloudflare.
# You will be prompted securely for the password.

Write-Host "Setting APP_PASSWORD..."
npx wrangler secret put APP_PASSWORD

Write-Host "Deploying private app..."
npx wrangler deploy
