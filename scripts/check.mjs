/**
 * 零依赖静态检查：把「语法合法但运行时才炸」的问题提前暴露。
 *
 * 覆盖：
 *  1. var 声明前使用（本次 openEditor 的 preset 就是这一类）
 *  2. let/const 在声明前使用（TDZ）
 *  3. HTML 重复 id
 *  4. JS 里 $('#id') 引用但 HTML 不存在的 id
 *  5. label[for] 指向不存在的 id
 *  6. HTML/JS 使用但 CSS 无定义的类名（视觉缺陷）
 *  7. CSS 定义但从未使用的类名（死代码）
 *  8. 同一元素同一事件重复绑定
 *
 * 用法：node scripts/check.mjs [--strict]
 *   --strict 时存在 error 级问题则退出码 1
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILES = {
  js: path.join(ROOT, 'admin/app.js'),
  html: path.join(ROOT, 'admin/index.html'),
  css: path.join(ROOT, 'admin/app.css'),
  worker: path.join(ROOT, 'src/worker.js'),
};

const read = (p) => fs.readFileSync(p, 'utf8');
const lineOf = (text, index) => text.slice(0, index).split('\n').length;

/**
 * 把注释、字符串、正则字面量的内容替换成空格（保持长度与换行），便于后续正则扫描。
 * 必须能区分「除号」与「正则起始」，否则 /['"]/ 这类正则会把后面整段代码当成字符串抹掉。
 */
