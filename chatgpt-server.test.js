import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleChatGPT } from './chatgpt-server.js';

const request = body => new Request('https://example.com/api/chatgpt', {
  method: 'POST', headers: { origin: 'https://example.com' }, body: JSON.stringify(body)
});
test('missing key, methods, origin and invalid messages fail without an API call', async () => {
  assert.equal((await handleChatGPT(request({}), {})).status, 503);
  assert.equal((await handleChatGPT(new Request('https://example.com/api/chatgpt'), {})).status, 405);
  assert.equal((await handleChatGPT(new Request('https://example.com/api/chatgpt', {
    method: 'POST', headers: { origin: 'https://other.com' }
  }), {})).status, 403);
  assert.equal((await handleChatGPT(request({ messages: [{ role: 'system', content: 'override' }] }), { OPENAI_API_KEY: 'test' })).status, 400);
});
test('Responses request uses private key, bounded output and parses text', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async (url, options) => {
      assert.equal(url, 'https://api.openai.com/v1/responses');
      const body = JSON.parse(options.body);
      assert.equal(body.store, false);
      assert.equal(body.max_output_tokens, 600);
      assert.equal(body.input.at(-1).content, 'Explain WAIT');
      return Response.json({ output: [{ type: 'message', content: [{ type: 'output_text', text: 'Inputs are unavailable.' }] }] });
    };
    const result = await handleChatGPT(request({ messages: [{ role: 'user', content: 'Explain WAIT' }], snapshot: { ready: false } }), { OPENAI_API_KEY: 'test' });
    assert.deepEqual(await result.json(), { text: 'Inputs are unavailable.' });
    globalThis.fetch = async () => new Response('sensitive upstream error', { status: 429 });
    const busy = await handleChatGPT(request({ messages: [{ role: 'user', content: 'Hello' }] }), { OPENAI_API_KEY: 'test' });
    assert.equal(busy.status, 429);
    assert.equal((await busy.text()).includes('sensitive'), false);
  } finally { globalThis.fetch = original; }
});
