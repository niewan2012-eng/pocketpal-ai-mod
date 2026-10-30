/**
 * The page the API server answers with at `/`.
 *
 * Self-contained on purpose: no build step, no CDN, no bundler. It talks to the
 * phone over the same origin, so there is no CORS involved and it works on any
 * device with a browser on the same Wi-Fi.
 */
export const WEB_PAGE_HTML = `<!doctype html>
<html lang="zh">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>PocketPal Mod · API</title>
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body { margin: 0; font: 15px/1.5 -apple-system, system-ui, "Segoe UI", Roboto, sans-serif;
         background: #0f1115; color: #e8eaed; }
  header { padding: 14px 18px; border-bottom: 1px solid #23262d; display: flex; gap: 10px;
           align-items: baseline; flex-wrap: wrap; }
  header strong { font-size: 16px; }
  header span { color: #9aa0a6; font-size: 13px; }
  main { max-width: 860px; margin: 0 auto; padding: 16px; }
  #log { display: flex; flex-direction: column; gap: 12px; min-height: 40vh; }
  .msg { padding: 10px 12px; border-radius: 10px; white-space: pre-wrap; word-break: break-word; }
  .user { background: #1f2937; align-self: flex-end; max-width: 85%; }
  .bot  { background: #16181d; border: 1px solid #23262d; }
  .meta { color: #9aa0a6; font-size: 12px; margin-top: 6px; }
  form { display: flex; gap: 8px; margin-top: 14px; position: sticky; bottom: 0;
         background: #0f1115; padding: 10px 0; }
  textarea { flex: 1; resize: vertical; min-height: 52px; padding: 10px; border-radius: 10px;
             border: 1px solid #2a2e36; background: #16181d; color: inherit; font: inherit; }
  button { padding: 0 18px; border-radius: 10px; border: 0; background: #4f8dfd; color: #fff;
           font-weight: 600; cursor: pointer; }
  button:disabled { opacity: .5; cursor: default; }
  label { display: inline-flex; gap: 6px; align-items: center; color: #9aa0a6; font-size: 13px; }
  code { background: #16181d; padding: 2px 6px; border-radius: 6px; }
</style>
</head>
<body>
<header>
  <strong>PocketPal Mod</strong>
  <span id="model">加载模型信息中…</span>
  <label><input type="checkbox" id="stream" checked /> 流式</label>
</header>
<main>
  <div id="log"></div>
  <form id="form">
    <textarea id="input" placeholder="输入内容，Enter 发送，Shift+Enter 换行"></textarea>
    <button id="send" type="submit">发送</button>
  </form>
</main>
<script>
const log = document.getElementById('log');
const form = document.getElementById('form');
const input = document.getElementById('input');
const send = document.getElementById('send');
const modelLabel = document.getElementById('model');
const streamBox = document.getElementById('stream');
let history = [];

function add(role, text) {
  const el = document.createElement('div');
  el.className = 'msg ' + (role === 'user' ? 'user' : 'bot');
  el.textContent = text;
  log.appendChild(el);
  el.scrollIntoView({block: 'end'});
  return el;
}

fetch('/v1/models').then(r => r.json()).then(d => {
  const id = d?.data?.[0]?.id;
  modelLabel.textContent = id ? ('模型: ' + id) : '未加载模型';
}).catch(() => { modelLabel.textContent = '无法读取模型信息'; });

async function sendMessage(text) {
  history.push({role: 'user', content: text});
  add('user', text);
  const bubble = add('assistant', '');
  send.disabled = true;
  const started = performance.now();
  try {
    const res = await fetch('/v1/chat/completions', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        model: modelLabel.textContent.replace('模型: ', ''),
        messages: history,
        stream: streamBox.checked,
      }),
    });
    if (!res.ok) {
      bubble.textContent = '错误: HTTP ' + res.status + ' ' + (await res.text());
      return;
    }
    let acc = '';
    if (streamBox.checked) {
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const {done, value} = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, {stream: true});
        const lines = buffer.split('\\n');
        buffer = lines.pop();
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) continue;
          const data = trimmed.slice(5).trim();
          if (data === '[DONE]') continue;
          try {
            const parsed = JSON.parse(data);
            const delta = parsed?.choices?.[0]?.delta?.content;
            if (delta) { acc += delta; bubble.textContent = acc; }
          } catch (e) { /* keepalive or partial */ }
        }
      }
    } else {
      const data = await res.json();
      acc = data?.choices?.[0]?.message?.content ?? '';
      bubble.textContent = acc;
    }
    const secs = ((performance.now() - started) / 1000).toFixed(1);
    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.textContent = secs + ' s';
    bubble.appendChild(meta);
    history.push({role: 'assistant', content: acc});
  } catch (e) {
    bubble.textContent = '请求失败: ' + e.message;
  } finally {
    send.disabled = false;
    input.focus();
  }
}

form.addEventListener('submit', e => {
  e.preventDefault();
  const text = input.value.trim();
  if (!text || send.disabled) return;
  input.value = '';
  sendMessage(text);
});

input.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    form.dispatchEvent(new Event('submit'));
  }
});
</script>
</body>
</html>`;