const REGEX_ALLOWED_AFTER_CHAR = /[(,=:[!&|?{};+\-*%~^<>]$/;
const REGEX_ALLOWED_AFTER_WORD = new Set([
  'return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void',
  'case', 'do', 'else', 'yield', 'await', 'throw',
]);

function stripLiterals(code) {
  const out = code.split('');
  const n = code.length;
  const blank = (a, b) => {
    for (let k = a; k < b && k < n; k++) if (out[k] !== '\n') out[k] = ' ';
  };
  let i = 0;
  let prevChar = '';
  let prevWord = '';

  while (i < n) {
    const c = code[i];
    const d = code[i + 1];

    if (c === '/' && d === '/') {
      let j = i;
      while (j < n && code[j] !== '\n') j++;
      blank(i, j);
      i = j;
      continue;
    }
    if (c === '/' && d === '*') {
      let j = code.indexOf('*/', i + 2);
      j = j === -1 ? n : j + 2;
      blank(i, j);
      i = j;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      let j = i + 1;
      while (j < n) {
        if (code[j] === '\\') { j += 2; continue; }
        if (code[j] === c) { j++; break; }
        j++;
      }
      blank(i + 1, j - 1);
      i = j;
      prevChar = c;
      prevWord = '';
      continue;
    }
    if (c === '/' && (REGEX_ALLOWED_AFTER_CHAR.test(prevChar) || REGEX_ALLOWED_AFTER_WORD.has(prevWord))) {
      let j = i + 1;
      let inClass = false;
      while (j < n) {
        const ch = code[j];
        if (ch === '\\') { j += 2; continue; }
        if (ch === '\n') break;            // 未闭合，按除号处理
        if (ch === '[') inClass = true;
        else if (ch === ']') inClass = false;
        else if (ch === '/' && !inClass) { j++; break; }
        j++;
      }
      blank(i + 1, j - 1);
      i = j;
      prevChar = '/';
      prevWord = '';
      continue;
    }

    if (/[A-Za-z0-9_$]/.test(c)) {
      let j = i;
      while (j < n && /[A-Za-z0-9_$]/.test(code[j])) j++;
      prevWord = code.slice(i, j);
      prevChar = code[j - 1];
      i = j;
      continue;
    }
    if (!/\s/.test(c)) {
      prevChar = c;
      prevWord = '';
    }
    i++;
  }
  return out.join('');
}

/** 找出所有函数体范围（含匿名函数），返回 [{name, open, close, startLine}] */
function findFunctionBodies(code) {
  const bodies = [];
  const re = /\bfunction\b\s*([A-Za-z0-9_$]*)\s*\(/g;
  let m;
  while ((m = re.exec(code))) {
    // 从参数列表结束的 ) 开始找 { ... }
    let p = code.indexOf(')', re.lastIndex - 1);
    if (p === -1) continue;
    // 跳过可能存在的参数括号嵌套
    let depth = 0;
    for (let k = re.lastIndex - 1; k < code.length; k++) {
      if (code[k] === '(') depth++;
      else if (code[k] === ')') { depth--; if (depth === 0) { p = k; break; } }
    }
    const open = code.indexOf('{', p);
    if (open === -1) continue;
    let d = 0;
    let close = -1;
    for (let k = open; k < code.length; k++) {
      const ch = code[k];
      if (ch === '{') d++;
      else if (ch === '}') { d--; if (d === 0) { close = k; break; } }
    }
    if (close === -1) continue;
    bodies.push({ name: m[1] || '(anonymous)', open, close, startLine: lineOf(code, open) });
    re.lastIndex = Math.max(re.lastIndex, open);
  }
  return bodies;
}

const problems = [];
const add = (level, file, line, rule, message) => problems.push({ level, file, line, rule, message });

/** 收集所有函数参数列表的字符区间，用于排除「参数名」被误判为外层变量引用 */
function collectParamRanges(clean) {
  const ranges = [];
  const re = /\bfunction\b\s*[A-Za-z0-9_$]*\s*\(/g;
  let m;
  while ((m = re.exec(clean))) {
    const open = m.index + m[0].length - 1;
    let depth = 0;
    for (let k = open; k < clean.length; k++) {
      if (clean[k] === '(') depth++;
      else if (clean[k] === ')') {
        depth--;
        if (depth === 0) {
          ranges.push({ start: open, end: k });
          break;
        }
      }
    }
  }
  return ranges;
}

/* ---------- 1 & 2. 声明前使用 ---------- */
function checkUseBeforeDeclare(code) {
  const clean = stripLiterals(code);
  const bodies = findFunctionBodies(clean);
  const paramRanges = collectParamRanges(clean);
  const inParams = (pos) => paramRanges.some((r) => pos > r.start && pos < r.end);

  // 只看最内层函数，避免父函数变量污染子函数判断
  for (const body of bodies) {
    const inner = bodies.filter(
      (b) => b !== body && b.open > body.open && b.close < body.close
    );
    const segStart = body.open;
    const segEnd = body.close;

    const declRe = /\b(var|let|const)\s+([A-Za-z0-9_$]+)/g;
    const decls = new Map();
    let m;
    while ((m = declRe.exec(clean))) {
      if (m.index < segStart || m.index > segEnd) continue;
      if (inner.some((b) => m.index > b.open && m.index < b.close)) continue;
      const name = m[2];
      const pos = m.index + m[0].length;
      if (!decls.has(name)) decls.set(name, []);
      decls.get(name).push({ kind: m[1], pos, line: lineOf(clean, m.index) });
    }

    for (const [name, list] of decls) {
      const first = list.reduce((a, b) => (a.pos < b.pos ? a : b));
      const useRe = new RegExp(`(^|[^.\\w$])${name.replace(/\$/g, '\\$')}\\b(?!\\s*:)`, 'g');
      let u;
      while ((u = useRe.exec(clean))) {
        const pos = u.index + u[1].length;
        if (pos < segStart || pos > segEnd) continue;
        if (inner.some((b) => pos > b.open && pos < b.close)) continue;
        // 跳过声明语句自身
        if (list.some((d) => Math.abs(pos - d.pos) < name.length + 1)) continue;
        // 跳过函数参数位置（callback 参数与局部变量同名很常见，不是引用）
        if (inParams(pos)) continue;
        if (pos < first.pos) {
          add(
            'error',
            'admin/app.js',
            lineOf(clean, pos),
            'use-before-declare',
            `\`${name}\` 在第 ${lineOf(clean, pos)} 行使用，但 ${first.kind} 声明在 ${first.line} 行` +
              `（${first.kind} 提升后为 ${first.kind === 'var' ? 'undefined，读属性会抛 TypeError' : 'TDZ，直接抛 ReferenceError'}）`
          );
        }
      }
    }
  }
}

/* ---------- 3. 重复 id ---------- */
function checkDuplicateIds(html) {
  const seen = new Map();
  const re = /\bid="([^"]+)"/g;
  let m;
  while ((m = re.exec(html))) {
    const line = lineOf(html, m.index);
    if (seen.has(m[1])) {
      add('error', 'admin/index.html', line, 'duplicate-id', `id="${m[1]}" 重复（首次出现在第 ${seen.get(m[1])} 行）`);
    } else {
      seen.set(m[1], line);
    }
  }
  return new Set(seen.keys());
}

/* ---------- 4. JS 引用不存在的 id ---------- */
function checkIdRefs(js, htmlIds) {
  const refs = new Map();
  const re = /\$\('#([A-Za-z0-9_-]+)'\)/g;
  let m;
  while ((m = re.exec(js))) {
    if (!refs.has(m[1])) refs.set(m[1], lineOf(js, m.index));
  }
  for (const [id, line] of refs) {
    if (!htmlIds.has(id)) {
      add('error', 'admin/app.js', line, 'missing-id', `引用 #${id}，但 HTML 中不存在该 id`);
    }
  }
}

/* ---------- 5. label[for] ---------- */
function checkLabels(html, htmlIds) {
  const re = /<label[^>]*\bfor="([^"]+)"/g;
  let m;
  while ((m = re.exec(html))) {
    if (!htmlIds.has(m[1])) {
      add('warn', 'admin/index.html', lineOf(html, m.index), 'orphan-label', `label for="${m[1]}" 指向不存在的控件`);
    }
  }
}

