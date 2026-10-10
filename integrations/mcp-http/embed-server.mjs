import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { APP_URI, APP_MIME, browserHtml, callBrowserApp } from './browser-app.mjs';

let sdk;
export function embedSdk() {
  return sdk ??= build({ entryPoints: [fileURLToPath(new URL('./embed-host.mjs', import.meta.url))],
    bundle: true, write: false, format: 'esm', minify: true, target: 'es2022' }).then(result => result.outputFiles[0].text);
}
export const exampleHtml = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Embed Kitsuvo</title>
<style>body{font:16px system-ui;margin:20px auto;max-width:1000px;padding:0 12px;color:CanvasText;background:Canvas;color-scheme:light dark}button{font:inherit;padding:10px}#browser{height:760px}#status{min-height:24px}</style></head><body>
<h1>Kitsuvo inside your application</h1><p>This example embeds the browser panel. Pages run in the local Kitsuvo engine. Connecting shares page text and previews with this host.</p>
<button id="connect">Connect local browser</button><button id="disconnect" hidden>Disconnect panel</button><p id="status" role="status" aria-live="polite"></p><div id="browser"></div>
<script type="module">import {mountKitsuvo} from '/embed/sdk.js';
const button=document.getElementById('connect'),disconnect=document.getElementById('disconnect'),status=document.getElementById('status');let panel;
const request=async(path,options)=>{const res=await fetch(path,options);if(!res.ok)throw new Error('Local bridge returned '+res.status);return res.json()};
button.onclick=async()=>{button.disabled=true;status.textContent='Connecting…';try{panel=await mountKitsuvo(document.getElementById('browser'),{client:{readResource:()=>request('/embed/resource'),callTool:params=>request('/embed/action',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(params)})},theme:matchMedia('(prefers-color-scheme:dark)').matches?'dark':'light'});disconnect.hidden=false;button.hidden=true;status.textContent='Connected to local Kitsuvo';}catch(error){status.textContent=error.message;}finally{button.disabled=false;}};
disconnect.onclick=async()=>{await panel?.destroy();panel=undefined;disconnect.hidden=true;button.hidden=false;status.textContent='Panel disconnected. Kitsuvo may remain open.';};
</script></body></html>`;

// Called only after createBridge has validated the loopback Host and Origin.
export async function serveEmbed(req, res, backend, serialize) {
  const send = (status, type, body) => res.writeHead(status, {
    'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; frame-src 'self' about:; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'self'",
  }).end(body);
  if (req.method === 'GET' && req.url === '/embed') {
    send(200, 'text/html; charset=utf-8', exampleHtml); return;
  }
  if (req.method === 'GET' && req.url === '/embed/sdk.js') {
    send(200, 'text/javascript; charset=utf-8', await embedSdk()); return;
  }
  if (req.method === 'GET' && req.url === '/embed/resource') {
    send(200, 'application/json', JSON.stringify({ contents: [{ uri: APP_URI, mimeType: APP_MIME, text: await browserHtml() }] })); return;
  }
  if (req.method !== 'POST' || req.url !== '/embed/action') {
    send(405, 'text/plain', 'Unsupported embed request.'); return;
  }
  if (req.headers['content-type']?.split(';')[0].trim() !== 'application/json') {
    send(415, 'text/plain', 'Expected application/json.'); return;
  }
  const chunks = []; let size = 0;
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    size += chunk.length;
    if (size > 16384) { req.resume(); send(413, 'text/plain', 'Embed arguments are too large.'); return; }
    chunks.push(chunk);
  }
  let params;
  try { params = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { send(400, 'text/plain', 'Invalid JSON.'); return; }
  if (!params || !['kitsuvo_browser', 'kitsuvo_browser_action'].includes(params.name)) {
    send(403, 'text/plain', 'Only browser panel tools are available.'); return;
  }
  const result = await serialize(() => callBrowserApp(backend, params.name, params.arguments));
  send(200, 'application/json', JSON.stringify(result));
}
