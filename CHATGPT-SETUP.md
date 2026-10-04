# ChatGPT setup

Set `OPENAI_API_KEY` as a secret environment variable in Netlify (Functions scope), then redeploy. Never put this key in HTML, browser storage, or Git. Optionally set `OPENAI_MODEL`; default is `gpt-4.1-mini`.

For Cloudflare hosting, set the same Worker secret and deploy the Worker. The Netlify-specific `/api/chatgpt` route runs locally on Netlify; other market routes keep their existing Worker routing.

The chat sends up to four previous exchanges and the client chart snapshot to the OpenAI Responses API. Requests use `store: false`. It does not fetch additional Upstox data or alter indicators, Finalizer gates or orders. Set API project spending limits and hosting rate limits for public usage.

Without a server key, the panel reports that ChatGPT is not configured. A real response must be checked after configuring the key. Test the handler with `node --test chatgpt-server.test.js`.