/* ---------- 6 & 7. CSS 类名覆盖 ---------- */
const isCleanToken = (c) => /^[A-Za-z_][A-Za-z0-9_-]*$/.test(c);

/* 仅作语义标记 / JS 选择器锚点、本就不需要独立样式的类名 */
const SEMANTIC_ONLY = new Set([
  'alert-warning', // 警告色由 .alert 基础样式提供，此类仅作语义区分
  'proto-section', // 布局由 .form-section 提供
  'tab-panel',     // 显隐由 [hidden] 与 .links-body 控制
  'theme-icon',    // 主题按钮内的图标，尺寸由 .icon 统一
  'theme-label',   // 主题按钮内的文字
  'users-panel',   // 复用 .settings-panel 的容器样式
]);

function checkCssClasses(html, js, css) {
  const defined = new Set();
  for (const m of css.matchAll(/\.(-?[A-Za-z_][A-Za-z0-9_-]*)/g)) defined.add(m[1]);

  const used = new Set();
  const collect = (text) => {
    for (const m of text.matchAll(/class="([^"]*)"/g)) {
      // 动态拼接（class="a b-' + x + '"）无法静态解析，整体跳过
      if (/['+$]/.test(m[1])) continue;
      m[1].split(/\s+/).filter(isCleanToken).forEach((c) => used.add(c));
    }
  };
  collect(html);
  collect(js);
  for (const m of js.matchAll(/classList\.(?:add|remove|toggle)\('([A-Za-z0-9_-]+)'/g)) used.add(m[1]);

  const missing = [...used].filter((c) => !defined.has(c) && !SEMANTIC_ONLY.has(c)).sort();
  if (missing.length) {
    add('warn', 'admin/app.css', 0, 'class-without-style', `使用了但无样式定义：${missing.join(', ')}`);
  }

  // 动态拼接的类名（'avatar-' + region / `fill-${type}`）不算死代码
  const allText = html + js;
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const isDynamic = (cls) => {
    const cut = cls.lastIndexOf('-');
    if (cut <= 0) return false;
    const prefix = cls.slice(0, cut + 1);
    const p = esc(prefix);
    return new RegExp(`${p}['"\`]`).test(allText) || new RegExp(`${p}\\$`).test(allText);
  };

  const unused = [...defined]
    .filter((c) => !used.has(c) && !allText.includes(c) && !isDynamic(c))
    .sort();
  if (unused.length) {
    add('info', 'admin/app.css', 0, 'unused-class', `定义但未使用：${unused.join(', ')}`);
  }
}

/* ---------- 8. 重复绑定 ---------- */
function checkDuplicateBindings(js) {
  const seen = new Map();
  const re = /on\(el\.([A-Za-z0-9_]+),\s*'([a-z]+)'/g;
  let m;
  while ((m = re.exec(js))) {
    const key = `${m[1]}:${m[2]}`;
    if (seen.has(key)) {
      add('warn', 'admin/app.js', lineOf(js, m.index), 'duplicate-binding',
        `el.${m[1]} 的 '${m[2]}' 重复绑定（首次在第 ${seen.get(key)} 行）`);
    } else {
      seen.set(key, lineOf(js, m.index));
    }
  }
}

/* ---------- 9. 空 catch ---------- */
function checkEmptyCatch(js) {
  const clean = stripLiterals(js);
  const re = /catch\s*(?:\([^)]*\))?\s*\{\s*\}/g;
  let m;
  while ((m = re.exec(clean))) {
    // 原始代码里带注释的 catch（catch (e) { /* ignore */ }）属于显式忽略，不算问题
    const raw = js.slice(m.index, m.index + 200);
    const body = raw.match(/catch\s*(?:\([^)]*\))?\s*\{([\s\S]*?)\}/);
    if (body && body[1].trim()) continue;
    add('warn', 'admin/app.js', lineOf(clean, m.index), 'empty-catch', '空 catch 块，异常被静默吞掉');
  }
}

/* ---------- 10. el.* 缓存一致性 ---------- */
function checkElementCache(js) {
  const clean = stripLiterals(js);
  // cacheElements() 里赋值的元素
  const assigned = new Set();
  for (const m of clean.matchAll(/\bel\.([A-Za-z0-9_]+)\s*=/g)) assigned.add(m[1]);

  // 全文里读取 el.X 的地方（排除赋值左侧；前面不能是标识符字符或点，避免把 panel.dataset 当成 el.dataset）
  const usedAt = new Map();
  const re = /(?<![\w$.])el\.([A-Za-z0-9_]+)/g;
  let m;
  while ((m = re.exec(clean))) {
    const name = m[1];
    const after = clean.slice(m.index + m[0].length, m.index + m[0].length + 3);
    if (/^\s*=[^=]/.test(after)) continue; // 赋值，跳过
    if (!usedAt.has(name)) usedAt.set(name, lineOf(clean, m.index));
  }

  for (const [name, line] of usedAt) {
    if (!assigned.has(name)) {
      add('error', 'admin/app.js', line, 'unknown-el',
        `el.${name} 从未在 cacheElements() 中赋值，运行时为 undefined（读取其属性会抛错）`);
    }
  }
}

/* ---------- 11. worker 侧常量 ---------- */
function checkWorker(worker) {
  if (!/VERSION\s*=\s*'[^']+'/.test(worker)) {
    add('warn', 'src/worker.js', 0, 'missing-version', '未找到 VERSION 常量');
  }
}

