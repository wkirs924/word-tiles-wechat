/** Export runtime copies only. Never copy a checkout or an entire assets directory. */
import {readFileSync, writeFileSync, mkdirSync, lstatSync, existsSync} from 'node:fs';
import {resolve, dirname, sep} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = resolve(import.meta.dirname, '..');
const scripts = ['content.js', 'core.bundle.js', 'gif-codec.js', 'custom-memes.js', 'game.js'];
const privateMaterial = /-----BEGIN (?:[A-Z ]*PRIVATE KEY)-----|github_pat_[A-Za-z0-9_]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|AKIA[A-Z0-9]{16}|(?:sourceMappingURL|sourceURL)\s*=/;

export function exportPublicWeb(source, destination) {
  source = resolve(source); destination = resolve(destination);
  if (destination === source || destination.startsWith(source + sep) || source.startsWith(destination + sep)) {
    throw new Error('Output must be separate from source');
  }
  // Refuse reuse: stale files must never enter a later publication.
  if (existsSync(destination)) throw new Error('Output directory must not exist');
  const outputs = new Map();
  function load(name) {
    if (!/^[a-zA-Z0-9_./-]+$/.test(name) || name.split('/').some(p => !p || p === '.' || p === '..' || p.startsWith('.'))) {
      throw new Error('Invalid public file path');
    }
    let current = source;
    if (lstatSync(current).isSymbolicLink()) throw new Error('Symlinks cannot be published');
    for (const part of name.split('/')) {
      current = resolve(current, part);
      if (lstatSync(current).isSymbolicLink()) throw new Error('Symlinks cannot be published');
    }
    if (!lstatSync(current).isFile()) throw new Error('Expected a regular file');
    const raw = readFileSync(current);
    // Node's type stripper inserts internal sourceURL labels into the rule bundle.
    const data = name.endsWith('.js')
      ? Buffer.from(raw.toString('utf8').replace(/^\/\/[#@]\s*sourceURL=.*\r?\n?/gm, '')) : raw;
    if (privateMaterial.test(data.toString('utf8'))) throw new Error('Sensitive material or source map directive in a public file');
    return data;
  }
  for (const name of scripts) outputs.set(name, load(name));
  const match = outputs.get('content.js').toString().match(/var CONTENT = (\{.*\});/);
  if (!match) throw new Error('Unsupported content manifest');
  const content = JSON.parse(match[1]);
  const publicContentKeys = new Set(['schema_version', 'content_version', 'rules_version', 'title',
    'theme', 'ui', 'playback', 'font', 'ui_paths', 'memes', 'deck_presets']);
  if (Object.keys(content).some(key => !publicContentKeys.has(key))) {
    throw new Error('New content manifest fields need publication review');
  }
  const assets = [...Object.values(content.ui_paths), ...content.memes.flatMap(m => [m.path, ...(m.animation ? [m.animation.path] : [])])];
  for (const name of assets) {
    if (typeof name !== 'string' || !/^assets\/(?:ui|memes|animations)\/[a-zA-Z0-9_.-]+\.(?:png|jpg|jpeg)$/.test(name)) {
      throw new Error('Asset is outside the public allowlist');
    }
    outputs.set(name, load(name));
  }
  // This static site has no multiplayer backend. Keep the private source unchanged.
  const game = outputs.get('game.js').toString();
  const onlineButton = /^    button\(inWeChat \? '同 Wi-Fi 联机 · 手机房主'[^\n]*\);\r?\n/gm;
  if ([...game.matchAll(onlineButton)].length !== 1) throw new Error('Public menu export needs review');
  outputs.set('game.js', Buffer.from(game.replace(onlineButton, '')));
  outputs.set('index.html', Buffer.from(`<!doctype html>
<html lang="zh-CN"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,viewport-fit=cover">
<title>字有意思 · 网页试玩</title>
<style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#082a2b}canvas{width:100%;height:100%;display:block;touch-action:none}</style>
</head><body><canvas id="game"></canvas>
${scripts.map(name => `<script src="${name}"></script>`).join('\n')}
</body></html>
`));
  outputs.set('.nojekyll', Buffer.alloc(0));
  outputs.set('README.md', Buffer.from(`# 字有意思 · 网页试玩副本

本目录只存放自动生成的网页运行副本，不是开发工程。请通过 GitHub Pages 打开 index.html。

支持同一设备四人轮流试玩，包含字库、表情、投票及结算。此静态站点不提供跨设备联机服务。

这里的修改会被下一次同步覆盖，不会回写开发工程。浏览器必需的 JavaScript 和素材可以被查看或下载。
玩家自行导入的表情保存在玩家的浏览器本地，不参与仓库同步。
`));
  // Finish all checks before writing any output.
  for (const [name, data] of outputs) {
    const target = resolve(destination, name);
    mkdirSync(dirname(target), {recursive: true});
    writeFileSync(target, data);
  }
  return {files: outputs.size, bytes: [...outputs.values()].reduce((sum, data) => sum + data.length, 0)};
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const destination = process.argv[2] || resolve(root, 'artifacts/runtime/public-web');
  console.log(JSON.stringify(exportPublicWeb(resolve(root, 'apps/wechat-preview'), destination)));
}
