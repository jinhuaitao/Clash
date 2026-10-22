(function () {
  'use strict';

  var STORAGE_KEY = 'th.admin.token';
  var THEME_KEY = 'th.theme';
  var MAIN_GROUP = '🌍选择节点';
  var MAX_NODES = 300;

  var REGION_META = {
    us: { group: '🇺🇸欧美节点', short: '欧美', flag: '🇺🇸' },
    jp: { group: '🇯🇵日韩节点', short: '日韩', flag: '🇯🇵' },
    hk: { group: '🇭🇰港台节点', short: '港台', flag: '🇭🇰' },
    relay: { group: '📶中转节点', short: '中转', flag: '📶' },
    other: { group: MAIN_GROUP, short: '未分组', flag: '🌐' }
  };
  var REGION_ORDER = ['us', 'jp', 'hk', 'relay', 'other'];

  var TYPE_META = {
    vless: { label: 'VLESS', color: '#4f46e5' },
    hysteria2: { label: 'Hysteria2', color: '#db2777' },
    trojan: { label: 'Trojan', color: '#d97706' },
    vmess: { label: 'VMess', color: '#0891b2' },
    ss: { label: 'Shadowsocks', color: '#059669' }
  };
  var TYPE_ORDER = ['vless', 'hysteria2', 'trojan', 'vmess', 'ss'];

  var TAG_META = {
    chatgpt: { emoji: '💬', label: 'ChatGPT' },
    google: { emoji: 'Ⓖ', label: 'Google' },
    youtube: { emoji: '📺', label: 'YouTube' },
    telegram: { emoji: '📲', label: 'Telegram' }
  };
  var TAG_ORDER = ['chatgpt', 'google', 'youtube', 'telegram'];

  var RESERVED_NAMES = new Set([
    MAIN_GROUP, '🇺🇸欧美节点', '🇯🇵日韩节点', '🇭🇰港台节点', '📶中转节点',
    '💬ChatGPT', 'ⒼGoogle', '📺YOUTUBE', '📲 电报信息',
    'DIRECT', 'REJECT', 'REJECT-DROP', 'PASS', 'GLOBAL'
  ]);

  var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  var HOST_RE = /^[A-Za-z0-9._%:\-\[\]]+$/;
  var BANDWIDTH_RE = /^\d{1,6}(?:\.\d{1,2})?\s*(kbps|mbps|gbps)$/i;
  var CONTROL_RE = /[\u0000-\u001f\u007f]/;

  var VIEW_META = {
    overview: '概览',
    nodes: '节点管理',
    preview: '订阅预览',
    settings: '参数预设'
  };

  var state = {
    token: '',
    config: null,
    meta: null,
    rev: 0,
    view: 'overview',
    query: '',
    filterType: 'all',
    filterRegion: 'all',
    preview: '',
    previewDirty: true,
    previewLoading: false,
    previewPromise: null,
    editingId: null,
    deletingId: null,
    formType: 'vless',
    subRevealed: false,
    mutating: false
  };

  var el = {};

  function $(selector, root) {
    return (root || document).querySelector(selector);
  }

  function $$(selector, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(selector));
  }

  var ESC_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

  function esc(value) {
    return String(value === null || value === undefined ? '' : value).replace(/[&<>"']/g, function (char) {
      return ESC_MAP[char];
    });
  }

  function icon(name, className) {
    return '<svg class="' + (className || 'icon') + '" aria-hidden="true"><use href="#i-' + name + '"></use></svg>';
  }

  function storageGet(store, key) {
    try {
      return (store === 'local' ? window.localStorage : window.sessionStorage).getItem(key);
    } catch (err) {
      return null;
    }
  }

  function storageSet(store, key, value) {
    try {
      if (store === 'local') window.localStorage.setItem(key, value);
      else window.sessionStorage.setItem(key, value);
    } catch (err) {
      /* storage unavailable */
    }
  }

  function storageRemove(store, key) {
    try {
      if (store === 'local') window.localStorage.removeItem(key);
      else window.sessionStorage.removeItem(key);
    } catch (err) {
      /* storage unavailable */
    }
  }

  function randomId() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return 'n_' + window.crypto.randomUUID();
    }
    return 'n_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
  }

  function generateUuid() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return window.crypto.randomUUID();
    }
    var bytes = new Uint8Array(16);
    window.crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    var hex = Array.prototype.map.call(bytes, function (byte) {
      return byte.toString(16).padStart(2, '0');
    });
    return hex.slice(0, 4).join('') + '-' + hex.slice(4, 6).join('') + '-' + hex.slice(6, 8).join('') + '-' +
      hex.slice(8, 10).join('') + '-' + hex.slice(10, 16).join('');
  }

  function generatePassword(length) {
    var alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
    var bytes = new Uint8Array(length || 18);
    window.crypto.getRandomValues(bytes);
    var out = '';
    for (var i = 0; i < bytes.length; i++) out += alphabet[bytes[i] % alphabet.length];
    return out;
  }

  function formatShort(value) {
    if (!value) return '';
    var date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return new Intl.DateTimeFormat('zh-CN', {
      month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false
    }).format(date).replace(/\//g, '-');
  }

  function formatFull(value) {
    if (!value) return '';
    var date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return new Intl.DateTimeFormat('zh-CN', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false
    }).format(date).replace(/\//g, '-');
  }

  class ApiError extends Error {
    constructor(message, status, data, field) {
      super(message);
      this.name = 'ApiError';
      this.status = status || 0;
      this.data = data || null;
      this.field = field || null;
    }
  }

  async function request(path, options) {
    var opts = options || {};
    var headers = { authorization: 'Bearer ' + state.token };
    if (opts.body !== undefined) headers['content-type'] = 'application/json';
    var response;
    try {
      response = await fetch(path, {
        method: opts.method || 'GET',
        headers: headers,
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
        cache: 'no-store'
      });
    } catch (err) {
      throw new ApiError('网络请求失败，请检查连接后重试', 0);
    }

    if (response.status === 401) {
      var unauthorized = await safeJson(response);
      throw new ApiError((unauthorized && unauthorized.error) || '登录已失效，请重新验证', 401, unauthorized);
    }

    if (!response.ok) {
      var data = await safeJson(response);
      throw new ApiError(
        (data && data.error) || ('请求失败（HTTP ' + response.status + '）'),
        response.status,
        data,
        data && data.field
      );
    }

    if (opts.raw) return await response.text();
    return await response.json();
  }

  async function safeJson(response) {
    try {
      return await response.json();
    } catch (err) {
      return null;
    }
  }

  function cacheElements() {
    el.authScreen = $('#auth-screen');
    el.app = $('#app');
    el.loginForm = $('#login-form');
    el.loginToken = $('#login-token');
    el.loginReveal = $('#login-reveal');
    el.loginError = $('#login-error');
    el.loginBtn = $('#login-btn');
    el.loginLabel = $('.btn-label', el.loginBtn);
    el.loginSpinner = $('.spinner', el.loginBtn);

    el.navItems = $$('.nav-item[data-view]');
    el.views = $$('.view[data-view-panel]');
    el.crumb = $('#crumb');
    el.navCount = $('#nav-count');
    el.modePill = $('#mode-pill');
    el.modePillText = $('#mode-pill-text');
    el.topCopy = $('#top-copy');
    el.topAdd = $('#top-add');

    el.kvAlert = $('#kv-alert');
    el.corruptAlert = $('#corrupt-alert');
    el.kvHelpBtn = $('#kv-help-btn');
    el.overviewUpdated = $('#overview-updated');
    el.heroStatusText = $('#hero-status-text');
    el.heroVersion = $('.hero-version');
    el.heroNodeCount = $('#hero-node-count');
    el.subUrlText = $('#sub-url-text');
    el.subReveal = $('#sub-reveal');
    el.subCopy = $('#sub-copy');
    el.subCard = $('.sub-card');

    el.statTotal = $('#stat-total');
    el.statEnabled = $('#stat-enabled');
    el.statTypes = $('#stat-types');
    el.statRegions = $('#stat-regions');
    el.statEnabledBadge = $('#stat-enabled-badge');
    el.statTypesHint = $('#stat-types-hint');
    el.protoTotal = $('#proto-total');
    el.protoBars = $('#proto-bars');
    el.regionBars = $('#region-bars');
    el.recentNodes = $('#recent-nodes');
    el.sysKv = $('#sys-kv');
    el.sysAuth = $('#sys-auth');
    el.sysRev = $('#sys-rev');
    el.sysUpdated = $('#sys-updated');
    el.sysHealth = $('#sys-health');
    el.authHint = $('#auth-hint');

    el.storageCard = $('#storage-card');
    el.storageDot = $('#storage-dot');
    el.storageLabel = $('#storage-label');
    el.storageHint = $('#storage-hint-text');
    el.kvHelpSide = $('#kv-help-side');
    el.themeToggle = $('#theme-toggle');
    el.mobileTheme = $('#mobile-theme');
    el.logout = $('#logout');
    el.mobileLogout = $('#mobile-logout');

    el.nodesCopy = $('#nodes-copy');
    el.nodesAdd = $('#nodes-add');
    el.nodeSearch = $('#node-search');
    el.filterType = $('#filter-type');
    el.filterRegion = $('#filter-region');
    el.filterReset = $('#filter-reset');
    el.nodeCountLabel = $('#node-count-label');
    el.nodeHead = $('.node-head');
    el.nodeList = $('#node-list');
    el.nodeEmpty = $('#node-empty');
    el.nodeEmptyFilter = $('#node-empty-filter');
    el.emptyAdd = $('#empty-add');
    el.emptyReset = $('#empty-reset');

    el.heroAdd = $('#hero-add');
    el.heroPreview = $('#hero-preview');
    el.previewRefresh = $('#preview-refresh');
    el.previewDownload = $('#preview-download');
    el.previewCopy = $('#preview-copy');
    el.previewSubUrl = $('#preview-sub-url');
    el.previewCopySub = $('#preview-copy-sub');
    el.yamlCode = $('#yaml-code');
    el.codeLoading = $('#code-loading');
    el.codeLines = $('#code-lines');
    el.codeSize = $('#code-size');

    el.drawerLayer = $('#drawer-layer');
    el.drawerTitle = $('#drawer-title');
    el.drawerSub = $('#drawer-sub');
    el.nodeForm = $('#node-form');
    el.nodeSave = $('#node-save');
    el.nodeSaveLabel = $('.btn-label', el.nodeSave);
    el.nodeSaveSpinner = $('.spinner', el.nodeSave);
    el.formGlobalError = $('#form-global-error');
    el.typeGrid = $('#type-grid');
    el.tagGrid = $('#tag-grid');
    el.realityRow = $('#reality-row');
    el.realityFields = $('#reality-fields');
    el.tlsFields = $('#tls-fields');
    el.flowField = $('#flow-field');
    el.wsFields = $('#ws-fields');
    el.grpcFields = $('#grpc-fields');
    el.vmTlsField = $('#vm-tls-field');
    el.vmWsFields = $('#vm-ws-fields');
    el.vmGrpcFields = $('#vm-grpc-fields');

    el.fieldName = $('#f-name');
    el.fieldRegion = $('#f-region');
    el.fieldServer = $('#f-server');
    el.fieldPort = $('#f-port');
    el.fieldEnabled = $('#f-enabled');
    el.fieldShowMain = $('#f-show-main');

    el.settingsForm = $('#settings-form');
    el.setUuid = $('#set-uuid');
    el.setPbk = $('#set-pbk');
    el.setSid = $('#set-sid');
    el.setSni = $('#set-sni');
    el.settingsSave = $('#settings-save');
    el.settingsSaveLabel = $('.btn-label', el.settingsSave);
    el.settingsSaveSpinner = $('.spinner', el.settingsSave);
    el.settingsGlobalError = $('#settings-global-error');
    el.settingsClear = $('#settings-clear');

    el.fieldUuid = $('#f-uuid');
    el.fieldTls = $('#f-tls');
    el.fieldReality = $('#f-reality');
    el.fieldPbk = $('#f-pbk');
    el.fieldSid = $('#f-sid');
    el.fieldSni = $('#f-sni');
    el.fieldFp = $('#f-fp');
    el.fieldFlow = $('#f-flow');
    el.fieldWsPath = $('#f-wspath');
    el.fieldWsHost = $('#f-wshost');
    el.fieldGrpc = $('#f-grpc');
    el.fieldUdp = $('#f-udp');
    el.networkBox = $('#f-network');

    el.vmUuid = $('#f-vm-uuid');
    el.vmNetworkBox = $('#f-vm-network');
    el.vmTls = $('#f-vm-tls');
    el.vmSni = $('#f-vm-sni');
    el.vmWsPath = $('#f-vm-wspath');
    el.vmWsHost = $('#f-vm-wshost');
    el.vmGrpc = $('#f-vm-grpc');
    el.vmUdp = $('#f-vm-udp');

    el.trPassword = $('#f-tr-password');
    el.trSni = $('#f-tr-sni');
    el.trSkip = $('#f-tr-skip');
    el.trUdp = $('#f-tr-udp');

    el.hyPassword = $('#f-hy-password');
    el.hySni = $('#f-hy-sni');
    el.hyUp = $('#f-hy-up');
    el.hyDown = $('#f-hy-down');
    el.hySkip = $('#f-hy-skip');

    el.ssCipher = $('#f-ss-cipher');
    el.ssPassword = $('#f-ss-password');
    el.ssUdp = $('#f-ss-udp');

    el.confirmLayer = $('#confirm-layer');
    el.confirmName = $('#confirm-name');
    el.confirmDelete = $('#confirm-delete');
    el.kvLayer = $('#kv-layer');
    el.kvCopyName = $('#kv-copy-name');
    el.toasts = $('#toasts');
    el.themeColor = $('meta[name="theme-color"]');
  }

  /* ------------------------------------------------------------------ */
  /* theme                                                               */
  /* ------------------------------------------------------------------ */

  function currentTheme() {
    return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
  }

  function applyThemeUi() {
    var dark = currentTheme() === 'dark';
    var href = dark ? '#i-sun' : '#i-moon';
    if (el.themeToggle) {
      var themeIcon = $('.theme-icon use', el.themeToggle);
      if (themeIcon) themeIcon.setAttribute('href', href);
      var themeLabel = $('.theme-label', el.themeToggle);
      if (themeLabel) themeLabel.textContent = dark ? '浅色模式' : '深色模式';
      el.themeToggle.setAttribute('aria-label', dark ? '切换到浅色模式' : '切换到深色模式');
    }
    if (el.mobileTheme) {
      var mobileIcon = $('use', el.mobileTheme);
      if (mobileIcon) mobileIcon.setAttribute('href', href);
      el.mobileTheme.setAttribute('aria-label', dark ? '切换到浅色模式' : '切换到深色模式');
    }
    if (el.themeColor) el.themeColor.setAttribute('content', dark ? '#070b14' : '#f5f6fa');
  }

  function toggleTheme() {
    var next = currentTheme() === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    storageSet('local', THEME_KEY, next);
    applyThemeUi();
  }

  /* ------------------------------------------------------------------ */
  /* auth                                                                */
  /* ------------------------------------------------------------------ */

  function setLoginBusy(busy) {
    el.loginBtn.disabled = busy;
    el.loginBtn.classList.toggle('is-loading', busy);
    el.loginSpinner.hidden = !busy;
    el.loginLabel.textContent = busy ? '正在验证…' : '进入控制台';
  }

  function showLoginError(message) {
    el.loginError.textContent = message || '';
    el.loginError.hidden = !message;
  }

  async function authenticate(token, fromStorage) {
    var clean = String(token || '').trim();
    if (!clean) {
      showLoginError('请输入管理令牌以继续。');
      el.loginToken.focus();
      return false;
    }
    setLoginBusy(true);
    showLoginError('');
    state.token = clean;
    try {
      var data = await request('/api/config');
      if (!data || !data.config || !Array.isArray(data.config.nodes)) {
        throw new ApiError('接口返回数据异常，请确认 Worker 版本是否正确', 0);
      }
      storageSet('session', STORAGE_KEY, clean);
      applyConfig(data);
      enterApp();
      return true;
    } catch (err) {
      state.token = '';
      storageRemove('session', STORAGE_KEY);
      if (err.status === 401) {
        showLoginError('令牌无效。请确认输入的是部署时设置的 ADMIN_TOKEN；若未单独设置，则为 AUTH_TOKEN。');
      } else {
        showLoginError(err.message || '登录失败，请稍后重试。');
      }
      if (!fromStorage) {
        el.loginToken.focus();
        el.loginToken.select();
      }
      return false;
    } finally {
      setLoginBusy(false);
    }
  }

  function enterApp() {
    el.authScreen.hidden = true;
    el.app.hidden = false;
    state.view = 'overview';
    resetFilters();
    renderAll();
    switchView('overview');
  }

  function logout(message) {
    state.token = '';
    state.config = null;
    state.meta = null;
    state.rev = 0;
    state.preview = '';
    state.previewDirty = true;
    state.previewPromise = null;
    state.previewLoading = false;
    state.subRevealed = false;
    state.mutating = false;
    state.query = '';
    state.filterType = 'all';
    state.filterRegion = 'all';
    state.editingId = null;
    state.deletingId = null;
    storageRemove('session', STORAGE_KEY);
    closeDrawer(true);
    closeModal('confirm', true);
    closeModal('kv', true);
    el.app.hidden = true;
    el.authScreen.hidden = false;
    el.loginToken.value = '';
    setLoginBusy(false);
    el.subUrlText.textContent = '—';
    el.previewSubUrl.textContent = '—';
    el.yamlCode.innerHTML = '';
    el.codeLines.textContent = '0 行';
    el.codeSize.textContent = '0 KB';
    el.nodeList.innerHTML = '';
    if (message) showLoginError(message);
    else showLoginError('');
    window.setTimeout(function () { el.loginToken.focus(); }, 60);
  }

  function handleUnauthorized() {
    logout('登录已失效，请重新输入管理令牌。');
  }

  function applyConfig(data) {
    state.config = data.config;
    state.rev = Number(data.config.rev) || 0;
    state.meta = data.meta || {};
    state.previewDirty = true;
  }

  /* ------------------------------------------------------------------ */
  /* rendering                                                           */
  /* ------------------------------------------------------------------ */

  function nodes() {
    return state.config && Array.isArray(state.config.nodes) ? state.config.nodes : [];
  }

  function enabledNodes() {
    return nodes().filter(function (node) { return node.enabled; });
  }

  function renderAll() {
    renderChrome();
    renderOverview();
    renderNodeList();
    renderSubUrls();
  }

  function renderChrome() {
    var meta = state.meta || {};
    var enabled = enabledNodes();
    var total = nodes().length;

    el.navCount.textContent = String(total);
    el.modePill.classList.add('is-warning');
    if (!meta.kv || meta.readonly) {
      el.modePillText.textContent = '只读模式';
    } else if (meta.corrupted) {
      el.modePillText.textContent = '配置异常';
    } else {
      el.modePill.classList.remove('is-warning');
      el.modePillText.textContent = enabled.length + ' 节点在线';
    }

    var kvMissing = !meta.kv || meta.readonly;
    el.storageDot.classList.toggle('is-warning', kvMissing || !!meta.corrupted);
    el.storageLabel.textContent = kvMissing ? '只读模式' : (meta.corrupted ? '配置异常' : 'KV 已连接');
    el.storageHint.textContent = kvMissing ? '点击查看 KV 绑定步骤' : '配置已持久化';
    el.kvAlert.hidden = !kvMissing;
    el.corruptAlert.hidden = !meta.corrupted;
    el.heroNodeCount.textContent = String(enabled.length);
    el.heroStatusText.textContent = kvMissing
      ? '只读预览 · 尚未连接存储'
      : (meta.corrupted ? '配置异常 · 当前载入默认节点' : '订阅服务运行中');
    if (el.heroVersion) el.heroVersion.textContent = 'v' + (meta.version || '2.0.0');
  }

  function renderOverview() {
    if (!state.config) return;
    var list = nodes();
    var enabled = enabledNodes();
    var meta = state.meta || {};
    var typeCounts = {};
    TYPE_ORDER.forEach(function (type) { typeCounts[type] = 0; });
    enabled.forEach(function (node) {
      if (typeCounts[node.type] !== undefined) typeCounts[node.type] += 1;
    });
    var activeTypes = TYPE_ORDER.filter(function (type) { return typeCounts[type] > 0; });
    var regionCounts = {};
    enabled.forEach(function (node) {
      var region = REGION_META[node.region] ? node.region : 'other';
      regionCounts[region] = (regionCounts[region] || 0) + 1;
    });
    var regionBuckets = REGION_ORDER.filter(function (key) {
      return key !== 'other' && regionCounts[key];
    });
    var activeGroups = 1 + regionBuckets.length + 4;

    el.statTotal.textContent = String(list.length);
    el.statEnabled.textContent = String(enabled.length);
    el.statTypes.textContent = String(activeTypes.length);
    el.statRegions.textContent = String(activeGroups);
    el.statEnabledBadge.textContent = list.length
      ? Math.round((enabled.length / list.length) * 100) + '%'
      : '在线';
    el.statTypesHint.textContent = '协议';

    el.overviewUpdated.textContent = state.config.updatedAt
      ? '更新于 ' + formatShort(state.config.updatedAt)
      : '尚未写入配置';

    if (!enabled.length) {
      el.protoBars.innerHTML = '<div class="bar-empty">还没有启用的节点</div>';
    } else {
      el.protoBars.innerHTML = TYPE_ORDER.map(function (type) {
        var count = typeCounts[type] || 0;
        var percent = Math.round((count / enabled.length) * 100);
        return '<div class="bar-row">' +
          '<span class="bar-label"><span class="type-dot" style="background:' + TYPE_META[type].color + '"></span><b>' + TYPE_META[type].label + '</b></span>' +
          '<span class="bar-track"><span class="bar-fill fill-' + type + '" style="width:' + percent + '%"></span></span>' +
          '<span class="bar-count">' + count + '</span>' +
          '</div>';
      }).join('');
    }
    el.protoTotal.textContent = enabled.length + ' 在线';

    var regionRows = REGION_ORDER.filter(function (key) {
      return key !== 'other' || regionCounts.other;
    }).filter(function (key) {
      return regionCounts[key];
    });
    if (!regionRows.length) {
      el.regionBars.innerHTML = '<div class="bar-empty">暂无分组数据</div>';
    } else {
      el.regionBars.innerHTML = regionRows.map(function (key) {
        var count = regionCounts[key] || 0;
        var percent = Math.round((count / enabled.length) * 100);
        var region = REGION_META[key];
        return '<div class="bar-row">' +
          '<span class="bar-label"><span class="type-dot" style="background:' + regionColor(key) + '"></span><b>' + esc(region.group) + '</b></span>' +
          '<span class="bar-track"><span class="bar-fill fill-' + key + '" style="width:' + percent + '%"></span></span>' +
          '<span class="bar-count">' + count + '</span>' +
          '</div>';
      }).join('');
    }

    var recent = enabled.concat(list.filter(function (node) { return !node.enabled; })).slice(0, 4);
    if (!recent.length) {
      el.recentNodes.innerHTML = '<div class="bar-empty">暂无节点</div>';
    } else {
      el.recentNodes.innerHTML = recent.map(function (node) {
        var region = REGION_META[node.region] || REGION_META.other;
        var type = TYPE_META[node.type] || { label: node.type };
        var disabled = node.enabled ? '' : ' <span class="mini-badge">停用</span>';
        return '<button class="mini-item" type="button" data-edit-id="' + esc(node.id) + '">' +
          '<span class="mini-avatar avatar-' + esc(node.region) + '">' + region.flag + '</span>' +
          '<span class="mini-main"><span class="mini-name">' + esc(node.name) + disabled + '</span>' +
          '<span class="mini-sub">' + esc(type.label) + ' · ' + esc(node.server) + '</span></span>' +
          '<span class="type-badge t-' + esc(node.type) + '"><span class="dot"></span>' + esc(type.label) + '</span>' +
          '</button>';
      }).join('');
    }

    var kvMissing = !meta.kv || meta.readonly;
    el.sysKv.textContent = kvMissing ? '未绑定 · 只读' : '已连接';
    el.sysKv.className = 'kv-val ' + (kvMissing ? 'is-warning' : 'is-ok');
    el.sysAuth.textContent = meta.authMode === 'dedicated' ? '独立管理令牌' : '与订阅令牌共用';
    el.sysRev.textContent = '#' + state.rev;
    el.sysUpdated.textContent = state.config.updatedAt ? formatFull(state.config.updatedAt) : '尚未保存';
    el.authHint.hidden = meta.authMode === 'dedicated' || !meta.hasAuthToken;

    var healthy = !kvMissing && !meta.corrupted;
    el.sysHealth.textContent = meta.corrupted ? '需注意' : (kvMissing ? '只读' : '正常');
    el.sysHealth.classList.toggle('soft-ok', healthy);

    renderSubUrls();
  }

  function regionColor(key) {
    var colors = { us: '#4f46e5', jp: '#db2777', hk: '#0891b2', relay: '#d97706', other: '#64748b' };
    return colors[key] || colors.other;
  }

  function maskToken(url) {
    if (!url) return '';
    return url.replace(/([?&]token=)[^&#]*/, function (match, prefix) {
      return prefix + '••••••••';
    });
  }

  function subUrlValue() {
    if (!state.meta || !state.meta.subUrl) return '';
    return state.meta.subUrl;
  }

  function renderSubUrls() {
    var url = subUrlValue();
    var display = url
      ? (state.subRevealed ? url : maskToken(url))
      : '服务端未配置 AUTH_TOKEN';
    if (el.subUrlText) el.subUrlText.textContent = display;
    if (el.previewSubUrl) el.previewSubUrl.textContent = display;
    if (el.subReveal) {
      var use = $('use', el.subReveal);
      if (use) use.setAttribute('href', state.subRevealed ? '#i-eye-off' : '#i-eye');
      el.subReveal.setAttribute('aria-label', state.subRevealed ? '隐藏令牌' : '显示令牌');
      el.subReveal.title = state.subRevealed ? '隐藏令牌' : '显示令牌';
      el.subReveal.disabled = !url;
    }
    if (el.subCopy) el.subCopy.disabled = !url;
    if (el.previewCopySub) el.previewCopySub.disabled = !url;
  }

  function renderNodeList() {
    if (!state.config) return;
    var all = nodes();
    var query = state.query.trim().toLowerCase();
    var filtered = all.filter(function (node) {
      if (state.filterType !== 'all' && node.type !== state.filterType) return false;
      if (state.filterRegion !== 'all' && node.region !== state.filterRegion) return false;
      if (!query) return true;
      var type = TYPE_META[node.type] || { label: node.type };
      var region = REGION_META[node.region] || REGION_META.other;
      var tagText = (node.tags || []).map(function (tag) {
        return TAG_META[tag] ? TAG_META[tag].label : tag;
      }).join(' ');
      var haystack = [node.name, node.server, node.type, type.label, region.short, region.group, tagText].join(' ').toLowerCase();
      return haystack.indexOf(query) !== -1;
    });

    el.nodeCountLabel.textContent = query || state.filterType !== 'all' || state.filterRegion !== 'all'
      ? filtered.length + ' / ' + all.length + ' 个节点'
      : '共 ' + all.length + ' 个节点';

    el.nodeHead.hidden = all.length === 0;
    el.nodeEmpty.hidden = all.length !== 0;
    el.nodeEmptyFilter.hidden = !(all.length > 0 && filtered.length === 0);
    el.nodeList.hidden = filtered.length === 0;

    var sortable = !query && state.filterType === 'all' && state.filterRegion === 'all';
    el.nodeList.innerHTML = filtered.map(function (node, index) {
      return renderNodeRow(node, index, filtered.length, sortable);
    }).join('');
  }

  function renderNodeRow(node, index, total, sortable) {
    var region = REGION_META[node.region] || REGION_META.other;
    var type = TYPE_META[node.type] || { label: node.type };
    var tags = (node.tags || []).filter(function (tag) { return TAG_META[tag]; });
    var tagHtml = tags.length
      ? '<div class="node-sub">' + tags.map(function (tag) {
        return '<span class="app-chip" title="' + esc(TAG_META[tag].label) + '">' + TAG_META[tag].emoji + '</span>';
      }).join('') + '</div>'
      : '';

    var badges = '';
    if (!node.enabled) badges += '<span class="mini-badge">已停用</span>';
    if (node.showInMain === false) badges += '<span class="mini-badge">不入🌍</span>';

    var moveHtml = '';
    if (sortable) {
      moveHtml =
        '<button class="icon-btn move-btn" type="button" data-move-id="' + esc(node.id) + '" data-dir="-1" title="上移" aria-label="上移节点"' + (index === 0 ? ' disabled' : '') + '>' + icon('arrow-up') + '</button>' +
        '<button class="icon-btn move-btn" type="button" data-move-id="' + esc(node.id) + '" data-dir="1" title="下移" aria-label="下移节点"' + (index === total - 1 ? ' disabled' : '') + '>' + icon('arrow-down') + '</button>';
    }

    return '<div class="node-row' + (node.enabled ? '' : ' is-disabled') + '" data-id="' + esc(node.id) + '" tabindex="0" role="button" aria-label="编辑节点 ' + esc(node.name) + '">' +
      '<div class="cell cell-node">' +
        '<span class="node-avatar avatar-' + esc(node.region) + '">' + region.flag + '</span>' +
        '<div class="node-main">' +
          '<div class="node-name"><span>' + esc(node.name) + '</span>' + badges + '</div>' +
          tagHtml +
        '</div>' +
      '</div>' +
      '<div class="cell cell-server">' +
        '<code>' + esc(node.server) + '</code><span class="port">:' + esc(node.port) + '</span>' +
        '<button class="copy-mini" type="button" data-copy-id="' + esc(node.id) + '" title="复制服务器地址" aria-label="复制服务器地址">' + icon('copy') + '</button>' +
      '</div>' +
      '<div class="cell cell-type"><span class="type-badge t-' + esc(node.type) + '"><span class="dot"></span>' + esc(type.label) + '</span></div>' +
      '<div class="cell cell-region"><span class="region-chip">' + region.flag + ' ' + esc(region.short) + '</span></div>' +
      '<div class="cell cell-status"><button class="switch" type="button" role="switch" data-toggle-id="' + esc(node.id) + '" aria-checked="' + (node.enabled ? 'true' : 'false') + '" aria-label="' + (node.enabled ? '停用节点' : '启用节点') + '"></button></div>' +
      '<div class="cell cell-actions">' +
        moveHtml +
        '<button class="icon-btn" type="button" data-edit-id="' + esc(node.id) + '" title="编辑" aria-label="编辑节点">' + icon('pen') + '</button>' +
        '<button class="icon-btn" type="button" data-dup-id="' + esc(node.id) + '" title="创建副本" aria-label="创建节点副本">' + icon('copy') + '</button>' +
        '<button class="icon-btn danger" type="button" data-del-id="' + esc(node.id) + '" title="删除" aria-label="删除节点">' + icon('trash') + '</button>' +
      '</div>' +
    '</div>';
  }

  async function moveNode(id, dir, button) {
    if (!ensureWritable() || state.mutating) return;
    var list = nodes();
    var index = list.findIndex(function (node) { return node.id === id; });
    var target = index + dir;
    if (index < 0 || target < 0 || target >= list.length) return;
    setRowBusy(button, true);
    var nextNodes = list.slice();
    var moved = nextNodes.splice(index, 1)[0];
    nextNodes.splice(target, 0, moved);
    var ok = await saveNodes(nextNodes, {
      successMessage: dir < 0 ? '节点已上移' : '节点已下移',
      rerenderOnError: true
    });
    if (!ok && button) button.disabled = false;
  }

  function switchView(view) {
    if (!VIEW_META[view]) view = 'overview';
    state.view = view;
    el.navItems.forEach(function (button) {
      button.classList.toggle('is-active', button.dataset.view === view);
    });
    el.views.forEach(function (panel) {
      panel.hidden = panel.dataset.viewPanel !== view;
    });
    el.crumb.textContent = VIEW_META[view];
    if (view === 'preview' && (!state.preview || state.previewDirty)) loadPreview();
    if (view === 'nodes') renderNodeList();
    if (view === 'overview') renderOverview();
    if (view === 'settings') renderSettings();
    window.scrollTo(0, 0);
  }

  /* ------------------------------------------------------------------ */
  /* settings (parameter presets)                                        */
  /* ------------------------------------------------------------------ */

  function currentDefaults() {
    return (state.config && state.config.defaults) || {};
  }

  function renderSettings() {
    if (!state.config) return;
    var defaults = currentDefaults();
    setField(el.setUuid, defaults.vlessUuid || '');
    setField(el.setPbk, defaults.vlessPublicKey || '');
    setField(el.setSid, defaults.vlessShortId || '');
    setField(el.setSni, defaults.vlessServername || '');
    clearSettingsErrors();
  }

  function setSettingsBusy(busy) {
    el.settingsSave.disabled = busy;
    el.settingsSave.classList.toggle('is-loading', busy);
    el.settingsSaveSpinner.hidden = !busy;
    el.settingsSaveLabel.textContent = busy ? '保存中…' : '保存预设';
  }

  function clearSettingsErrors() {
    $$('.field.has-error', el.settingsForm).forEach(function (field) { field.classList.remove('has-error'); });
    $$('.field-error', el.settingsForm).forEach(function (error) { error.textContent = ''; });
    el.settingsGlobalError.hidden = true;
    el.settingsGlobalError.textContent = '';
  }

  function clearSettingsFieldError(event) {
    var field = event.target.closest ? event.target.closest('.field') : null;
    if (field) {
      field.classList.remove('has-error');
      $$('.field-error', field).forEach(function (error) { error.textContent = ''; });
    }
    if (!el.settingsGlobalError.hidden) {
      el.settingsGlobalError.hidden = true;
      el.settingsGlobalError.textContent = '';
    }
  }

  function showSettingsErrors(errors) {
    clearSettingsErrors();
    var globalMessage = '';
    var firstInput = null;
    (errors || []).forEach(function (error) {
      var target = $('[data-error="' + error.key + '"]', el.settingsForm);
      if (!target) {
        if (!globalMessage) globalMessage = error.message;
        return;
      }
      var field = target.closest('.field');
      field.classList.add('has-error');
      target.textContent = error.message;
      if (!firstInput) firstInput = $('input, select', field);
    });
    if (globalMessage) {
      el.settingsGlobalError.textContent = globalMessage;
      el.settingsGlobalError.hidden = false;
    }
    if (firstInput) {
      firstInput.focus({ preventScroll: true });
      firstInput.scrollIntoView({ block: 'center', behavior: 'smooth' });
    } else if (globalMessage) {
      el.settingsGlobalError.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }

  function collectSettings() {
    var errors = [];
    var defaults = {};

    var uuid = String(el.setUuid.value || '').trim();
    if (uuid) {
      if (!UUID_RE.test(uuid)) {
        errors.push({ key: 'setUuid', message: 'UUID 格式不正确' });
      } else {
        defaults.vlessUuid = uuid.toLowerCase();
      }
    }

    var pbk = String(el.setPbk.value || '').trim();
    if (pbk) {
      if (pbk.length > 128) {
        errors.push({ key: 'setPbk', message: 'Reality 公钥不能超过 128 个字符' });
      } else {
        defaults.vlessPublicKey = pbk;
      }
    }

    var sid = String(el.setSid.value || '').trim();
    if (sid) {
      if (sid.length > 32) {
        errors.push({ key: 'setSid', message: 'Reality Short ID 不能超过 32 个字符' });
      } else {
        defaults.vlessShortId = sid;
      }
    }

    var sni = hostError(el.setSni.value, 'setSni', 'SNI / 回落域名', false, errors);
    if (sni) defaults.vlessServername = sni;

    return { defaults: defaults, errors: errors };
  }

  async function saveSettings(event) {
    event.preventDefault();
    if (state.mutating) return;
    if (!ensureWritable()) return;
    clearSettingsErrors();
    var result = collectSettings();
    if (result.errors.length) {
      showSettingsErrors(result.errors);
      return;
    }

    state.mutating = true;
    setSettingsBusy(true);
    try {
      var data = await request('/api/config', {
        method: 'PUT',
        body: { rev: state.rev, nodes: nodes(), defaults: result.defaults }
      });
      applyConfig(data);
      renderAll();
      renderSettings();
      toast('参数预设已保存，新建 VLESS 节点时会自动填入', 'success');
    } catch (err) {
      if (err.status === 401) {
        handleUnauthorized();
      } else if (err.status === 409) {
        toast(err.message, 'error');
        await reloadConfig();
        renderSettings();
      } else if (err.status === 503) {
        toast(err.message, 'error');
        openModal('kv');
        await reloadConfig();
      } else {
        toast(err.message || '保存失败，请稍后重试', 'error');
      }
    } finally {
      state.mutating = false;
      setSettingsBusy(false);
    }
  }

  /* ------------------------------------------------------------------ */
  /* node actions                                                        */
  /* ------------------------------------------------------------------ */

  function findNode(id) {
    return nodes().filter(function (node) { return node.id === id; })[0] || null;
  }

  function ensureWritable() {
    var meta = state.meta;
    if (!meta) return false;
    if (!meta.kv || meta.readonly) {
      openModal('kv');
      toast('当前为只读模式，绑定 KV 存储后才能保存修改', 'info');
      return false;
    }
    return true;
  }

  function setRowBusy(button, busy) {
    if (button) button.disabled = busy;
  }

  async function saveNodes(nextNodes, options) {
    var opts = options || {};
    if (state.mutating) return false;
    state.mutating = true;
    if (opts.form) setSaveBusy(true);

    try {
      var data = await request('/api/config', {
        method: 'PUT',
        body: { rev: state.rev, nodes: nextNodes }
      });
      applyConfig(data);
      renderAll();
      if (opts.form) closeDrawer();
      if (opts.successMessage) toast(opts.successMessage, 'success');
      if (state.view === 'preview') loadPreview(true);
      return true;
    } catch (err) {
      if (err.status === 401) {
        handleUnauthorized();
        return false;
      }
      if (err.status === 409) {
        toast(err.message, 'error');
        if (opts.form) closeDrawer();
        await reloadConfig();
        return false;
      }
      if (err.status === 503) {
        toast(err.message, 'error');
        openModal('kv');
        await reloadConfig();
        return false;
      }
      if (opts.form && err.field) {
        showFormErrors([{ key: apiFieldKey(err.field), message: err.message }]);
        toast(err.message, 'error');
        return false;
      }
      if (opts.form && err.status !== 0) {
        el.formGlobalError.textContent = err.message;
        el.formGlobalError.hidden = false;
        el.formGlobalError.scrollIntoView({ block: 'nearest' });
      }
      toast(err.message || '保存失败，请稍后重试', 'error');
      if (opts.rerenderOnError) renderAll();
      return false;
    } finally {
      state.mutating = false;
      if (opts.form) setSaveBusy(false);
    }
  }

  async function reloadConfig() {
    try {
      var data = await request('/api/config');
      applyConfig(data);
      renderAll();
      if (state.view === 'preview') loadPreview(true);
      return true;
    } catch (err) {
      if (err.status === 401) handleUnauthorized();
      else toast(err.message || '刷新配置失败', 'error');
      return false;
    }
  }

  async function toggleNode(id, button) {
    if (!ensureWritable() || state.mutating) return;
    var target = findNode(id);
    if (!target) return;
    var nextEnabled = !target.enabled;
    setRowBusy(button, true);
    var nextNodes = nodes().map(function (node) {
      return node.id === id ? Object.assign({}, node, { enabled: nextEnabled }) : node;
    });
    var ok = await saveNodes(nextNodes, {
      successMessage: nextEnabled ? '节点已启用' : '节点已停用',
      rerenderOnError: true
    });
    if (!ok && button) button.disabled = false;
  }

  function uniqueCopyName(base) {
    var used = new Set(nodes().map(function (node) { return node.name.toLowerCase(); }));
    var root = base.replace(/\s*副本(?:\s+\d+)?$/, '').trim().slice(0, 76) || '未命名节点';
    var candidate = root + ' 副本';
    var index = 2;
    while (used.has(candidate.toLowerCase())) {
      var suffix = ' 副本 ' + index;
      candidate = root.slice(0, 80 - suffix.length) + suffix;
      index += 1;
    }
    return candidate;
  }

  async function duplicateNode(id) {
    if (!ensureWritable() || state.mutating) return;
    var source = findNode(id);
    if (!source) return;
    if (nodes().length >= MAX_NODES) {
      toast('节点数量已达到上限 ' + MAX_NODES + ' 个', 'error');
      return;
    }
    var copy = Object.assign({}, source, { id: randomId(), name: uniqueCopyName(source.name) });
    var nextNodes = nodes().slice();
    var index = nextNodes.findIndex(function (node) { return node.id === id; });
    nextNodes.splice(index + 1, 0, copy);
    await saveNodes(nextNodes, {
      successMessage: '已创建节点副本「' + copy.name + '」',
      rerenderOnError: true
    });
  }

  function askDelete(id) {
    if (!ensureWritable()) return;
    var target = findNode(id);
    if (!target) return;
    state.deletingId = id;
    el.confirmName.textContent = target.name;
    openModal('confirm');
  }

  async function confirmDelete() {
    var id = state.deletingId;
    if (!id || state.mutating) return;
    var target = findNode(id);
    if (!target) {
      closeModal('confirm');
      return;
    }
    el.confirmDelete.disabled = true;
    el.confirmDelete.textContent = '删除中…';
    var nextNodes = nodes().filter(function (node) { return node.id !== id; });
    var ok = await saveNodes(nextNodes, {
      successMessage: '节点「' + target.name + '」已删除',
      rerenderOnError: true
    });
    el.confirmDelete.disabled = false;
    el.confirmDelete.textContent = '删除节点';
    if (ok) {
      state.deletingId = null;
      closeModal('confirm');
    }
  }

  /* ------------------------------------------------------------------ */
  /* drawer                                                              */
  /* ------------------------------------------------------------------ */

  function setField(input, value) {
    if (input) input.value = value === null || value === undefined ? '' : String(value);
  }

  function getSwitch(button) {
    return button.getAttribute('aria-checked') === 'true';
  }

  function setSwitch(button, on) {
    if (button) button.setAttribute('aria-checked', on ? 'true' : 'false');
  }

  function setSegment(container, value) {
    if (!container) return;
    var buttons = $$('button[data-value]', container);
    var has = buttons.some(function (button) { return button.dataset.value === value; });
    if (!has) value = buttons.length ? buttons[0].dataset.value : '';
    buttons.forEach(function (button) {
      button.classList.toggle('is-active', button.dataset.value === value);
    });
  }

  function segmentValue(container) {
    var active = $('button.is-active', container);
    return active ? active.dataset.value : '';
  }

  function setTags(tags) {
    var values = Array.isArray(tags) ? tags : [];
    $$('input', el.tagGrid).forEach(function (input) {
      var on = values.indexOf(input.value) !== -1;
      input.checked = on;
      input.closest('.tag-chip').classList.toggle('is-on', on);
    });
  }

  function selectedTags() {
    return $$('input:checked', el.tagGrid).map(function (input) { return input.value; });
  }

  function showDrawer() {
    window.clearTimeout(showDrawer.timer);
    el.drawerLayer.hidden = false;
    window.requestAnimationFrame(function () {
      el.drawerLayer.classList.add('is-open');
      syncBodyLock();
    });
  }

  function closeDrawer(immediate) {
    if (!el.drawerLayer || el.drawerLayer.hidden) return;
    el.drawerLayer.classList.remove('is-open');
    window.clearTimeout(showDrawer.timer);
    if (immediate) {
      el.drawerLayer.hidden = true;
      syncBodyLock();
    } else {
      showDrawer.timer = window.setTimeout(function () {
        el.drawerLayer.hidden = true;
        syncBodyLock();
      }, 220);
    }
    state.editingId = null;
  }

  function openEditor(id) {
    if (!ensureWritable()) return;
    var node = id ? findNode(id) : null;
    if (id && !node) {
      toast('节点不存在，请刷新后重试', 'error');
      return;
    }

    clearFormErrors();
    setField(el.fieldName, '');
    setField(el.fieldServer, '');
    setField(el.fieldPort, 443);
    setField(el.fieldRegion, 'hk');
    setTags([]);
    setSwitch(el.fieldEnabled, true);
    setSwitch(el.fieldShowMain, true);

    var preset = (state.config && state.config.defaults) || {};
    setField(el.fieldUuid, preset.vlessUuid || generateUuid());
    setSegment(el.networkBox, 'tcp');
    setSwitch(el.fieldTls, true);
    setSwitch(el.fieldReality, false);
    setField(el.fieldPbk, preset.vlessPublicKey || '');
    setField(el.fieldSid, preset.vlessShortId || '');
    setField(el.fieldSni, preset.vlessServername || '');
    setField(el.fieldFp, 'chrome');
    setField(el.fieldFlow, '');
    setField(el.fieldWsPath, '/');
    setField(el.fieldWsHost, '');
    setField(el.fieldGrpc, '');
    setSwitch(el.fieldUdp, true);

    setField(el.vmUuid, generateUuid());
    setSegment(el.vmNetworkBox, 'ws');
    setSwitch(el.vmTls, false);
    setField(el.vmSni, '');
    setField(el.vmWsPath, '/');
    setField(el.vmWsHost, '');
    setField(el.vmGrpc, '');
    setSwitch(el.vmUdp, true);

    setField(el.trPassword, generatePassword());
    setField(el.trSni, '');
    setSwitch(el.trSkip, true);
    setSwitch(el.trUdp, true);

    setField(el.hyPassword, generatePassword());
    setField(el.hySni, 'bing.com');
    setField(el.hyUp, '80 mbps');
    setField(el.hyDown, '500 mbps');
    setSwitch(el.hySkip, true);

    setField(el.ssCipher, 'aes-256-gcm');
    setField(el.ssPassword, generatePassword());
    setSwitch(el.ssUdp, true);

    var type = node && TYPE_META[node.type] ? node.type : 'vless';
    state.formType = type;
    state.editingId = node ? node.id : null;

    if (node) {
      setField(el.fieldName, node.name);
      setField(el.fieldServer, node.server);
      setField(el.fieldPort, node.port);
      setField(el.fieldRegion, node.region || 'other');
      setTags(node.tags || []);
      setSwitch(el.fieldEnabled, node.enabled !== false);
      setSwitch(el.fieldShowMain, node.showInMain !== false);

      if (type === 'vless') {
        setField(el.fieldUuid, node.uuid || generateUuid());
        setSegment(el.networkBox, node.network || 'tcp');
        setSwitch(el.fieldTls, node.tls !== false);
        setSwitch(el.fieldReality, !!node.reality);
        setField(el.fieldPbk, node.publicKey || '');
        setField(el.fieldSid, node.shortId || '');
        setField(el.fieldSni, node.servername || '');
        setField(el.fieldFp, node.fingerprint || 'chrome');
        setField(el.fieldFlow, node.flow || '');
        setField(el.fieldWsPath, node.wsPath || '/');
        setField(el.fieldWsHost, node.wsHost || '');
        setField(el.fieldGrpc, node.grpcService || '');
        setSwitch(el.fieldUdp, node.udp !== false);
      } else if (type === 'vmess') {
        setField(el.vmUuid, node.uuid || generateUuid());
        setSegment(el.vmNetworkBox, node.network || 'ws');
        setSwitch(el.vmTls, !!node.tls);
        setField(el.vmSni, node.servername || '');
        setField(el.vmWsPath, node.wsPath || '/');
        setField(el.vmWsHost, node.wsHost || '');
        setField(el.vmGrpc, node.grpcService || '');
        setSwitch(el.vmUdp, node.udp !== false);
      } else if (type === 'trojan') {
        setField(el.trPassword, node.password || '');
        setField(el.trSni, node.sni || '');
        setSwitch(el.trSkip, node.skipCertVerify !== false);
        setSwitch(el.trUdp, node.udp !== false);
      } else if (type === 'hysteria2') {
        setField(el.hyPassword, node.password || '');
        setField(el.hySni, node.sni || '');
        setField(el.hyUp, node.up || '');
        setField(el.hyDown, node.down || '');
        setSwitch(el.hySkip, node.skipCertVerify !== false);
      } else if (type === 'ss') {
        setField(el.ssCipher, node.cipher || 'aes-256-gcm');
        setField(el.ssPassword, node.password || '');
        setSwitch(el.ssUdp, node.udp !== false);
      }
    }

    el.drawerTitle.textContent = node ? '编辑节点' : '添加节点';
    el.drawerSub.textContent = node ? '正在编辑「' + node.name + '」' : '配置一个新的代理节点';
    el.nodeSaveLabel.textContent = node ? '保存更改' : '保存节点';

    renderFormType();
    showDrawer();
    window.setTimeout(function () {
      el.fieldName.focus();
      el.fieldName.select();
    }, 120);
  }

  function renderFormType() {
    var type = state.formType;
    $$('.proto-section').forEach(function (section) {
      section.hidden = section.id !== 'proto-' + type;
    });
    $$('.type-card', el.typeGrid).forEach(function (button) {
      button.classList.toggle('is-active', button.dataset.type === type);
      button.setAttribute('aria-pressed', button.dataset.type === type ? 'true' : 'false');
    });
    syncFormConditions();
  }

  function syncFormConditions() {
    if (state.formType === 'vless') {
      var network = segmentValue(el.networkBox);
      var tls = getSwitch(el.fieldTls);
      if (network !== 'tcp' || !tls) {
        setSwitch(el.fieldReality, false);
        el.realityRow.hidden = true;
      } else {
        el.realityRow.hidden = false;
      }
      var reality = getSwitch(el.fieldReality);
      el.realityFields.hidden = !reality;
      el.tlsFields.hidden = !(tls || reality);
      el.flowField.hidden = !(network === 'tcp' && (tls || reality));
      el.wsFields.hidden = network !== 'ws';
      el.grpcFields.hidden = network !== 'grpc';
      el.fieldFlow.disabled = el.flowField.hidden;
    } else if (state.formType === 'vmess') {
      var vmNetwork = segmentValue(el.vmNetworkBox);
      var vmTls = getSwitch(el.vmTls);
      el.vmTlsField.hidden = !vmTls;
      el.vmWsFields.hidden = vmNetwork !== 'ws';
      el.vmGrpcFields.hidden = vmNetwork !== 'grpc';
    }
  }

  function setSaveBusy(busy) {
    el.nodeSave.disabled = busy;
    el.nodeSave.classList.toggle('is-loading', busy);
    el.nodeSaveSpinner.hidden = !busy;
    el.nodeSaveLabel.textContent = busy
      ? '保存中…'
      : (state.editingId ? '保存更改' : '保存节点');
  }

  function clearFormErrors() {
    $$('.field.has-error', el.nodeForm).forEach(function (field) { field.classList.remove('has-error'); });
    $$('.field-error', el.nodeForm).forEach(function (error) { error.textContent = ''; });
    el.formGlobalError.hidden = true;
    el.formGlobalError.textContent = '';
  }

  function clearFieldError(event) {
    var field = event.target.closest ? event.target.closest('.field') : null;
    if (field) {
      field.classList.remove('has-error');
      $$('.field-error', field).forEach(function (error) { error.textContent = ''; });
    }
    if (!el.formGlobalError.hidden) {
      el.formGlobalError.hidden = true;
      el.formGlobalError.textContent = '';
    }
  }

  function showFormErrors(errors) {
    clearFormErrors();
    var globalMessage = '';
    var firstInput = null;
    (errors || []).forEach(function (error) {
      var target = $('[data-error="' + error.key + '"]', el.nodeForm);
      if (!target) {
        if (!globalMessage) globalMessage = error.message;
        return;
      }
      var field = target.closest('.field');
      field.classList.add('has-error');
      target.textContent = error.message;
      if (!firstInput) firstInput = $('input, select', field);
    });
    if (globalMessage) {
      el.formGlobalError.textContent = globalMessage;
      el.formGlobalError.hidden = false;
    }
    if (firstInput) {
      firstInput.focus({ preventScroll: true });
      firstInput.scrollIntoView({ block: 'center', behavior: 'smooth' });
    } else if (globalMessage) {
      el.formGlobalError.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }

  function hostError(value, key, label, required, errors) {
    var text = String(value || '').trim();
    if (!text) {
      if (required) errors.push({ key: key, message: label + '不能为空' });
      return '';
    }
    if (text.length > 253) {
      errors.push({ key: key, message: label + '不能超过 253 个字符' });
      return text;
    }
    if (CONTROL_RE.test(text) || !HOST_RE.test(text)) {
      errors.push({ key: key, message: label + '只能包含域名、IPv4 或 IPv6 地址' });
      return text;
    }
    return text;
  }

  function requiredError(value, key, label, max, errors) {
    var text = String(value || '').trim();
    if (!text) {
      errors.push({ key: key, message: label + '不能为空' });
      return '';
    }
    if (text.length > max) {
      errors.push({ key: key, message: label + '不能超过 ' + max + ' 个字符' });
      return text;
    }
    if (CONTROL_RE.test(text)) {
      errors.push({ key: key, message: label + '包含非法字符' });
      return text;
    }
    return text;
  }

  function optionalError(value, key, label, max, errors) {
    var text = String(value || '').trim();
    if (!text) return '';
    if (text.length > max) {
      errors.push({ key: key, message: label + '不能超过 ' + max + ' 个字符' });
      return text;
    }
    if (CONTROL_RE.test(text)) {
      errors.push({ key: key, message: label + '包含非法字符' });
      return text;
    }
    return text;
  }

  function collectForm() {
    var errors = [];
    var type = state.formType;
    var name = requiredError(el.fieldName.value, 'name', '节点名称', 80, errors);
    var nameLower = name.toLowerCase();
    var duplicate = nodes().some(function (node) {
      return node.name.toLowerCase() === nameLower && node.id !== state.editingId;
    });
    if (name && RESERVED_NAMES.has(name)) {
      errors.push({ key: 'name', message: '该名称与策略组或内置策略重名，请更换' });
    } else if (name && duplicate) {
      errors.push({ key: 'name', message: '节点名称已存在，请使用其他名称' });
    }

    var server = hostError(el.fieldServer.value, 'server', '服务器地址', true, errors);
    var portRaw = String(el.fieldPort.value || '').trim();
    var port = Number(portRaw);
    if (!portRaw || !Number.isInteger(port) || port < 1 || port > 65535) {
      errors.push({ key: 'port', message: '端口必须是 1 - 65535 之间的整数' });
    }

    var region = el.fieldRegion.value;
    if (REGION_ORDER.indexOf(region) === -1) region = 'other';
    var node = {
      name: name,
      type: type,
      server: server,
      port: port,
      region: region,
      enabled: getSwitch(el.fieldEnabled),
      showInMain: getSwitch(el.fieldShowMain),
      tags: selectedTags()
    };

    var optionalHost = function (value, key, label) {
      return hostError(value, key, label, false, errors);
    };
    var optionalText = function (value, key, label) {
      return optionalError(value, key, label, 256, errors);
    };

    if (type === 'vless') {
      var uuid = requiredError(el.fieldUuid.value, 'uuid', 'UUID', 64, errors);
      if (uuid && !UUID_RE.test(uuid)) errors.push({ key: 'uuid', message: 'UUID 格式不正确' });
      var network = segmentValue(el.networkBox) || 'tcp';
      var reality = getSwitch(el.fieldReality);
      if (reality && network !== 'tcp') {
        errors.push({ key: 'reality', message: 'Reality 仅支持 TCP 传输' });
      }
      node.uuid = uuid.toLowerCase();
      node.network = network;
      node.tls = getSwitch(el.fieldTls) || reality;
      node.reality = reality;
      node.servername = optionalHost(el.fieldSni.value, 'servername', 'SNI / 回落域名');
      if (reality) {
        node.publicKey = requiredError(el.fieldPbk.value, 'publicKey', 'Reality 公钥', 128, errors);
        node.shortId = optionalError(el.fieldSid.value, 'shortId', 'Reality Short ID', 32, errors);
      }
      node.flow = network === 'tcp' && (node.tls || reality) ? (el.fieldFlow.value || '') : '';
      node.fingerprint = el.fieldFp.value || 'chrome';
      node.udp = getSwitch(el.fieldUdp);
      if (network === 'ws') {
        node.wsPath = optionalText(el.fieldWsPath.value, 'wsPath', 'WS Path') || '/';
        node.wsHost = optionalHost(el.fieldWsHost.value, 'wsHost', 'WS Host');
      }
      if (network === 'grpc') {
        node.grpcService = optionalError(el.fieldGrpc.value, 'grpcService', 'gRPC 服务名', 64, errors);
      }
    } else if (type === 'vmess') {
      var vmUuid = requiredError(el.vmUuid.value, 'vmUuid', 'UUID', 64, errors);
      if (vmUuid && !UUID_RE.test(vmUuid)) errors.push({ key: 'vmUuid', message: 'UUID 格式不正确' });
      var vmNetwork = segmentValue(el.vmNetworkBox) || 'ws';
      node.uuid = vmUuid.toLowerCase();
      node.network = vmNetwork;
      node.tls = getSwitch(el.vmTls);
      node.servername = optionalHost(el.vmSni.value, 'vmServername', 'SNI');
      node.udp = getSwitch(el.vmUdp);
      if (vmNetwork === 'ws') {
        node.wsPath = optionalText(el.vmWsPath.value, 'wsPath', 'WS Path') || '/';
        node.wsHost = optionalHost(el.vmWsHost.value, 'vmWsHost', 'WS Host');
      }
      if (vmNetwork === 'grpc') {
        node.grpcService = optionalError(el.vmGrpc.value, 'grpcService', 'gRPC 服务名', 64, errors);
      }
    } else if (type === 'trojan') {
      node.password = requiredError(el.trPassword.value, 'trPassword', '密码', 128, errors);
      node.sni = optionalHost(el.trSni.value, 'trSni', 'SNI');
      node.skipCertVerify = getSwitch(el.trSkip);
      node.udp = getSwitch(el.trUdp);
    } else if (type === 'hysteria2') {
      node.password = requiredError(el.hyPassword.value, 'hyPassword', '密码', 128, errors);
      node.sni = optionalHost(el.hySni.value, 'hySni', 'SNI');
      node.skipCertVerify = getSwitch(el.hySkip);
      var up = optionalError(el.hyUp.value, 'hyUp', '上行带宽', 24, errors);
      var down = optionalError(el.hyDown.value, 'hyDown', '下行带宽', 24, errors);
      if (up && !BANDWIDTH_RE.test(up)) errors.push({ key: 'hyUp', message: '格式应为 80 mbps' });
      if (down && !BANDWIDTH_RE.test(down)) errors.push({ key: 'hyDown', message: '格式应为 500 mbps' });
      node.up = up;
      node.down = down;
    } else if (type === 'ss') {
      node.cipher = el.ssCipher.value || 'aes-256-gcm';
      node.password = requiredError(el.ssPassword.value, 'ssPassword', '密码', 128, errors);
      node.udp = getSwitch(el.ssUdp);
    }

    return { node: node, errors: errors };
  }

  function apiFieldKey(field) {
    var maps = {
      vmess: { uuid: 'vmUuid', servername: 'vmServername', wsHost: 'vmWsHost' },
      trojan: { password: 'trPassword', sni: 'trSni' },
      hysteria2: { password: 'hyPassword', sni: 'hySni', up: 'hyUp', down: 'hyDown' },
      ss: { password: 'ssPassword' }
    };
    if (field === 'name' || field === 'server' || field === 'port' || field === 'reality') return field;
    var map = maps[state.formType];
    return map && map[field] ? map[field] : field;
  }

  async function submitForm(event) {
    event.preventDefault();
    if (state.mutating) return;
    if (!ensureWritable()) return;
    clearFormErrors();
    var result = collectForm();
    if (result.errors.length) {
      showFormErrors(result.errors);
      return;
    }

    var nextNodes;
    if (state.editingId) {
      nextNodes = nodes().map(function (node) {
        return node.id === state.editingId ? Object.assign({}, result.node, { id: node.id }) : node;
      });
    } else {
      if (nodes().length >= MAX_NODES) {
        el.formGlobalError.textContent = '节点数量已达到上限 ' + MAX_NODES + ' 个';
        el.formGlobalError.hidden = false;
        return;
      }
      nextNodes = nodes().concat([Object.assign({}, result.node, { id: randomId() })]);
    }

    await saveNodes(nextNodes, {
      form: true,
      successMessage: state.editingId ? '节点已更新' : '节点已添加'
    });
  }

  /* ------------------------------------------------------------------ */
  /* preview                                                             */
  /* ------------------------------------------------------------------ */

  function loadPreview(force) {
    if (state.previewLoading) return state.previewPromise;
    if (!force && state.preview && !state.previewDirty) return Promise.resolve(state.preview);
    state.previewLoading = true;
    el.codeLoading.hidden = false;
    el.previewRefresh.disabled = true;

    state.previewPromise = (async function () {
      try {
        var text = await request('/api/preview', { raw: true });
        state.preview = text;
        state.previewDirty = false;
        renderPreview();
        return text;
      } catch (err) {
        if (err.status === 401) {
          handleUnauthorized();
        } else {
          toast(err.message || '生成订阅预览失败', 'error');
          if (!state.preview) {
            el.yamlCode.innerHTML = '<div class="code-line"><span class="ln">!</span><span class="lc tok-comment">' + esc(err.message || '生成订阅预览失败') + '</span></div>';
            el.codeLines.textContent = '0 行';
            el.codeSize.textContent = '0 KB';
          }
        }
        return null;
      } finally {
        state.previewLoading = false;
        el.codeLoading.hidden = true;
        el.previewRefresh.disabled = false;
      }
    })();
    return state.previewPromise;
  }

  function renderPreview() {
    var text = state.preview || '';
    el.yamlCode.innerHTML = highlightYaml(text);
    var lines = text ? text.split('\n').length : 0;
    var bytes = new TextEncoder().encode(text).length;
    el.codeLines.textContent = lines + ' 行';
    el.codeSize.textContent = (bytes / 1024).toFixed(1) + ' KB';
    $('.code-body').scrollTop = 0;
  }

  function splitComment(raw) {
    var inDouble = false;
    var inSingle = false;
    for (var i = 0; i < raw.length; i++) {
      var char = raw[i];
      if (char === '"' && !inSingle && raw[i - 1] !== '\\') inDouble = !inDouble;
      else if (char === "'" && !inDouble) inSingle = !inSingle;
      else if (char === '#' && !inDouble && !inSingle && (i === 0 || /\s/.test(raw[i - 1]))) {
        return [raw.slice(0, i), raw.slice(i)];
      }
    }
    return [raw, ''];
  }

  function highlightValue(raw) {
    var parts = splitComment(raw);
    var valuePart = parts[0];
    var commentPart = parts[1];
    var output = '';
    var leading = (valuePart.match(/^\s*/) || [''])[0];
    var value = valuePart.slice(leading.length);
    if (!value) {
      output = esc(valuePart);
    } else if (/^"(?:\\.|[^"\\])*"$/.test(value)) {
      output = esc(leading) + '<span class="tok-string">' + esc(value) + '</span>';
    } else if (/^(true|false|null|yes|no)$/i.test(value)) {
      output = esc(leading) + '<span class="tok-bool">' + esc(value) + '</span>';
    } else if (/^-?\d+(?:\.\d+)?$/.test(value)) {
      output = esc(leading) + '<span class="tok-number">' + esc(value) + '</span>';
    } else {
      output = esc(valuePart);
    }
    if (commentPart) output += '<span class="tok-comment">' + esc(commentPart) + '</span>';
    return output;
  }

  function highlightYaml(text) {
    return text.split('\n').map(function (line, index) {
      var leading = (line.match(/^\s*/) || [''])[0];
      var rest = line.slice(leading.length);
      var content = '';
      if (rest.charAt(0) === '#') {
        content = esc(leading) + '<span class="tok-comment">' + esc(rest) + '</span>';
      } else {
        var bullet = '';
        if (rest.indexOf('- ') === 0) {
          bullet = '- ';
          rest = rest.slice(2);
        }
        var match = rest.match(/^([A-Za-z0-9_.@\/-]+):(.*)$/);
        if (match) {
          content = esc(leading + bullet) +
            '<span class="tok-key">' + esc(match[1]) + '</span>:' +
            highlightValue(match[2]);
        } else {
          content = esc(leading + bullet) + highlightValue(rest);
        }
      }
      return '<div class="code-line"><span class="ln">' + (index + 1) + '</span><span class="lc">' + (content || ' ') + '</span></div>';
    }).join('');
  }

  async function copyYaml() {
    var text = state.preview && !state.previewDirty ? state.preview : await loadPreview();
    if (!text) return;
    await copyText(text, 'Clash 配置已复制');
  }

  async function downloadYaml() {
    var text = state.preview && !state.previewDirty ? state.preview : await loadPreview();
    if (!text) return;
    var now = new Date();
    var stamp = now.getFullYear() +
      String(now.getMonth() + 1).padStart(2, '0') +
      String(now.getDate()).padStart(2, '0') + '-' +
      String(now.getHours()).padStart(2, '0') +
      String(now.getMinutes()).padStart(2, '0');
    var blob = new Blob([text], { type: 'text/yaml;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var link = document.createElement('a');
    link.href = url;
    link.download = 'transit-hub-' + stamp + '.yaml';
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    toast('配置已开始下载', 'success');
  }

  /* ------------------------------------------------------------------ */
  /* modal, toast, clipboard                                             */
  /* ------------------------------------------------------------------ */

  function syncBodyLock() {
    var open = $$('.drawer-layer.is-open, .modal-layer.is-open').length > 0;
    document.body.classList.toggle('body-lock', open);
  }

  function openModal(name) {
    var layer = name === 'confirm' ? el.confirmLayer : el.kvLayer;
    if (!layer) return;
    window.clearTimeout(openModal[name + 'Timer']);
    layer.hidden = false;
    window.requestAnimationFrame(function () {
      layer.classList.add('is-open');
      syncBodyLock();
      var focusTarget = name === 'confirm' ? el.confirmDelete : el.kvCopyName;
      if (focusTarget) window.setTimeout(function () { focusTarget.focus(); }, 120);
    });
  }

  function closeModal(name, immediate) {
    var layer = name === 'confirm' ? el.confirmLayer : el.kvLayer;
    if (!layer || layer.hidden) return;
    layer.classList.remove('is-open');
    window.clearTimeout(openModal[name + 'Timer']);
    if (immediate) {
      layer.hidden = true;
      syncBodyLock();
    } else {
      openModal[name + 'Timer'] = window.setTimeout(function () {
        layer.hidden = true;
        syncBodyLock();
      }, 200);
    }
    if (name === 'confirm') state.deletingId = null;
  }

  function isLayerOpen(layer) {
    return !!layer && !layer.hidden && layer.classList.contains('is-open');
  }

  function toast(message, type) {
    var kind = type || 'info';
    var node = document.createElement('div');
    node.className = 'toast toast-' + kind;
    node.innerHTML = icon(kind === 'success' ? 'check' : (kind === 'error' ? 'alert' : 'info'));
    var text = document.createElement('span');
    text.textContent = message;
    node.appendChild(text);
    el.toasts.appendChild(node);
    while (el.toasts.children.length > 4) el.toasts.removeChild(el.toasts.firstChild);
    window.requestAnimationFrame(function () { node.classList.add('is-show'); });
    window.setTimeout(function () {
      node.classList.remove('is-show');
      window.setTimeout(function () { node.remove(); }, 240);
    }, 3400);
  }

  async function copyText(text, message) {
    if (!text) {
      toast('没有可复制的内容', 'error');
      return false;
    }
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
      } else {
        var area = document.createElement('textarea');
        area.value = text;
        area.setAttribute('readonly', '');
        area.style.position = 'fixed';
        area.style.left = '-9999px';
        document.body.appendChild(area);
        area.select();
        var copied = document.execCommand('copy');
        area.remove();
        if (!copied) throw new Error('copy failed');
      }
      if (message) toast(message, 'success');
      return true;
    } catch (err) {
      toast('复制失败，请手动选择文本后复制', 'error');
      return false;
    }
  }

  function copySubscription() {
    var url = subUrlValue();
    if (!url) {
      toast('服务端未配置 AUTH_TOKEN，无法生成订阅链接', 'error');
      return;
    }
    copyText(url, '订阅链接已复制');
  }

  /* ------------------------------------------------------------------ */
  /* events                                                              */
  /* ------------------------------------------------------------------ */

  function resetFilters() {
    state.query = '';
    state.filterType = 'all';
    state.filterRegion = 'all';
    if (el.nodeSearch) el.nodeSearch.value = '';
    if (el.filterType) el.filterType.value = 'all';
    if (el.filterRegion) el.filterRegion.value = 'all';
    renderNodeList();
  }

  function bindEvents() {
    el.loginForm.addEventListener('submit', function (event) {
      event.preventDefault();
      authenticate(el.loginToken.value, false);
    });
    el.loginToken.addEventListener('input', function () { showLoginError(''); });
    el.loginReveal.addEventListener('click', function () {
      var showing = el.loginToken.type === 'text';
      el.loginToken.type = showing ? 'password' : 'text';
      var use = $('use', el.loginReveal);
      if (use) use.setAttribute('href', showing ? '#i-eye' : '#i-eye-off');
      el.loginReveal.setAttribute('aria-label', showing ? '显示令牌' : '隐藏令牌');
    });

    el.navItems.forEach(function (button) {
      button.addEventListener('click', function () { switchView(button.dataset.view); });
    });
    $$('[data-goto]').forEach(function (button) {
      button.addEventListener('click', function () { switchView(button.dataset.goto); });
    });
    el.heroPreview.addEventListener('click', function () { switchView('preview'); });

    [el.topAdd, el.nodesAdd, el.heroAdd, el.emptyAdd].forEach(function (button) {
      button.addEventListener('click', function () { openEditor(null); });
    });
    [el.topCopy, el.nodesCopy, el.previewCopySub].forEach(function (button) {
      if (button) button.addEventListener('click', copySubscription);
    });
    el.subCopy.addEventListener('click', copySubscription);
    el.subReveal.addEventListener('click', function () {
      state.subRevealed = !state.subRevealed;
      renderSubUrls();
    });

    [el.themeToggle, el.mobileTheme].forEach(function (button) {
      button.addEventListener('click', toggleTheme);
    });
    el.logout.addEventListener('click', function () { logout(''); });
    el.mobileLogout.addEventListener('click', function () { logout(''); });

    [el.storageCard, el.kvHelpSide, el.kvHelpBtn].forEach(function (button) {
      button.addEventListener('click', function () {
        if (button === el.storageCard && state.meta && state.meta.kv && !state.meta.readonly) {
          toast('KV 存储已连接 · 当前配置版本 #' + state.rev, 'success');
        } else {
          openModal('kv');
        }
      });
    });
    el.kvCopyName.addEventListener('click', function () { copyText('SUB_KV', '变量名 SUB_KV 已复制'); });

    el.nodeSearch.addEventListener('input', function () {
      state.query = el.nodeSearch.value;
      renderNodeList();
    });
    el.filterType.addEventListener('change', function () {
      state.filterType = el.filterType.value;
      renderNodeList();
    });
    el.filterRegion.addEventListener('change', function () {
      state.filterRegion = el.filterRegion.value;
      renderNodeList();
    });
    [el.filterReset, el.emptyReset].forEach(function (button) {
      button.addEventListener('click', resetFilters);
    });

    el.nodeList.addEventListener('click', function (event) {
      var row = event.target.closest('.node-row');
      if (!row) return;
      var copyButton = event.target.closest('[data-copy-id]');
      if (copyButton) {
        var copyNode = findNode(copyButton.dataset.copyId);
        if (copyNode) copyText(copyNode.server, '服务器地址已复制');
        return;
      }
      var toggleButton = event.target.closest('[data-toggle-id]');
      if (toggleButton) {
        toggleNode(toggleButton.dataset.toggleId, toggleButton);
        return;
      }
      var moveButton = event.target.closest('[data-move-id]');
      if (moveButton) {
        if (!moveButton.disabled) {
          moveNode(moveButton.dataset.moveId, Number(moveButton.dataset.dir), moveButton);
        }
        return;
      }
      var editButton = event.target.closest('[data-edit-id]');
      if (editButton) {
        openEditor(editButton.dataset.editId);
        return;
      }
      var duplicateButton = event.target.closest('[data-dup-id]');
      if (duplicateButton) {
        duplicateNode(duplicateButton.dataset.dupId);
        return;
      }
      var deleteButton = event.target.closest('[data-del-id]');
      if (deleteButton) {
        askDelete(deleteButton.dataset.delId);
        return;
      }
      if (event.target.closest('button')) return;
      openEditor(row.dataset.id);
    });
    el.nodeList.addEventListener('keydown', function (event) {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      var row = event.target.closest('.node-row');
      if (!row || event.target.closest('button')) return;
      event.preventDefault();
      openEditor(row.dataset.id);
    });

    el.recentNodes.addEventListener('click', function (event) {
      var button = event.target.closest('[data-edit-id]');
      if (button) openEditor(button.dataset.editId);
    });

    $$('[data-close-drawer]').forEach(function (button) {
      button.addEventListener('click', function () { closeDrawer(); });
    });
    $$('[data-close-modal]').forEach(function (button) {
      button.addEventListener('click', function () {
        closeModal(button.dataset.closeModal);
      });
    });

    el.nodeForm.addEventListener('submit', submitForm);
    el.nodeForm.addEventListener('input', clearFieldError);
    el.nodeForm.addEventListener('change', clearFieldError);

    el.settingsForm.addEventListener('submit', saveSettings);
    el.settingsForm.addEventListener('input', clearSettingsFieldError);
    el.settingsForm.addEventListener('change', clearSettingsFieldError);
    el.settingsClear.addEventListener('click', function () {
      setField(el.setUuid, '');
      setField(el.setPbk, '');
      setField(el.setSid, '');
      setField(el.setSni, '');
      clearSettingsErrors();
      toast('已清空，点击「保存预设」后生效', 'info');
    });
    el.typeGrid.addEventListener('click', function (event) {
      var button = event.target.closest('[data-type]');
      if (!button) return;
      state.formType = button.dataset.type;
      clearFormErrors();
      renderFormType();
    });
    $$('.segmented').forEach(function (group) {
      group.addEventListener('click', function (event) {
        var button = event.target.closest('button[data-value]');
        if (!button) return;
        $$('button', group).forEach(function (item) { item.classList.remove('is-active'); });
        button.classList.add('is-active');
        syncFormConditions();
      });
    });
    $$('#node-form .switch').forEach(function (button) {
      button.addEventListener('click', function () {
        setSwitch(button, !getSwitch(button));
        syncFormConditions();
      });
    });
    $$('#tag-grid input').forEach(function (input) {
      input.addEventListener('change', function () {
        input.closest('.tag-chip').classList.toggle('is-on', input.checked);
      });
    });

    $('#gen-uuid').addEventListener('click', function () { setField(el.fieldUuid, generateUuid()); });
    $('#gen-vm-uuid').addEventListener('click', function () { setField(el.vmUuid, generateUuid()); });
    $('#gen-set-uuid').addEventListener('click', function () { setField(el.setUuid, generateUuid()); });
    $('#gen-tr-password').addEventListener('click', function () { setField(el.trPassword, generatePassword()); });
    $('#gen-hy-password').addEventListener('click', function () { setField(el.hyPassword, generatePassword()); });
    $('#gen-ss-password').addEventListener('click', function () { setField(el.ssPassword, generatePassword()); });

    el.confirmDelete.addEventListener('click', confirmDelete);
    el.previewRefresh.addEventListener('click', function () { loadPreview(true); });
    el.previewCopy.addEventListener('click', copyYaml);
    el.previewDownload.addEventListener('click', downloadYaml);

    document.addEventListener('keydown', function (event) {
      var tag = (event.target.tagName || '').toLowerCase();
      var typing = tag === 'input' || tag === 'select' || tag === 'textarea' || event.target.isContentEditable;

      if (event.key === 'Escape') {
        if (isLayerOpen(el.kvLayer)) { closeModal('kv'); return; }
        if (isLayerOpen(el.confirmLayer)) { closeModal('confirm'); return; }
        if (isLayerOpen(el.drawerLayer)) { closeDrawer(); return; }
      }

      if (!el.app.hidden && event.key === '/' && !typing) {
        if (state.view !== 'nodes') switchView('nodes');
        event.preventDefault();
        window.setTimeout(function () { el.nodeSearch.focus(); el.nodeSearch.select(); }, 30);
        return;
      }

      if (!el.app.hidden && isLayerOpen(el.drawerLayer) && (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        el.nodeForm.requestSubmit();
      }
    });
  }

  function init() {
    cacheElements();
    bindEvents();
    applyThemeUi();
    var saved = storageGet('session', STORAGE_KEY);
    if (saved) {
      el.loginToken.value = saved;
      authenticate(saved, true);
    } else {
      window.setTimeout(function () { el.loginToken.focus(); }, 80);
    }
  }

  init();
})();