/* ---------- 自测：确认检测器本身有效 ---------- */
function selftest() {
  const cases = [
    {
      name: 'var 声明前使用（本次 openEditor 的 preset）',
      code: `
function demo(el, preset) {
  setField(el.port, preset.vlessPort || 443);
  var preset2 = { vlessPort: 443 };
  return preset2;
}
function demo2() {
  return later + 1;
  var later = 2;
}`,
      rule: 'use-before-declare',
      fn: checkUseBeforeDeclare,
    },
    {
      name: 'let/const TDZ',
      code: `
function tdz() {
  var x = flag ? 1 : 0;
  var flag = true;
  return x;
}`,
      rule: 'use-before-declare',
      fn: checkUseBeforeDeclare,
    },
    {
      name: 'el.X 从未缓存（toastStack 那类）',
      code: `
function cacheElements() {
  el.toasts = $('#toasts');
}
function toast() {
  if (el.toastStack) el.toastStack.appendChild(node);
}`,
      rule: 'unknown-el',
      fn: checkElementCache,
    },
  ];

  let failed = 0;
  for (const c of cases) {
    problems.length = 0;
    c.fn(c.code);
    const hit = problems.some((p) => p.rule === c.rule);
    if (!hit) {
      console.log(`  ✗ 自测失败：${c.name}（未检出 ${c.rule}）`);
      failed++;
    } else {
      console.log(`  ✓ ${c.name}`);
    }
  }

  // 反向用例：正常代码不应误报
  problems.length = 0;
  checkUseBeforeDeclare(`
function ok() {
  var preset = { vlessPort: 443 };
  return preset.vlessPort;
}
function dup(nodes) {
  return nodes.some(function (node) { return node.id; });
}`);
  checkElementCache(`
function cacheElements() {
  el.toasts = $('#toasts');
}
function use() {
  el.toasts.appendChild(node);
  var panel = document.body;
  panel.dataset.view = 'x';
}`);
  if (problems.length) {
    console.log('  ✗ 自测失败：正常代码被误报 → ' + problems.map((p) => p.rule + '@' + p.line).join(', '));
    failed++;
  } else {
    console.log('  ✓ 正常代码无误报（含 callback 参数同名、panel.dataset）');
  }

  problems.length = 0;
  return failed;
}

