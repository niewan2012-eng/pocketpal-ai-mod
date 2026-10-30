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
  form { display: flex; gap: 8px; margin-top: 10px; position: sticky; bottom: 0;
         background: #0f1115; padding: 10px 0; }
  #attachBar { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin-top: 12px; }
  .thumb { position: relative; width: 64px; height: 64px; border-radius: 10px; overflow: hidden;
           border: 1px solid #2a2e36; }
  .thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .thumb button { position: absolute; top: 2px; right: 2px; width: 18px; height: 18px; padding: 0;
                  border-radius: 9px; background: #000a; color: #fff; font-size: 12px; line-height: 16px; }
  #pick { padding: 8px 12px; border-radius: 10px; border: 1px dashed #2a2e36; background: #16181d;
          color: #cfd3d8; cursor: pointer; font: inherit; }
  #pick:hover { border-color: #4f8dfd; }
  .hint { color: #9aa0a6; font-size: 12px; }
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
  <label><input type="checkbox" id="think" /> 思考</label>
</header>
<main>
  <div id="log"></div>
  <div id="attachBar">
    <label id="pick">＋ 图片
      <input id="file" type="file" accept="image/*" multiple hidden />
    </label>
    <span class="hint">图片会先缩放到 1024px 再发送</span>
    <span class="hint" id="visionHint" style="display:none">当前模型不支持看图，请先在 App 里换一个带 mmproj 的视觉模型</span>
  </div>
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
const thinkBox = document.getElementById('think');
const fileInput = document.getElementById('file');
const attachBar = document.getElementById('attachBar');
const pickLabel = document.getElementById('pick');
/** {id, dataUrl, name} for each attached image. */
let attachments = [];
let attachmentSeq = 0;

/** Downscale in the browser: phone photos are ~10 MB, and the app reads them
 *  from disk after the server writes them out. 1024 px keeps mtmd happy. */
function downscale(file, maxSide = 1024) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('无法读取图片'));
    };
    img.src = url;
  });
}

function renderAttachments() {
  for (const el of [...attachBar.querySelectorAll('.thumb')]) {
    el.remove();
  }
  for (const item of attachments) {
    const box = document.createElement('div');
    box.className = 'thumb';
    const img = document.createElement('img');
    img.src = item.dataUrl;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = '×';
    btn.title = '移除';
    btn.onclick = () => {
      attachments = attachments.filter(a => a.id !== item.id);
      renderAttachments();
    };
    box.append(img, btn);
    attachBar.insertBefore(box, pickLabel);
  }
}

fileInput.addEventListener('change', async () => {
  const files = [...fileInput.files];
  fileInput.value = '';
  for (const file of files) {
    try {
      const dataUrl = await downscale(file);
      attachments.push({id: ++attachmentSeq, dataUrl, name: file.name});
    } catch (e) {
      console.warn(e);
    }
  }
  renderAttachments();
});
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
  const model = d?.data?.[0];
  if (!model) {
    modelLabel.textContent = '未加载模型';
    return;
  }
  const vision = model.capabilities?.vision === true;
  modelLabel.textContent =
    '模型: ' + model.id + ' · 视觉: ' + (vision ? '✓ 可看图' : '✗ 当前未启用');
  // Keep the picker visible either way: the app can enable vision after this
  // page was loaded, and hiding it made that look like a missing feature.
  document.getElementById('visionHint').style.display = vision
    ? 'none'
    : 'inline';
}).catch(() => { modelLabel.textContent = '无法读取模型信息'; });

async function sendMessage(text) {
  const images = attachments.map(a => a.dataUrl);
  // OpenAI shape: a plain string when there is no image, parts when there is.
  const userContent = images.length
    ? [
        ...(text ? [{type: 'text', text}] : []),
        ...images.map(url => ({type: 'image_url', image_url: {url}})),
      ]
    : text;
  history.push({role: 'user', content: userContent});
  add('user', (text || '') + (images.length ? '  [' + images.length + ' 张图片]' : ''));
  attachments = [];
  renderAttachments();
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
        // Off by default: a reasoning model spends its output budget thinking
        // first, and the answer is what a chat page is for.
        enable_thinking: thinkBox.checked,
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
  if ((!text && attachments.length === 0) || send.disabled) return;
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
