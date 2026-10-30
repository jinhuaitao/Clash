(function () {
  'use strict';

  var STORAGE_KEY = 'th.admin.token';
  var USERNAME_KEY = 'th.username';
  var THEME_KEY = 'th.theme';
  var MAIN_GROUP = '🌍选择节点';
  var MAX_NODES = 300;
  var MAX_PERSONAL_NODES = 100;
  var MAX_TOTAL_GB = 1048576;
  var THEME_MODES = ['system', 'light', 'dark'];
  var MAX_USERS = 20;
  var PASSWORD_MIN = 12;
  var USERNAME_RE = /^[A-Za-z0-9][A-Za-z0-9._+@-]{2,253}$/;
  var FINGERPRINTS = ['chrome', 'firefox', 'safari', 'ios', 'android', 'edge', 'random', 'randomized'];
  var SS_CIPHERS = ['aes-128-gcm', 'aes-256-gcm', 'chacha20-ietf-poly1305', 'xchacha20-ietf-poly1305'];

  /* 分组（策略组）由控制台维护，存在 config.groups 里。
     内置四组的 id 沿用旧版 region 键，历史数据与 regionOrder 无需迁移。 */
  var DEFAULT_GROUPS = [
    { id: 'us', name: '🇺🇸欧美节点', icon: 'https://fastly.jsdelivr.net/gh/Koolson/Qure/IconSet/Color/United_States.png' },
    { id: 'jp', name: '🇯🇵日韩节点', icon: 'https://fastly.jsdelivr.net/gh/Koolson/Qure/IconSet/Color/Japan.png' },
    { id: 'hk', name: '🇭🇰港台节点', icon: 'https://fastly.jsdelivr.net/gh/Koolson/Qure/IconSet/Color/Hong_Kong.png' },
    { id: 'relay', name: '📶中转节点', icon: 'https://fastly.jsdelivr.net/gh/Koolson/Qure/IconSet/Color/Relay.png' }
  ];
  var BUILTIN_GROUP_IDS = DEFAULT_GROUPS.map(function (group) { return group.id; });
  var MAX_GROUPS = 24;
  /* 成员的个人分组：只影响自己的订阅，上限比所有者低一些 */
  var MAX_MEMBER_GROUPS = 12;
  var GROUP_NAME_MAX = 40;
  /* 「未分组」不是真分组：这些节点只出现在 🌍选择节点 里 */
  var UNGROUPED = 'none';
  var GROUP_TONES = 6;
  var GROUP_PALETTE = ['#4f46e5', '#db2777', '#0891b2', '#d97706', '#059669', '#7c3aed'];

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

  /* 分组名可以用内置分组名（由分组表去重保证唯一），但不能占用全局选择组 /
     应用策略组 / 内置策略的名字，否则 YAML 里会出现重名策略组 */
  var RESERVED_GROUP_NAMES = new Set([
    MAIN_GROUP, '💬ChatGPT', 'ⒼGoogle', '📺YOUTUBE', '📲 电报信息',
    'DIRECT', 'REJECT', 'REJECT-DROP', 'PASS', 'GLOBAL'
  ]);

  var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  var HOST_RE = /^[A-Za-z0-9._%:\-\[\]]+$/;
  var BANDWIDTH_RE = /^\d{1,6}(?:\.\d{1,2})?\s*(kbps|mbps|gbps)$/i;
  var CONTROL_RE = /[\u0000-\u001f\u007f]/;
  /* 名称开头的 emoji：分组没有单独的图标字段，列表头像直接取名字里的第一个符号。
     范围覆盖旗帜（两个区域指示符）、常见 emoji 与变体选择符，取不到时回落到 🌐。 */
  var EMOJI_LEAD_RE = new RegExp('^[\\u{1F1E6}-\\u{1F1FF}\\u{1F300}-\\u{1FAFF}\\u{2600}-\\u{27BF}\\u{2B00}-\\u{2BFF}\\u{FE0F}\\u{200D}]+', 'u');

  var VIEW_META = {
    overview: '概览',
    nodes: '节点管理',
    groups: '分组管理',
    preview: '订阅预览',
    users: '用户管理',
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
    passwordBusy: false,
    view: 'overview',
    query: '',
    filterType: 'all',
    filterGroup: 'all',
    groupFormId: null,
    groupBusy: false,
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
    /* 点击「清除」后置位：保存时下发 authToken: null，删除设置页令牌回退环境变量 */
    clearAuthToken: false,
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

  function randomId(prefix) {
    var head = prefix || 'n_';
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return head + window.crypto.randomUUID();
    }
    return head + Math.random().toString(36).slice(2) + Date.now().toString(36);
  }

  function newNodeId() {
    return randomId(isOwner() ? 'n_' : 'p_');
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
    el.overviewAuthNote = $('#overview-auth-note');
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
    el.filterGroup = $('#filter-group');
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
    el.bulkGroup = $('#bulk-group');
    el.bulkClear = $('#bulk-clear');
    el.rowMenu = $('#row-menu');

    el.groupList = $('#group-list');
    el.groupAdd = $('#group-add');
    el.groupForm = $('#group-form');
    el.groupFormTitle = $('#group-form-title');
    el.groupFormSub = $('#group-form-sub');
    el.groupName = $('#group-name');
    el.groupIcon = $('#group-icon');
    el.groupSave = $('#group-save');
    el.groupSaveLabel = $('#group-save-label');
    el.groupSaveSpinner = $('#group-save-spinner');
    el.groupCancel = $('#group-cancel');
    el.groupSummary = $('#group-summary');
    el.groupsSub = $('#groups-sub');

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
    el.fieldGroup = $('#f-group');
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
    el.userRole = $('#user-role');
    el.userScopeField = $('#user-scope-field');
    el.userScopeAll = $('#user-scope-all');
    el.userScopeList = $('#user-scope-list');
    el.userPassword = $('#user-password');
    el.userPassword2 = $('#user-password2');
    el.userPasswordHint = $('#user-password-hint');
    el.userCancel = $('#user-cancel');
    el.userSave = $('#user-save');
    el.userSaveLabel = $('#user-save-label');
    el.userSaveSpinner = $('#user-save-spinner');
    el.accountPanel = $('#account-panel');
    el.accountRole = $('#account-role');
    el.accountUsername = $('#account-username');
    el.accountScope = $('#account-scope');
    el.accountSubUrl = $('#account-sub-url');
    el.accountSubCopy = $('#account-sub-copy');
    el.passwordForm = $('#password-form');
    el.pwCurrent = $('#pw-current');
    el.pwNew = $('#pw-new');
    el.pwConfirm = $('#pw-confirm');
    el.pwSave = $('#pw-save');
    el.pwSaveLabel = $('#pw-save-label');
    el.pwSpinner = $('#pw-spinner');
    el.setAuthToken = $('#set-auth-token');
    el.authTokenNote = $('#auth-token-note');
    el.genAuthToken = $('#gen-auth-token');
    el.clearAuthToken = $('#clear-auth-token');
    el.setProviderBase = $('#set-provider-base');
    el.setUuid = $('#set-uuid');
    el.setPbk = $('#set-pbk');
    el.setSid = $('#set-sid');
    el.setSni = $('#set-sni');
    el.setPort = $('#set-port');
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
    el.linksGroup = $('#links-group');
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
    if (el.themeColor) el.themeColor.setAttribute('content', dark ? '#070b13' : '#f4f5fa');
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
    var info = state.authInfo || {};
    // 两种情况下初始化按钮不可用：没绑 KV；以及实例默认拒绝开放初始化
    // 又没配 ADMIN_TOKEN（此时填什么都没用，必须先去配环境变量）
    var blocked = state.loginView === 'setup' && (info.kv === false || info.setupDisabled);
    el.loginBtn.disabled = busy || blocked;
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
      } else if (info.setupDisabled) {
        el.loginHelp.textContent = '为防止实例被任意访问者抢占，初始化前需先在 Worker 环境变量里配置 ADMIN_TOKEN（16 位以上随机字符串，建议写成 Secret），保存后刷新本页。确实要开放初始化，可设置 ALLOW_OPEN_SETUP=1。';
      } else if (info.setupLocked) {
        el.loginHelp.textContent = '该实例已配置 ADMIN_TOKEN，需填写恢复令牌才能完成初始化。';
      } else if (info.corrupted) {
        el.loginHelp.textContent = '检测到用户数据损坏，继续初始化会覆盖损坏的账号数据。';
      } else {
        el.loginHelp.textContent = '本实例允许开放初始化，任何访问者都能创建管理员，请完成初始化后立刻配置 ADMIN_TOKEN。';
      }
    } else if (recovery) {
      el.loginHelp.textContent = '恢复令牌用于忘记密码或恢复访问，不会取代日常账号登录。';
    } else {
      el.loginHelp.textContent = '忘记密码时，可由所有者重置；成员也可登录后在设置页自行修改。';
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
      if (password.length < PASSWORD_MIN) {
        showLoginError('密码至少需要 ' + PASSWORD_MIN + ' 个字符。');
        el.loginPassword.focus();
        return;
      }
      if (password !== el.loginConfirm.value) {
        showLoginError('两次输入的密码不一致。');
        el.loginConfirm.focus();
        return;
      }
      if (info.setupDisabled) {
        showLoginError('该实例默认拒绝开放初始化，请先在环境变量中配置 ADMIN_TOKEN 后刷新本页。');
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
      // 恢复令牌是长期有效、可直接接管全部账号的部署凭据，绝不写进 storage：
      // 刷新页面即退出恢复会话，避免被浏览器扩展 / 残留脚本长期读取
      storageRemove('session', STORAGE_KEY);
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
    syncRoleUi();
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
    state.filterGroup = 'all';
    state.groupFormId = null;
    state.groupBusy = false;
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
    document.body.classList.remove('is-member');
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

  /* ---- groups ---- */

  // 分组表：配置里没有（首次部署 / 旧版本数据）时回落到内置四组
  function groups() {
    var list = state.config && state.config.groups;
    return Array.isArray(list) && list.length ? list : DEFAULT_GROUPS;
  }

  function groupById(id) {
    if (!id) return null;
    var list = groups();
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === id) return list[i];
    }
    return null;
  }

  function isBuiltinGroup(id) {
    return BUILTIN_GROUP_IDS.indexOf(id) !== -1;
  }

  function nodeGroupId(node) {
    return node && typeof node.groupId === 'string' ? node.groupId : '';
  }

  function nodeGroup(node) {
    return groupById(nodeGroupId(node));
  }

  function groupLabel(node) {
    var group = nodeGroup(node);
    return group ? group.name : '未分组';
  }

  function groupEmoji(name) {
    var match = EMOJI_LEAD_RE.exec(String(name || '').replace(/^\s+/, ''));
    return match ? match[0] : '🌐';
  }

  // 表格里的分组列空间有限：去掉名字开头的 emoji 后截断，完整名字放 title
  function groupShort(name) {
    var text = String(name || '').replace(EMOJI_LEAD_RE, '').trim();
    if (!text) return String(name || '').trim();
    return text.length > 6 ? text.slice(0, 6) + '…' : text;
  }

  // 自定义分组没有预设配色：按 id 散列到固定色板，改名 / 换顺序都不会跳色
  function groupTone(id) {
    if (!id || !groupById(id)) return 'other';
    var hash = 0;
    for (var i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) % 9973;
    return 'tone' + (hash % GROUP_TONES);
  }

  function groupColor(id) {
    var tone = groupTone(id);
    if (tone === 'other') return '#64748b';
    return GROUP_PALETTE[Number(tone.slice(4)) % GROUP_PALETTE.length];
  }

  function groupOptionHtml(list) {
    return list.map(function (group) {
      return '<option value="' + esc(group.id) + '">' + esc(group.name) + '</option>';
    }).join('');
  }

  /* 四个下拉（筛选 / 批量移动 / 分享链接 / 节点表单）共用同一份分组表，
     重建 innerHTML 后尽量保留用户当前的选择。 */
  function renderGroupOptions() {
    var list = groups();
    var options = groupOptionHtml(list);

    if (el.filterGroup) {
      var wanted = state.filterGroup;
      el.filterGroup.innerHTML = '<option value="all">全部分组</option>' + options +
        '<option value="' + UNGROUPED + '">未分组</option>';
      var valid = wanted === 'all' || wanted === UNGROUPED || !!groupById(wanted);
      el.filterGroup.value = valid ? wanted : 'all';
      state.filterGroup = el.filterGroup.value;
    }

    if (el.bulkGroup) {
      var bulkValue = el.bulkGroup.value;
      el.bulkGroup.innerHTML = '<option value="">移动到分组…</option>' + options +
        '<option value="' + UNGROUPED + '">🌐 仅选择列表</option>';
      if (bulkValue && (bulkValue === UNGROUPED || groupById(bulkValue))) el.bulkGroup.value = bulkValue;
    }

    if (el.linksGroup) {
      var linksValue = el.linksGroup.value;
      el.linksGroup.innerHTML = '<option value="auto">自动识别</option>' + options +
        '<option value="' + UNGROUPED + '">🌐 仅选择列表</option>';
      if (linksValue && (linksValue === 'auto' || linksValue === UNGROUPED || groupById(linksValue))) {
        el.linksGroup.value = linksValue;
      }
    }

    if (el.fieldGroup) {
      var fieldValue = el.fieldGroup.value;
      el.fieldGroup.innerHTML = options + '<option value="' + UNGROUPED + '">🌐 仅选择列表</option>';
      if (fieldValue && (fieldValue === UNGROUPED || groupById(fieldValue))) el.fieldGroup.value = fieldValue;
      else if (list.length) el.fieldGroup.value = list[0].id;
    }
  }

  function renderAll() {
    renderGroupOptions();
    renderChrome();
    renderOverview();
    renderNodeList();
    renderGroups();
    renderSubUrls();
    renderPreviewGroups();
  }

  function renderChrome() {
    var meta = state.meta || {};
    var enabled = enabledNodes();
    var total = nodes().length;

    el.navCount.textContent = String(total);
    el.modePill.classList.add('is-warning');
    if (!isOwner() && (!meta.kv || meta.readonly || meta.corrupted)) {
      el.modePillText.textContent = (!meta.kv || meta.readonly) ? '只读模式' : '配置异常';
    } else if (!isOwner()) {
      el.modePill.classList.remove('is-warning');
      el.modePillText.textContent = '成员 · ' + personalNodes().length + ' 个人节点';
    } else if (!meta.kv || meta.readonly) {
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
    el.heroStatusText.textContent = !isOwner()
      ? '成员访问 · 共享节点 + 个人节点'
      : (kvMissing ? '只读预览 · 尚未连接存储' : (meta.corrupted ? '配置异常 · 当前载入默认节点' : '订阅服务运行中'));
    if (el.heroVersion) el.heroVersion.textContent = 'v' + (meta.version || '2.0.0');

    var personalCount = personalNodes().length;
    if (!isOwner()) {
      if (!total) {
        el.heroTitle.innerHTML = '还没有可用节点，<br class="hero-br">先添加一条自己的线路。';
        el.heroDesc.textContent = '你添加的节点只保存在自己的账号下，不影响所有人的共享配置。';
      } else if (!enabled.length) {
        el.heroTitle.innerHTML = '所有节点已停用，<br class="hero-br">订阅暂时为空。';
        el.heroDesc.textContent = '启用自己的节点，或联系所有者启用共享节点；客户端刷新订阅后才会拿到新配置。';
      } else {
        el.heroTitle.innerHTML = '节点已就绪，随时同步<br class="hero-br">至你的每一台设备。';
        el.heroDesc.textContent = personalCount
          ? '其中 ' + personalCount + ' 个是你自己的节点，修改只影响当前账号；共享节点由所有者维护。'
          : '共享节点由所有者维护；点击「添加节点」可以创建只对自己生效的线路。';
      }
    } else if (!total) {
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

  /* 控制台 CSP 是 style-src 'nonce-…'，内联 style 属性会被浏览器直接丢弃
     （nonce 只覆盖 <style> 元素，不覆盖 style 属性）。宽度与色块因此改用
     CSSOM 赋值：element.style 不受 CSP 限制，既保住 nonce-only 策略，
     又不会让统计条全部渲染成 100%。 */
  function applyBarStyles(root) {
    if (!root) return;
    $$('[data-pct]', root).forEach(function (bar) {
      var pct = Number(bar.getAttribute('data-pct'));
      if (!isFinite(pct)) pct = 0;
      bar.style.width = pct + '%';
      bar.classList.toggle('is-zero', pct <= 0);
    });
    $$('[data-color]', root).forEach(function (dot) {
      var color = dot.getAttribute('data-color');
      if (color) dot.style.background = color;
    });
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
    var groupCounts = {};
    enabled.forEach(function (node) {
      var id = nodeGroupId(node);
      if (id && groupById(id)) groupCounts[id] = (groupCounts[id] || 0) + 1;
    });
    var activeGroups = 1 + Object.keys(groupCounts).length + APP_GROUPS.length;

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
          '<span class="bar-label"><span class="type-dot" data-color="' + esc(TYPE_META[type].color) + '"></span><b>' + TYPE_META[type].label + '</b></span>' +
          '<span class="bar-track"><span class="bar-fill fill-' + type + '" data-pct="' + percent + '"></span></span>' +
          '<span class="bar-count">' + count + '</span>' +
          '</div>';
      }).join('');
      applyBarStyles(el.protoBars);
    }
    el.protoTotal.textContent = enabled.length + ' 在线';

    var groupRows = groups().filter(function (group) { return groupCounts[group.id]; });
    if (!groupRows.length) {
      el.regionBars.innerHTML = '<div class="bar-empty">暂无分组数据</div>';
    } else {
      el.regionBars.innerHTML = groupRows.map(function (group) {
        var count = groupCounts[group.id] || 0;
        var percent = Math.round((count / enabled.length) * 100);
        return '<div class="bar-row">' +
          '<span class="bar-label"><span class="type-dot" data-color="' + esc(groupColor(group.id)) + '"></span><b>' + esc(group.name) + '</b></span>' +
          '<span class="bar-track"><span class="bar-fill fill-' + esc(groupTone(group.id)) + '" data-pct="' + percent + '"></span></span>' +
          '<span class="bar-count">' + count + '</span>' +
          '</div>';
      }).join('');
      applyBarStyles(el.regionBars);
    }

    var recent = enabled.concat(list.filter(function (node) { return !node.enabled; })).slice(0, 4);
    if (!recent.length) {
      el.recentNodes.innerHTML = '<div class="bar-empty">暂无节点</div>';
    } else {
      el.recentNodes.innerHTML = recent.map(function (node) {
        var group = nodeGroup(node);
        var type = TYPE_META[node.type] || { label: node.type };
        var disabled = node.enabled ? '' : ' <span class="mini-badge">停用</span>';
        var inner = '<span class="mini-avatar avatar-' + esc(groupTone(nodeGroupId(node))) + '">' + esc(group ? groupEmoji(group.name) : '🌐') + '</span>' +
          '<span class="mini-main"><span class="mini-name">' + esc(node.name) + disabled + '</span>' +
          '<span class="mini-sub">' + esc(node.server) + ':' + esc(node.port) + '</span></span>' +
          '<span class="type-badge t-' + esc(node.type) + '"><span class="dot"></span>' + esc(type.label) + '</span>';
        // 只有能改的节点才渲染成按钮；共享节点保持只读展示
        return editableNode(node)
          ? '<button class="mini-item" type="button" data-edit-id="' + esc(node.id) + '">' + inner + '</button>'
          : '<div class="mini-item">' + inner + '</div>';
      }).join('');
    }

    var kvMissing = !meta.kv || meta.readonly;
    el.sysKv.textContent = kvMissing ? '未绑定 · 只读' : '已连接';
    el.sysKv.className = 'kv-val ' + (kvMissing ? 'is-warning' : 'is-ok');
    el.sysAuth.textContent = meta.authType === 'recovery'
      ? '恢复令牌会话'
      : (meta.username ? (isOwner() ? '所有者 · ' : '成员 · ') + meta.username : '账号登录');
    if (el.overviewAuthNote) {
      el.overviewAuthNote.textContent = isOwner()
        ? '登录使用账号密码，可在左侧「用户管理」添加或重置用户；订阅令牌只用于订阅链接。'
        : '成员账号可添加和修改自己的节点；共享节点与订阅链接由所有者分配。';
    }
    el.sysRev.textContent = '#' + state.rev;
    el.sysUpdated.textContent = state.config.updatedAt ? formatFull(state.config.updatedAt) : '尚未保存';

    var healthy = !kvMissing && !meta.corrupted;
    el.sysHealth.textContent = meta.corrupted ? '需注意' : (kvMissing ? '只读' : '正常');
    el.sysHealth.classList.toggle('soft-ok', healthy);

    renderSubUrls();
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

  // 只有真实分组才谈「组内顺序」：未分组 / 全部分组没有独立顺序表
  function isGroupFilter(value) {
    return !!value && value !== 'all' && value !== UNGROUPED && !!groupById(value);
  }

  // 某分组的节点 id 顺序：独立顺序表优先，未收录的按全局顺序追加
  function orderedGroupIds(groupId) {
    var stored = ((state.config && state.config.regionOrder) || {})[groupId] || [];
    var ids = nodes()
      .filter(function (node) { return nodeGroupId(node) === groupId; })
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
      if (state.filterGroup === UNGROUPED) {
        if (nodeGroup(node)) return false;
      } else if (state.filterGroup !== 'all' && nodeGroupId(node) !== state.filterGroup) {
        return false;
      }
      if (!query) return true;
      var type = TYPE_META[node.type] || { label: node.type };
      var group = nodeGroup(node);
      var tagText = (node.tags || []).map(function (tag) {
        return TAG_META[tag] ? TAG_META[tag].label : tag;
      }).join(' ');
      var haystack = [node.name, node.server, node.type, type.label, group ? group.name : '未分组', tagText]
        .join(' ').toLowerCase();
      return haystack.indexOf(query) !== -1;
    });
  }

  // 当前列表视图：筛选 +（按分组筛选时）该分组的独立顺序。
  // 列表渲染与排序移动必须共用同一顺序，否则换错邻居导致乱序。
  function viewNodes() {
    var list = filteredNodes();
    if (!state.query.trim() && isGroupFilter(state.filterGroup)) {
      var rank = {};
      orderedGroupIds(state.filterGroup).forEach(function (id, i) { rank[id] = i; });
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

    el.nodeCountLabel.textContent = query || state.filterType !== 'all' || state.filterGroup !== 'all'
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
    var group = nodeGroup(node);
    var tone = groupTone(nodeGroupId(node));
    var type = TYPE_META[node.type] || { label: node.type };
    var tags = (node.tags || []).filter(function (tag) { return TAG_META[tag]; });
    var tagHtml = tags.length
      ? '<div class="node-sub">' + tags.map(function (tag) {
        return '<span class="app-chip" title="' + esc(TAG_META[tag].label) + '">' + TAG_META[tag].emoji + '</span>';
      }).join('') + '</div>'
      : '';

    var shared = isSharedNode(node);
    var personal = !isOwner() && !shared;

    var badges = '';
    if (!node.enabled) badges += '<span class="mini-badge">已停用</span>';
    if (node.showInMain === false) badges += '<span class="mini-badge" title="不在「选择节点」中显示">不入主组</span>';
    if (personal) badges += '<span class="mini-badge is-personal" title="仅当前账号可见">我的</span>';
    if (shared) badges += '<span class="mini-badge" title="由所有者分配，成员不能修改">共享</span>';

    var moveHtml = '';
    if (sortable && isOwner()) {
      moveHtml =
        '<button class="icon-btn move-btn" type="button" data-move-id="' + esc(node.id) + '" data-dir="-1" title="上移" aria-label="上移节点"' + (index === 0 ? ' disabled' : '') + '>' + icon('arrow-up') + '</button>' +
        '<button class="icon-btn move-btn" type="button" data-move-id="' + esc(node.id) + '" data-dir="1" title="下移" aria-label="下移节点"' + (index === total - 1 ? ' disabled' : '') + '>' + icon('arrow-down') + '</button>';
    }

    var checked = state.selected.has(node.id);
    var rowClass = 'node-row' + (node.enabled ? '' : ' is-disabled') + (checked ? ' is-selected' : '') +
      (shared ? ' is-shared' : '') + (personal ? ' is-personal' : '');
    var rowAttrs = shared
      ? ''
      : ' tabindex="0" role="button" aria-label="编辑节点 ' + esc(node.name) + '"';
    var statusHtml = shared
      ? '<span class="shared-lock" title="共享节点由所有者维护" aria-label="共享节点由所有者维护">' + icon('shield') + '</span>'
      : '<button class="switch" type="button" role="switch" data-toggle-id="' + esc(node.id) + '" aria-checked="' + (node.enabled ? 'true' : 'false') + '" aria-label="' + (node.enabled ? '停用节点' : '启用节点') + '"></button>';
    var actionsHtml = shared
      ? ''
      : moveHtml +
        '<button class="icon-btn" type="button" data-edit-id="' + esc(node.id) + '" title="编辑" aria-label="编辑节点">' + icon('pen') + '</button>' +
        '<button class="icon-btn" type="button" data-menu-id="' + esc(node.id) + '" title="更多操作" aria-label="更多操作" aria-haspopup="menu" aria-expanded="false">' + icon('more') + '</button>';

    return '<div class="' + rowClass + '" data-id="' + esc(node.id) + '"' + rowAttrs + '>' +
      '<div class="cell cell-check"><input type="checkbox" class="check-input" data-pick-id="' + esc(node.id) + '" aria-label="选择节点 ' + esc(node.name) + '"' + (checked ? ' checked' : '') + '></div>' +
      '<div class="cell cell-node">' +
        '<span class="node-avatar avatar-' + esc(tone) + '">' + esc(group ? groupEmoji(group.name) : '🌐') + '</span>' +
        '<div class="node-main">' +
          '<div class="node-name"><span>' + esc(node.name) + '</span>' + badges + '</div>' +
          tagHtml +
        '</div>' +
      '</div>' +
      '<div class="cell cell-server">' +
        '<code>' + esc(node.server) + '</code><span class="port">:' + esc(node.port) + '</span>' +
      '</div>' +
      '<div class="cell cell-type"><span class="type-badge t-' + esc(node.type) + '"><span class="dot"></span>' + esc(type.label) + '</span></div>' +
      '<div class="cell cell-region"><span class="region-chip" title="' + esc(group ? group.name : '未分组') + '">' +
        (group ? esc(groupEmoji(group.name)) + ' ' + esc(groupShort(group.name)) : '🌐 未分组') + '</span></div>' +
      '<div class="cell cell-status">' + statusHtml + '</div>' +
      '<div class="cell cell-actions">' + actionsHtml + '</div>' +
    '</div>';
  }

  /* ------------------------------------------------------------------ */
  /* groups（策略组）                                                    */
  /* ------------------------------------------------------------------ */

  function newGroupId(prefix) {
    // 成员分组用 mg_ 前缀：和所有者的内置组 / g_ 自定义组天然隔开
    return randomId(prefix || 'g_');
  }

  function renderGroups() {
    if (!el.groupList) return;
    if (!state.config) {
      el.groupList.innerHTML = '<div class="group-empty">正在载入分组…</div>';
      return;
    }
    var list = groups();
    var own = ownGroups();
    var owner = isOwner();
    var all = nodes();
    var ungrouped = all.filter(function (node) { return !nodeGroup(node); });

    var cards = list.map(function (group) {
      var members = all.filter(function (node) { return nodeGroupId(node) === group.id; });
      var active = members.filter(function (node) { return node.enabled; }).length;
      var mine = isOwnGroup(group.id);
      var ownIndex = own.indexOf(group);
      var badge = '';
      if (!mine) {
        badge = '<span class="group-badge is-soft">共享</span>';
      } else if (isBuiltinGroup(group.id)) {
        badge = '<span class="group-badge">内置</span>';
      } else if (group.icon) {
        badge = '<span class="group-badge is-soft" title="' + esc(group.icon) + '">自定义图标</span>';
      }
      // 共享分组对成员只读：不给按钮，避免点了才发现 403
      var actions = mine
        ? '<div class="group-actions">' +
            '<button class="icon-btn" type="button" data-group-move="' + esc(group.id) + '" data-dir="-1" title="上移分组" aria-label="上移分组"' + (ownIndex === 0 ? ' disabled' : '') + '>' + icon('arrow-up') + '</button>' +
            '<button class="icon-btn" type="button" data-group-move="' + esc(group.id) + '" data-dir="1" title="下移分组" aria-label="下移分组"' + (ownIndex === own.length - 1 ? ' disabled' : '') + '>' + icon('arrow-down') + '</button>' +
            '<button class="btn btn-quiet btn-sm" type="button" data-group-edit="' + esc(group.id) + '">' + icon('pen') + '编辑</button>' +
            '<button class="icon-btn group-delete" type="button" data-group-delete="' + esc(group.id) + '" title="删除分组" aria-label="删除分组 ' + esc(group.name) + '">' + icon('trash') + '</button>' +
          '</div>'
        : '';
      return '<article class="group-card' + (state.groupFormId === group.id ? ' is-editing' : '') + '">' +
        '<span class="group-avatar avatar-' + esc(groupTone(group.id)) + '">' + esc(groupEmoji(group.name)) + '</span>' +
        '<div class="group-main">' +
          '<div class="group-title">' +
            '<span class="group-name">' + esc(group.name) + '</span>' +
            badge +
          '</div>' +
          '<div class="group-sub">' + members.length + ' 个节点 · ' + active + ' 个已启用' +
            (mine ? '' : ' · 由所有者维护') + '</div>' +
        '</div>' +
        actions +
      '</article>';
    }).join('');

    var rest = '<article class="group-card is-ungrouped">' +
      '<span class="group-avatar avatar-other">🌐</span>' +
      '<div class="group-main">' +
        '<div class="group-title"><span class="group-name">未分组</span></div>' +
        '<div class="group-sub">' + ungrouped.length + ' 个节点只出现在 🌍选择节点 里</div>' +
      '</div>' +
      '<div class="group-actions">' +
        '<button class="btn btn-quiet btn-sm" type="button" data-group-view="' + UNGROUPED + '">查看节点</button>' +
      '</div>' +
    '</article>';

    el.groupList.innerHTML = cards + rest;
    if (el.groupSummary) {
      el.groupSummary.textContent = owner
        ? list.length + ' 个分组 · ' + all.length + ' 个节点'
        : own.length + ' 个自定义分组 · ' + (list.length - own.length) + ' 个共享分组';
    }
    if (el.groupsSub) {
      el.groupsSub.textContent = owner
        ? '每个分组都会作为独立策略组写入订阅；改名、换图标或调整顺序都不会改动节点数据。'
        : '共享分组由所有者维护；你新建的分组只出现在自己的订阅里，用来收纳个人节点。';
    }
  }

  function groupErrorNode(key) {
    return el.groupForm ? $('[data-error="' + key + '"]', el.groupForm) : null;
  }

  function clearGroupErrors() {
    if (!el.groupForm) return;
    $$('.field-error', el.groupForm).forEach(function (node) { node.textContent = ''; });
    $$('.field.has-error', el.groupForm).forEach(function (node) { node.classList.remove('has-error'); });
  }

  function showGroupErrors(errors) {
    if (!el.groupForm) return;
    clearGroupErrors();
    errors.forEach(function (error) {
      var node = groupErrorNode(error.key);
      if (!node) return;
      node.textContent = error.message;
      var field = node.closest('.field');
      if (field) field.classList.add('has-error');
    });
    var first = errors.length ? groupErrorNode(errors[0].key) : null;
    var field = first ? first.closest('.field') : null;
    var input = field ? $('input', field) : null;
    if (input) input.focus();
  }

  function setGroupBusy(busy) {
    state.groupBusy = busy;
    if (el.groupSave) {
      el.groupSave.disabled = busy;
      el.groupSave.classList.toggle('is-loading', busy);
    }
    if (el.groupSaveSpinner) el.groupSaveSpinner.hidden = !busy;
    if (el.groupSaveLabel) el.groupSaveLabel.textContent = busy ? '保存中…' : (state.groupFormId ? '保存分组' : '创建分组');
  }

  function openGroupEditor(id) {
    if (!el.groupForm) return;
    if (!ensureWritable()) return;
    var group = id ? groupById(id) : null;
    if (id && !group) {
      toast('分组不存在，请刷新后重试', 'error');
      return;
    }
    if (group && !isOwnGroup(group.id)) {
      toast('共享分组由所有者维护，不能在这里修改', 'info');
      return;
    }
    if (!id && ownGroups().length >= groupLimit()) {
      toast('分组数量已达上限 ' + groupLimit() + ' 个', 'error');
      return;
    }
    state.groupFormId = group ? group.id : null;
    clearGroupErrors();
    setField(el.groupName, group ? group.name : '');
    setField(el.groupIcon, group ? group.icon || '' : '');
    if (el.groupFormTitle) el.groupFormTitle.textContent = group ? '编辑分组' : '新建分组';
    if (el.groupFormSub) {
      el.groupFormSub.textContent = group
        ? '改名或换图标会同步到订阅里的策略组，节点归属不变。'
        : (isOwner()
          ? '新分组会作为独立策略组写入订阅，节点可以在节点管理里移入。'
          : '新分组只出现在你自己的订阅里，节点可以在节点管理里移入。');
    }
    setGroupBusy(false);
    el.groupForm.hidden = false;
    renderGroups();
    window.setTimeout(function () {
      el.groupName.focus();
      el.groupName.select();
    }, 40);
  }

  function closeGroupEditor() {
    state.groupFormId = null;
    if (el.groupForm) el.groupForm.hidden = true;
    clearGroupErrors();
    renderGroups();
  }

  function groupFormErrors(name, icon) {
    var errors = [];
    if (!name) {
      errors.push({ key: 'groupName', message: '请填写分组名称' });
    } else if (name.length > GROUP_NAME_MAX) {
      errors.push({ key: 'groupName', message: '分组名称不能超过 ' + GROUP_NAME_MAX + ' 个字符' });
    } else if (CONTROL_RE.test(name)) {
      errors.push({ key: 'groupName', message: '分组名称不能包含控制字符' });
    } else if (RESERVED_GROUP_NAMES.has(name)) {
      errors.push({ key: 'groupName', message: '该名称与内置策略或应用策略组冲突' });
    } else if (groups().some(function (group) {
      return group.name.toLowerCase() === name.toLowerCase() && group.id !== state.groupFormId;
    })) {
      errors.push({ key: 'groupName', message: '分组名称已存在' });
    } else if (nodes().some(function (node) {
      return node.name.toLowerCase() === name.toLowerCase();
    })) {
      errors.push({ key: 'groupName', message: '已有同名节点，客户端会解析失败' });
    }
    if (icon && (icon.length > 256 || /[\s"'\\]/.test(icon) || icon.indexOf('https://') !== 0)) {
      errors.push({ key: 'groupIcon', message: '图标需为 https:// 开头、不含空格与引号的地址' });
    }
    return errors;
  }

  async function submitGroupForm(event) {
    if (event) event.preventDefault();
    if (state.mutating || state.groupBusy) return;
    if (!ensureWritable()) return;
    var editing = state.groupFormId;
    var name = String(el.groupName.value || '').trim();
    var icon = String(el.groupIcon.value || '').trim();
    var errors = groupFormErrors(name, icon);
    if (errors.length) {
      showGroupErrors(errors);
      return;
    }

    var owner = isOwner();
    var list = (owner ? groups() : ownGroups()).map(function (group) { return Object.assign({}, group); });
    if (editing) {
      list = list.map(function (group) {
        return group.id === editing ? Object.assign({}, group, { name: name, icon: icon }) : group;
      });
    } else {
      if (list.length >= groupLimit()) {
        showGroupErrors([{ key: 'groupName', message: '分组数量不能超过 ' + groupLimit() + ' 个' }]);
        return;
      }
      list.push({ id: newGroupId(owner ? 'g_' : 'mg_'), name: name, icon: icon });
    }

    setGroupBusy(true);
    var ok = await saveNodes(nodes(), {
      groups: list,
      successMessage: editing ? '分组已更新' : '已创建分组「' + name + '」',
      rerenderOnError: true
    });
    setGroupBusy(false);
    if (ok) closeGroupEditor();
  }

  async function moveGroup(id, dir) {
    if (state.mutating || !ensureWritable() || !isOwnGroup(id)) return;
    var own = ownGroups().map(function (group) { return Object.assign({}, group); });
    var index = -1;
    for (var i = 0; i < own.length; i++) {
      if (own[i].id === id) index = i;
    }
    var target = index + dir;
    if (index < 0 || target < 0 || target >= own.length) return;
    var tmp = own[index];
    own[index] = own[target];
    own[target] = tmp;
    // 共享分组保持所有者定的顺序在前，成员只在自建分组内部调序
    var list = groups().filter(function (group) { return !isOwnGroup(group.id); }).concat(own);
    await saveNodes(nodes(), {
      groups: list,
      successMessage: '分组顺序已更新',
      rerenderOnError: true
    });
  }

  function askDeleteGroup(id) {
    var group = groupById(id);
    if (!group || !isOwnGroup(id) || !ensureWritable() || state.mutating) return;
    var members = nodes().filter(function (node) { return nodeGroupId(node) === id; });
    openConfirm({
      title: '删除分组「' + group.name + '」？',
      segments: [
        { text: isOwner() ? '策略组会从订阅中移除；其中的 ' : '策略组会从你的订阅中移除；其中的 ' },
        { strong: true, text: String(members.length) + ' 个节点' },
        { text: ' 不会被删除，而是变成「未分组」，只出现在 🌍选择节点 里。' }
      ],
      okLabel: '删除分组',
      danger: true,
      onOk: function () { return doDeleteGroup(id); }
    });
  }

  async function doDeleteGroup(id) {
    if (state.mutating) return;
    var owner = isOwner();
    var list = (owner ? groups() : ownGroups()).filter(function (group) { return group.id !== id; });
    // 所有者必须保留至少一个分组；成员可以一个自建分组都不留
    if (owner && !list.length) {
      toast('至少需要保留一个分组；可以先新建一个再删除这个', 'error');
      closeModal('generic');
      return;
    }
    el.genericOk.disabled = true;
    el.genericOk.textContent = '删除中…';
    var ok = await saveNodes(nodes(), {
      groups: list,
      successMessage: '分组已删除，原节点已归入未分组',
      rerenderOnError: true
    });
    el.genericOk.disabled = false;
    el.genericOk.textContent = '删除分组';
    if (ok) {
      if (state.groupFormId === id) closeGroupEditor();
      closeModal('generic');
    }
  }

  /* 从分组卡片跳到节点列表：按该分组过滤，未分组走 UNGROUPED 分支 */
  function focusGroup(value) {
    state.query = '';
    if (el.nodeSearch) el.nodeSearch.value = '';
    state.filterType = 'all';
    if (el.filterType) el.filterType.value = 'all';
    state.filterGroup = value;
    if (el.filterGroup) el.filterGroup.value = value;
    switchView('nodes');
  }

  /* ---- selection & bulk actions ---- */

  function isOwner() {
    // 旧版本 Worker 的 meta 没有 role，按原有行为视为所有者
    return !!(state.meta && state.meta.role !== 'member');
  }

  /* 分组归属：所有者能管全部分组；成员只能管自己新建的（id 记在 meta.personalGroupIds） */
  function personalGroupIds() {
    var ids = state.meta && state.meta.personalGroupIds;
    return Array.isArray(ids) ? ids : [];
  }

  function isOwnGroup(id) {
    if (isOwner()) return true;
    return personalGroupIds().indexOf(id) !== -1;
  }

  function ownGroups() {
    return groups().filter(function (group) { return isOwnGroup(group.id); });
  }

  function groupLimit() {
    if (isOwner()) return MAX_GROUPS;
    var max = state.meta && Number(state.meta.maxPersonalGroups);
    return Number.isFinite(max) && max > 0 ? max : MAX_MEMBER_GROUPS;
  }

  function canWrite() {
    var meta = state.meta;
    return !!(meta && meta.kv && !meta.readonly && meta.canWrite !== false);
  }

  function personalNodeIds() {
    var ids = state.meta && state.meta.personalNodeIds;
    return Array.isArray(ids) ? ids : [];
  }

  function isPersonalNode(node) {
    if (!node) return false;
    if (isOwner()) return true;
    return personalNodeIds().indexOf(node.id) !== -1;
  }

  function isSharedNode(node) {
    return !isOwner() && !!node && !isPersonalNode(node);
  }

  function editableNode(node) {
    return !!node && canWrite() && (isOwner() || isPersonalNode(node));
  }

  function personalNodes() {
    return nodes().filter(isPersonalNode);
  }

  function nodeLimit() {
    if (isOwner()) return MAX_NODES;
    var max = state.meta && Number(state.meta.maxPersonalNodes);
    return Number.isFinite(max) && max > 0 ? max : MAX_PERSONAL_NODES;
  }

  function personalRoom() {
    return Math.max(nodeLimit() - personalNodes().length, 0);
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

  function bulkMoveGroup() {
    if (!ensureWritable() || state.mutating) return;
    var value = el.bulkGroup.value;
    if (!value) return;
    var groupId = value === UNGROUPED ? '' : value;
    var group = groupId ? groupById(groupId) : null;
    if (groupId && !group) return;
    var ids = Array.from(state.selected);
    if (!ids.length) return;
    var previous = nodes();
    var next = previous.map(function (node) {
      return state.selected.has(node.id) ? Object.assign({}, node, { groupId: groupId }) : node;
    });
    setBulkBusy(true);
    saveNodes(next, {
      successMessage: '已将 ' + ids.length + ' 个节点移至「' + (group ? group.name : '仅选择列表') + '」',
      successAction: {
        label: '撤销',
        run: function () { undoSnapshot(previous, '已恢复节点原分组'); }
      },
      rerenderOnError: true
    }).then(function (ok) {
      setBulkBusy(false);
      // 失败时保留下拉选择，方便用户直接重试
      if (ok) {
        el.bulkGroup.value = '';
        clearSelection();
      }
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
    if (!node || !el.rowMenu || !editableNode(node)) return;
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
    if (!isOwner() || !ensureWritable() || state.mutating) return;
    var view = viewNodes();
    var viewIndex = view.findIndex(function (node) { return node.id === id; });
    var viewTarget = viewIndex + dir;
    if (viewIndex < 0 || viewTarget < 0 || viewTarget >= view.length) return;
    setRowBusy(button, true);

    // 按分组筛选时：只改该分组的独立顺序表，不动全局顺序，其他分组与 🌍组不受影响
    if (isGroupFilter(state.filterGroup)) {
      var order = orderedGroupIds(state.filterGroup);
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
      regionOrder[state.filterGroup] = order;
      var okGroup = await saveNodes(nodes(), {
        regionOrder: regionOrder,
        successMessage: '分组内顺序已更新，不影响其他分组',
        rerenderOnError: true
      });
      if (!okGroup && button) button.disabled = false;
      return;
    }

    // 未筛选：视图中相邻即全局相邻，等价于交换；
    // 按协议筛选：视图中相邻的节点在全局数组里可能隔着其他协议的节点，
    // 直接交换会把中间的节点一起牵连进来。改为「移出后插入到目标旁」，
    // 筛选视图结果一致，且不影响协议筛选之外的节点。
    var nextNodes = nodes().slice();
    var a = nextNodes.findIndex(function (node) { return node.id === view[viewIndex].id; });
    var b = nextNodes.findIndex(function (node) { return node.id === view[viewTarget].id; });
    if (a < 0 || b < 0) {
      if (button) button.disabled = false;
      return;
    }
    var moved = nextNodes.splice(a, 1)[0];
    if (a < b) b -= 1; // 移出的节点在目标之前时，目标索引左移一位
    nextNodes.splice(dir < 0 ? b : b + 1, 0, moved);
    var ok = await saveNodes(nextNodes, {
      successMessage: dir < 0 ? '节点已上移' : '节点已下移',
      rerenderOnError: true
    });
    if (!ok && button) button.disabled = false;
  }

  function switchView(view) {
    if (!VIEW_META[view]) view = 'overview';
    if (view === 'users' && !isOwner()) view = 'overview';
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
    if (view === 'groups') renderGroups();
    if (view === 'overview') renderOverview();
    if (view === 'users') loadUsers();
    if (view === 'settings') {
      if (isOwner()) renderSettings();
      else renderAccount();
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
    var hint = meta.authTokenHint || '';
    if (meta.authSource === 'settings') {
      el.authTokenNote.textContent = '当前令牌 ' + hint + '（由设置页保存）；保存新值会立即使旧令牌失效，点「清除」可删除并回退到环境变量。为避免明文外泄，控制台不再回显完整令牌，需要新令牌请点「生成」。该令牌仅用于订阅访问，不能登录控制台。';
    } else if (meta.authSource === 'environment') {
      el.authTokenNote.textContent = '当前使用环境变量 AUTH_TOKEN' + (hint ? '（' + hint + '）' : '') + '；填写新令牌并保存后，改由设置页管理。该令牌仅用于订阅访问，不能登录控制台。';
    } else {
      el.authTokenNote.textContent = '当前尚未配置订阅令牌，填写并保存后订阅链接立即可用；该令牌不能用于登录控制台。';
    }
  }

  function renderSettings() {
    if (!state.config) return;
    var defaults = currentDefaults();
    var info = state.config.subscription || {};
    state.clearAuthToken = false;
    // 令牌不回显明文：输入框始终留空，占位符给出掩码与下一步操作提示
    setField(el.setAuthToken, '');
    if (el.setAuthToken) {
      el.setAuthToken.placeholder = (state.meta && state.meta.authTokenHint)
        ? '当前 ' + state.meta.authTokenHint + '；留空保持不变'
        : '至少 16 个字符';
    }
    setField(el.setProviderBase, state.config.providerBase || '');
    renderAuthTokenNote();
    setField(el.setUuid, defaults.vlessUuid || '');
    setField(el.setPbk, defaults.vlessPublicKey || '');
    setField(el.setSid, defaults.vlessShortId || '');
    setField(el.setSni, defaults.vlessServername || '');
    setField(el.setPort, defaults.vlessPort > 0 ? defaults.vlessPort : '');
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
      // 掩码优先于长度：粘贴回来的掩码无论多长都是同一个误操作，提示只给一条
      if (authTokenRaw.indexOf('\u2022') !== -1) {
        errors.push({ key: 'setAuthToken', message: '订阅令牌不能包含掩码字符，请填写完整令牌' });
      } else if (authTokenRaw.length < 16) {
        errors.push({ key: 'setAuthToken', message: '订阅令牌至少需要 16 个字符' });
      } else if (authTokenRaw.length > 256) {
        errors.push({ key: 'setAuthToken', message: '订阅令牌不能超过 256 个字符' });
      } else if (/[\s\u0000-\u001f\u007f]/.test(authTokenRaw)) {
        errors.push({ key: 'setAuthToken', message: '订阅令牌不能包含空格或控制字符' });
      } else {
        authToken = authTokenRaw;
      }
    }

    // 点击过「清除」且输入框为空：保存时下发 null 删除设置页令牌；一旦又输入了新值则取消清除
    var clearToken = state.clearAuthToken && !authTokenRaw;

    var providerBase = String(el.setProviderBase.value || '').trim();
    if (providerBase) {
      if (providerBase.length > 256) {
        errors.push({ key: 'setProviderBase', message: '镜像前缀不能超过 256 个字符' });
      } else if (!/^https:\/\/[A-Za-z0-9._~:\/?#@!$&*+,;=%-]+$/.test(providerBase)) {
        errors.push({ key: 'setProviderBase', message: '镜像前缀需以 https:// 开头，且不含空格或引号' });
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

    var portRaw = String(el.setPort.value || '').trim();
    if (portRaw) {
      var port = Number(portRaw);
      if (!/^\d+$/.test(portRaw) || !Number.isInteger(port) || port < 1 || port > 65535) {
        errors.push({ key: 'setPort', message: '需为 1–65535 的整数' });
      } else {
        defaults.vlessPort = port;
      }
    }

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

    return {
      defaults: defaults,
      subscription: subscription,
      authToken: authToken,
      providerBase: providerBase,
      clearToken: clearToken,
      errors: errors
    };
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
        subscription: result.subscription,
        providerBase: result.providerBase
      };
      if (result.clearToken) body.authToken = null;
      else if (result.authToken) body.authToken = result.authToken;
      var data = await request('/api/config', { method: 'PUT', body: body });
      applyConfig(data);
      renderAll();
      renderSettings();
      state.clearAuthToken = false;
      toast(result.clearToken
        ? '设置已保存，已清除订阅令牌并回退到环境变量'
        : (result.authToken
          ? '设置已保存，新订阅令牌即时生效'
          : '设置已保存，订阅信息即时生效，新建 VLESS 节点将使用新预设'), 'success');
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

  function syncRoleUi() {
    var owner = isOwner();
    document.body.classList.toggle('is-member', !owner);
    $$('[data-owner-only]').forEach(function (panel) { panel.hidden = !owner; });
    $$('[data-member-only]').forEach(function (panel) { panel.hidden = owner; });
  }

  function renderAccount() {
    var meta = state.meta || {};
    var scope = meta.scope || {};
    var personalCount = personalNodes().length;
    var sharedCount = Math.max(nodes().length - personalCount, 0);
    if (el.accountUsername) el.accountUsername.value = meta.username || '';
    if (el.accountRole) el.accountRole.textContent = isOwner() ? '所有者' : '成员';
    if (el.accountScope) {
      el.accountScope.value = (scope.allNodes ? '全部共享节点' : '已分配共享节点') +
        '（' + sharedCount + ' 个） · 个人节点（' + personalCount + ' 个）';
    }
    if (el.accountSubUrl) {
      el.accountSubUrl.value = meta.subUrl ? maskToken(meta.subUrl) : '';
      el.accountSubUrl.placeholder = meta.subUrl ? '' : '订阅链接尚未生成，请稍后刷新';
    }
    if (el.accountSubCopy) el.accountSubCopy.disabled = !meta.subUrl;
    if (el.accountPanel) el.accountPanel.hidden = isOwner();
  }

  function setPasswordBusy(busy) {
    if (el.pwSave) {
      el.pwSave.disabled = busy;
      el.pwSave.classList.toggle('is-loading', busy);
    }
    if (el.pwSpinner) el.pwSpinner.hidden = !busy;
    if (el.pwSaveLabel) el.pwSaveLabel.textContent = busy ? '更新中…' : '更新密码';
  }

  function clearPasswordErrors() {
    if (!el.passwordForm) return;
    $$('.field.has-error', el.passwordForm).forEach(function (field) { field.classList.remove('has-error'); });
    $$('[data-error]', el.passwordForm).forEach(function (error) { error.textContent = ''; });
    $$('[aria-invalid="true"]', el.passwordForm).forEach(function (input) { input.removeAttribute('aria-invalid'); });
  }

  function showPasswordErrors(errors) {
    clearPasswordErrors();
    var global = $('[data-error="global"]', el.passwordForm);
    (errors || []).forEach(function (error) {
      var key = error.key || 'global';
      var target = $('[data-error="' + key + '"]', el.passwordForm) || global;
      if (!target) return;
      target.textContent = error.message;
      if (target === global) return;
      var field = target.closest('.field');
      if (field) field.classList.add('has-error');
      var input = field ? $('input', field) : null;
      if (input) input.setAttribute('aria-invalid', 'true');
    });
  }

  async function submitPasswordChange(event) {
    if (event) event.preventDefault();
    if (state.passwordBusy) return;
    clearPasswordErrors();
    var current = el.pwCurrent.value || '';
    var next = el.pwNew.value || '';
    var confirm = el.pwConfirm.value || '';
    var errors = [];
    if (!current) errors.push({ key: 'currentPassword', message: '请输入当前密码' });
    if (!next) {
      errors.push({ key: 'newPassword', message: '请输入新密码' });
    } else if (next.length < PASSWORD_MIN) {
      errors.push({ key: 'newPassword', message: '密码至少需要 ' + PASSWORD_MIN + ' 个字符' });
    } else if (next.length > 128) {
      errors.push({ key: 'newPassword', message: '密码不能超过 128 个字符' });
    } else if (next !== confirm) {
      errors.push({ key: 'newPassword', message: '两次输入的新密码不一致' });
    }
    if (errors.length) {
      showPasswordErrors(errors);
      return;
    }

    state.passwordBusy = true;
    setPasswordBusy(true);
    try {
      var data = await request('/api/password', {
        method: 'POST',
        body: { currentPassword: current, newPassword: next }
      });
      if (data && data.token) {
        state.token = data.token;
        storageSet('session', STORAGE_KEY, data.token);
      }
      el.pwCurrent.value = '';
      el.pwNew.value = '';
      el.pwConfirm.value = '';
      toast('密码已更新，其他设备的登录与旧订阅链接已失效', 'success');
      await reloadConfig();
      renderAccount();
    } catch (err) {
      if (err.status === 401) {
        handleUnauthorized();
        return;
      }
      showPasswordErrors([{ key: err.field || 'global', message: err.message || '修改失败，请稍后重试' }]);
    } finally {
      state.passwordBusy = false;
      setPasswordBusy(false);
    }
  }

  async function loadUsers(force) {
    if (!state.config) return;
    if (!isOwner()) {
      renderAccount();
      return;
    }
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

  function scopeSummary(user) {
    if (user.role === 'owner') return '全部节点';
    var scope = user.scope || {};
    if (scope.allNodes) return '全部节点';
    var count = Array.isArray(scope.nodeIds) ? scope.nodeIds.length : 0;
    return count ? count + ' 个节点' : '未分配节点';
  }

  function renderUsers() {
    if (!el.userList) return;
    var users = Array.isArray(state.users) ? state.users : [];
    if (!users.length) {
      el.userList.innerHTML = '<div class="user-empty">还没有可用账号，请添加一个。</div>';
      syncUserAddState();
      return;
    }
    var ownerCount = users.filter(function (user) { return user.role === 'owner'; }).length;
    el.userList.innerHTML = users.map(function (user) {
      var current = user.id === state.currentUserId;
      var isOwnerUser = user.role === 'owner';
      var lastOwner = isOwnerUser && ownerCount <= 1;
      var canDelete = !current && users.length > 1 && !lastOwner;
      var created = user.createdAt ? formatShort(user.createdAt) : '';
      var deleteTitle = current
        ? '不能删除当前登录账号'
        : (lastOwner ? '至少需要保留一个所有者账号' : (users.length <= 1 ? '至少需要保留一个账号' : '删除账号'));
      return '<div class="user-row' + (current ? ' is-current' : '') + '">' +
        '<span class="user-avatar">' + esc(userInitial(user.username)) + '</span>' +
        '<span class="user-main">' +
          '<span class="user-name" title="' + esc(user.username) + '">' + esc(user.username) + (current ? '<span class="user-badge">当前账号</span>' : '') + '</span>' +
          '<span class="user-sub">' +
            '<span class="role-badge' + (isOwnerUser ? ' is-owner' : '') + '">' + (isOwnerUser ? '所有者' : '成员') + '</span>' +
            '<span>可用 ' + esc(scopeSummary(user)) + '</span>' +
            (created ? '<span>创建于 ' + esc(created) + '</span>' : '') +
          '</span>' +
        '</span>' +
        '<span class="user-actions">' +
          '<button class="btn btn-quiet btn-sm" type="button" data-user-manage="' + esc(user.id) + '">管理</button>' +
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
      el.userSaveLabel.textContent = state.userFormMode === 'manage' ? '保存修改' : '添加用户';
    }
  }

  function scopeFromForm() {
    var allNodes = !!(el.userScopeAll && el.userScopeAll.checked);
    var nodeIds = [];
    if (!allNodes && el.userScopeList) {
      $$('input[type="checkbox"]', el.userScopeList).forEach(function (input) {
        if (input.checked) nodeIds.push(input.value);
      });
    }
    return { allNodes: allNodes, nodeIds: nodeIds };
  }

  function renderUserScope(scope, role) {
    if (!el.userScopeField) return;
    var owner = role === 'owner';
    var allNodes = owner || !scope || scope.allNodes === true;
    var selected = {};
    ((scope && scope.nodeIds) || []).forEach(function (id) { selected[id] = true; });
    el.userScopeField.hidden = owner;
    if (el.userScopeAll) {
      el.userScopeAll.checked = allNodes;
      el.userScopeAll.disabled = owner;
    }
    if (!el.userScopeList) return;
    el.userScopeList.classList.toggle('is-all', allNodes);
    var list = nodes();
    if (!list.length) {
      el.userScopeList.innerHTML = '<div class="scope-empty">还没有节点；保存后该成员不会获得任何节点。</div>';
      return;
    }
    el.userScopeList.innerHTML = list.map(function (node) {
      var type = TYPE_META[node.type] || { label: node.type };
      var on = allNodes || !!selected[node.id];
      return '<label class="scope-item">' +
        '<input class="check-input" type="checkbox" value="' + esc(node.id) + '"' + (on ? ' checked' : '') + (allNodes ? ' disabled' : '') + '>' +
        '<span class="scope-name">' + esc(node.name) + '</span>' +
        '<span class="scope-meta">' + esc(groupShort(groupLabel(node))) + ' · ' + esc(type.label) + '</span>' +
        '</label>';
    }).join('');
  }

  function syncScopeControls() {
    var allNodes = !!(el.userScopeAll && el.userScopeAll.checked);
    if (!el.userScopeList) return;
    el.userScopeList.classList.toggle('is-all', allNodes);
    $$('input[type="checkbox"]', el.userScopeList).forEach(function (input) {
      input.disabled = allNodes;
      if (allNodes) input.checked = true;
    });
  }

  function openUserEditor(mode, id) {
    if (!el.userForm || !isOwner()) return;
    if (mode === 'manage') {
      var user = findUser(id);
      if (!user) return;
      state.userFormMode = 'manage';
      state.userFormId = id;
      el.userFormTitle.textContent = '管理账号';
      el.userFormSub.textContent = user.id === state.currentUserId
        ? '调整当前账号的角色与节点范围；密码留空则保持不变。'
        : '调整 ' + user.username + ' 的角色与可用节点；密码留空则保持不变。';
      el.userUsername.value = user.username;
      el.userUsername.disabled = true;
      el.userRole.value = user.role === 'owner' ? 'owner' : 'member';
      renderUserScope(user.scope, user.role);
      el.userSaveLabel.textContent = '保存修改';
    } else {
      state.userFormMode = 'add';
      state.userFormId = null;
      el.userFormTitle.textContent = '添加账号';
      el.userFormSub.textContent = '新账号默认是成员，只能使用分配的共享节点并添加个人节点；需要全部权限时可设为所有者。';
      el.userUsername.value = '';
      el.userUsername.disabled = false;
      el.userRole.value = 'member';
      renderUserScope({ allNodes: false, nodeIds: [] }, 'member');
      el.userSaveLabel.textContent = '添加用户';
    }
    if (el.userPasswordHint) el.userPasswordHint.hidden = state.userFormMode === 'add';
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
    if (el.userRole) el.userRole.value = 'member';
    if (el.userPasswordHint) el.userPasswordHint.hidden = true;
    el.userPassword.value = '';
    el.userPassword2.value = '';
    clearUserErrors();
    setUserBusy(false);
    syncUserAddState();
  }

  function collectUserForm() {
    var errors = [];
    var mode = state.userFormMode;
    var username = String(el.userUsername.value || '').trim();
    var password = el.userPassword.value || '';
    var confirm = el.userPassword2.value || '';
    var role = el.userRole && el.userRole.value === 'owner' ? 'owner' : 'member';
    var scope = role === 'owner' ? { allNodes: true, nodeIds: [] } : scopeFromForm();
    if (mode === 'add') {
      if (!username) {
        errors.push({ key: 'username', message: '请输入用户名' });
      } else if (!USERNAME_RE.test(username)) {
        errors.push({ key: 'username', message: '需 3–254 位，以字母或数字开头，可含 . _ + @ -，也可直接填写邮箱' });
      }
    }
    if (mode === 'add' || password) {
      if (!password) {
        errors.push({ key: 'password', message: '请输入密码' });
      } else if (password.length < PASSWORD_MIN) {
        errors.push({ key: 'password', message: '密码至少需要 ' + PASSWORD_MIN + ' 个字符' });
      } else if (password.length > 128) {
        errors.push({ key: 'password', message: '密码不能超过 128 个字符' });
      } else if (password !== confirm) {
        errors.push({ key: 'password', message: '两次输入的密码不一致' });
      }
    }
    return { username: username, password: password, role: role, scope: scope, errors: errors };
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
          body: {
            rev: state.usersRev,
            username: result.username,
            password: result.password,
            role: result.role,
            scope: result.scope
          }
        });
      } else {
        var body = { rev: state.usersRev, id: id, role: result.role, scope: result.scope };
        if (result.password) body.password = result.password;
        data = await request('/api/users/update', { method: 'POST', body: body });
      }
      applyUsersResponse(data);
      closeUserEditor();
      if (mode === 'add') {
        toast('已添加' + (result.role === 'owner' ? '所有者' : '成员') + '「' + result.username + '」', 'success');
      } else {
        toast(result.password ? '账号权限与密码已更新' : '账号权限已更新', 'success');
      }
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
    var users = state.users || [];
    if (users.length <= 1) {
      toast('至少需要保留一个管理员账号', 'info');
      return;
    }
    if (user.role === 'owner' && users.filter(function (item) { return item.role === 'owner'; }).length <= 1) {
      toast('至少需要保留一个所有者账号', 'info');
      return;
    }
    state.userDeletingId = id;
    openConfirm({
      title: '删除这个账号？',
      segments: [
        { text: '即将删除 ' },
        { strong: true, text: user.username },
        { text: '，该账号会立即退出登录，其独立订阅链接同时失效且无法恢复。' }
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
      var owner = isOwner();
      // 成员只把个人节点发到 /api/nodes；新建节点尚未进入 meta.personalNodeIds，
      // 但 id 已按 p_ 命名空间生成，同样需要带上
      var payloadNodes = owner ? nextNodes : nextNodes.filter(function (node) {
        return isPersonalNode(node) || /^p_/.test(node.id);
      });
      var body = owner
        ? { rev: state.rev, nodes: payloadNodes }
        : { rev: Number((state.meta && state.meta.personalRev) || 0), nodes: payloadNodes };
      if (opts.groups) {
        // 成员只能提交自建分组：共享分组由所有者维护，混进来会被服务端整单拒绝
        body.groups = owner
          ? opts.groups
          : opts.groups.filter(function (group) { return isOwnGroup(group.id) || /^mg_/.test(group.id); });
      }
      if (owner) {
        if (opts.defaults) body.defaults = opts.defaults;
        if (opts.subscription) body.subscription = opts.subscription;
        if (opts.regionOrder) body.regionOrder = opts.regionOrder;
        if (opts.providerBase !== undefined) body.providerBase = opts.providerBase;
      }
      var data = await request(owner ? '/api/config' : '/api/nodes', {
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
        // 保留抽屉与已填内容，只同步最新 rev：用户再点一次保存即可覆盖，不必重填
        if (opts.form) {
          el.formGlobalError.textContent = err.message + '。当前填写的内容已保留，确认后再次保存即可覆盖。';
          el.formGlobalError.hidden = false;
          el.formGlobalError.scrollIntoView({ block: 'nearest' });
          await reloadConfig();
          return false;
        }
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
    if (!editableNode(target)) return;
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
    if (!editableNode(source)) return;
    var limit = nodeLimit();
    if (personalNodes().length >= limit) {
      toast('节点数量已达到上限 ' + limit + ' 个', 'error');
      return;
    }
    var copy = Object.assign({}, source, { id: newNodeId(), name: uniqueCopyName(source.name) });
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
    if (!editableNode(target)) return;
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
      groups: groups(),
      nodes: nodes(),
      defaults: currentDefaults(),
      regionOrder: (state.config && state.config.regionOrder) || {},
      subscription: (state.config && state.config.subscription) || {},
      providerBase: (state.config && state.config.providerBase) || ''
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
      groups: Array.isArray(parsed.groups) && parsed.groups.length ? parsed.groups : undefined,
      defaults: parsed.defaults && typeof parsed.defaults === 'object' ? parsed.defaults : {},
      regionOrder: parsed.regionOrder && typeof parsed.regionOrder === 'object' ? parsed.regionOrder : {},
      subscription: parsed.subscription && typeof parsed.subscription === 'object' ? parsed.subscription : {},
      providerBase: typeof parsed.providerBase === 'string' ? parsed.providerBase : '',
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
    // 服务端只接受 TCP 上的 Reality；这里提前拦下，否则整批导入会被服务端一次拒绝
    if (reality && network !== 'tcp') throw new Error('Reality 仅支持 TCP 传输');

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
    if (!Number.isInteger(aid) || aid < 0 || aid > 65535) throw new Error('VMess alterId 无效');
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

  // 从链接文本猜分组：只猜内置组的 id，猜不到就交给「未分组」
  function guessShareGroup(text) {
    for (var i = 0; i < REGION_HINTS.length; i++) {
      if (REGION_HINTS[i].re.test(text)) return REGION_HINTS[i].key;
    }
    return '';
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
        parsed.node.groupId = guessShareGroup([
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

  function linkGroupFor(item) {
    var override = el.linksGroup ? el.linksGroup.value : 'auto';
    var value = override === 'auto' ? nodeGroupId(item.node) : override;
    return value === UNGROUPED ? null : groupById(value);
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
      html += '<p class="links-overflow">' + icon('alert') + '<span>节点数量将超过上限 ' + nodeLimit() + ' 个，请减少导入条数。</span></p>';
    }
    el.linksFeedback.innerHTML = html;
    el.linksFeedback.hidden = false;
  }

  function renderLinksResults() {
    if (!el.linksPreview) return;
    var items = state.linksParsed || [];
    var errors = state.linksErrors || [];
    var room = personalRoom();
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
        var group = linkGroupFor(item);
        var type = TYPE_META[item.node.type] || { label: item.node.type };
        var meta = item.node.server + ':' + item.node.port + ' · ' + (group ? group.name : '仅选择列表');
        return '<div class="link-item">' +
          '<span class="link-kind t-' + esc(item.node.type) + '">' + esc(type.label) + '</span>' +
          '<span class="link-main">' +
            '<span class="link-name">' + esc(item.node.name) + '</span>' +
            '<span class="link-meta">' + esc(meta) + '</span>' +
          '</span>' +
          '<span class="link-region">' + (group ? esc(groupEmoji(group.name)) + ' ' + esc(groupShort(group.name)) : '未分组') + '</span>' +
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
      else if (!items.length) el.linksFootNote.textContent = '导入后可在节点管理中继续编辑';
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
    var room = personalRoom();
    if (items.length > room) {
      toast('最多还能导入 ' + Math.max(room, 0) + ' 个节点', 'error');
      return;
    }
    var override = el.linksGroup.value;
    var additions = items.map(function (item) {
      var copy = Object.assign({}, item.node);
      if (override !== 'auto') copy.groupId = override === UNGROUPED ? '' : override;
      copy.id = newNodeId();
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
    if (id && !editableNode(node)) {
      toast('共享节点由所有者维护；添加自己的节点后可以随时修改', 'info');
      return;
    }

    clearFormErrors();
    setField(el.fieldName, '');
    setField(el.fieldServer, '');
    renderGroupOptions();
    setTags([]);
    setSwitch(el.fieldEnabled, true);
    setSwitch(el.fieldShowMain, true);

    var preset = currentDefaults();
    setField(el.fieldPort, preset.vlessPort || 443);
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
    setSwitch(el.trSkip, false);
    setSwitch(el.trUdp, true);

    setField(el.hyPassword, generatePassword());
    setField(el.hySni, 'bing.com');
    setField(el.hyUp, '80 mbps');
    setField(el.hyDown, '500 mbps');
    setSwitch(el.hySkip, false);

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
      setField(el.fieldGroup, nodeGroupId(node) || UNGROUPED);
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
        setSwitch(el.trSkip, node.skipCertVerify === true);
        setSwitch(el.trUdp, node.udp !== false);
      } else if (type === 'hysteria2') {
        setField(el.hyPassword, node.password || '');
        setField(el.hySni, node.sni || '');
        setField(el.hyUp, node.up || '');
        setField(el.hyDown, node.down || '');
        setSwitch(el.hySkip, node.skipCertVerify === true);
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
    } else if (name && groups().some(function (group) { return group.name.toLowerCase() === nameLower; })) {
      errors.push({ key: 'name', message: '该名称与分组同名，客户端会解析失败' });
    } else if (name && duplicate) {
      errors.push({ key: 'name', message: '节点名称已存在，请使用其他名称' });
    }

    var server = hostError(el.fieldServer.value, 'server', '服务器地址', true, errors);
    var portRaw = String(el.fieldPort.value || '').trim();
    var port = Number(portRaw);
    if (!portRaw || !Number.isInteger(port) || port < 1 || port > 65535) {
      errors.push({ key: 'port', message: '端口必须是 1 - 65535 之间的整数' });
    }

    var groupValue = el.fieldGroup ? el.fieldGroup.value : UNGROUPED;
    var groupId = groupValue && groupValue !== UNGROUPED && groupById(groupValue) ? groupValue : '';
    var node = {
      name: name,
      type: type,
      server: server,
      port: port,
      groupId: groupId,
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
        errors.push({ key: 'network', message: 'Reality 仅支持 TCP 传输' });
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
        node.wsPath = optionalText(el.vmWsPath.value, 'vmWsPath', 'WS Path') || '/';
        node.wsHost = optionalHost(el.vmWsHost.value, 'vmWsHost', 'WS Host');
      }
      if (vmNetwork === 'grpc') {
        node.grpcService = optionalError(el.vmGrpc.value, 'vmGrpcService', 'gRPC 服务名', 64, errors);
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
      // 服务端的 reality 校验（如「Reality 仅支持 TCP」）没有专属锚点，统一标到传输方式字段
      vless: { reality: 'network' },
      vmess: { uuid: 'vmUuid', servername: 'vmServername', wsHost: 'vmWsHost', wsPath: 'vmWsPath', grpcService: 'vmGrpcService' },
      trojan: { password: 'trPassword', sni: 'trSni' },
      hysteria2: { password: 'hyPassword', sni: 'hySni', up: 'hyUp', down: 'hyDown' },
      ss: { password: 'ssPassword' }
    };
    if (field === 'name' || field === 'server' || field === 'port') return field;
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
      if (!editableNode(findNode(state.editingId))) {
        el.formGlobalError.textContent = '共享节点由所有者维护，不能在这里修改';
        el.formGlobalError.hidden = false;
        return;
      }
      nextNodes = nodes().map(function (node) {
        return node.id === state.editingId ? Object.assign({}, result.node, { id: node.id }) : node;
      });
    } else {
      var limit = nodeLimit();
      if (personalNodes().length >= limit) {
        el.formGlobalError.textContent = '节点数量已达到上限 ' + limit + ' 个';
        el.formGlobalError.hidden = false;
        return;
      }
      nextNodes = nodes().concat([Object.assign({}, result.node, { id: newNodeId() })]);
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
    groups().forEach(function (group) {
      var count = enabled.filter(function (node) { return nodeGroupId(node) === group.id; }).length;
      if (count) defs.push({ name: group.name, count: count });
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
    state.filterGroup = 'all';
    if (el.nodeSearch) el.nodeSearch.value = '';
    if (el.filterType) el.filterType.value = 'all';
    if (el.filterGroup) el.filterGroup.value = 'all';
    renderNodeList();
  }

  function bindEvents() {
    /* 单个元素缺失不应中断整条绑定链：这里统一走 on()，元素为空时静默跳过 */
    function on(target, type, handler, options) {
      if (target) target.addEventListener(type, handler, options);
      return target;
    }

    on(el.loginForm, 'submit', submitAuth);
    on(el.loginUsername, 'input', function () { showLoginError(''); });
    on(el.loginPassword, 'input', function () { showLoginError(''); });
    on(el.loginConfirm, 'input', function () { showLoginError(''); });
    on(el.loginSetupToken, 'input', function () { showLoginError(''); });
    on(el.loginToken, 'input', function () { showLoginError(''); });
    on(el.loginPasswordReveal, 'click', function () {
      var showing = el.loginPassword.type === 'text';
      el.loginPassword.type = showing ? 'password' : 'text';
      setRevealState(el.loginPasswordReveal, !showing, '密码');
    });
    on(el.loginTokenReveal, 'click', function () {
      var showing = el.loginToken.type === 'text';
      el.loginToken.type = showing ? 'password' : 'text';
      setRevealState(el.loginTokenReveal, !showing, '令牌');
    });
    on(el.loginRecovery, 'click', function () {
      renderAuthView(state.loginView === 'recovery' ? 'login' : 'recovery');
    });

    el.navItems.forEach(function (button) {
      button.addEventListener('click', function () { switchView(button.dataset.view); });
    });
    $$('[data-goto]').forEach(function (button) {
      button.addEventListener('click', function () { switchView(button.dataset.goto); });
    });
    on(el.heroPreview, 'click', function () { switchView('preview'); });

    [el.nodesAdd, el.heroAdd, el.emptyAdd].forEach(function (button) {
      if (button) button.addEventListener('click', function () { openEditor(null); });
    });
    [el.previewCopySub].forEach(function (button) {
      if (button) button.addEventListener('click', copySubscription);
    });
    [el.nodesLinks, el.emptyLinks].forEach(function (button) {
      if (button) button.addEventListener('click', function () { openLinks('import'); });
    });
    on(el.subCopy, 'click', copySubscription);
    on(el.subReveal, 'click', function () {
      state.subRevealed = !state.subRevealed;
      renderSubUrls();
    });

    [el.themeToggle, el.mobileTheme].forEach(function (button) {
      button.addEventListener('click', toggleTheme);
    });
    if (el.themeMode) {
      on(el.themeMode, 'click', function (event) {
        var button = event.target.closest('[data-theme-mode]');
        if (button) setThemeMode(button.dataset.themeMode);
      });
    }
    on(el.logout, 'click', function () { logout(''); });
    on(el.mobileLogout, 'click', function () { logout(''); });

    if (el.tokenOpenSettings) on(el.tokenOpenSettings, 'click', function () {
      switchView('settings');
      if (el.setAuthToken) {
        window.setTimeout(function () {
          el.setAuthToken.focus();
          el.setAuthToken.select();
        }, 40);
      }
    });
    if (el.emptySubBtn) on(el.emptySubBtn, 'click', function () { switchView('nodes'); });

    [el.storageCard, el.kvHelpSide, el.kvHelpBtn].forEach(function (button) {
      button.addEventListener('click', function () {
        if (button === el.storageCard && state.meta && state.meta.kv && !state.meta.readonly) {
          toast('KV 存储已连接 · 当前配置版本 #' + state.rev, 'success');
        } else {
          openModal('kv');
        }
      });
    });
    on(el.kvCopyName, 'click', function () { copyText('SUB_KV', '变量名 SUB_KV 已复制'); });

    on(el.nodeSearch, 'input', function () {
      state.query = el.nodeSearch.value;
      renderNodeList();
    });
    on(el.filterType, 'change', function () {
      state.filterType = el.filterType.value;
      renderNodeList();
    });
    on(el.filterGroup, 'change', function () {
      state.filterGroup = el.filterGroup.value;
      renderNodeList();
    });
    [el.filterReset, el.emptyReset].forEach(function (button) {
      button.addEventListener('click', resetFilters);
    });

    on(el.groupAdd, 'click', function () { openGroupEditor(null); });
    on(el.groupCancel, 'click', closeGroupEditor);
    on(el.groupForm, 'submit', submitGroupForm);
    on(el.groupForm, 'input', clearGroupErrors);
    if (el.groupList) {
      on(el.groupList, 'click', function (event) {
        var move = event.target.closest('[data-group-move]');
        if (move) {
          if (!move.disabled) moveGroup(move.dataset.groupMove, Number(move.dataset.dir));
          return;
        }
        var edit = event.target.closest('[data-group-edit]');
        if (edit) {
          openGroupEditor(edit.dataset.groupEdit);
          return;
        }
        var remove = event.target.closest('[data-group-delete]');
        if (remove) {
          askDeleteGroup(remove.dataset.groupDelete);
          return;
        }
        var view = event.target.closest('[data-group-view]');
        if (view) focusGroup(view.dataset.groupView);
      });
    }

    on(el.nodeList, 'click', function (event) {
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
    on(el.nodeList, 'keydown', function (event) {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      var row = event.target.closest('.node-row');
      if (!row || event.target.closest('button, input, .cell-check')) return;
      event.preventDefault();
      openEditor(row.dataset.id);
    });

    if (el.selectAll) {
      on(el.selectAll, 'change', function () { selectAllVisible(el.selectAll.checked); });
    }
    if (el.bulkBar) {
      on(el.bulkBar, 'click', function (event) {
        var button = event.target.closest('[data-bulk]');
        if (!button || button.disabled) return;
        if (button.dataset.bulk === 'enable') bulkSetEnabled(true);
        else if (button.dataset.bulk === 'disable') bulkSetEnabled(false);
        else if (button.dataset.bulk === 'delete') askBulkDelete();
      });
    }
    if (el.bulkClear) on(el.bulkClear, 'click', clearSelection);
    if (el.bulkGroup) {
      on(el.bulkGroup, 'change', function () {
        if (el.bulkGroup.value) bulkMoveGroup();
      });
    }

    if (el.rowMenu) {
      on(el.rowMenu, 'click', function (event) {
        var item = event.target.closest('[data-menu]');
        if (!item || item.disabled) return;
        performRowMenu(item.dataset.menu);
      });
      on(el.rowMenu, 'keydown', function (event) {
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

    on(el.recentNodes, 'click', function (event) {
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

    on(el.nodeForm, 'submit', submitForm);
    on(el.nodeForm, 'input', clearFieldError);
    on(el.nodeForm, 'change', clearFieldError);

    on(el.settingsForm, 'submit', saveSettings);
    on(el.settingsForm, 'input', clearSettingsFieldError);
    on(el.settingsForm, 'change', clearSettingsFieldError);
    if (el.userAdd) on(el.userAdd, 'click', function () { openUserEditor('add'); });
    if (el.userCancel) on(el.userCancel, 'click', closeUserEditor);
    if (el.userForm) {
      on(el.userForm, 'submit', submitUserForm);
      on(el.userForm, 'input', clearUserFieldError);
    }
    if (el.userList) {
      on(el.userList, 'click', function (event) {
        var manage = event.target.closest('[data-user-manage]');
        if (manage) {
          openUserEditor('manage', manage.dataset.userManage);
          return;
        }
        var remove = event.target.closest('[data-user-delete]');
        if (remove && !remove.disabled) askDeleteUser(remove.dataset.userDelete);
      });
    }
    if (el.userRole) {
      on(el.userRole, 'change', function () {
        var role = el.userRole.value === 'owner' ? 'owner' : 'member';
        var previousHidden = el.userScopeField ? el.userScopeField.hidden : false;
        var scope = role === 'owner' || previousHidden ? { allNodes: false, nodeIds: [] } : scopeFromForm();
        renderUserScope(scope, role);
      });
    }
    if (el.userScopeAll) on(el.userScopeAll, 'change', syncScopeControls);
    if (el.passwordForm) {
      on(el.passwordForm, 'submit', submitPasswordChange);
      on(el.passwordForm, 'input', clearPasswordErrors);
    }
    if (el.accountSubCopy) on(el.accountSubCopy, 'click', function () {
      var url = state.meta && state.meta.subUrl;
      if (url) copyText(url, '我的订阅链接已复制');
    });
    on(el.settingsClear, 'click', function () {
      setField(el.setUuid, '');
      setField(el.setPbk, '');
      setField(el.setSid, '');
      setField(el.setSni, '');
      setField(el.setPort, '');
      clearSettingsErrors();
      toast('已清空 VLESS 预设，点击「保存设置」后生效', 'info');
    });
    if (el.genAuthToken) on(el.genAuthToken, 'click', function () {
      setField(el.setAuthToken, generatePassword(32));
      state.clearAuthToken = false;
      clearSettingsErrors();
      el.setAuthToken.focus();
      el.setAuthToken.select();
    });
    if (el.clearAuthToken) on(el.clearAuthToken, 'click', function () {
      state.clearAuthToken = true;
      setField(el.setAuthToken, '');
      clearSettingsErrors();
      toast('已标记清除订阅令牌，点击「保存设置」后生效；未配置环境变量时订阅将需要重新配置', 'info');
    });
    if (el.setAuthToken) on(el.setAuthToken, 'input', function () {
      // 又输入了新值：取消待清除状态
      if (String(el.setAuthToken.value || '').trim()) state.clearAuthToken = false;
    });
    on(el.typeGrid, 'click', function (event) {
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

    on(el.genericOk, 'click', function () {
      var callback = confirmCallback;
      confirmCallback = null;
      if (callback) callback();
    });

    on(el.nodesExport, 'click', exportBackup);
    on(el.nodesImport, 'click', function () {
      if (ensureWritable()) el.importFile.click();
    });
    on(el.importFile, 'change', function () {
      var file = el.importFile.files && el.importFile.files[0];
      el.importFile.value = '';
      if (file) importBackupFile(file);
    });
    on(el.previewRefresh, 'click', function () { loadPreview(true); });
    on(el.previewCopy, 'click', copyYaml);
    on(el.previewDownload, 'click', downloadYaml);

    if (el.previewSearch) {
      on(el.previewSearch, 'input', function () {
        state.previewQuery = el.previewSearch.value;
        window.clearTimeout(state.previewSearchTimer);
        state.previewSearchTimer = window.setTimeout(refreshPreviewSearch, 160);
      });
      on(el.previewSearch, 'keydown', function (event) {
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
    if (el.previewSearchPrev) on(el.previewSearchPrev, 'click', function () { movePreviewHit(-1); });
    if (el.previewSearchNext) on(el.previewSearchNext, 'click', function () { movePreviewHit(1); });

    (el.linksTabs || []).forEach(function (button) {
      button.addEventListener('click', function () { setLinksTab(button.dataset.tab); });
    });
    if (el.linksInput) {
      on(el.linksInput, 'input', function () {
        window.clearTimeout(state.linksTimer);
        state.linksTimer = window.setTimeout(parseLinksInput, 200);
      });
    }
    if (el.linksGroup) {
      on(el.linksGroup, 'change', function () {
        if (el.linksInput.value.trim()) parseLinksInput();
        else renderLinksResults();
      });
    }
    if (el.linksPreview) {
      on(el.linksPreview, 'click', function (event) {
        var button = event.target.closest('[data-link-remove]');
        if (!button) return;
        var index = Number(button.dataset.linkRemove);
        if (index >= 0 && index < state.linksParsed.length) {
          state.linksParsed.splice(index, 1);
          renderLinksResults();
        }
      });
    }
    if (el.linksConfirm) on(el.linksConfirm, 'click', importLinks);
    if (el.linksCopyAll) on(el.linksCopyAll, 'click', function () { copyText(state.linksExportText, '链接清单已复制'); });
    if (el.linksDownload) on(el.linksDownload, 'click', downloadLinks);

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

  /* 脚本异常兜底：避免「点了没反应」却毫无提示，把原因直接暴露到界面与控制台 */
  window.addEventListener('error', function (event) {
    var message = (event && event.message) || '未知脚本错误';
    if (typeof console !== 'undefined' && console.error) {
      console.error('[transit-hub]', message, event && event.filename, event && event.lineno);
    }
    if (el.toasts) toast('页面脚本异常：' + message, 'error');
  });
  window.addEventListener('unhandledrejection', function (event) {
    var reason = event && event.reason;
    var message = reason && reason.message ? reason.message : String(reason || '未知异常');
    if (typeof console !== 'undefined' && console.error) console.error('[transit-hub]', message);
    if (el.toasts) toast('请求异常：' + message, 'error');
  });

  init();
})();
