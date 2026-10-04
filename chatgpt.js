export function setupChatGPT(getSnapshot) {
  const form = document.querySelector('#chatgpt-form');
  const input = document.querySelector('#chatgpt-input');
  const messages = document.querySelector('#chatgpt-messages');
  const status = document.querySelector('#chatgpt-status');
  const history = [];
  let pending = false;
  const add = (role, text) => {
    const row = document.createElement('p');
    row.className = 'all-chat-message ' + role;
    row.textContent = text;
    messages.append(row);
    messages.scrollTop = messages.scrollHeight;
  };
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const question = input.value.trim().slice(0, 2000);
    if (pending || !question) return;
    pending = true;
    const button = form.querySelector('button');
    button.disabled = true;
    status.textContent = 'Thinking...';
    add('user', question);
    input.value = '';
    try {
      const snapshot = getSnapshot();
      const response = await fetch('/api/chatgpt', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(30000),
        body: JSON.stringify({ messages: [...history.slice(-8), { role: 'user', content: question }], snapshot })
      });
      const data = await response.json();
      if (!response.ok || !data.text) throw new Error(data.error || 'ChatGPT is unavailable.');
      add('assistant', data.text);
      history.push({ role: 'user', content: question }, { role: 'assistant', content: data.text.slice(0, 2000) });
      history.splice(0, Math.max(0, history.length - 8));
      status.textContent = '';
    } catch (error) {
      status.textContent = error.name === 'TimeoutError' ? 'Request timed out. Please retry.' : error.message;
      input.value = question;
    } finally { pending = false; button.disabled = false; input.focus(); }
  });
}