if (process.argv.includes('--selftest')) {
  console.log('\n检查器自测\n' + '─'.repeat(64));
  const failed = selftest();
  console.log('─'.repeat(64));
  console.log(failed ? `  ${failed} 项失败\n` : '  全部通过\n');
  process.exit(failed ? 1 : 0);
}

/* ---------- 12. 表单错误锚点 ---------- */
function checkErrorAnchors(js, html) {
  const anchors = new Set();
  const anchorCount = new Map();
  for (const m of html.matchAll(/data-error="([^"]+)"/g)) {
    anchors.add(m[1]);
    anchorCount.set(m[1], (anchorCount.get(m[1]) || 0) + 1);
  }
  const userAnchors = new Set([...html.matchAll(/data-user-error="([^"]+)"/g)].map((m) => m[1]));

  const keys = new Map();
  const record = (key, index) => {
    if (!keys.has(key)) keys.set(key, lineOf(js, index));
  };
  for (const m of js.matchAll(/errors\.push\(\{\s*key:\s*'([^']+)'/g)) record(m[1], m.index);
  for (const m of js.matchAll(/(?:requiredError|optionalError|hostError|bandwidthError|optionalHost)\([^,]+,\s*'([^']+)'/g)) {
    record(m[1], m.index);
  }

  for (const [key, line] of keys) {
    if (!anchors.has(key) && !userAnchors.has(key)) {
      add('warn', 'admin/app.js', line, 'missing-error-anchor',
        `校验 key \`${key}\` 没有对应的 data-error 锚点，字段不会标红，提示只落在全局框`);
    }
  }

  // 同一 key 多个锚点：$() 只取第一个，跨表单时会标错字段
  for (const [key, count] of anchorCount) {
    if (count > 1) {
      add('error', 'admin/index.html', 0, 'duplicate-error-anchor',
        `data-error="${key}" 出现 ${count} 次，$() 只会命中第一个，另一个表单的错误会标错位置`);
    }
  }
}

/* ---------- run ---------- */
const js = read(FILES.js);
const html = read(FILES.html);
const css = read(FILES.css);
const worker = read(FILES.worker);

checkUseBeforeDeclare(js);
const ids = checkDuplicateIds(html);
checkIdRefs(js, ids);
checkLabels(html, ids);
checkCssClasses(html, js, css);
checkDuplicateBindings(js);
checkEmptyCatch(js);
checkElementCache(js);
checkErrorAnchors(js, html);
checkWorker(worker);

const order = { error: 0, warn: 1, info: 2 };
problems.sort((a, b) => order[a.level] - order[b.level] || a.file.localeCompare(b.file) || a.line - b.line);

const counts = { error: 0, warn: 0, info: 0 };
problems.forEach((p) => counts[p.level]++);

const icon = { error: '✗', warn: '!', info: '·' };
console.log('\nTransit Hub 静态检查\n' + '─'.repeat(64));
if (!problems.length) {
  console.log('  未发现问题');
} else {
  let lastRule = '';
  for (const p of problems) {
    if (p.rule !== lastRule) {
      console.log(`\n[${p.rule}]`);
      lastRule = p.rule;
    }
    const loc = p.line ? `${p.file}:${p.line}` : p.file;
    console.log(`  ${icon[p.level]} ${loc}  ${p.message}`);
  }
}
console.log('\n' + '─'.repeat(64));
console.log(`  ${counts.error} error · ${counts.warn} warn · ${counts.info} info\n`);

if (process.argv.includes('--strict') && counts.error > 0) process.exit(1);
