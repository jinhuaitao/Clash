(function () {
  'use strict';

  var STORAGE_KEY = 'th.admin.token';
  var USERNAME_KEY = 'th.username';
  var THEME_KEY = 'th.theme';
  var MAIN_GROUP = '🌍选择节点';
  var MAX_NODES = 300;
  var MAX_TOTAL_GB = 1048576;
  var THEME_MODES = ['system', 'light', 'dark'];
  var MAX_USERS = 20;
  var USERNAME_RE = /^[A-Za-z0-9][A-Za-z0-9._+@-]{2,253}$/;
  var FINGERPRINTS = ['chrome', 'firefox', 'safari', 'ios', 'android', 'edge', 'random', 'randomized'];
  var SS_CIPHERS = ['aes-128-gcm', 'aes-256-gcm', 'chacha20-ietf-poly1305', 'xchacha20-ietf-poly1305'];

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

  var APP_GROUPS = [
    { key: 'chatgpt', name: '💬ChatGPT' },
    { key: 'google', name: 'ⒼGoogle' },
    { key: 'youtube', name: '📺YOUTUBE' },
    { key: 'telegram', name: '📲 电报信息' }
  ];

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
    settings: '设置'
  };

  var state = {
    token: '',
    authInfo: null,
    loginView: 'login',
    config: null,
    meta: null,
    rev: 0,
    users: null,
    usersRev: 0,
    currentUserId: null,
    usersLoading: false,
    userFormMode: 'add',
    userFormId: null,
    userDeletingId: null,
    userBusy: false,
    view: 'overview',
    query: '',
    filterType: 'all',
    filterRegion: 'all',
    preview: '',
    previewDirty: true,
    previewLoading: false,
    previewPromise: null,
    previewQuery: '',
    previewHits: [],
    previewHitIndex: -1,
    previewSearchTimer: 0,
    editingId: null,
    deletingId: null,
    formType: 'vless',
    subRevealed: false,
    mutating: false,
    selected: new Set(),
    selectionAnchorId: null,
    menuNodeId: null,
    menuTrigger: null,
    linksParsed: [],
    linksErrors: [],
    linksTab: 'import',
    linksTimer: 0,
    linksExportText: '',
    drawerFocus: null,
    layerFocus: {}
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
    el.authEyebrow = $('#auth-eyebrow');
    el.authTitle = $('#auth-title');
    el.authSub = $('#auth-sub');
    el.loginUsername = $('#login-username');
    el.loginPassword = $('#login-password');
    el.loginConfirm = $('#login-confirm');
    el.loginSetupToken = $('#login-setup-token');
    el.loginToken = $('#login-token');
    el.fieldUsername = $('#field-username');
    el.fieldPassword = $('#field-password');
    el.fieldConfirm = $('#field-confirm');
    el.fieldSetupToken = $('#field-setup-token');
    el.fieldToken = $('#field-token');
    el.loginPasswordReveal = $('#login-password-reveal');
    el.loginTokenReveal = $('#login-token-reveal');
    el.loginRecovery = $('#login-recovery');
    el.loginNote = $('#login-note');
    el.loginHelp = $('#login-help');
    el.loginError = $('#login-error');
    el.loginBtn = $('#login-btn');
    el.loginLabel = $('#login-label');
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
    el.tokenAlert = $('#token-alert');
    el.tokenOpenSettings = $('#token-open-settings');
    el.emptySubAlert = $('#empty-sub-alert');
    el.emptySubBtn = $('#empty-sub-btn');
    el.kvHelpBtn = $('#kv-help-btn');
    el.overviewUpdated = $('#overview-updated');
    el.heroStatusText = $('#hero-status-text');
    el.heroTitle = $('#hero-title');
    el.heroDesc = $('#hero-desc');
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

    el.storageCard = $('#storage-card');
    el.storageDot = $('#storage-dot');
    el.storageLabel = $('#storage-label');
    el.storageHint = $('#storage-hint-text');
    el.kvHelpSide = $('#kv-help-side');
    el.themeToggle = $('#theme-toggle');
    el.mobileTheme = $('#mobile-theme');
    el.logout = $('#logout');
    el.mobileLogout = $('#mobile-logout');

    el.nodesAdd = $('#nodes-add');
    el.nodesLinks = $('#nodes-links');
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
    el.emptyLinks = $('#empty-links');
    el.emptyReset = $('#empty-reset');
    el.selectAll = $('#select-all');
    el.bulkBar = $('#bulk-bar');
    el.bulkCount = $('#bulk-count');
    el.bulkRegion = $('#bulk-region');
    el.bulkClear = $('#bulk-clear');
    el.rowMenu = $('#row-menu');

    el.heroAdd = $('#hero-add');
    el.heroPreview = $('#hero-preview');
    el.previewRefresh = $('#preview-refresh');
    el.previewDownload = $('#preview-download');
    el.previewCopy = $('#preview-copy');
    el.previewSubUrl = $('#preview-sub-url');
    el.previewCopySub = $('#preview-copy-sub');
    el.previewGroupPills = $('#preview-group-pills');
    el.previewSearch = $('#preview-search');
    el.previewSearchCount = $('#preview-search-count');
    el.previewSearchPrev = $('#preview-search-prev');
    el.previewSearchNext = $('#preview-search-next');
    el.yamlCode = $('#yaml-code');
    el.codeBody = $('.code-body');
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
    el.usersPanel = $('#users-panel');
    el.userList = $('#user-list');
    el.userAdd = $('#user-add');
    el.userForm = $('#user-form');
    el.userFormTitle = $('#user-form-title');
    el.userFormSub = $('#user-form-sub');
    el.userUsername = $('#user-username');
    el.userPassword = $('#user-password');
    el.userPassword2 = $('#user-password2');
    el.userCancel = $('#user-cancel');
    el.userSave = $('#user-save');
    el.userSaveLabel = $('#user-save-label');
    el.userSaveSpinner = $('#user-save-spinner');
    el.setAuthToken = $('#set-auth-token');
    el.authTokenNote = $('#auth-token-note');
    el.genAuthToken = $('#gen-auth-token');
    el.copyAuthToken = $('#copy-auth-token');
    el.setUuid = $('#set-uuid');
    el.setPbk = $('#set-pbk');
    el.setSid = $('#set-sid');
    el.setSni = $('#set-sni');
    el.setTotal = $('#set-total');
    el.setExpire = $('#set-expire');
    el.themeMode = $('#theme-mode');
    el.appearanceNote = $('#appearance-note');
    el.settingsUpdated = $('#settings-updated');
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

    el.genericLayer = $('#generic-layer');
    el.genericIcon = $('#generic-icon');
    el.genericTitle = $('#generic-title');
    el.genericBody = $('#generic-body');
    el.genericOk = $('#generic-ok');
    el.nodesExport = $('#nodes-export');
    el.nodesImport = $('#nodes-import');
    el.importFile = $('#import-file');
    el.kvLayer = $('#kv-layer');
    el.kvCopyName = $('#kv-copy-name');
    el.linksLayer = $('#links-layer');
    el.linksTabs = $$('#links-layer .tab');
    el.linksPanels = $$('#links-layer .tab-panel');
    el.linksInput = $('#links-input');
    el.linksRegion = $('#links-region');
    el.linksSummary = $('#links-summary');
    el.linksFeedback = $('#links-feedback');
    el.linksPreview = $('#links-preview');
    el.linksExportCount = $('#links-export-count');
    el.linksExport = $('#links-export');
    el.linksDownload = $('#links-download');
    el.linksCopyAll = $('#links-copy-all');
    el.linksConfirm = $('#links-confirm');
    el.linksFootNote = $('#links-foot-note');
    el.toasts = $('#toasts');
    el.themeColor = $('meta[name="theme-color"]');
  }

  /* ------------------------------------------------------------------ */
  /* theme                                                               */
  /* ------------------------------------------------------------------ */

  function themeMode() {
    var saved = storageGet('local', THEME_KEY);
    return THEME_MODES.indexOf(saved) !== -1 ? saved : 'system';
  }

  function currentTheme() {
    return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
  }

  function prefersDark() {
    return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  }

  function resolvedTheme(mode) {
    if (mode === 'light' || mode === 'dark') return mode;
    return prefersDark() ? 'dark' : 'light';
  }

  var THEME_NOTES = {
    system: '跟随系统外观，系统切换深色时控制台会同步变化。',
    light: '始终使用浅色外观，适合明亮的白天环境。',
    dark: '始终使用深色外观，适合夜间或长时间查看。'
  };

  function applyThemeUi() {
    var mode = themeMode();
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
    if (el.themeMode) {
      $$('button[data-theme-mode]', el.themeMode).forEach(function (button) {
        var active = button.dataset.themeMode === mode;
        button.classList.toggle('is-active', active);
        button.setAttribute('aria-pressed', active ? 'true' : 'false');
      });
    }
    if (el.appearanceNote) el.appearanceNote.textContent = THEME_NOTES[mode];
  }

  function applyTheme(mode, persist) {
    var clean = THEME_MODES.indexOf(mode) !== -1 ? mode : 'system';
    document.documentElement.dataset.theme = resolvedTheme(clean);
    if (persist) storageSet('local', THEME_KEY, clean);
    applyThemeUi();
  }

  function setThemeMode(mode) {
    applyTheme(mode, true);
  }

  function toggleTheme() {
    setThemeMode(currentTheme() === 'dark' ? 'light' : 'dark');
  }

  /* ------------------------------------------------------------------ */
  /* auth                                                                */
  /* ------------------------------------------------------------------ */

  function setLoginBusy(busy) {
    el.loginBtn.disabled = busy || (state.loginView === 'setup' && state.authInfo && state.authInfo.kv === false);
    el.loginBtn.classList.toggle('is-loading', busy);
    el.loginSpinner.hidden = !busy;
    var labels = { login: '登录', setup: '创建管理员并进入', recovery: '使用恢复令牌' };
    el.loginLabel.textContent = busy
      ? (state.loginView === 'setup' ? '正在创建…' : '正在验证…')
      : (labels[state.loginView] || '登录');
  }

  function showLoginError(message) {
    el.loginError.textContent = message || '';
    el.loginError.hidden = !message;
  }

  async function publicRequest(path, options) {
    var opts = options || {};
    var headers = {};
    if (opts.body !== undefined) headers['content-type'] = 'application/json';
    if (opts.token) headers.authorization = 'Bearer ' + opts.token;
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
    var data = await safeJson(response);
    if (!response.ok) {
      throw new ApiError(
        (data && data.error) || ('请求失败（HTTP ' + response.status + '）'),
        response.status,
        data,
        data && data.field
      );
    }
    return data || {};
  }

  function setRevealState(button, revealed, label) {
    var use = button ? $('use', button) : null;
    if (use) use.setAttribute('href', revealed ? '#i-eye-off' : '#i-eye');
    if (button) button.setAttribute('aria-label', (revealed ? '隐藏' : '显示') + (label || '内容'));
  }

  function renderAuthView(view) {
    state.loginView = view;
    var info = state.authInfo || {};
    var setup = view === 'setup';
    var recovery = view === 'recovery';
    showLoginError('');

    el.authEyebrow.textContent = setup ? 'First Run' : (recovery ? 'Recovery' : 'Admin Access');
    el.authTitle.textContent = setup ? '初始化控制台' : (recovery ? '恢复访问' : '登录控制台');
    el.authSub.textContent = setup
      ? '创建第一个管理员账号，用户名可使用邮箱，账号密码会保存在你的 KV 中。'
      : (recovery ? '使用部署时配置的 ADMIN_TOKEN 临时进入控制台。' : '使用用户名或邮箱登录，账号密码保存在你的 KV 中。');

    el.fieldUsername.hidden = recovery;
    el.fieldPassword.hidden = recovery;
    el.fieldConfirm.hidden = !setup;
    el.fieldToken.hidden = !recovery;
    el.fieldSetupToken.hidden = !(setup && info.setupLocked);
    el.loginRecovery.hidden = setup || !info.recovery;
    el.loginRecovery.textContent = recovery ? '返回账号登录' : '使用部署恢复令牌';
    el.loginPassword.setAttribute('autocomplete', setup ? 'new-password' : 'current-password');

    var note = $('span', el.loginNote);
    if (note) {
      note.textContent = setup
        ? '密码只保存为不可逆哈希，不会明文写入 KV。'
        : (recovery ? '恢复令牌来自环境变量 ADMIN_TOKEN，日常登录请使用账号密码。' : '登录状态仅保存在当前标签页，关闭浏览器后自动退出。');
    }

    if (setup) {
      if (!info.kv) {
        el.loginHelp.textContent = '尚未绑定 SUB_KV，无法保存管理员账号，请先完成 KV 绑定。';
      } else if (info.setupLocked) {
        el.loginHelp.textContent = '该实例已配置 ADMIN_TOKEN，需填写恢复令牌才能完成初始化。';
      } else if (info.corrupted) {
        el.loginHelp.textContent = '检测到用户数据损坏，继续初始化会覆盖损坏的账号数据。';
      } else {
        el.loginHelp.textContent = '初始化完成前，任何访问者都可以创建管理员，请在部署后尽快完成。';
      }
    } else if (recovery) {
      el.loginHelp.textContent = '恢复令牌用于忘记密码或恢复访问，不会取代日常账号登录。';
    } else {
      el.loginHelp.textContent = '忘记密码时，可由其他管理员在设置页重置。';
    }

    if (!recovery && !el.loginUsername.value) {
      el.loginUsername.value = storageGet('local', USERNAME_KEY) || '';
    }
    if (recovery) {
      el.loginPassword.value = '';
      el.loginPassword.type = 'password';
      el.loginConfirm.value = '';
      setRevealState(el.loginPasswordReveal, false, '密码');
    }
    if (!recovery) {
      el.loginToken.type = 'password';
      setRevealState(el.loginTokenReveal, false, '令牌');
    }
    if (!setup) {
      el.loginConfirm.value = '';
      el.loginSetupToken.value = '';
    }

    setLoginBusy(false);
    if (!el.authScreen.hidden) {
      var target = setup || !recovery ? el.loginUsername : el.loginToken;
      window.setTimeout(function () { target.focus({ preventScroll: true }); }, 40);
    }
  }

  function authErrorFocus(field) {
    if (field === 'username') el.loginUsername.focus();
    else if (field === 'password' || field === 'confirm') el.loginPassword.focus();
    else if (field === 'setupToken') el.loginSetupToken.focus();
    else if (state.loginView === 'recovery') el.loginToken.focus();
  }

  async function finishLogin(token, username) {
    state.token = token;
    var data = await request('/api/config');
    if (!data || !data.config || !Array.isArray(data.config.nodes)) {
      throw new ApiError('接口返回数据异常，请确认 Worker 版本是否正确', 0);
    }
    storageSet('session', STORAGE_KEY, token);
    storageSet('local', USERNAME_KEY, (data.meta && data.meta.username) || username || '');
    if (state.authInfo) state.authInfo.needsSetup = false;
    applyConfig(data);
    enterApp();
  }

  async function submitAuth(event) {
    if (event) event.preventDefault();
    if (state.loginView === 'recovery') return recoverWithToken();

    var setup = state.loginView === 'setup';
    var info = state.authInfo || {};
    var username = String(el.loginUsername.value || '').trim();
    var password = el.loginPassword.value || '';
    showLoginError('');

    if (!username) {
      showLoginError('请输入用户名或邮箱。');
      el.loginUsername.focus();
      return;
    }
    if (setup && !USERNAME_RE.test(username)) {
      showLoginError('用户名需为 3–254 位（字母、数字或 . _ + @ -），也可以直接填写邮箱地址。');
      el.loginUsername.focus();
      return;
    }
    if (!password) {
      showLoginError('请输入密码。');
      el.loginPassword.focus();
      return;
    }
    if (setup) {
      if (password.length < 8) {
        showLoginError('密码至少需要 8 个字符。');
        el.loginPassword.focus();
        return;
      }
      if (password !== el.loginConfirm.value) {
        showLoginError('两次输入的密码不一致。');
        el.loginConfirm.focus();
        return;
      }
      if (info.setupLocked && !String(el.loginSetupToken.value || '').trim()) {
        showLoginError('该实例已配置 ADMIN_TOKEN，请填写部署恢复令牌。');
        el.loginSetupToken.focus();
        return;
      }
    }

    setLoginBusy(true);
    try {
      var data;
      if (setup) {
        data = await publicRequest('/api/setup', {
          method: 'POST',
          token: String(el.loginSetupToken.value || '').trim() || undefined,
          body: { username: username, password: password }
        });
      } else {
        data = await publicRequest('/api/login', {
          method: 'POST',
          body: { username: username, password: password }
        });
      }
      if (!data || !data.token) throw new ApiError('登录响应异常，请稍后重试。', 0);
      await finishLogin(data.token, username);
    } catch (err) {
      state.token = '';
      storageRemove('session', STORAGE_KEY);
      if (err.status === 401) {
        showLoginError('用户名或密码不正确。');
        if (!setup) {
          el.loginPassword.focus();
          el.loginPassword.select();
        }
      } else if (err.status === 409 && setup) {
        await loadAuthInfo();
      } else if (err.status === 403 && err.data && err.data.needsSetup) {
        await loadAuthInfo();
      } else {
        showLoginError(err.message || '登录失败，请稍后重试。');
        authErrorFocus(err.field);
      }
    } finally {
      setLoginBusy(false);
    }
  }

  async function recoverWithToken() {
    var token = String(el.loginToken.value || '').trim();
    if (!token) {
      showLoginError('请输入部署恢复令牌。');
      el.loginToken.focus();
      return;
    }
    showLoginError('');
    setLoginBusy(true);
    state.token = token;
    try {
      var data = await request('/api/config');
      if (!data || !data.config || !Array.isArray(data.config.nodes)) {
        throw new ApiError('接口返回数据异常，请确认 Worker 版本是否正确', 0);
      }
      storageSet('session', STORAGE_KEY, token);
      applyConfig(data);
      enterApp();
    } catch (err) {
      state.token = '';
      storageRemove('session', STORAGE_KEY);
      if (err.status === 401) showLoginError('恢复令牌无效。');
      else showLoginError(err.message || '恢复失败，请稍后重试。');
      el.loginToken.focus();
      el.loginToken.select();
    } finally {
      setLoginBusy(false);
    }
  }

  async function loadAuthInfo() {
    var info;
    try {
      info = await publicRequest('/api/auth');
    } catch (err) {
      state.authInfo = null;
      renderAuthView('login');
      showLoginError(err.message || '无法连接 Worker，请稍后刷新重试。');
      return null;
    }
    state.authInfo = info;
    renderAuthView(info.needsSetup ? 'setup' : 'login');
    return info;
  }

  async function initAuth() {
    setLoginBusy(true);
    var info = await loadAuthInfo();
    if (!info) return;

    var saved = storageGet('session', STORAGE_KEY);
    if (!saved) return;
    state.token = saved;
    try {
      var data = await request('/api/config');
      if (!data || !data.config || !Array.isArray(data.config.nodes)) {
        throw new ApiError('接口返回数据异常，请确认 Worker 版本是否正确', 0);
      }
      applyConfig(data);
      enterApp();
    } catch (err) {
      state.token = '';
      storageRemove('session', STORAGE_KEY);
      if (err.status && err.status !== 401) {
        showLoginError(err.message || '载入配置失败，请稍后重试。');
      }
      setLoginBusy(false);
    }
  }

  function enterApp() {
    el.authScreen.hidden = true;
    el.app.hidden = false;
    state.users = null;
    state.usersRev = 0;
    state.usersLoading = false;
    state.currentUserId = (state.meta && state.meta.userId) || null;
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
    state.users = null;
    state.usersRev = 0;
    state.currentUserId = null;
    state.usersLoading = false;
    state.userBusy = false;
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
    state.selected.clear();
    state.selectionAnchorId = null;
    state.menuNodeId = null;
    state.menuTrigger = null;
    state.linksParsed = [];
    state.linksErrors = [];
    state.linksExportText = '';
    state.linksTab = 'import';
    state.previewQuery = '';
    state.previewHits = [];
    state.previewHitIndex = -1;
    window.clearTimeout(state.previewSearchTimer);
    window.clearTimeout(state.linksTimer);
    storageRemove('session', STORAGE_KEY);
    closeRowMenu(true);
    closeDrawer(true);
    closeModal('generic', true);
    closeModal('kv', true);
    closeModal('links', true);
    closeUserEditor();
    if (el.userList) el.userList.innerHTML = '';
    if (el.previewSearch) el.previewSearch.value = '';
    if (el.linksInput) el.linksInput.value = '';
    if (el.setAuthToken) el.setAuthToken.value = '';
    el.app.hidden = true;
    el.authScreen.hidden = false;
    el.loginUsername.value = storageGet('local', USERNAME_KEY) || '';
    el.loginPassword.value = '';
    el.loginConfirm.value = '';
    el.loginSetupToken.value = '';
    el.loginToken.value = '';
    el.loginPassword.type = 'password';
    el.loginToken.type = 'password';
    setRevealState(el.loginPasswordReveal, false, '密码');
    setRevealState(el.loginTokenReveal, false, '令牌');
    var view = state.authInfo && state.authInfo.needsSetup ? 'setup' : 'login';
    renderAuthView(view);
    showLoginError(message || '');
    el.subUrlText.textContent = '—';
    el.previewSubUrl.textContent = '—';
    el.yamlCode.innerHTML = '';
    el.codeLines.textContent = '0 行';
    el.codeSize.textContent = '0 KB';
    el.nodeList.innerHTML = '';
    document.body.classList.remove('has-bulk');
    window.setTimeout(function () { el.loginUsername.focus(); }, 60);
  }

  function handleUnauthorized() {
    logout('登录已失效，请重新登录。');
  }

  function applyConfig(data) {
    state.config = data.config;
    state.rev = Number(data.config.rev) || 0;
    state.meta = data.meta || {};
    state.currentUserId = state.meta.userId || state.currentUserId;
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
    renderPreviewGroups();
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
    el.tokenAlert.hidden = !!meta.hasAuthToken;
    el.emptySubAlert.hidden = !(total > 0 && enabled.length === 0);
    el.heroNodeCount.textContent = String(enabled.length);
    el.heroStatusText.textContent = kvMissing
      ? '只读预览 · 尚未连接存储'
      : (meta.corrupted ? '配置异常 · 当前载入默认节点' : '订阅服务运行中');
    if (el.heroVersion) el.heroVersion.textContent = 'v' + (meta.version || '2.0.0');

    if (!total) {
      el.heroTitle.innerHTML = '还没有节点，<br class="hero-br">从第一条线路开始。';
      el.heroDesc.textContent = '添加节点后，这里会自动生成订阅链接与 Clash 配置，所有数据都保存在你自己的 KV 中。';
    } else if (!enabled.length) {
      el.heroTitle.innerHTML = '所有节点已停用，<br class="hero-br">订阅暂时为空。';
      el.heroDesc.textContent = '客户端刷新订阅后只会拿到空配置。启用至少一个节点，或调整筛选后继续维护。';
    } else {
      el.heroTitle.innerHTML = '节点已就绪，随时同步<br class="hero-br">至你的每一台设备。';
      el.heroDesc.textContent = '编辑节点或调整分组后无需重新部署，客户端下次刷新订阅即可获取最新配置。';
    }
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
    el.sysAuth.textContent = meta.authType === 'recovery'
      ? '恢复令牌会话'
      : (meta.username ? '账号 · ' + meta.username : '账号登录');
    el.sysRev.textContent = '#' + state.rev;
    el.sysUpdated.textContent = state.config.updatedAt ? formatFull(state.config.updatedAt) : '尚未保存';

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
      : '尚未配置订阅令牌，请前往设置';
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

  var GROUP_REGIONS = ['us', 'jp', 'hk', 'relay'];

  function isGroupRegion(region) {
    return GROUP_REGIONS.indexOf(region) !== -1;
  }

  // 某分组的节点 id 顺序：独立顺序表优先，未收录的按全局顺序追加
  function orderedRegionIds(region) {
    var stored = ((state.config && state.config.regionOrder) || {})[region] || [];
    var ids = nodes()
      .filter(function (node) { return node.region === region; })
      .map(function (node) { return node.id; });
    var seen = {};
    var out = [];
    stored.forEach(function (id) {
      if (ids.indexOf(id) !== -1 && !seen[id]) {
        seen[id] = true;
        out.push(id);
      }
    });
    ids.forEach(function (id) {
      if (!seen[id]) {
        seen[id] = true;
        out.push(id);
      }
    });
    return out;
  }

  function filteredNodes() {
    var all = nodes();
    var query = state.query.trim().toLowerCase();
    return all.filter(function (node) {
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
  }

  // 当前列表视图：筛选 +（按分组筛选时）该分组的独立顺序。
  // 列表渲染与排序移动必须共用同一顺序，否则换错邻居导致乱序。
  function viewNodes() {
    var list = filteredNodes();
    if (!state.query.trim() && isGroupRegion(state.filterRegion)) {
      var rank = {};
      orderedRegionIds(state.filterRegion).forEach(function (id, i) { rank[id] = i; });
      var far = 1e9;
      list.sort(function (a, b) {
        var ra = rank[a.id] === undefined ? far : rank[a.id];
        var rb = rank[b.id] === undefined ? far : rank[b.id];
        return ra - rb;
      });
    }
    return list;
  }

  function renderNodeList() {
    if (!state.config) return;
    closeRowMenu(true, false);
    var known = {};
    nodes().forEach(function (node) { known[node.id] = true; });
    Array.from(state.selected).forEach(function (id) {
      if (!known[id]) state.selected.delete(id);
    });

    var all = nodes();
    var query = state.query.trim().toLowerCase();
    var filtered = viewNodes();

    el.nodeCountLabel.textContent = query || state.filterType !== 'all' || state.filterRegion !== 'all'
      ? filtered.length + ' / ' + all.length + ' 个节点'
      : '共 ' + all.length + ' 个节点';

    el.nodeHead.hidden = all.length === 0;
    el.nodeEmpty.hidden = all.length !== 0;
    el.nodeEmptyFilter.hidden = !(all.length > 0 && filtered.length === 0);
    el.nodeList.hidden = filtered.length === 0;

    var sortable = !query;
    el.nodeList.innerHTML = filtered.map(function (node, index) {
      return renderNodeRow(node, index, filtered.length, sortable);
    }).join('');
    syncSelectionUi();
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
    if (node.showInMain === false) badges += '<span class="mini-badge" title="不在「选择节点」中显示">不入主组</span>';

    var moveHtml = '';
    if (sortable) {
      moveHtml =
        '<button class="icon-btn move-btn" type="button" data-move-id="' + esc(node.id) + '" data-dir="-1" title="上移" aria-label="上移节点"' + (index === 0 ? ' disabled' : '') + '>' + icon('arrow-up') + '</button>' +
        '<button class="icon-btn move-btn" type="button" data-move-id="' + esc(node.id) + '" data-dir="1" title="下移" aria-label="下移节点"' + (index === total - 1 ? ' disabled' : '') + '>' + icon('arrow-down') + '</button>';
    }

    var checked = state.selected.has(node.id);

    return '<div class="node-row' + (node.enabled ? '' : ' is-disabled') + (checked ? ' is-selected' : '') + '" data-id="' + esc(node.id) + '" tabindex="0" role="button" aria-label="编辑节点 ' + esc(node.name) + '">' +
      '<div class="cell cell-check"><input type="checkbox" class="check-input" data-pick-id="' + esc(node.id) + '" aria-label="选择节点 ' + esc(node.name) + '"' + (checked ? ' checked' : '') + '></div>' +
      '<div class="cell cell-node">' +
        '<span class="node-avatar avatar-' + esc(node.region) + '">' + region.flag + '</span>' +
        '<div class="node-main">' +
          '<div class="node-name"><span>' + esc(node.name) + '</span>' + badges + '</div>' +
          tagHtml +
        '</div>' +
      '</div>' +
      '<div class="cell cell-server">' +
        '<code>' + esc(node.server) + '</code><span class="port">:' + esc(node.port) + '</span>' +
      '</div>' +
      '<div class="cell cell-type"><span class="type-badge t-' + esc(node.type) + '"><span class="dot"></span>' + esc(type.label) + '</span></div>' +
      '<div class="cell cell-region"><span class="region-chip">' + region.flag + ' ' + esc(region.short) + '</span></div>' +
      '<div class="cell cell-status"><button class="switch" type="button" role="switch" data-toggle-id="' + esc(node.id) + '" aria-checked="' + (node.enabled ? 'true' : 'false') + '" aria-label="' + (node.enabled ? '停用节点' : '启用节点') + '"></button></div>' +
      '<div class="cell cell-actions">' +
        moveHtml +
        '<button class="icon-btn" type="button" data-edit-id="' + esc(node.id) + '" title="编辑" aria-label="编辑节点">' + icon('pen') + '</button>' +
        '<button class="icon-btn" type="button" data-menu-id="' + esc(node.id) + '" title="更多操作" aria-label="更多操作" aria-haspopup="menu" aria-expanded="false">' + icon('more') + '</button>' +
      '</div>' +
    '</div>';
  }

  /* ---- selection & bulk actions ---- */

  function canWrite() {
    var meta = state.meta;
    return !!(meta && meta.kv && !meta.readonly);
  }

  function clearSelection() {
    if (!state.selected.size && !state.selectionAnchorId) return;
    state.selected.clear();
    state.selectionAnchorId = null;
    syncSelectionUi();
  }

  function syncSelectionUi() {
    if (!el.nodeList) return;
    var visible = viewNodes();
    var visibleSelected = 0;
    $$('.node-row', el.nodeList).forEach(function (row) {
      var on = state.selected.has(row.dataset.id);
      if (on) visibleSelected += 1;
      row.classList.toggle('is-selected', on);
      var checkbox = $('.check-input', row);
      if (checkbox) checkbox.checked = on;
    });
    if (el.selectAll) {
      el.selectAll.checked = visible.length > 0 && visibleSelected === visible.length;
      el.selectAll.indeterminate = visibleSelected > 0 && visibleSelected < visible.length;
      el.selectAll.disabled = visible.length === 0;
    }
    if (el.bulkBar) {
      var count = state.selected.size;
      el.bulkBar.hidden = count === 0 || state.view !== 'nodes' || el.app.hidden;
      if (count) el.bulkCount.textContent = String(count);
      document.body.classList.toggle('has-bulk', count > 0 && state.view === 'nodes' && !el.app.hidden);
    }
  }

  function toggleSelection(id, checked, shiftKey) {
    var visible = viewNodes();
    var index = visible.findIndex(function (node) { return node.id === id; });
    if (index === -1) return;
    if (shiftKey && state.selectionAnchorId) {
      var anchor = visible.findIndex(function (node) { return node.id === state.selectionAnchorId; });
      if (anchor !== -1) {
        var start = Math.min(anchor, index);
        var end = Math.max(anchor, index);
        for (var i = start; i <= end; i++) {
          if (checked) state.selected.add(visible[i].id);
          else state.selected.delete(visible[i].id);
        }
        syncSelectionUi();
        return;
      }
    }
    if (checked) state.selected.add(id);
    else state.selected.delete(id);
    state.selectionAnchorId = id;
    syncSelectionUi();
  }

  function selectAllVisible(checked) {
    viewNodes().forEach(function (node) {
      if (checked) state.selected.add(node.id);
      else state.selected.delete(node.id);
    });
    state.selectionAnchorId = null;
    syncSelectionUi();
  }

  function setBulkBusy(busy) {
    if (!el.bulkBar) return;
    el.bulkBar.classList.toggle('is-busy', busy);
    $$('button, select', el.bulkBar).forEach(function (control) {
      control.disabled = busy;
    });
  }

  function undoSnapshot(snapshot, message) {
    if (!ensureWritable() || state.mutating) return;
    saveNodes(snapshot, {
      successMessage: message || '已撤销上一步操作',
      rerenderOnError: true
    });
  }

  function bulkSetEnabled(nextEnabled) {
    if (!ensureWritable() || state.mutating) return;
    var ids = Array.from(state.selected);
    if (!ids.length) return;
    var previous = nodes();
    var next = previous.map(function (node) {
      return state.selected.has(node.id) ? Object.assign({}, node, { enabled: nextEnabled }) : node;
    });
    setBulkBusy(true);
    saveNodes(next, {
      successMessage: '已' + (nextEnabled ? '启用' : '停用') + ' ' + ids.length + ' 个节点',
      successAction: {
        label: '撤销',
        run: function () { undoSnapshot(previous, '已恢复上一步的启用状态'); }
      },
      rerenderOnError: true
    }).then(function (ok) {
      setBulkBusy(false);
      if (ok) clearSelection();
    });
  }

  function bulkMoveRegion() {
    if (!ensureWritable() || state.mutating) return;
    var region = el.bulkRegion.value;
    if (!region) return;
    var ids = Array.from(state.selected);
    if (!ids.length) return;
    var meta = REGION_META[region] || REGION_META.other;
    var previous = nodes();
    var next = previous.map(function (node) {
      return state.selected.has(node.id) ? Object.assign({}, node, { region: region }) : node;
    });
    setBulkBusy(true);
    saveNodes(next, {
      successMessage: '已将 ' + ids.length + ' 个节点移至「' + meta.group + '」',
      successAction: {
        label: '撤销',
        run: function () { undoSnapshot(previous, '已恢复节点原分组'); }
      },
      rerenderOnError: true
    }).then(function (ok) {
      setBulkBusy(false);
      el.bulkRegion.value = '';
      if (ok) clearSelection();
    });
  }

  function askBulkDelete() {
    if (!ensureWritable()) return;
    var ids = Array.from(state.selected);
    if (!ids.length) return;
    openConfirm({
      title: '删除选中的 ' + ids.length + ' 个节点？',
      segments: [
        { text: '这些节点会立即从订阅中移除，删除后仍可在右下角提示中' },
        { strong: true, text: '撤销' },
        { text: '。' }
      ],
      okLabel: '删除 ' + ids.length + ' 个节点',
      danger: true,
      onOk: confirmBulkDelete
    });
  }

  async function confirmBulkDelete() {
    if (state.mutating) return;
    var ids = Array.from(state.selected);
    if (!ids.length) {
      closeModal('generic');
      return;
    }
    var previous = nodes();
    var next = previous.filter(function (node) { return !state.selected.has(node.id); });
    el.genericOk.disabled = true;
    el.genericOk.textContent = '删除中…';
    var ok = await saveNodes(next, {
      successMessage: '已删除 ' + ids.length + ' 个节点',
      successAction: {
        label: '撤销',
        run: function () { undoSnapshot(previous, '已恢复被删除的节点'); }
      },
      rerenderOnError: true
    });
    el.genericOk.disabled = false;
    el.genericOk.textContent = '删除 ' + ids.length + ' 个节点';
    if (ok) {
      clearSelection();
      closeModal('generic');
    }
  }

  /* ---- row action menu ---- */

  function closeRowMenu(immediate, restoreFocus) {
    if (!el.rowMenu || el.rowMenu.hidden) {
      state.menuNodeId = null;
      state.menuTrigger = null;
      return;
    }
    var trigger = state.menuTrigger;
    el.rowMenu.hidden = true;
    el.rowMenu.classList.remove('is-open');
    state.menuNodeId = null;
    state.menuTrigger = null;
    if (trigger) {
      trigger.setAttribute('aria-expanded', 'false');
      if (restoreFocus !== false) trigger.focus({ preventScroll: true });
    }
  }

  function openRowMenu(id, trigger) {
    var node = findNode(id);
    if (!node || !el.rowMenu) return;
    closeRowMenu(true, false);
    state.menuNodeId = id;
    state.menuTrigger = trigger;
    $$('[data-menu="duplicate"], [data-menu="delete"]', el.rowMenu).forEach(function (item) {
      item.disabled = !canWrite();
    });
    el.rowMenu.hidden = false;
    el.rowMenu.classList.add('is-open');
    trigger.setAttribute('aria-expanded', 'true');

    var rect = trigger.getBoundingClientRect();
    var menuRect = el.rowMenu.getBoundingClientRect();
    var left = rect.right - menuRect.width;
    left = Math.max(12, Math.min(left, window.innerWidth - menuRect.width - 12));
    var top = rect.bottom + 6;
    if (top + menuRect.height > window.innerHeight - 12) {
      top = rect.top - menuRect.height - 6;
    }
    el.rowMenu.style.left = left + 'px';
    el.rowMenu.style.top = Math.max(12, top) + 'px';

    var first = $('.menu-item:not([disabled])', el.rowMenu);
    if (first) window.setTimeout(function () { first.focus({ preventScroll: true }); }, 20);
  }

  function performRowMenu(action) {
    var id = state.menuNodeId;
    if (!id) return;
    var node = findNode(id);
    closeRowMenu(true, true);
    if (!node) return;
    if (action === 'share') copyShareLink(node);
    else if (action === 'server') copyText(node.server, '服务器地址已复制');
    else if (action === 'duplicate') duplicateNode(id);
    else if (action === 'delete') askDelete(id);
  }

  async function moveNode(id, dir, button) {
    if (!ensureWritable() || state.mutating) return;
    var view = viewNodes();
    var viewIndex = view.findIndex(function (node) { return node.id === id; });
    var viewTarget = viewIndex + dir;
    if (viewIndex < 0 || viewTarget < 0 || viewTarget >= view.length) return;
    setRowBusy(button, true);

    // 按分组筛选时：只改该分组的独立顺序表，不动全局顺序，其他分组与 🌍组不受影响
    if (isGroupRegion(state.filterRegion)) {
      var order = orderedRegionIds(state.filterRegion);
      var idA = view[viewIndex].id;
      var idB = view[viewTarget].id;
      var pa = order.indexOf(idA);
      var pb = order.indexOf(idB);
      if (pa < 0 || pb < 0) {
        if (button) button.disabled = false;
        return;
      }
      var tmp = order[pa];
      order[pa] = order[pb];
      order[pb] = tmp;
      var regionOrder = Object.assign({}, (state.config && state.config.regionOrder) || {});
      regionOrder[state.filterRegion] = order;
      var okGroup = await saveNodes(nodes(), {
        regionOrder: regionOrder,
        successMessage: '分组内顺序已更新，不影响其他分组',
        rerenderOnError: true
      });
      if (!okGroup && button) button.disabled = false;
      return;
    }

    // 未筛选（或按协议筛选）：调整全局顺序
    var nextNodes = nodes().slice();
    var a = nextNodes.findIndex(function (node) { return node.id === view[viewIndex].id; });
    var b = nextNodes.findIndex(function (node) { return node.id === view[viewTarget].id; });
    var moved = nextNodes[a];
    nextNodes[a] = nextNodes[b];
    nextNodes[b] = moved;
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
      var active = button.dataset.view === view;
      button.classList.toggle('is-active', active);
      if (active) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    });
    el.views.forEach(function (panel) {
      panel.hidden = panel.dataset.viewPanel !== view;
    });
    el.crumb.textContent = VIEW_META[view];
    if (el.bulkBar) el.bulkBar.hidden = view !== 'nodes' || state.selected.size === 0;
    document.body.classList.toggle('has-bulk', view === 'nodes' && state.selected.size > 0 && !el.app.hidden);
    if (view === 'preview' && (!state.preview || state.previewDirty)) loadPreview();
    if (view === 'nodes') renderNodeList();
    if (view === 'overview') renderOverview();
    if (view === 'settings') {
      renderSettings();
      loadUsers();
    }
    window.scrollTo(0, 0);
  }

  /* ------------------------------------------------------------------ */
  /* settings (parameter presets)                                        */
  /* ------------------------------------------------------------------ */

  function currentDefaults() {
    return (state.config && state.config.defaults) || {};
  }

  function renderAuthTokenNote() {
    if (!el.authTokenNote) return;
    var meta = state.meta || {};
    var stored = !!(state.config && state.config.authToken);
    if (stored) {
      el.authTokenNote.textContent = '当前使用设置页保存的令牌；保存新值会立即使旧令牌失效。该令牌仅用于订阅访问，不能登录控制台。';
    } else if (meta.authSource === 'environment') {
      el.authTokenNote.textContent = '当前使用环境变量 AUTH_TOKEN；填写新令牌并保存后，改由设置页管理。该令牌仅用于订阅访问，不能登录控制台。';
    } else {
      el.authTokenNote.textContent = '当前尚未配置订阅令牌，填写并保存后订阅链接立即可用；该令牌不能用于登录控制台。';
    }
  }

  function renderSettings() {
    if (!state.config) return;
    var defaults = currentDefaults();
    var info = state.config.subscription || {};
    setField(el.setAuthToken, state.config.authToken || '');
    if (el.setAuthToken) {
      el.setAuthToken.placeholder = state.config.authToken
        ? '留空则保持当前令牌不变'
        : '至少 16 个字符';
    }
    renderAuthTokenNote();
    setField(el.setUuid, defaults.vlessUuid || '');
    setField(el.setPbk, defaults.vlessPublicKey || '');
    setField(el.setSid, defaults.vlessShortId || '');
    setField(el.setSni, defaults.vlessServername || '');
    setField(el.setTotal, info.totalGB > 0 ? info.totalGB : '');
    setField(el.setExpire, info.expire || '');
    el.settingsUpdated.textContent = state.config.updatedAt
      ? '保存于 ' + formatShort(state.config.updatedAt)
      : '尚未保存';
    applyThemeUi();
    clearSettingsErrors();
  }

  function setSettingsBusy(busy) {
    el.settingsSave.disabled = busy;
    el.settingsSave.classList.toggle('is-loading', busy);
    el.settingsSaveSpinner.hidden = !busy;
    el.settingsSaveLabel.textContent = busy ? '保存中…' : '保存设置';
  }

  function clearSettingsErrors() {
    $$('.field.has-error', el.settingsForm).forEach(function (field) { field.classList.remove('has-error'); });
    $$('.field-error', el.settingsForm).forEach(function (error) { error.textContent = ''; });
    $$('[aria-invalid="true"]', el.settingsForm).forEach(function (input) { input.removeAttribute('aria-invalid'); });
    el.settingsGlobalError.hidden = true;
    el.settingsGlobalError.textContent = '';
  }

  function clearSettingsFieldError(event) {
    var field = event.target.closest ? event.target.closest('.field') : null;
    if (field) {
      field.classList.remove('has-error');
      $$('.field-error', field).forEach(function (error) { error.textContent = ''; });
      $$('[aria-invalid="true"]', field).forEach(function (input) { input.removeAttribute('aria-invalid'); });
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
      var fieldInput = $('input, select', field);
      if (fieldInput) fieldInput.setAttribute('aria-invalid', 'true');
      if (!firstInput) firstInput = fieldInput;
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

    var authToken = '';
    var authTokenRaw = String(el.setAuthToken.value || '').trim();
    if (authTokenRaw) {
      if (authTokenRaw.length < 16) {
        errors.push({ key: 'setAuthToken', message: '订阅令牌至少需要 16 个字符' });
      } else if (authTokenRaw.length > 256) {
        errors.push({ key: 'setAuthToken', message: '订阅令牌不能超过 256 个字符' });
      } else if (/[\s\u0000-\u001f\u007f]/.test(authTokenRaw)) {
        errors.push({ key: 'setAuthToken', message: '订阅令牌不能包含空格或控制字符' });
      } else {
        authToken = authTokenRaw;
      }
    }

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

    var subscription = {};
    var totalRaw = String(el.setTotal.value || '').trim();
    if (totalRaw) {
      var total = Number(totalRaw);
      if (!Number.isFinite(total) || total <= 0) {
        errors.push({ key: 'setTotal', message: '流量上限必须是大于 0 的数字' });
      } else if (total > MAX_TOTAL_GB) {
        errors.push({ key: 'setTotal', message: '流量上限不能超过 ' + MAX_TOTAL_GB + ' GB' });
      } else {
        subscription.totalGB = Math.round(total * 100) / 100;
      }
    }

    var expire = String(el.setExpire.value || '').trim();
    if (expire) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(expire) || Number.isNaN(Date.parse(expire + 'T00:00:00Z'))) {
        errors.push({ key: 'setExpire', message: '到期日期格式不正确' });
      } else {
        subscription.expire = expire;
      }
    }

    return { defaults: defaults, subscription: subscription, authToken: authToken, errors: errors };
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
      var body = {
        rev: state.rev,
        nodes: nodes(),
        defaults: result.defaults,
        subscription: result.subscription
      };
      if (result.authToken) body.authToken = result.authToken;
      var data = await request('/api/config', { method: 'PUT', body: body });
      applyConfig(data);
      renderAll();
      renderSettings();
      toast(result.authToken
        ? '设置已保存，新订阅令牌即时生效'
        : '设置已保存，订阅信息即时生效，新建 VLESS 节点将使用新预设', 'success');
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
  /* users                                                               */
  /* ------------------------------------------------------------------ */

  function findUser(id) {
    return (state.users || []).filter(function (user) { return user.id === id; })[0] || null;
  }

  function userInitial(name) {
    var text = String(name || '?').trim();
    return text ? text.charAt(0).toUpperCase() : '?';
  }

  function syncUserAddState() {
    if (!el.userAdd) return;
    var maxed = Array.isArray(state.users) && state.users.length >= MAX_USERS;
    el.userAdd.disabled = maxed || (el.userForm && !el.userForm.hidden);
    el.userAdd.title = maxed ? '最多只能创建 ' + MAX_USERS + ' 个用户' : '';
  }

  function applyUsersResponse(data) {
    if (!data) return;
    if (Array.isArray(data.users)) state.users = data.users;
    state.usersRev = Number(data.rev) || 0;
    if (data.currentUserId) state.currentUserId = data.currentUserId;
    if (data.token) {
      state.token = data.token;
      storageSet('session', STORAGE_KEY, data.token);
    }
    renderUsers();
  }

  async function loadUsers(force) {
    if (!state.config) return;
    if (!force && Array.isArray(state.users)) {
      renderUsers();
      return;
    }
    if (state.usersLoading) return;
    state.usersLoading = true;
    if (!Array.isArray(state.users) || force) {
      el.userList.innerHTML = '<div class="user-empty">正在载入账号…</div>';
    }
    try {
      applyUsersResponse(await request('/api/users'));
    } catch (err) {
      if (err.status === 401) {
        handleUnauthorized();
        return;
      }
      el.userList.innerHTML = '<div class="user-empty is-error">' + esc(err.message || '账号加载失败，请稍后重试') + '</div>';
    } finally {
      state.usersLoading = false;
    }
  }

  function renderUsers() {
    if (!el.userList) return;
    var users = Array.isArray(state.users) ? state.users : [];
    if (!users.length) {
      el.userList.innerHTML = '<div class="user-empty">还没有可用账号，请添加一个。</div>';
      syncUserAddState();
      return;
    }
    el.userList.innerHTML = users.map(function (user) {
      var current = user.id === state.currentUserId;
      var last = users.length <= 1;
      var canDelete = !current && !last;
      var created = user.createdAt ? formatShort(user.createdAt) : '';
      var deleteTitle = current ? '不能删除当前登录账号' : '至少需要保留一个账号';
      return '<div class="user-row' + (current ? ' is-current' : '') + '">' +
        '<span class="user-avatar">' + esc(userInitial(user.username)) + '</span>' +
        '<span class="user-main">' +
          '<span class="user-name" title="' + esc(user.username) + '">' + esc(user.username) + (current ? '<span class="user-badge">当前账号</span>' : '') + '</span>' +
          '<span class="user-sub">' + (created ? '创建于 ' + esc(created) + ' · ' : '') + '管理员</span>' +
        '</span>' +
        '<span class="user-actions">' +
          '<button class="btn btn-quiet btn-sm" type="button" data-user-reset="' + esc(user.id) + '">重置密码</button>' +
          '<button class="btn btn-quiet btn-sm user-delete" type="button" data-user-delete="' + esc(user.id) + '"' +
            (canDelete ? ' title="删除账号" aria-label="删除账号 ' + esc(user.username) + '"' : ' disabled title="' + deleteTitle + '"') +
            '>' + icon('trash') + '</button>' +
        '</span>' +
      '</div>';
    }).join('');
    syncUserAddState();
  }

  function clearUserErrors() {
    if (!el.userForm) return;
    $$('.field', el.userForm).forEach(function (field) { field.classList.remove('has-error'); });
    $$('[data-user-error]', el.userForm).forEach(function (error) { error.textContent = ''; });
    $$('[aria-invalid="true"]', el.userForm).forEach(function (input) { input.removeAttribute('aria-invalid'); });
  }

  function clearUserFieldError(event) {
    var field = event.target.closest ? event.target.closest('.field') : null;
    if (!field) return;
    field.classList.remove('has-error');
    $$('[data-user-error]', field).forEach(function (error) { error.textContent = ''; });
    $$('[aria-invalid="true"]', field).forEach(function (input) { input.removeAttribute('aria-invalid'); });
    var global = $('[data-user-error="global"]', el.userForm);
    if (global) global.textContent = '';
  }

  function showUserErrors(errors) {
    clearUserErrors();
    var firstInput = null;
    (errors || []).forEach(function (error) {
      var key = error.key || 'global';
      var target = $('[data-user-error="' + key + '"]', el.userForm);
      if (!target) target = $('[data-user-error="global"]', el.userForm);
      if (!target) return;
      target.textContent = error.message;
      if (key === 'global' || target.getAttribute('data-user-error') === 'global') return;
      var field = target.closest('.field');
      if (!field) return;
      field.classList.add('has-error');
      var input = $('input', field);
      if (input) {
        input.setAttribute('aria-invalid', 'true');
        if (!firstInput) firstInput = input;
      }
    });
    if (firstInput) firstInput.focus({ preventScroll: true });
  }

  function setUserBusy(busy) {
    el.userSave.disabled = busy;
    el.userSave.classList.toggle('is-loading', busy);
    el.userSaveSpinner.hidden = !busy;
    el.userCancel.disabled = busy;
    if (!busy) {
      el.userSaveLabel.textContent = state.userFormMode === 'reset' ? '保存新密码' : '添加用户';
    }
  }

  function openUserEditor(mode, id) {
    if (!el.userForm) return;
    if (mode === 'reset') {
      var user = findUser(id);
      if (!user) return;
      state.userFormMode = 'reset';
      state.userFormId = id;
      el.userFormTitle.textContent = '重置密码';
      el.userFormSub.textContent = user.id === state.currentUserId
        ? '为当前账号设置新密码，保存后本标签页保持登录。'
        : '为 ' + user.username + ' 设置新密码，保存后其旧登录立即失效。';
      el.userUsername.value = user.username;
      el.userUsername.disabled = true;
      el.userSaveLabel.textContent = '保存新密码';
    } else {
      state.userFormMode = 'add';
      state.userFormId = null;
      el.userFormTitle.textContent = '添加用户';
      el.userFormSub.textContent = '创建后即可使用该账号登录控制台';
      el.userUsername.value = '';
      el.userUsername.disabled = false;
      el.userSaveLabel.textContent = '添加用户';
    }
    el.userPassword.value = '';
    el.userPassword2.value = '';
    clearUserErrors();
    setUserBusy(false);
    el.userForm.hidden = false;
    syncUserAddState();
    window.setTimeout(function () {
      var target = state.userFormMode === 'add' ? el.userUsername : el.userPassword;
      el.userForm.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      target.focus({ preventScroll: true });
    }, 40);
  }

  function closeUserEditor() {
    if (!el.userForm) return;
    el.userForm.hidden = true;
    state.userFormMode = 'add';
    state.userFormId = null;
    el.userUsername.value = '';
    el.userUsername.disabled = false;
    el.userPassword.value = '';
    el.userPassword2.value = '';
    clearUserErrors();
    setUserBusy(false);
    syncUserAddState();
  }

  function collectUserForm() {
    var errors = [];
    var username = String(el.userUsername.value || '').trim();
    var password = el.userPassword.value || '';
    var confirm = el.userPassword2.value || '';
    if (state.userFormMode === 'add') {
      if (!username) {
        errors.push({ key: 'username', message: '请输入用户名' });
      } else if (!USERNAME_RE.test(username)) {
        errors.push({ key: 'username', message: '需 3–254 位，以字母或数字开头，可含 . _ + @ -，也可直接填写邮箱' });
      }
    }
    if (!password) {
      errors.push({ key: 'password', message: '请输入密码' });
    } else if (password.length < 8) {
      errors.push({ key: 'password', message: '密码至少需要 8 个字符' });
    } else if (password.length > 128) {
      errors.push({ key: 'password', message: '密码不能超过 128 个字符' });
    } else if (password !== confirm) {
      errors.push({ key: 'password', message: '两次输入的密码不一致' });
    }
    return { username: username, password: password, errors: errors };
  }

  async function submitUserForm(event) {
    if (event) event.preventDefault();
    if (state.userBusy) return;
    clearUserErrors();
    var result = collectUserForm();
    if (result.errors.length) {
      showUserErrors(result.errors);
      return;
    }
    var mode = state.userFormMode;
    var id = state.userFormId;
    state.userBusy = true;
    setUserBusy(true);
    try {
      var data;
      if (mode === 'add') {
        data = await request('/api/users', {
          method: 'POST',
          body: { rev: state.usersRev, username: result.username, password: result.password }
        });
      } else {
        data = await request('/api/users/update', {
          method: 'POST',
          body: { rev: state.usersRev, id: id, password: result.password }
        });
      }
      applyUsersResponse(data);
      closeUserEditor();
      if (mode === 'add') toast('已添加用户「' + result.username + '」', 'success');
      else toast(id === state.currentUserId ? '密码已更新，当前登录保持有效' : '密码已重置，该账号的旧登录已失效', 'success');
    } catch (err) {
      if (err.status === 401) {
        handleUnauthorized();
        return;
      }
      if (err.status === 409) await loadUsers(true);
      showUserErrors([{ key: err.field || 'global', message: err.message || '保存失败，请稍后重试' }]);
    } finally {
      state.userBusy = false;
      setUserBusy(false);
    }
  }

  function askDeleteUser(id) {
    var user = findUser(id);
    if (!user) return;
    if (id === state.currentUserId) {
      toast('不能删除当前登录账号', 'info');
      return;
    }
    if ((state.users || []).length <= 1) {
      toast('至少需要保留一个管理员账号', 'info');
      return;
    }
    state.userDeletingId = id;
    openConfirm({
      title: '删除这个账号？',
      segments: [
        { text: '即将删除 ' },
        { strong: true, text: user.username },
        { text: '，该账号会立即退出登录且无法恢复。' }
      ],
      okLabel: '删除账号',
      danger: true,
      onOk: confirmDeleteUser
    });
  }

  async function confirmDeleteUser() {
    var id = state.userDeletingId;
    if (!id || state.userBusy) return;
    var user = findUser(id);
    if (!user) {
      closeModal('generic');
      return;
    }
    state.userBusy = true;
    el.genericOk.disabled = true;
    el.genericOk.textContent = '删除中…';
    try {
      var data = await request('/api/users/delete', {
        method: 'POST',
        body: { rev: state.usersRev, id: id }
      });
      state.userDeletingId = null;
      applyUsersResponse(data);
      closeModal('generic');
      toast('已删除账号「' + user.username + '」', 'success');
    } catch (err) {
      if (err.status === 401) {
        closeModal('generic');
        handleUnauthorized();
        return;
      }
      if (err.status === 409) await loadUsers(true);
      el.genericOk.disabled = false;
      el.genericOk.textContent = '删除账号';
      toast(err.message || '删除失败，请稍后重试', 'error');
    } finally {
      state.userBusy = false;
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
      var body = { rev: state.rev, nodes: nextNodes };
      if (opts.defaults) body.defaults = opts.defaults;
      if (opts.subscription) body.subscription = opts.subscription;
      if (opts.regionOrder) body.regionOrder = opts.regionOrder;
      var data = await request('/api/config', {
        method: 'PUT',
        body: body
      });
      applyConfig(data);
      renderAll();
      if (opts.form) closeDrawer();
      if (opts.successMessage) toast(opts.successMessage, 'success', opts.successAction);
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

  /* 通用确认弹窗：删除节点、导入备份等不可撤销操作共用 */
  var confirmCallback = null;

  function setGenericVisual(danger) {
    el.genericIcon.className = 'modal-icon ' + (danger ? 'tone-rose' : 'tone-indigo');
    var use = $('use', el.genericIcon);
    if (use) use.setAttribute('href', danger ? '#i-trash' : '#i-info');
    el.genericOk.className = 'btn ' + (danger ? 'btn-danger' : 'btn-primary');
  }

  function openConfirm(options) {
    var opts = options || {};
    el.genericTitle.textContent = opts.title || '确认操作';
    el.genericBody.textContent = '';
    (opts.segments || [{ text: '确认执行此操作吗？' }]).forEach(function (seg) {
      if (seg.strong) {
        var strong = document.createElement('strong');
        strong.textContent = seg.text;
        el.genericBody.appendChild(strong);
      } else {
        el.genericBody.appendChild(document.createTextNode(seg.text));
      }
    });
    el.genericOk.disabled = false;
    el.genericOk.textContent = opts.okLabel || '确认';
    setGenericVisual(opts.danger !== false);
    confirmCallback = typeof opts.onOk === 'function' ? opts.onOk : null;
    openModal('generic');
  }

  function askDelete(id) {
    if (!ensureWritable()) return;
    var target = findNode(id);
    if (!target) return;
    state.deletingId = id;
    openConfirm({
      title: '删除这个节点？',
      segments: [
        { text: '即将删除 ' },
        { strong: true, text: target.name },
        { text: '，该操作会立即写入订阅且无法撤销。' }
      ],
      okLabel: '删除节点',
      danger: true,
      onOk: confirmDelete
    });
  }

  async function confirmDelete() {
    var id = state.deletingId;
    if (!id || state.mutating) return;
    var target = findNode(id);
    if (!target) {
      closeModal('generic');
      return;
    }
    el.genericOk.disabled = true;
    el.genericOk.textContent = '删除中…';
    var nextNodes = nodes().filter(function (node) { return node.id !== id; });
    var ok = await saveNodes(nextNodes, {
      successMessage: '节点「' + target.name + '」已删除',
      rerenderOnError: true
    });
    el.genericOk.disabled = false;
    el.genericOk.textContent = '删除节点';
    if (ok) {
      state.deletingId = null;
      closeModal('generic');
    }
  }

  /* ------------------------------------------------------------------ */
  /* backup export / import                                              */
  /* ------------------------------------------------------------------ */

  function backupStamp() {
    var now = new Date();
    var pad = function (n) { return String(n).padStart(2, '0'); };
    return now.getFullYear() + pad(now.getMonth() + 1) + pad(now.getDate()) +
      '-' + pad(now.getHours()) + pad(now.getMinutes());
  }

  function exportBackup() {
    if (!state.config) return;
    var payload = {
      app: 'transit-hub',
      v: 1,
      exportedAt: new Date().toISOString(),
      nodes: nodes(),
      defaults: currentDefaults(),
      regionOrder: (state.config && state.config.regionOrder) || {},
      subscription: (state.config && state.config.subscription) || {}
    };
    var blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var link = document.createElement('a');
    link.href = url;
    link.download = 'transit-hub-backup-' + backupStamp() + '.json';
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    toast('备份已导出（' + nodes().length + ' 个节点）', 'success');
  }

  function importBackupFile(file) {
    if (!file || !ensureWritable()) return;
    var reader = new FileReader();
    reader.onload = function () {
      var parsed;
      try {
        parsed = JSON.parse(reader.result);
      } catch (err) {
        toast('备份文件不是有效的 JSON', 'error');
        return;
      }
      if (!parsed || !Array.isArray(parsed.nodes)) {
        toast('备份文件格式不正确：缺少节点数据', 'error');
        return;
      }
      openConfirm({
        title: '导入备份？',
        segments: [
          { text: '将用备份文件覆盖当前全部配置（' },
          { strong: true, text: String(parsed.nodes.length) + ' 个节点' },
          { text: '），包括参数预设、订阅信息与分组排序，该操作无法撤销。' }
        ],
        okLabel: '确认导入',
        danger: false,
        onOk: function () { doImport(parsed); }
      });
    };
    reader.onerror = function () { toast('读取备份文件失败', 'error'); };
    reader.readAsText(file);
  }

  async function doImport(parsed) {
    if (state.mutating) return;
    el.genericOk.disabled = true;
    el.genericOk.textContent = '导入中…';
    var ok = await saveNodes(parsed.nodes, {
      defaults: parsed.defaults && typeof parsed.defaults === 'object' ? parsed.defaults : {},
      regionOrder: parsed.regionOrder && typeof parsed.regionOrder === 'object' ? parsed.regionOrder : {},
      subscription: parsed.subscription && typeof parsed.subscription === 'object' ? parsed.subscription : {},
      successMessage: '已导入备份（' + parsed.nodes.length + ' 个节点）',
      rerenderOnError: true
    });
    el.genericOk.disabled = false;
    el.genericOk.textContent = '确认导入';
    if (ok) closeModal('generic');
  }

  /* ------------------------------------------------------------------ */
  /* share links                                                         */
  /* ------------------------------------------------------------------ */

  var SHARE_PARSERS = {
    vless: parseVlessLink,
    vmess: parseVmessLink,
    trojan: parseTrojanLink,
    hysteria2: parseHysteria2Link,
    hy2: parseHysteria2Link,
    ss: parseSSLink
  };

  var REGION_HINTS = [
    { key: 'relay', re: /中转|专线|iplc|iepl|relay|transit|bgp|入口|落地|沪日|深港/i },
    { key: 'hk', re: /香港|港台|台湾|台北|新北|彰化|高雄|hkg|hong\s?kong|\bhk\b|\btw\b|taiwan|taipei/i },
    { key: 'jp', re: /日本|东京|大阪|埼玉|名古屋|jpn|tokyo|osaka|\bjp\b/i },
    { key: 'us', re: /美国|洛杉矶|圣何塞|硅谷|西雅图|纽约|芝加哥|达拉斯|凤凰城|迈阿密|usa|united\s?states|los\s?angeles|san\s?jose|seattle|new\s?york|chicago|dallas|\bus\b/i }
  ];

  function safeDecodeURI(value) {
    try {
      return decodeURIComponent(value);
    } catch (err) {
      return value;
    }
  }

  function base64UrlToBase64(value) {
    var text = String(value || '').replace(/-/g, '+').replace(/_/g, '/').replace(/\s+/g, '');
    while (text.length % 4) text += '=';
    return text;
  }

  function decodeBase64Text(value) {
    var binary = window.atob(base64UrlToBase64(value));
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  function encodeBase64Text(value) {
    var bytes = new TextEncoder().encode(value);
    var binary = '';
    for (var i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return window.btoa(binary);
  }

  function encodeBase64Url(value) {
    return encodeBase64Text(value).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function parseShareQuery(raw) {
    var out = {};
    String(raw || '').split('&').forEach(function (pair) {
      if (!pair) return;
      var split = pair.indexOf('=');
      var key = split === -1 ? pair : pair.slice(0, split);
      var value = split === -1 ? '' : pair.slice(split + 1);
      out[safeDecodeURI(key).toLowerCase()] = safeDecodeURI(value.replace(/\+/g, '%2B'));
    });
    return out;
  }

  function splitShareUri(line) {
    var match = String(line || '').match(/^([A-Za-z0-9+.-]+):\/\/(.*)$/);
    if (!match) return null;
    var scheme = match[1].toLowerCase();
    var rest = match[2];
    var name = '';
    var hash = rest.indexOf('#');
    if (hash !== -1) {
      name = safeDecodeURI(rest.slice(hash + 1)).trim();
      rest = rest.slice(0, hash);
    }
    var query = '';
    var mark = rest.indexOf('?');
    if (mark !== -1) {
      query = rest.slice(mark + 1);
      rest = rest.slice(0, mark);
    }
    if (scheme === 'vless' || scheme === 'trojan' || scheme === 'hysteria2' || scheme === 'hy2') {
      rest = rest.replace(/\/+$/, '');
    }
    return { scheme: scheme, body: rest, query: parseShareQuery(query), name: name };
  }

  function splitShareAuthority(body) {
    var at = String(body || '').lastIndexOf('@');
    if (at === -1) return { userinfo: '', hostport: body || '' };
    return { userinfo: body.slice(0, at), hostport: body.slice(at + 1) };
  }

  function splitHostPort(value) {
    var text = String(value || '').trim();
    if (!text) return { host: '', port: 0 };
    if (text.charAt(0) === '[') {
      var close = text.indexOf(']');
      if (close === -1) return { host: '', port: 0 };
      var inside = text.slice(1, close);
      var rest = text.slice(close + 1);
      var portMatch = rest.match(/^:(\d+)$/);
      return { host: inside, port: portMatch ? Number(portMatch[1]) : 0 };
    }
    var slash = text.indexOf('/');
    if (slash !== -1) text = text.slice(0, slash);
    var colon = text.lastIndexOf(':');
    if (colon === -1) return { host: text, port: 0 };
    return { host: text.slice(0, colon), port: Number(text.slice(colon + 1)) || 0 };
  }

  function shareHost(value, label) {
    var text = String(value || '').trim();
    if (!text) return '';
    if (text.length > 253 || CONTROL_RE.test(text) || !HOST_RE.test(text)) {
      throw new Error(label + '格式不正确');
    }
    return text;
  }

  function shareEndpoint(hostport) {
    var parts = splitHostPort(hostport);
    var host = String(parts.host || '').trim();
    if (!host || !HOST_RE.test(host) || CONTROL_RE.test(host)) throw new Error('服务器地址格式不正确');
    if (!parts.port || parts.port < 1 || parts.port > 65535) throw new Error('端口号无效');
    return { server: host, port: parts.port };
  }

  function shareBandwidth(value) {
    var text = String(value || '').trim();
    if (!text) return '';
    if (/^\d{1,6}(?:\.\d{1,2})?$/.test(text)) return text + ' mbps';
    if (BANDWIDTH_RE.test(text)) return text;
    return '';
  }

  function shareBool(value) {
    return /^(1|true|yes|on)$/i.test(String(value || ''));
  }

  function parseVlessLink(parts) {
    if (!parts.body) throw new Error('缺少 UUID 与服务器地址');
    var auth = splitShareAuthority(parts.body);
    var uuid = safeDecodeURI(auth.userinfo);
    if (!uuid) throw new Error('缺少 UUID');
    if (!UUID_RE.test(uuid)) throw new Error('UUID 格式不正确');
    var endpoint = shareEndpoint(auth.hostport);
    var query = parts.query;
    var network = (query.type || 'tcp').toLowerCase();
    if (['tcp', 'ws', 'grpc'].indexOf(network) === -1) throw new Error('暂不支持 ' + network + ' 传输');
    var security = (query.security || '').toLowerCase();
    if (security === 'xtls') security = 'tls';
    if (security && ['tls', 'reality', 'none'].indexOf(security) === -1) throw new Error('暂不支持 ' + security + ' 加密方式');
    var reality = security === 'reality';
    var tls = security === 'tls' || reality;
    if (reality && !query.pbk) throw new Error('Reality 链接缺少 pbk 公钥');

    var node = {
      type: 'vless',
      server: endpoint.server,
      port: endpoint.port,
      uuid: uuid.toLowerCase(),
      network: network,
      tls: tls,
      reality: reality,
      servername: shareHost(query.sni || query.host, 'SNI'),
      fingerprint: FINGERPRINTS.indexOf((query.fp || '').toLowerCase()) !== -1 ? query.fp.toLowerCase() : 'chrome',
      flow: (network === 'tcp' && tls) ? (query.flow || '') : '',
      udp: true
    };
    if (reality) {
      node.publicKey = String(query.pbk || '').slice(0, 128);
      node.shortId = String(query.sid || '').slice(0, 32);
    }
    if (network === 'ws') {
      node.wsPath = query.path || '/';
      node.wsHost = shareHost(query.host, 'WS Host');
    }
    if (network === 'grpc') {
      node.grpcService = String(query.servicename || query.path || '').slice(0, 64);
    }
    return { node: node, name: 'VLESS · ' + endpoint.server };
  }

  function parseVmessLink(parts) {
    var data;
    try {
      data = JSON.parse(decodeBase64Text(parts.body));
    } catch (err) {
      throw new Error('VMess 内容不是有效的 Base64 JSON');
    }
    if (!data || typeof data !== 'object') throw new Error('VMess 内容格式不正确');
    var uuid = String(data.id || '').trim();
    if (!UUID_RE.test(uuid)) throw new Error('UUID 格式不正确');
    var aid = data.aid === undefined || data.aid === null || data.aid === '' ? 0 : Number(data.aid);
    if (aid) throw new Error('暂不支持 alterId ≠ 0 的旧版 VMess');
    if (data.scy && String(data.scy).toLowerCase() !== 'auto') {
      throw new Error('暂不支持 ' + data.scy + ' 加密方式');
    }
    var vmServer = String(data.add || '').trim();
    var vmPort = Number(data.port);
    if (!vmServer || !HOST_RE.test(vmServer) || CONTROL_RE.test(vmServer)) throw new Error('服务器地址格式不正确');
    if (!vmPort || vmPort < 1 || vmPort > 65535) throw new Error('端口号无效');
    var endpoint = { server: vmServer, port: vmPort };
    var network = String(data.net || 'tcp').toLowerCase();
    if (['tcp', 'ws', 'grpc'].indexOf(network) === -1) throw new Error('暂不支持 ' + network + ' 传输');
    var tls = String(data.tls || '').toLowerCase() === 'tls';
    var node = {
      type: 'vmess',
      server: endpoint.server,
      port: endpoint.port,
      uuid: uuid.toLowerCase(),
      network: network,
      tls: tls,
      servername: shareHost(data.sni || data.host, 'SNI'),
      udp: true
    };
    if (network === 'ws') {
      node.wsPath = data.path || '/';
      node.wsHost = shareHost(data.host, 'WS Host');
    }
    if (network === 'grpc') {
      node.grpcService = String(data.path || data.serviceName || '').slice(0, 64);
    }
    return { node: node, name: String(data.ps || '').trim() || ('VMess · ' + endpoint.server) };
  }

  function parseTrojanLink(parts) {
    if (!parts.body) throw new Error('缺少密码与服务器地址');
    var auth = splitShareAuthority(parts.body);
    var password = safeDecodeURI(auth.userinfo);
    if (!password) throw new Error('缺少密码');
    var endpoint = shareEndpoint(auth.hostport);
    var query = parts.query;
    var network = (query.type || 'tcp').toLowerCase();
    if (network !== 'tcp') throw new Error('Trojan 的 ' + network + ' 传输暂不支持');
    return {
      node: {
        type: 'trojan',
        server: endpoint.server,
        port: endpoint.port,
        password: password.slice(0, 128),
        sni: shareHost(query.sni || query.peer, 'SNI'),
        skipCertVerify: shareBool(query.allowinsecure || query.insecure),
        udp: true
      },
      name: 'Trojan · ' + endpoint.server
    };
  }

  function parseHysteria2Link(parts) {
    if (!parts.body) throw new Error('缺少密码与服务器地址');
    var auth = splitShareAuthority(parts.body);
    var password = safeDecodeURI(auth.userinfo);
    if (!password) throw new Error('缺少密码');
    var endpoint = shareEndpoint(auth.hostport);
    var query = parts.query;
    if (query.obfs) throw new Error('暂不支持 Hysteria2 的 obfs 混淆');
    return {
      node: {
        type: 'hysteria2',
        server: endpoint.server,
        port: endpoint.port,
        password: password.slice(0, 128),
        sni: shareHost(query.sni || query.peer, 'SNI'),
        skipCertVerify: shareBool(query.insecure || query.allowinsecure),
        up: shareBandwidth(query.up || query.upmbps),
        down: shareBandwidth(query.down || query.downmbps)
      },
      name: 'Hysteria2 · ' + endpoint.server
    };
  }

  function parseSSLink(parts) {
    var body = String(parts.body || '');
    if (!body) throw new Error('缺少加密方式与服务器地址');
    if (parts.query.plugin) throw new Error('暂不支持 Shadowsocks 插件');
    var userinfo = '';
    var hostport = '';
    var at = body.lastIndexOf('@');

    if (at !== -1) {
      var rawUser = body.slice(0, at);
      var decodedUser = safeDecodeURI(rawUser);
      if (decodedUser.indexOf(':') !== -1) {
        userinfo = decodedUser;
      } else {
        try {
          userinfo = decodeBase64Text(rawUser);
        } catch (err) {
          throw new Error('SS 用户信息不是有效的 Base64');
        }
      }
      hostport = body.slice(at + 1);
    } else {
      var decodedBody;
      try {
        decodedBody = decodeBase64Text(body);
      } catch (err) {
        throw new Error('SS 链接不是有效的 Base64');
      }
      var split = decodedBody.lastIndexOf('@');
      if (split === -1) throw new Error('SS 链接缺少服务器地址');
      userinfo = decodedBody.slice(0, split);
      hostport = decodedBody.slice(split + 1);
    }

    var colon = userinfo.indexOf(':');
    if (colon === -1) throw new Error('SS 链接缺少加密方式或密码');
    var cipher = userinfo.slice(0, colon).trim().toLowerCase();
    var password = userinfo.slice(colon + 1);
    if (SS_CIPHERS.indexOf(cipher) === -1) throw new Error('暂不支持 ' + cipher + ' 加密方式');
    if (!password) throw new Error('缺少密码');
    var endpoint = shareEndpoint(hostport);
    return {
      node: {
        type: 'ss',
        server: endpoint.server,
        port: endpoint.port,
        cipher: cipher,
        password: password.slice(0, 128),
        udp: true
      },
      name: 'SS · ' + endpoint.server
    };
  }

  function parseShareLink(line) {
    var parts = splitShareUri(line);
    if (!parts) throw new Error('不是有效的分享链接');
    var parser = SHARE_PARSERS[parts.scheme];
    if (!parser) throw new Error('暂不支持 ' + parts.scheme + ':// 协议');
    var parsed = parser(parts);
    if (!HOST_RE.test(parsed.node.server)) throw new Error('服务器地址格式不正确');
    return { node: parsed.node, title: parts.name || parsed.name };
  }

  function shareSignature(node) {
    var secret = node.uuid ? String(node.uuid).toLowerCase() : String(node.password || '');
    return [node.type, String(node.server || '').toLowerCase(), node.port, secret].join('|');
  }

  function guessShareRegion(text) {
    for (var i = 0; i < REGION_HINTS.length; i++) {
      if (REGION_HINTS[i].re.test(text)) return REGION_HINTS[i].key;
    }
    return 'other';
  }

  function shareNameBase(raw, node) {
    var text = String(raw || '').replace(CONTROL_RE, '').replace(/\s+/g, ' ').trim().slice(0, 80);
    if (!text) text = (TYPE_META[node.type] ? TYPE_META[node.type].label : node.type) + ' · ' + node.server;
    return text;
  }

  function uniqueShareName(base, used) {
    var root = String(base || '').slice(0, 80);
    if (RESERVED_NAMES.has(root)) root = root.slice(0, 74) + ' 节点';
    var candidate = root;
    var index = 2;
    while (used.has(candidate.toLowerCase())) {
      var suffix = ' ' + index;
      candidate = root.slice(0, 80 - suffix.length) + suffix;
      index += 1;
    }
    used.add(candidate.toLowerCase());
    return candidate;
  }

  function parseShareLinks(text) {
    var usedNames = new Set(nodes().map(function (node) { return node.name.toLowerCase(); }));
    var known = new Set(nodes().map(shareSignature));
    var seenLines = {};
    var items = [];
    var errors = [];
    var lines = String(text || '').split(/\r?\n/);

    lines.forEach(function (raw, index) {
      var line = raw.trim();
      if (!line || line.charAt(0) === '#') return;
      if (seenLines[line]) return;
      seenLines[line] = true;
      try {
        var parsed = parseShareLink(line);
        var signature = shareSignature(parsed.node);
        if (known.has(signature)) {
          errors.push({ line: index + 1, message: '与已有节点重复，已跳过' });
          return;
        }
        known.add(signature);
        parsed.node.name = uniqueShareName(shareNameBase(parsed.title, parsed.node), usedNames);
        parsed.node.region = guessShareRegion([
          parsed.title, parsed.node.name, parsed.node.server,
          parsed.node.wsHost, parsed.node.servername
        ].join(' '));
        parsed.line = line;
        items.push(parsed);
      } catch (err) {
        errors.push({ line: index + 1, message: err.message || '无法解析该链接' });
      }
    });

    return { items: items, errors: errors };
  }

  function shareHostForUri(server) {
    return server.indexOf(':') !== -1 && server.charAt(0) !== '[' ? '[' + server + ']' : server;
  }

  function shareLinkForNode(node) {
    var name = encodeURIComponent(node.name);
    var host = shareHostForUri(node.server);
    var params = [];
    var push = function (key, value) {
      if (value !== undefined && value !== null && value !== '') params.push(key + '=' + encodeURIComponent(value));
    };

    if (node.type === 'vless') {
      var tls = !!node.tls || !!node.reality;
      push('encryption', 'none');
      push('security', node.reality ? 'reality' : (tls ? 'tls' : 'none'));
      push('type', node.network || 'tcp');
      if (tls) push('sni', node.servername);
      if (node.fingerprint) push('fp', node.fingerprint);
      if (node.reality) {
        push('pbk', node.publicKey);
        push('sid', node.shortId);
      }
      push('flow', node.flow);
      if (node.network === 'ws') {
        push('path', node.wsPath || '/');
        push('host', node.wsHost);
      }
      if (node.network === 'grpc') push('serviceName', node.grpcService);
      return 'vless://' + node.uuid + '@' + host + ':' + node.port + '?' + params.join('&') + '#' + name;
    }

    if (node.type === 'vmess') {
      var payload = {
        v: '2',
        ps: node.name,
        add: node.server,
        port: String(node.port),
        id: node.uuid,
        aid: '0',
        scy: 'auto',
        net: node.network || 'tcp',
        type: 'none',
        host: node.wsHost || '',
        path: node.network === 'grpc' ? (node.grpcService || '') : (node.wsPath || '/'),
        tls: node.tls ? 'tls' : '',
        sni: node.servername || ''
      };
      return 'vmess://' + encodeBase64Text(JSON.stringify(payload));
    }

    if (node.type === 'trojan') {
      push('security', 'tls');
      push('sni', node.sni);
      if (node.skipCertVerify) push('allowInsecure', '1');
      return 'trojan://' + encodeURIComponent(node.password) + '@' + host + ':' + node.port +
        (params.length ? '?' + params.join('&') : '') + '#' + name;
    }

    if (node.type === 'hysteria2') {
      push('sni', node.sni);
      if (node.skipCertVerify) push('insecure', '1');
      push('up', node.up);
      push('down', node.down);
      return 'hysteria2://' + encodeURIComponent(node.password) + '@' + host + ':' + node.port + '/?' +
        params.join('&') + '#' + name;
    }

    if (node.type === 'ss') {
      return 'ss://' + encodeBase64Url(node.cipher + ':' + node.password) + '@' + host + ':' + node.port + '#' + name;
    }

    throw new Error('暂不支持导出 ' + node.type + ' 协议');
  }

  function copyShareLink(node) {
    if (!node) return;
    var link;
    try {
      link = shareLinkForNode(node);
    } catch (err) {
      toast(err.message || '生成分享链接失败', 'error');
      return;
    }
    copyText(link, '分享链接已复制');
  }

  function linkRegionFor(item) {
    var override = el.linksRegion ? el.linksRegion.value : 'auto';
    var region = override === 'auto' ? item.node.region : override;
    return REGION_META[region] || REGION_META.other;
  }

  function renderLinksFeedback(overflow) {
    var errors = state.linksErrors || [];
    var hasErrors = errors.length > 0;
    if (!hasErrors && !overflow) {
      el.linksFeedback.hidden = true;
      el.linksFeedback.innerHTML = '';
      return;
    }
    var html = '';
    if (hasErrors) {
      html += '<div class="links-feedback-head">' + icon('alert') + '<strong>已跳过 ' + errors.length + ' 条链接</strong></div>';
      html += '<ul class="links-error-list">' + errors.slice(0, 6).map(function (error) {
        return '<li><span>第 ' + error.line + ' 行</span>' + esc(error.message) + '</li>';
      }).join('') + '</ul>';
      if (errors.length > 6) html += '<p class="links-error-more">以及另外 ' + (errors.length - 6) + ' 条，请修正后重新粘贴。</p>';
    }
    if (overflow) {
      html += '<p class="links-overflow">' + icon('alert') + '<span>节点数量将超过上限 ' + MAX_NODES + ' 个，请减少导入条数。</span></p>';
    }
    el.linksFeedback.innerHTML = html;
    el.linksFeedback.hidden = false;
  }

  function renderLinksResults() {
    if (!el.linksPreview) return;
    var items = state.linksParsed || [];
    var errors = state.linksErrors || [];
    var room = MAX_NODES - nodes().length;
    var overflow = items.length > room;

    if (el.linksSummary) {
      if (!el.linksInput || !el.linksInput.value.trim()) el.linksSummary.textContent = '等待粘贴';
      else if (items.length) el.linksSummary.textContent = items.length + ' 条可导入' + (errors.length ? ' · ' + errors.length + ' 条跳过' : '');
      else el.linksSummary.textContent = '未识别到可用链接';
    }

    renderLinksFeedback(overflow);

    if (!items.length) {
      el.linksPreview.innerHTML = '<div class="links-empty">' +
        '<span class="links-empty-icon">' + icon('link') + '</span>' +
        '<p>粘贴链接后，这里会显示可导入的节点。</p>' +
        (errors.length ? '<small>请检查链接是否包含完整的服务器、端口与凭据。</small>' : '') +
        '</div>';
    } else {
      el.linksPreview.innerHTML = items.map(function (item, index) {
        var region = linkRegionFor(item);
        var type = TYPE_META[item.node.type] || { label: item.node.type };
        var meta = item.node.server + ':' + item.node.port + ' · ' + region.group;
        return '<div class="link-item">' +
          '<span class="link-kind t-' + esc(item.node.type) + '">' + esc(type.label) + '</span>' +
          '<span class="link-main">' +
            '<span class="link-name">' + esc(item.node.name) + '</span>' +
            '<span class="link-meta">' + esc(meta) + '</span>' +
          '</span>' +
          '<span class="link-region">' + (item.node.region === 'other' && el.linksRegion.value === 'auto' ? '未分组' : region.short) + '</span>' +
          '<button class="icon-btn link-remove" type="button" data-link-remove="' + index + '" title="移除" aria-label="移除 ' + esc(item.node.name) + '">' + icon('close') + '</button>' +
        '</div>';
      }).join('');
    }

    if (el.linksConfirm) {
      el.linksConfirm.disabled = !items.length || overflow;
      el.linksConfirm.textContent = items.length ? '导入 ' + items.length + ' 个节点' : '导入节点';
    }

    if (el.linksFootNote) {
      if (errors.length) el.linksFootNote.textContent = '已跳过 ' + errors.length + ' 条无法识别的链接';
      else if (!items.length) el.linksFootNote.textContent = '支持 VLESS、Hysteria2、Trojan、VMess、Shadowsocks';
      else el.linksFootNote.textContent = '命名冲突会自动追加序号';
    }
  }

  function parseLinksInput() {
    var result = parseShareLinks(el.linksInput.value);
    state.linksParsed = result.items;
    state.linksErrors = result.errors;
    renderLinksResults();
  }

  function renderLinksExport() {
    if (!el.linksExport) return;
    var list = enabledNodes();
    var lines = [];
    list.forEach(function (node) {
      try {
        lines.push(shareLinkForNode(node));
      } catch (err) {
        /* skip unsupported node */
      }
    });
    state.linksExportText = lines.join('\n');
    el.linksExport.textContent = state.linksExportText || '没有已启用的节点，暂无可导出的链接。';
    el.linksExport.classList.toggle('is-empty', !state.linksExportText);
    if (el.linksExportCount) el.linksExportCount.textContent = lines.length + ' 条';
    if (el.linksCopyAll) el.linksCopyAll.disabled = !state.linksExportText;
    if (el.linksDownload) el.linksDownload.disabled = !state.linksExportText;
    if (el.linksFootNote) el.linksFootNote.textContent = lines.length ? '链接在本地生成，不会上传服务器' : '先启用至少一个节点';
  }

  function setLinksTab(tab) {
    state.linksTab = tab === 'export' ? 'export' : 'import';
    (el.linksTabs || []).forEach(function (button) {
      var active = button.dataset.tab === state.linksTab;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    (el.linksPanels || []).forEach(function (panel) {
      panel.hidden = panel.dataset.tabPanel !== state.linksTab;
    });
    var footerCancel = $('.links-foot-actions [data-close-modal="links"]', el.linksLayer);
    if (footerCancel) footerCancel.textContent = state.linksTab === 'export' ? '关闭' : '取消';
    if (el.linksConfirm) el.linksConfirm.hidden = state.linksTab === 'export';
    if (state.linksTab === 'export') renderLinksExport();
    else {
      if (el.linksInput && el.linksInput.value.trim()) parseLinksInput();
      else renderLinksResults();
    }
  }

  function openLinks(tab) {
    if (!state.config) return;
    setLinksTab(tab || 'import');
    openModal('links');
    window.setTimeout(function () {
      if (state.linksTab === 'import' && el.linksInput) el.linksInput.focus();
    }, 160);
  }

  async function importLinks() {
    if (!ensureWritable() || state.mutating) return;
    var items = state.linksParsed || [];
    if (!items.length) return;
    var room = MAX_NODES - nodes().length;
    if (items.length > room) {
      toast('最多还能导入 ' + Math.max(room, 0) + ' 个节点', 'error');
      return;
    }
    var override = el.linksRegion.value;
    var additions = items.map(function (item) {
      var copy = Object.assign({}, item.node);
      if (override !== 'auto') copy.region = override;
      copy.id = randomId();
      copy.enabled = true;
      copy.showInMain = true;
      copy.tags = [];
      return copy;
    });

    el.linksConfirm.disabled = true;
    el.linksConfirm.textContent = '导入中…';
    var ok = await saveNodes(nodes().concat(additions), {
      successMessage: '已导入 ' + additions.length + ' 个节点'
    });
    el.linksConfirm.textContent = '导入 ' + items.length + ' 个节点';
    el.linksConfirm.disabled = false;
    if (ok) {
      state.linksParsed = [];
      state.linksErrors = [];
      state.linksExportText = '';
      el.linksInput.value = '';
      renderLinksResults();
      closeModal('links');
      switchView('nodes');
    } else {
      parseLinksInput();
    }
  }

  function downloadLinks() {
    if (!state.linksExportText) return;
    var blob = new Blob([state.linksExportText], { type: 'text/plain;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var link = document.createElement('a');
    link.href = url;
    link.download = 'transit-hub-links-' + backupStamp() + '.txt';
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    toast('链接清单已开始下载', 'success');
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

  function restoreDrawerFocus() {
    var target = state.drawerFocus;
    state.drawerFocus = null;
    if (!el.app.hidden && target && document.contains(target) && target.offsetParent !== null) {
      target.focus({ preventScroll: true });
    }
  }

  function closeDrawer(immediate) {
    if (!el.drawerLayer || el.drawerLayer.hidden) return;
    el.drawerLayer.classList.remove('is-open');
    window.clearTimeout(showDrawer.timer);
    if (immediate) {
      el.drawerLayer.hidden = true;
      syncBodyLock();
      restoreDrawerFocus();
    } else {
      showDrawer.timer = window.setTimeout(function () {
        el.drawerLayer.hidden = true;
        syncBodyLock();
        restoreDrawerFocus();
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
    state.drawerFocus = document.activeElement;
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
    $$('[aria-invalid="true"]', el.nodeForm).forEach(function (input) { input.removeAttribute('aria-invalid'); });
    el.formGlobalError.hidden = true;
    el.formGlobalError.textContent = '';
  }

  function clearFieldError(event) {
    var field = event.target.closest ? event.target.closest('.field') : null;
    if (field) {
      field.classList.remove('has-error');
      $$('.field-error', field).forEach(function (error) { error.textContent = ''; });
      $$('[aria-invalid="true"]', field).forEach(function (input) { input.removeAttribute('aria-invalid'); });
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
      var fieldInput = $('input, select', field);
      if (fieldInput) fieldInput.setAttribute('aria-invalid', 'true');
      if (!firstInput) firstInput = fieldInput;
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

  function appGroupCount(app) {
    return enabledNodes().filter(function (node) {
      return (node.tags || []).indexOf(app.key) !== -1;
    }).length;
  }

  function renderPreviewGroups() {
    if (!el.previewGroupPills) return;
    if (!state.config) {
      el.previewGroupPills.innerHTML = '<span class="group-pill is-zero">等待配置载入</span>';
      return;
    }
    var enabled = enabledNodes();
    var defs = [{
      name: MAIN_GROUP,
      count: enabled.filter(function (node) { return node.showInMain !== false; }).length
    }];
    GROUP_REGIONS.forEach(function (region) {
      var count = enabled.filter(function (node) { return node.region === region; }).length;
      if (count) defs.push({ name: REGION_META[region].group, count: count });
    });
    APP_GROUPS.forEach(function (app) {
      defs.push({ name: app.name, count: appGroupCount(app), unit: ' 个标记节点' });
    });
    el.previewGroupPills.innerHTML = defs.map(function (item) {
      return '<span class="group-pill' + (item.count ? '' : ' is-zero') + '" title="' + esc(item.name) + ' · ' + item.count + (item.unit || ' 个节点') + '">' +
        '<span class="group-pill-name">' + esc(item.name) + '</span><b>' + item.count + '</b></span>';
    }).join('');
  }

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

  function renderPreview(options) {
    var opts = options || {};
    var text = state.preview || '';
    var keepScroll = opts.preserveScroll ? el.codeBody.scrollTop : 0;
    el.yamlCode.innerHTML = highlightYaml(text);
    var lines = text ? text.split('\n').length : 0;
    var bytes = new TextEncoder().encode(text).length;
    el.codeLines.textContent = lines + ' 行';
    el.codeSize.textContent = (bytes / 1024).toFixed(1) + ' KB';
    el.codeBody.scrollTop = keepScroll;
    applyPreviewSearch();
  }

  function previewTextNodes(root) {
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    var list = [];
    var node = walker.nextNode();
    while (node) {
      list.push(node);
      node = walker.nextNode();
    }
    return list;
  }

  function previewPosition(nodes, offsets, position) {
    for (var i = 0; i < nodes.length; i++) {
      var start = offsets[i];
      var end = start + nodes[i].nodeValue.length;
      if (position >= start && position <= end) {
        if (position === start && position === end) continue;
        return { node: nodes[i], offset: Math.min(position - start, nodes[i].nodeValue.length) };
      }
    }
    return null;
  }

  function markLineMatches(line, query) {
    var text = line.textContent || '';
    var haystack = text.toLowerCase();
    var needle = query.toLowerCase();
    var index = haystack.indexOf(needle);
    if (index === -1) return 0;

    var nodes = previewTextNodes(line).filter(function (node) {
      return node.nodeValue.length > 0;
    });
    if (!nodes.length) return 0;
    var offsets = [];
    var total = 0;
    nodes.forEach(function (node) {
      offsets.push(total);
      total += node.nodeValue.length;
    });

    var ranges = [];
    while (index !== -1) {
      var start = previewPosition(nodes, offsets, index);
      var end = previewPosition(nodes, offsets, index + needle.length);
      if (start && end) {
        var range = document.createRange();
        range.setStart(start.node, start.offset);
        range.setEnd(end.node, end.offset);
        ranges.push(range);
      }
      index = haystack.indexOf(needle, index + needle.length);
    }

    for (var i = ranges.length - 1; i >= 0; i--) {
      var mark = document.createElement('mark');
      mark.className = 'code-hit';
      mark.appendChild(ranges[i].extractContents());
      ranges[i].insertNode(mark);
    }
    return ranges.length;
  }

  function applyPreviewSearch() {
    state.previewHits = [];
    state.previewHitIndex = -1;
    var query = state.previewQuery.trim();
    if (query) {
      $$('.lc', el.yamlCode).forEach(function (line) {
        markLineMatches(line, query);
      });
      state.previewHits = $$('mark.code-hit', el.yamlCode);
      if (state.previewHits.length) setPreviewHit(0);
    }
    updatePreviewSearchUi();
  }

  function updatePreviewSearchUi() {
    if (!el.previewSearchCount) return;
    var hasQuery = state.previewQuery.trim().length > 0;
    var total = state.previewHits.length;
    el.previewSearchCount.textContent = !hasQuery
      ? ''
      : (total ? (state.previewHitIndex + 1) + ' / ' + total : '无匹配');
    el.previewSearchCount.classList.toggle('is-empty', hasQuery && !total);
    if (el.previewSearchPrev) el.previewSearchPrev.disabled = total < 2;
    if (el.previewSearchNext) el.previewSearchNext.disabled = total < 2;
  }

  function setPreviewHit(index) {
    var total = state.previewHits.length;
    if (!total) return;
    var next = ((index % total) + total) % total;
    state.previewHits.forEach(function (mark, i) {
      mark.classList.toggle('is-current', i === next);
    });
    state.previewHitIndex = next;
    updatePreviewSearchUi();

    var mark = state.previewHits[next];
    if (!mark || !el.codeBody) return;
    var bodyRect = el.codeBody.getBoundingClientRect();
    var rect = mark.getBoundingClientRect();
    if (rect.top < bodyRect.top + 28 || rect.bottom > bodyRect.bottom - 20) {
      el.codeBody.scrollTop += rect.top - bodyRect.top - el.codeBody.clientHeight / 2 + rect.height / 2;
    }
  }

  function movePreviewHit(delta) {
    if (!state.previewHits.length) return;
    setPreviewHit(state.previewHitIndex < 0 ? 0 : state.previewHitIndex + delta);
  }

  function refreshPreviewSearch() {
    renderPreview({ preserveScroll: true });
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

  function modalLayer(name) {
    if (name === 'generic') return el.genericLayer;
    if (name === 'kv') return el.kvLayer;
    if (name === 'links') return el.linksLayer;
    return null;
  }

  function modalFocusTarget(name) {
    if (name === 'generic') return el.genericOk;
    if (name === 'kv') return el.kvCopyName;
    if (name === 'links') {
      if (state.linksTab === 'export') return el.linksCopyAll;
      return el.linksInput;
    }
    return null;
  }

  function openModal(name) {
    var layer = modalLayer(name);
    if (!layer) return;
    window.clearTimeout(openModal[name + 'Timer']);
    if (!isLayerOpen(layer)) state.layerFocus[name] = document.activeElement;
    layer.hidden = false;
    window.requestAnimationFrame(function () {
      layer.classList.add('is-open');
      syncBodyLock();
      var focusTarget = modalFocusTarget(name);
      if (focusTarget) window.setTimeout(function () { focusTarget.focus({ preventScroll: true }); }, 120);
    });
  }

  function closeModal(name, immediate) {
    var layer = modalLayer(name);
    if (!layer || layer.hidden) return;
    layer.classList.remove('is-open');
    window.clearTimeout(openModal[name + 'Timer']);
    var finalize = function () {
      layer.hidden = true;
      syncBodyLock();
      var target = state.layerFocus[name];
      state.layerFocus[name] = null;
      if (!el.app.hidden && target && document.contains(target) && target.offsetParent !== null) {
        try { target.focus({ preventScroll: true }); } catch (err) { /* ignore */ }
      }
    };
    if (immediate) {
      finalize();
    } else {
      openModal[name + 'Timer'] = window.setTimeout(finalize, 200);
    }
    if (name === 'generic') {
      state.deletingId = null;
      state.userDeletingId = null;
      confirmCallback = null;
    }
  }

  function isLayerOpen(layer) {
    return !!layer && !layer.hidden && layer.classList.contains('is-open');
  }

  function layerFocusables(layer) {
    return $$('a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])', layer)
      .filter(function (node) {
        return node.offsetParent !== null && node.getAttribute('aria-hidden') !== 'true';
      });
  }

  function trapLayerFocus(event, layer) {
    var items = layerFocusables(layer);
    if (!items.length) return;
    var first = items[0];
    var last = items[items.length - 1];
    var active = document.activeElement;
    if (event.shiftKey) {
      if (active === first || !layer.contains(active)) {
        event.preventDefault();
        last.focus({ preventScroll: true });
      }
    } else if (active === last || !layer.contains(active)) {
      event.preventDefault();
      first.focus({ preventScroll: true });
    }
  }

  function toast(message, type, action) {
    var kind = type || 'info';
    var node = document.createElement('div');
    node.className = 'toast toast-' + kind;
    node.innerHTML = icon(kind === 'success' ? 'check' : (kind === 'error' ? 'alert' : 'info'));
    var text = document.createElement('span');
    text.className = 'toast-text';
    text.textContent = message;
    node.appendChild(text);
    var closing = false;
    var timer = 0;
    var dismiss = function () {
      if (closing) return;
      closing = true;
      window.clearTimeout(timer);
      node.classList.remove('is-show');
      window.setTimeout(function () { node.remove(); }, 240);
    };
    if (action && action.label && typeof action.run === 'function') {
      var actionButton = document.createElement('button');
      actionButton.type = 'button';
      actionButton.className = 'toast-action';
      actionButton.textContent = action.label;
      actionButton.addEventListener('click', function () {
        dismiss();
        action.run();
      });
      node.appendChild(actionButton);
      node.classList.add('has-action');
    }
    el.toasts.appendChild(node);
    while (el.toasts.children.length > 4) el.toasts.removeChild(el.toasts.firstChild);
    window.requestAnimationFrame(function () { node.classList.add('is-show'); });
    timer = window.setTimeout(dismiss, action ? 8000 : 3400);
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
      toast('尚未配置订阅令牌，请先到设置页填写 AUTH_TOKEN', 'error');
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
    el.loginForm.addEventListener('submit', submitAuth);
    el.loginUsername.addEventListener('input', function () { showLoginError(''); });
    el.loginPassword.addEventListener('input', function () { showLoginError(''); });
    el.loginConfirm.addEventListener('input', function () { showLoginError(''); });
    el.loginSetupToken.addEventListener('input', function () { showLoginError(''); });
    el.loginToken.addEventListener('input', function () { showLoginError(''); });
    el.loginPasswordReveal.addEventListener('click', function () {
      var showing = el.loginPassword.type === 'text';
      el.loginPassword.type = showing ? 'password' : 'text';
      setRevealState(el.loginPasswordReveal, !showing, '密码');
    });
    el.loginTokenReveal.addEventListener('click', function () {
      var showing = el.loginToken.type === 'text';
      el.loginToken.type = showing ? 'password' : 'text';
      setRevealState(el.loginTokenReveal, !showing, '令牌');
    });
    el.loginRecovery.addEventListener('click', function () {
      renderAuthView(state.loginView === 'recovery' ? 'login' : 'recovery');
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
    [el.topCopy, el.previewCopySub].forEach(function (button) {
      if (button) button.addEventListener('click', copySubscription);
    });
    [el.nodesLinks, el.emptyLinks].forEach(function (button) {
      if (button) button.addEventListener('click', function () { openLinks('import'); });
    });
    el.subCopy.addEventListener('click', copySubscription);
    el.subReveal.addEventListener('click', function () {
      state.subRevealed = !state.subRevealed;
      renderSubUrls();
    });

    [el.themeToggle, el.mobileTheme].forEach(function (button) {
      button.addEventListener('click', toggleTheme);
    });
    if (el.themeMode) {
      el.themeMode.addEventListener('click', function (event) {
        var button = event.target.closest('[data-theme-mode]');
        if (button) setThemeMode(button.dataset.themeMode);
      });
    }
    el.logout.addEventListener('click', function () { logout(''); });
    el.mobileLogout.addEventListener('click', function () { logout(''); });

    if (el.tokenOpenSettings) el.tokenOpenSettings.addEventListener('click', function () {
      switchView('settings');
      if (el.setAuthToken) {
        window.setTimeout(function () {
          el.setAuthToken.focus();
          el.setAuthToken.select();
        }, 40);
      }
    });
    if (el.emptySubBtn) el.emptySubBtn.addEventListener('click', function () { switchView('nodes'); });

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
      var pick = event.target.closest('[data-pick-id]');
      if (pick) {
        toggleSelection(pick.dataset.pickId, pick.checked, event.shiftKey);
        return;
      }
      var row = event.target.closest('.node-row');
      if (!row) return;
      var menuButton = event.target.closest('[data-menu-id]');
      if (menuButton) {
        openRowMenu(menuButton.dataset.menuId, menuButton);
        return;
      }
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
      if (event.target.closest('button, input, .cell-check')) return;
      openEditor(row.dataset.id);
    });
    el.nodeList.addEventListener('keydown', function (event) {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      var row = event.target.closest('.node-row');
      if (!row || event.target.closest('button, input, .cell-check')) return;
      event.preventDefault();
      openEditor(row.dataset.id);
    });

    if (el.selectAll) {
      el.selectAll.addEventListener('change', function () { selectAllVisible(el.selectAll.checked); });
    }
    if (el.bulkBar) {
      el.bulkBar.addEventListener('click', function (event) {
        var button = event.target.closest('[data-bulk]');
        if (!button || button.disabled) return;
        if (button.dataset.bulk === 'enable') bulkSetEnabled(true);
        else if (button.dataset.bulk === 'disable') bulkSetEnabled(false);
        else if (button.dataset.bulk === 'delete') askBulkDelete();
      });
    }
    if (el.bulkClear) el.bulkClear.addEventListener('click', clearSelection);
    if (el.bulkRegion) {
      el.bulkRegion.addEventListener('change', function () {
        if (el.bulkRegion.value) bulkMoveRegion();
      });
    }

    if (el.rowMenu) {
      el.rowMenu.addEventListener('click', function (event) {
        var item = event.target.closest('[data-menu]');
        if (!item || item.disabled) return;
        performRowMenu(item.dataset.menu);
      });
      el.rowMenu.addEventListener('keydown', function (event) {
        var items = $$('.menu-item:not([disabled])', el.rowMenu);
        if (!items.length) return;
        var index = items.indexOf(document.activeElement);
        if (event.key === 'ArrowDown') {
          event.preventDefault();
          items[(index + 1) % items.length].focus();
        } else if (event.key === 'ArrowUp') {
          event.preventDefault();
          items[(index - 1 + items.length) % items.length].focus();
        } else if (event.key === 'Home') {
          event.preventDefault();
          items[0].focus();
        } else if (event.key === 'End') {
          event.preventDefault();
          items[items.length - 1].focus();
        } else if (event.key === 'Tab') {
          closeRowMenu(true, false);
        }
      });
      document.addEventListener('click', function (event) {
        if (!el.rowMenu || el.rowMenu.hidden) return;
        if (el.rowMenu.contains(event.target) || event.target.closest('[data-menu-id]')) return;
        closeRowMenu(false, false);
      }, true);
      window.addEventListener('scroll', function () {
        if (el.rowMenu && !el.rowMenu.hidden) closeRowMenu(false, false);
      }, true);
      window.addEventListener('resize', function () {
        if (el.rowMenu && !el.rowMenu.hidden) closeRowMenu(false, false);
      });
    }

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
    if (el.userAdd) el.userAdd.addEventListener('click', function () { openUserEditor('add'); });
    if (el.userCancel) el.userCancel.addEventListener('click', closeUserEditor);
    if (el.userForm) {
      el.userForm.addEventListener('submit', submitUserForm);
      el.userForm.addEventListener('input', clearUserFieldError);
    }
    if (el.userList) {
      el.userList.addEventListener('click', function (event) {
        var reset = event.target.closest('[data-user-reset]');
        if (reset) {
          openUserEditor('reset', reset.dataset.userReset);
          return;
        }
        var remove = event.target.closest('[data-user-delete]');
        if (remove && !remove.disabled) askDeleteUser(remove.dataset.userDelete);
      });
    }
    el.settingsClear.addEventListener('click', function () {
      setField(el.setUuid, '');
      setField(el.setPbk, '');
      setField(el.setSid, '');
      setField(el.setSni, '');
      clearSettingsErrors();
      toast('已清空 VLESS 预设，点击「保存设置」后生效', 'info');
    });
    if (el.genAuthToken) el.genAuthToken.addEventListener('click', function () {
      setField(el.setAuthToken, generatePassword(32));
      clearSettingsErrors();
      el.setAuthToken.focus();
      el.setAuthToken.select();
    });
    if (el.copyAuthToken) el.copyAuthToken.addEventListener('click', function () {
      var token = String(el.setAuthToken.value || '').trim();
      if (!token) {
        toast('当前没有可复制的订阅令牌', 'error');
        return;
      }
      copyText(token, '订阅令牌已复制');
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

    el.genericOk.addEventListener('click', function () {
      var callback = confirmCallback;
      confirmCallback = null;
      if (callback) callback();
    });

    el.nodesExport.addEventListener('click', exportBackup);
    el.nodesImport.addEventListener('click', function () {
      if (ensureWritable()) el.importFile.click();
    });
    el.importFile.addEventListener('change', function () {
      var file = el.importFile.files && el.importFile.files[0];
      el.importFile.value = '';
      if (file) importBackupFile(file);
    });
    el.previewRefresh.addEventListener('click', function () { loadPreview(true); });
    el.previewCopy.addEventListener('click', copyYaml);
    el.previewDownload.addEventListener('click', downloadYaml);

    if (el.previewSearch) {
      el.previewSearch.addEventListener('input', function () {
        state.previewQuery = el.previewSearch.value;
        window.clearTimeout(state.previewSearchTimer);
        state.previewSearchTimer = window.setTimeout(refreshPreviewSearch, 160);
      });
      el.previewSearch.addEventListener('keydown', function (event) {
        if (event.key === 'Enter') {
          event.preventDefault();
          movePreviewHit(event.shiftKey ? -1 : 1);
        } else if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          el.previewSearch.value = '';
          state.previewQuery = '';
          window.clearTimeout(state.previewSearchTimer);
          refreshPreviewSearch();
        }
      });
    }
    if (el.previewSearchPrev) el.previewSearchPrev.addEventListener('click', function () { movePreviewHit(-1); });
    if (el.previewSearchNext) el.previewSearchNext.addEventListener('click', function () { movePreviewHit(1); });

    (el.linksTabs || []).forEach(function (button) {
      button.addEventListener('click', function () { setLinksTab(button.dataset.tab); });
    });
    if (el.linksInput) {
      el.linksInput.addEventListener('input', function () {
        window.clearTimeout(state.linksTimer);
        state.linksTimer = window.setTimeout(parseLinksInput, 200);
      });
    }
    if (el.linksRegion) {
      el.linksRegion.addEventListener('change', function () {
        if (el.linksInput.value.trim()) parseLinksInput();
        else renderLinksResults();
      });
    }
    if (el.linksPreview) {
      el.linksPreview.addEventListener('click', function (event) {
        var button = event.target.closest('[data-link-remove]');
        if (!button) return;
        var index = Number(button.dataset.linkRemove);
        if (index >= 0 && index < state.linksParsed.length) {
          state.linksParsed.splice(index, 1);
          renderLinksResults();
        }
      });
    }
    if (el.linksConfirm) el.linksConfirm.addEventListener('click', importLinks);
    if (el.linksCopyAll) el.linksCopyAll.addEventListener('click', function () { copyText(state.linksExportText, '链接清单已复制'); });
    if (el.linksDownload) el.linksDownload.addEventListener('click', downloadLinks);

    document.addEventListener('keydown', function (event) {
      var tag = (event.target.tagName || '').toLowerCase();
      var typing = tag === 'input' || tag === 'select' || tag === 'textarea' || event.target.isContentEditable;

      if (event.key === 'Escape') {
        if (el.rowMenu && !el.rowMenu.hidden) { event.preventDefault(); closeRowMenu(false, true); return; }
        if (isLayerOpen(el.linksLayer)) { closeModal('links'); return; }
        if (isLayerOpen(el.kvLayer)) { closeModal('kv'); return; }
        if (isLayerOpen(el.genericLayer)) { closeModal('generic'); return; }
        if (isLayerOpen(el.drawerLayer)) { closeDrawer(); return; }
      }

      if (!el.app.hidden && event.key === 'Tab') {
        var activeLayer = isLayerOpen(el.linksLayer) ? el.linksLayer
          : (isLayerOpen(el.kvLayer) ? el.kvLayer
            : (isLayerOpen(el.genericLayer) ? el.genericLayer
              : (isLayerOpen(el.drawerLayer) ? el.drawerLayer : null)));
        if (activeLayer) trapLayerFocus(event, activeLayer);
      }

      if (!el.app.hidden && event.key === '/' && !typing) {
        event.preventDefault();
        if (state.view === 'preview') {
          el.previewSearch.focus();
          el.previewSearch.select();
        } else {
          if (state.view !== 'nodes') switchView('nodes');
          window.setTimeout(function () { el.nodeSearch.focus(); el.nodeSearch.select(); }, 30);
        }
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
    applyTheme(themeMode(), false);
    if (window.matchMedia) {
      var scheme = window.matchMedia('(prefers-color-scheme: dark)');
      var onSchemeChange = function () {
        if (themeMode() === 'system') applyTheme('system', false);
      };
      if (scheme.addEventListener) scheme.addEventListener('change', onSchemeChange);
      else if (scheme.addListener) scheme.addListener(onSchemeChange);
    }
    initAuth();
  }

  init();
})();
