/* ------------------------------------------------------------------
 * 分享链接生成 · Worker 与控制台共用
 *
 * 由 build.mjs 分别内联进 dist/1.js 的 Worker 顶层与 admin 脚本块，
 * 因此这里是「纯函数 + 全局 function 声明」，不能写 import/export，
 * 也不能引用 window / document —— 两端都要能直接跑。
 *
 * 依赖：TextEncoder、btoa、encodeURIComponent（浏览器与 Workers 均有）。
 * 命名统一加 th 前缀，避免与两端已有的 base64 辅助函数撞名。
 * ------------------------------------------------------------------ */

function thBase64Text(value) {
  var bytes = new TextEncoder().encode(String(value === undefined || value === null ? '' : value));
  var binary = '';
  var chunk = 0x8000;
  for (var i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function thBase64Url(value) {
  return thBase64Text(value).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/* IPv6 字面量在 URI 的 authority 里必须加方括号，否则端口会被吞掉 */
function thShareHost(server) {
  var text = String(server || '');
  return text.indexOf(':') !== -1 && text.charAt(0) !== '[' ? '[' + text + ']' : text;
}

/* 单个节点 → 标准分享链接；字段缺失时按协议默认值补齐，不抛错、不生成 "undefined"。
   订阅输出只传已通过 isRenderableNode 的节点，这里再兜一层字段级容错。 */
function thShareLink(node) {
  if (!node || typeof node !== 'object') return '';
  var server = typeof node.server === 'string' ? node.server : '';
  if (!server) return '';
  var port = Number.isInteger(node.port) ? node.port : 443;
  var host = thShareHost(server);
  var name = encodeURIComponent(String(node.name || server));
  var params = [];
  var push = function (key, value) {
    if (value !== undefined && value !== null && value !== '') params.push(key + '=' + encodeURIComponent(value));
  };

  if (node.type === 'vless') {
    if (typeof node.uuid !== 'string' || !node.uuid) return '';
    var network = ['tcp', 'ws', 'grpc'].indexOf(node.network) !== -1 ? node.network : 'tcp';
    var tls = !!node.tls || !!node.reality;
    push('encryption', 'none');
    push('security', node.reality ? 'reality' : (tls ? 'tls' : 'none'));
    push('type', network);
    if (tls) push('sni', node.servername);
    if (node.fingerprint) push('fp', node.fingerprint);
    if (node.reality) {
      if (!node.publicKey) return '';
      push('pbk', node.publicKey);
      push('sid', node.shortId);
    }
    push('flow', network === 'tcp' && tls ? node.flow : '');
    if (network === 'ws') {
      push('path', node.wsPath || '/');
      push('host', node.wsHost);
    }
    if (network === 'grpc') push('serviceName', node.grpcService);
    return 'vless://' + node.uuid + '@' + host + ':' + port + '?' + params.join('&') + '#' + name;
  }

  if (node.type === 'vmess') {
    if (typeof node.uuid !== 'string' || !node.uuid) return '';
    var vmNetwork = ['tcp', 'ws', 'grpc'].indexOf(node.network) !== -1 ? node.network : 'tcp';
    var payload = {
      v: '2',
      ps: String(node.name || server),
      add: server,
      port: String(port),
      id: node.uuid,
      aid: '0',
      scy: 'auto',
      net: vmNetwork,
      type: 'none',
      host: node.wsHost || '',
      path: vmNetwork === 'grpc' ? (node.grpcService || '') : (node.wsPath || '/'),
      tls: node.tls ? 'tls' : '',
      sni: node.servername || ''
    };
    return 'vmess://' + thBase64Text(JSON.stringify(payload));
  }

  if (node.type === 'trojan') {
    if (typeof node.password !== 'string' || !node.password) return '';
    push('security', 'tls');
    push('sni', node.sni);
    if (node.skipCertVerify) push('allowInsecure', '1');
    return 'trojan://' + encodeURIComponent(node.password) + '@' + host + ':' + port +
      (params.length ? '?' + params.join('&') : '') + '#' + name;
  }

  if (node.type === 'hysteria2') {
    if (typeof node.password !== 'string' || !node.password) return '';
    push('sni', node.sni);
    if (node.skipCertVerify) push('insecure', '1');
    push('up', node.up);
    push('down', node.down);
    return 'hysteria2://' + encodeURIComponent(node.password) + '@' + host + ':' + port + '/?' +
      params.join('&') + '#' + name;
  }

  if (node.type === 'ss') {
    if (typeof node.password !== 'string' || !node.password) return '';
    var cipher = typeof node.cipher === 'string' && node.cipher ? node.cipher : 'aes-256-gcm';
    return 'ss://' + thBase64Url(cipher + ':' + node.password) + '@' + host + ':' + port + '#' + name;
  }

  return '';
}

/* 一批节点 → URI 行数组。跳过无法生成的节点而不是整份失败：
   订阅里一个坏字段不该让其他节点全部消失。 */
function thShareLines(nodes) {
  var out = [];
  if (!Array.isArray(nodes)) return out;
  for (var i = 0; i < nodes.length; i++) {
    var link = thShareLink(nodes[i]);
    if (link) out.push(link);
  }
  return out;
}
