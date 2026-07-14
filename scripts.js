const PROXY             = 'https://r1999tracker.posofrefraction.workers.dev/';
const PITY_MAX          = 70;
const PITY_COLOR_YELLOW = 50;
const PITY_COLOR_RED    = 60;
const BANNER_TYPE_LABELS  = { Limited: 'Limited Event', Character: 'Character Event', Water: 'Water', Regular: 'Regular', Special: 'Special Event' };
const BANNER_TYPE_CLASSES = { Limited: 'type-limited', Character: 'type-character', Water: 'type-water', Regular: 'type-regular', Special: 'type-special' };
const RU_LOCALES          = ['ru', 'be', 'uk', 'kk', 'ky', 'tg', 'uz', 'tk', 'az', 'hy', 'ka', 'mn'];
const TIME                = Object.freeze({
  MS_MINUTE: 60000,
  MS_HOUR:   3600000,
  MS_DAY:    86400000,
  SERVER_TZ_OFFSET_MIN: -5 * 60,
  SERVER_RESET_HOUR: 5,
});

const LOCALES   = {};
let currentLang = 'ru';

let localDB               = [];
let processedList         = [];
let processedPity         = [];
let processedPityCounters = {};
let processedFifty        = [];
let processedGuarantee    = {};
let chart                 = null;
let pityChart             = null;
let chartsMonthly         = null;
let chartsDirty           = false;
let chartsOpen            = false;
let currentFilter         = 0;
let currentTypeFilter     = null;
let profiles              = [];
let currentProfile        = null;
let timelineTickInterval  = null;
let activeBannersGridTick = null;
let tlUseLocalTime        = localStorage.getItem('tlUseLocalTime') !== 'false';

function detectLang() {
  const saved = localStorage.getItem('r1999_lang');
  if (saved === 'ru' || saved === 'en') return saved;
  const base = (navigator.language || '').split('-')[0].toLowerCase();
  return RU_LOCALES.includes(base) ? 'ru' : 'en';
}

function t(key, ...args) {
  const val = LOCALES[currentLang]?.[key] ?? key;
  return typeof val === 'function' ? val(...args) : val;
}

async function setLang(lang) {
  await loadLocale(lang);
  if (!LOCALES[lang]) return;
  document.body.classList.add('ui-fade');
  setTimeout(() => {
    currentLang = lang;
    localStorage.setItem('r1999_lang', lang);
    document.documentElement.lang = lang;
    document.getElementById('langRU').classList.toggle('active', lang === 'ru');
    document.getElementById('langEN').classList.toggle('active', lang === 'en');
    applyI18n();
    refreshDynamicContent();
    requestAnimationFrame(() => requestAnimationFrame(() => document.body.classList.remove('ui-fade')));
  }, 130);
}

function loadLocale(lang) {
  return new Promise(resolve => {
    if (LOCALES[lang]) { resolve(); return; }
    const script   = document.createElement('script');
    script.src     = 'localization/' + lang + '.js';
    script.onload  = () => { LOCALES[lang] = window.LOCALE; resolve(); };
    script.onerror = () => { script.remove(); resolve(); };
    document.head.appendChild(script);
  });
}

function preloadLocales() {
  loadLocale(currentLang === 'ru' ? 'en' : 'ru');
}

function applyI18n() {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    el.textContent = t(el.dataset.i18n);
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    el.placeholder = t(el.dataset.i18nPlaceholder);
  });
  document.querySelectorAll('[data-i18n-title]').forEach(el => {
    el.title = t(el.dataset.i18nTitle);
  });
}

function refreshDynamicContent() {
  const mode = localStorage.getItem('bannerView') || 'timeline';
  applyBannerView(mode);
  renderBannerStats();
  if (processedList.length > 0) {
    ['statsBox', 'recentSixStarsBox', 'chartsBox'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = '';
    });
    renderStats();
    renderRecentSixStars();
  }
  renderTable();
  renderProfileSelect();
  _updateGdriveUILang();
}

function fmtTimer(diff) {
  const d = Math.floor(diff / TIME.MS_DAY);
  const h = Math.floor((diff % TIME.MS_DAY) / TIME.MS_HOUR);
  const m = Math.floor((diff % TIME.MS_HOUR) / TIME.MS_MINUTE);
  return d > 0
    ? `${d}${t('timerDays')} ${h}${t('timerHours')} ${m}${t('timerMin')}`
    : `${h}${t('timerHours')} ${m}${t('timerMin')}`;
}

function parseTimeMs(value) {
  return new Date(value).getTime();
}

function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]));
}

function bannerPlaceholderHTML(info, typeClass, extraClass = '', { showType = true } = {}) {
  const typeTag = showType
    ? `<span class="banner-type ${typeClass}">${escapeHTML(info.type)}</span>`
    : '';
  return `
    <div class="banner-image-placeholder ${extraClass} ${typeClass}">
      <div class="banner-placeholder-content">
        ${typeTag}
        <strong class="banner-placeholder-title">${escapeHTML(info.name)}</strong>
      </div>
    </div>`;
}

function hasBannerImage(banner) {
  return typeof banner?.image === 'string' && banner.image.trim().length > 0;
}

function createBannerPlaceholder(info, typeClass, extraClass = '', options = {}) {
  const wrap = document.createElement('div');
  wrap.innerHTML = bannerPlaceholderHTML(info, typeClass, extraClass, options).trim();
  return wrap.firstElementChild;
}

function createBannerMedia(banner, info, typeClass, extraClass = '', options = {}) {
  if (!hasBannerImage(banner)) {
    return createBannerPlaceholder(info, typeClass, extraClass, options);
  }

  const imgEl = document.createElement('img');
  imgEl.className = options.imgClass || 'active-banner-img';
  imgEl.alt       = info.name;
  imgEl.src       = banner.image;
  imgEl.addEventListener('error', () => {
    imgEl.replaceWith(createBannerPlaceholder(info, typeClass, extraClass, options));
  }, { once: true });
  return imgEl;
}

function applyTimelineBarImage(bar, banner, onMissing) {
  if (!hasBannerImage(banner)) {
    onMissing();
    return;
  }

  const img = new Image();
  img.onload  = () => { bar.style.backgroundImage = `url(${banner.image})`; };
  img.onerror = onMissing;
  img.src     = banner.image;
}

function getBannerCountdownState(startMs, endMs, now = Date.now()) {
  if (now < startMs) {
    return {
      state: 'upcoming',
      diff: startMs - now,
      label: t('countdownStartLabel'),
      modalLabel: t('modalCountdownStartLabel'),
      shortText: t('startsInShort', fmtTimer(startMs - now)),
    };
  }
  if (now < endMs) {
    return {
      state: 'active',
      diff: endMs - now,
      label: t('countdownLabel'),
      modalLabel: t('modalCountdownLabel'),
      shortText: fmtTimer(endMs - now),
    };
  }
  return {
    state: 'ended',
    diff: 0,
    label: t('countdownLabel'),
    modalLabel: t('modalCountdownLabel'),
    shortText: t('bannerEndedShort'),
  };
}

function getLocalOffsetMin() {
  return -new Date().getTimezoneOffset();
}

function formatUtcOffset(offsetMin) {
  const sign = offsetMin >= 0 ? '+' : '-';
  const abs  = Math.abs(offsetMin);
  const h    = String(Math.floor(abs / 60)).padStart(2, '0');
  const m    = String(abs % 60).padStart(2, '0');
  return `UTC${sign}${h}:${m}`;
}

function startOfLocalDayMs(ms) {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function startOfFixedOffsetDayMs(ms, offsetMin, resetHour = 0) {
  const offsetMs = offsetMin * TIME.MS_MINUTE;
  const resetMs  = resetHour * TIME.MS_HOUR;
  return Math.floor((ms + offsetMs - resetMs) / TIME.MS_DAY) * TIME.MS_DAY - offsetMs + resetMs;
}

function getTimelineDayStartMs(ms) {
  return tlUseLocalTime
    ? startOfLocalDayMs(ms)
    : startOfFixedOffsetDayMs(ms, TIME.SERVER_TZ_OFFSET_MIN, TIME.SERVER_RESET_HOUR);
}

function getTimelineDateParts(ms) {
  if (tlUseLocalTime) {
    const d = new Date(ms);
    return {
      date: d.getDate(),
      month: d.getMonth(),
      year: d.getFullYear(),
      weekday: d.getDay(),
    };
  }

  const d = new Date(ms + TIME.SERVER_TZ_OFFSET_MIN * TIME.MS_MINUTE);
  return {
    date: d.getUTCDate(),
    month: d.getUTCMonth(),
    year: d.getUTCFullYear(),
    weekday: d.getUTCDay(),
  };
}

function getTimelineX(ms, rangeStartMs, dayWidth) {
  return (ms - rangeStartMs) / TIME.MS_DAY * dayWidth;
}

function formatTimelineDate(ms, monthsFull) {
  const p = getTimelineDateParts(ms);
  return currentLang === 'ru'
    ? `${p.date} ${monthsFull[p.month]} ${p.year}`
    : `${monthsFull[p.month]} ${p.date}, ${p.year}`;
}

window.addEventListener('DOMContentLoaded', () => {
  currentLang = detectLang();
  LOCALES[currentLang] = window.LOCALE;
  document.documentElement.lang = currentLang;
  document.getElementById('langRU').classList.toggle('active', currentLang === 'ru');
  document.getElementById('langEN').classList.toggle('active', currentLang === 'en');
  requestAnimationFrame(() => document.querySelector('.lang-switcher')?.classList.add('ready'));
  applyI18n();
  document.querySelectorAll('.box').forEach(b => b.classList.add('visible'));
  preloadLocales();
  loadProfiles();
  initBannerView();
  applyOfflineLocks();

  document.getElementById('fileInput').addEventListener('change', loadFromFile);
  document.getElementById('dbInput').addEventListener('change', loadDBFile);

  const tb = document.getElementById('table');
  tb.addEventListener('mouseover', ev => {
    const tr  = ev.target.closest('tr');
    const gid = tr?.dataset.group;
    if (!gid) return;
    tb.querySelectorAll(`tr[data-group="${CSS.escape(gid)}"]`).forEach(r => r.classList.add('group-hover'));
  });
  tb.addEventListener('mouseout', ev => {
    const tr  = ev.target.closest('tr');
    const gid = tr?.dataset.group;
    if (!gid) return;
    tb.querySelectorAll(`tr[data-group="${CSS.escape(gid)}"]`).forEach(r => r.classList.remove('group-hover'));
  });
});

const OFFLINE_LOCK_SELECTORS = [
  '.url-import button',
  '.side-btn[href$="guide.html"]',
  '.side-btn[target="_blank"]',
  '#gdriveSignInBtn'
];

function applyOfflineLocks() {
  const offline = !navigator.onLine;
  document.body.classList.toggle('is-offline', offline);
  OFFLINE_LOCK_SELECTORS.forEach(sel => {
    document.querySelectorAll(sel).forEach(el => {
      el.classList.toggle('offline-locked', offline);
      if (offline) {
        el.setAttribute('aria-disabled', 'true');
        el.title = t('offlineLocked');
      } else {
        el.removeAttribute('aria-disabled');
        el.title = '';
      }
    });
  });
}

document.addEventListener('click', ev => {
  if (navigator.onLine) return;
  const locked = ev.target.closest('.offline-locked');
  if (!locked) return;
  ev.preventDefault();
  ev.stopImmediatePropagation();
  showToast(t('offlineLocked'), 'warning');
}, true);

window.addEventListener('online', applyOfflineLocks);
window.addEventListener('offline', applyOfflineLocks);

window.addEventListener('scroll', () => {
  document.getElementById('scrollTopBtn')?.classList.toggle('visible', window.scrollY > 400);
});

let resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (!chart) requestAnimationFrame(drawChartPlaceholder);
  }, 150);
});

let activeToast = null;

const topBar = (() => {
  let el          = null;
  let finishTimer = null;
  let startTime   = 0;
  const MIN_MS    = 400;

  function getEl() {
    if (!el) el = document.getElementById('top-bar');
    return el;
  }

  function start(work) {
    const bar = getEl();
    clearTimeout(finishTimer);
    bar.style.width = '0%';
    bar.classList.remove('finishing', 'running');
    startTime = Date.now();
    requestAnimationFrame(() => {
      bar.style.width = '70%';
      bar.classList.add('running');
      if (work) requestAnimationFrame(work);
    });
  }

  function finish() {
    const bar     = getEl();
    const elapsed = Date.now() - startTime;
    const delay   = Math.max(0, MIN_MS - elapsed);
    clearTimeout(finishTimer);
    finishTimer = setTimeout(() => {
      bar.classList.add('finishing');
      bar.classList.remove('running');
      finishTimer = setTimeout(() => {
        bar.style.width = '0%';
        bar.classList.remove('finishing');
      }, 650);
    }, delay);
  }

  return { start, finish };
})();

function initBannerView() {
  const localTimeCheck = document.getElementById('tlLocalTimeCheck');
  if (localTimeCheck) localTimeCheck.checked = tlUseLocalTime;
  applyBannerView(localStorage.getItem('bannerView') || 'timeline');
}

function setBannerView(mode) {
  localStorage.setItem('bannerView', mode);
  applyBannerView(mode);
}

function applyBannerView(mode) {
  const tlWrap   = document.getElementById('bannerTimelineWrap');
  const gridWrap = document.getElementById('activeBannersWrap');
  const btnTl    = document.getElementById('toggleTimeline');
  const btnGrid  = document.getElementById('toggleGrid');
  const title    = document.getElementById('bannerBoxTitle');
  const tzToggle = document.getElementById('tlTzToggle');

  const prevMode = tlWrap.style.display === 'none' ? 'grid' : 'timeline';
  const toRight  = mode === 'grid';

  function slideIn(el) {
    el.classList.remove('slide-in-right', 'slide-in-left');
    void el.offsetWidth;
    el.classList.add(toRight ? 'slide-in-right' : 'slide-in-left');
  }

  if (mode === 'grid') {
    tlWrap.style.display   = 'none';
    gridWrap.style.display = '';
    btnTl.classList.remove('active');
    btnGrid.classList.add('active');
    title.textContent = t('activeBanners');
    if (tzToggle) tzToggle.style.display = 'none';
    if (prevMode !== 'grid') slideIn(gridWrap);
    renderActiveBanners();
  } else {
    if (activeBannersGridTick) {
      clearTimeout(activeBannersGridTick);
      activeBannersGridTick = null;
    }
    gridWrap.style.display = 'none';
    tlWrap.style.display   = '';
    btnTl.classList.add('active');
    btnGrid.classList.remove('active');
    title.textContent = t('bannerTimeline');
    if (tzToggle) tzToggle.style.display = '';
    if (prevMode !== 'timeline') slideIn(tlWrap);
    renderBannerTimeline();
  }
}

function getBannerGridTier(info) {
  if (info.type === 'Limited') return 0;
  if (info.type === 'Character') return 1;
  return 2;
}

function gridBannerSignature(b) {
  return `${b.key}\0${b.startUTC}\0${b.endUTC}`;
}

function getActiveGridBannersSorted(now = Date.now()) {
  const rows = [];
  for (const b of ACTIVE_BANNERS) {
    if (!b.startUTC || !b.endUTC) continue;
    const startMs = parseTimeMs(b.startUTC);
    const endMs   = parseTimeMs(b.endUTC);
    if (endMs <= now) continue;
    const info  = BANNERS[b.key] || { name: b.key, type: 'Character' };
    const phase = now < startMs ? 1 : 0;
    rows.push({
      b,
      tier: getBannerGridTier(info),
      phase,
      remaining: endMs - now,
      untilStart: startMs - now,
    });
  }
  rows.sort((a, b) => {
    if (a.phase !== b.phase) return a.phase - b.phase;
    if (a.phase === 0) {
      if (a.tier !== b.tier) return a.tier - b.tier;
      return a.remaining !== b.remaining ? a.remaining - b.remaining : a.untilStart - b.untilStart;
    }
    return a.untilStart !== b.untilStart ? a.untilStart - b.untilStart : b.remaining - a.remaining;
  });
  return rows.map(r => r.b);
}

function renderActiveBanners() {
  if (activeBannersGridTick) {
    clearTimeout(activeBannersGridTick);
    activeBannersGridTick = null;
  }

  const container = document.getElementById('activeBanners');
  if (!container) return;

  if (!ACTIVE_BANNERS.length) {
    container.innerHTML = '';
    return;
  }

  const banners = getActiveGridBannersSorted();
  if (!banners.length) {
    container.innerHTML = `<div class="active-banners-grid-empty">${t('activeBannersEmpty')}</div>`;
    return;
  }

  const orderSig = banners.map(gridBannerSignature).join('|');

  container.innerHTML = '';
  const timerEls = [];

  banners.forEach(b => {
    const info      = BANNERS[b.key] || { name: b.key, type: 'Character' };
    const startTime = parseTimeMs(b.startUTC);
    const endTime   = parseTimeMs(b.endUTC);
    const typeClass = BANNER_TYPE_CLASSES[info.type] || 'type-other';
    const timerId   = 'grid-timer-' + b.key.replace(/[^a-z0-9]/gi, '_') + '_' + Math.random().toString(36).slice(2);
    const labelId   = timerId + '-label';

    const card = document.createElement('div');
    card.className = 'active-banner-card active-banner-card--clickable';

    const typeBadge = document.createElement('div');
    typeBadge.className = 'active-banner-type-overlay';
    typeBadge.innerHTML = `<span class="banner-type ${typeClass}">${info.type}</span>`;

    const mediaEl = createBannerMedia(
      b, info, typeClass, 'active-banner-img-placeholder', { showType: false }
    );

    const infoDiv = document.createElement('div');
    infoDiv.className = 'active-banner-info';
    infoDiv.innerHTML = `
      <div class="active-banner-name">${info.name}</div>
      <div class="active-banner-countdown">
        <span class="active-banner-countdown-label" id="${labelId}">${t('countdownLabel')}</span>
        <span class="active-banner-timer" id="${timerId}">—</span>
      </div>`;

    card.appendChild(typeBadge);
    card.appendChild(mediaEl);
    card.appendChild(infoDiv);
    card.addEventListener('click', () => openBannerModal(b, info, typeClass));
    container.appendChild(card);
    timerEls.push({ el: document.getElementById(timerId), labelEl: document.getElementById(labelId), startTime, endTime });
  });

  function tick() {
    const now       = Date.now();
    const next      = getActiveGridBannersSorted(now);
    const nextSig   = next.map(gridBannerSignature).join('|');
    if (nextSig !== orderSig) {
      renderActiveBanners();
      return;
    }

    for (let i = timerEls.length - 1; i >= 0; i--) {
      const { el, labelEl, startTime, endTime } = timerEls[i];
      if (!el) { timerEls.splice(i, 1); continue; }
      const countdown = getBannerCountdownState(startTime, endTime, now);
      if (countdown.state === 'ended') {
        renderActiveBanners();
        return;
      }
      if (labelEl) labelEl.textContent = countdown.label;
      el.textContent = fmtTimer(countdown.diff);
      const urgency =
        countdown.state === 'active' &&
        (countdown.diff < TIME.MS_HOUR ? ' ending-very-soon' :
         countdown.diff < TIME.MS_DAY  ? ' ending-soon' : '');
      el.className   = 'active-banner-timer' +
        (countdown.state === 'upcoming' ? ' upcoming' : '') +
        urgency;
    }
    if (timerEls.length) activeBannersGridTick = setTimeout(tick, 1000);
  }

  tick();
}

function showToast(message, type = 'info', duration = 3000) {
  activeToast?._dismiss();

  const toast       = document.createElement('div');
  toast.className   = `toast toast-${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.classList.add('show'), 10);

  const timer = setTimeout(() => dismiss(), duration);

  function dismiss() {
    clearTimeout(timer);
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
    if (activeToast === toast) activeToast = null;
  }

  toast._dismiss = dismiss;
  activeToast    = toast;
  return toast;
}

function readJSONStorage(key, fallback) {
  const raw = localStorage.getItem(key);
  if (raw === null) return fallback;
  try { return JSON.parse(raw); } catch { return fallback; }
}

function readCachedPulls(profileId) {
  const arr = readJSONStorage(`r1999_cache_${profileId}`, []);
  return Array.isArray(arr) ? arr : [];
}

function saveToStorage() {
  try {
    localStorage.setItem(`r1999_cache_${currentProfile}`, JSON.stringify(localDB));
    if (typeof gdriveScheduleSave === 'function') gdriveScheduleSave();
  } catch (err) {
    if (err.name === 'QuotaExceededError') {
      showToast(t('storageQuota'), 'error');
    } else {
      console.error('Storage error:', err);
    }
  }
}

function saveProfiles() {
  localStorage.setItem('r1999_profiles', JSON.stringify(profiles));
  if (typeof gdriveScheduleSave === 'function') gdriveScheduleSave();
}

function loadProfiles() {
  profiles = readJSONStorage('r1999_profiles', []);
  if (!Array.isArray(profiles)) profiles = [];
  if (!profiles.length) {
    profiles = [{ id: 1, name: t('defaultProfile') }];
    localStorage.setItem('r1999_profiles', JSON.stringify(profiles));
  }
  currentProfile = Number(localStorage.getItem('r1999_active_profile')) || profiles[0].id;
  renderProfileSelect();
  loadProfileDB();
}

function renderProfileSelect() {
  document.getElementById('profileSelect').innerHTML = profiles.map(p =>
    `<option value="${escapeHTML(p.id)}"${p.id === currentProfile ? ' selected' : ''}>${escapeHTML(p.name)}</option>`
  ).join('');
}

function switchProfile(id) {
  currentProfile = Number(id);
  localStorage.setItem('r1999_active_profile', currentProfile);
  loadProfileDB(true);
  showToast(t('profileSwitched'), 'info');
}

function loadProfileDB(withBar = false) {
  localDB = readCachedPulls(currentProfile);
  if (withBar) {
    topBar.start(() => { parseData(localDB); topBar.finish(); });
  } else {
    parseData(localDB);
  }
}

function addProfile() {
  const name = prompt(t('promptProfileName'));
  if (!name) return;
  const id = Date.now();
  profiles.push({ id, name });
  currentProfile = id;
  saveProfiles();
  localStorage.setItem('r1999_active_profile', id);
  renderProfileSelect();
  loadProfileDB();
  showToast(t('profileCreated', name), 'success');
}

function removeProfile() {
  if (currentProfile === 1) {
    if (!confirm(t('confirmClearMain'))) return;
    localStorage.removeItem(`r1999_cache_${currentProfile}`);
    localDB = [];
    loadProfileDB(true);
    showToast(t('profileClearMain'), 'info');
    return;
  }
  if (profiles.length === 1) { showToast(t('profileCantDelete'), 'warning'); return; }
  if (!confirm(t('confirmDelete'))) return;

  localStorage.removeItem(`r1999_cache_${currentProfile}`);
  profiles       = profiles.filter(p => p.id !== currentProfile);
  currentProfile = profiles[0].id;
  saveProfiles();
  localStorage.setItem('r1999_active_profile', currentProfile);
  renderProfileSelect();
  loadProfileDB(true);
  showToast(t('profileDeleted'), 'info');
}

function validateImportData(data) {
  if (!data?.data?.pageData || !Array.isArray(data.data.pageData))
    throw new Error(t('invalidImportData'));
  const s = data.data.pageData[0];
  if (s && (!s.createTime || !s.poolId || !s.gainIds))
    throw new Error(t('invalidPullFormat'));
}

function validateDBData(data) {
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    if (!Array.isArray(data.profiles)) throw new Error(t('dbCorruptProfiles'));
    if (typeof data.pulls !== 'object') throw new Error(t('dbCorruptPulls'));
    return;
  }
  if (!Array.isArray(data)) throw new Error(t('dbCorrupt'));
  const s = data[0];
  if (s && (!s.createTime || !s.poolId || !s.gainIds))
    throw new Error(t('invalidDbFormat'));
}

function normalizePulls(db) {
  return db.flatMap(e => {
    if (Number(e.summonType) === 10 && e.gainIds.length === 10) {
      const groupId = generateKey(e);
      return e.gainIds.map(id => ({ ...e, gainIds: [id], _groupId: groupId }));
    }
    return [e];
  });
}

function generateKey(e) {
  return `${e.createTime}_${e.poolId}_${e.gainIds.join('-')}`;
}

function countPulls(db) {
  return db.reduce((sum, e) => sum + e.gainIds.length, 0);
}

function mergeDatabases(oldDB, newDB) {
  const map = new Map();
  [...oldDB, ...newDB].forEach(e => map.set(generateKey(e), e));
  return [...map.values()].sort((a, b) => a.createTime.localeCompare(b.createTime));
}

function readJSONFile(input, onSuccess) {
  const file = input.files[0];
  if (!file) return;
  if (!file.name.endsWith('.json')) {
    showToast(t('fileNotJson'), 'error');
    input.value = '';
    return;
  }
  const reader   = new FileReader();
  reader.onerror = () => { showToast(t('fileReadError'), 'error'); input.value = ''; };
  reader.onload  = () => {
    try {
      onSuccess(JSON.parse(reader.result));
    } catch (err) {
      console.error('File read error:', err);
      showToast(`Error: ${err.message}`, 'error', 5000);
    } finally {
      input.value = '';
    }
  };
  reader.readAsText(file);
}

function loadFromFile(e) {
  readJSONFile(e.target, json => {
    validateImportData(json);
    const before = countPulls(localDB);
    localDB = mergeDatabases(localDB, json.data.pageData);
    topBar.start(() => {
      parseData(localDB);
      saveToStorage();
      topBar.finish();
      const added = countPulls(localDB) - before;
      showToast(
        added === 0 ? t('noNewPulls') : t('addedPulls', added, countPulls(localDB)),
        added === 0 ? 'warning' : 'success'
      );
    });
  });
}

async function loadFromURL() {
  const url = document.getElementById('urlInput').value.trim();
  if (!url)                    { showToast(t('enterUrl'),   'warning'); return; }
  if (!url.startsWith('http')) { showToast(t('invalidUrl'), 'error');   return; }

  const btn          = document.querySelector('.url-import button');
  const originalText = btn.textContent;
  btn.disabled       = true;
  btn.textContent    = t('loading');

  const loadingToast = showToast(t('loadingData'), 'info', 60000);
  topBar.start();

  try {
    const res = await fetch(PROXY + '?url=' + encodeURIComponent(url));
    if (!res.ok) throw new Error(t('serverError', res.status));

    const json = await res.json();
    loadingToast._dismiss();
    validateImportData(json);

    const before = countPulls(localDB);
    localDB = mergeDatabases(localDB, json.data.pageData);
    parseData(localDB);
    saveToStorage();

    const added = countPulls(localDB) - before;
    showToast(
      added === 0 ? t('noNewPulls') : t('addedPulls', added, countPulls(localDB)),
      added === 0 ? 'warning' : 'success',
      4000
    );
  } catch (err) {
    loadingToast._dismiss();
    console.error('URL import error:', err);
    showToast(t('importError', err.message), 'error', 5000);
  } finally {
    topBar.finish();
    btn.disabled    = false;
    btn.textContent = originalText;
  }
}

function loadDBFile(e) {
  readJSONFile(e.target, json => {
    validateDBData(json);
    if (Array.isArray(json)) {
      localDB = json;
      topBar.start(() => {
        parseData(localDB);
        saveToStorage();
        topBar.finish();
        showToast(t('dbLoadedOldFormat'), 'success');
      });
      return;
    }
    _resolveConflicts(json.profiles, json.pulls, json.savedAt, false);
  });
}

function exportDB() {
  const hasAny = profiles.some(p => readCachedPulls(p.id).length > 0);
  if (!hasAny) { showToast(t('dbEmpty'), 'warning'); return; }

  const pulls = {};
  profiles.forEach(p => {
    pulls[p.id] = readCachedPulls(p.id);
  });

  const payload  = { version: 2, savedAt: new Date().toISOString(), profiles, pulls };
  const filename = `r1999_all_${new Date().toISOString().slice(0, 10)}.json`;
  const json     = JSON.stringify(payload, null, 2);

  if (window.AndroidBridge && typeof window.AndroidBridge.saveDatabase === 'function') {
    window.AndroidBridge.saveDatabase(json, filename);
    return;
  }

  const blob = new Blob([json], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
  showToast(t('exportedProfiles', profiles.length), 'success');
}

function _dbMeta(profileId, pullsMap, savedAt) {
  const arr    = pullsMap?.[profileId] || [];
  const last   = arr.length ? arr[arr.length - 1].createTime : null;
  const locale = t('dateLocale');
  return {
    count:    countPulls(arr),
    lastPull: last
      ? new Date(last.replace(' ', 'T')).toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric' })
      : '—',
    savedAt: savedAt
      ? new Date(savedAt).toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })
      : '—',
  };
}

function _resolveConflicts(importedProfiles, importedPulls, savedAt, silent = false) {
  if (silent) _resolveConflictsSmart(importedProfiles, importedPulls, savedAt);
  else        _resolveConflictsAlways(importedProfiles, importedPulls, savedAt);
}

function _resolveConflictsSmart(importedProfiles, importedPulls, savedAt) {
  const conflicts  = [];
  const clean      = [];
  const localOnly  = [];
  const importedIds   = new Set(importedProfiles.map(p => p.id));
  const importedNames = new Set(importedProfiles.map(p => p.name));

  importedProfiles.forEach(imp => {
    const match = profiles.find(p => p.id === imp.id) || profiles.find(p => p.name === imp.name);
    if (match) conflicts.push({ local: match, imported: imp });
    else       clean.push(imp);
  });

  profiles.forEach(local => {
    if (!importedIds.has(local.id) && !importedNames.has(local.name)) localOnly.push(local);
  });

  clean.forEach(imp => {
    profiles.push(imp);
    localStorage.setItem(`r1999_cache_${imp.id}`, JSON.stringify(importedPulls[imp.id] || []));
  });
  if (clean.length) { saveProfiles(); renderProfileSelect(); }

  const needsModal = [];

  conflicts.forEach(({ local, imported }) => {
    const localCount    = countPulls(readCachedPulls(local.id));
    const importedCount = countPulls(importedPulls[imported.id] || []);
    if (localCount === importedCount) return;
    if (importedCount > localCount) { _applyImported(local, imported, importedPulls); return; }
    needsModal.push({ local, imported });
  });

  localOnly.forEach(local => needsModal.push({ local, imported: null }));

  if (!needsModal.length) { _finishImport(true); return; }

  const localPulls = Object.fromEntries(
    profiles.map(p => [p.id, readCachedPulls(p.id)])
  );

  let idx = 0;
  function next() {
    if (idx >= needsModal.length) { _finishImport(true); return; }
    const { local, imported } = needsModal[idx++];

    if (!imported) {
      _showConflictModal({
        local, imported: null,
        localMeta:    _dbMeta(local.id, localPulls, null),
        importedMeta: null,
        driveDeleted: true,
        onKeepLocal:   () => next(),
        onUseImported: () => {
          localStorage.removeItem(`r1999_cache_${local.id}`);
          profiles = profiles.filter(p => p.id !== local.id);
          if (currentProfile === local.id) {
            currentProfile = profiles[0]?.id || 1;
            localStorage.setItem('r1999_active_profile', currentProfile);
          }
          saveProfiles();
          renderProfileSelect();
          next();
        },
      });
      return;
    }

    _showConflictModal({
      local, imported,
      localMeta:    _dbMeta(local.id,    localPulls,    null),
      importedMeta: _dbMeta(imported.id, importedPulls, savedAt),
      driveDeleted: false,
      onKeepLocal:   () => next(),
      onUseImported: () => { _applyImported(local, imported, importedPulls); next(); },
    });
  }
  next();
}

function _resolveConflictsAlways(importedProfiles, importedPulls, savedAt) {
  const conflicts = [];
  const clean     = [];

  importedProfiles.forEach(imp => {
    const match = profiles.find(p => p.id === imp.id) || profiles.find(p => p.name === imp.name);
    if (match) conflicts.push({ local: match, imported: imp });
    else       clean.push(imp);
  });

  clean.forEach(imp => {
    profiles.push(imp);
    localStorage.setItem(`r1999_cache_${imp.id}`, JSON.stringify(importedPulls[imp.id] || []));
  });
  if (clean.length) { saveProfiles(); renderProfileSelect(); }

  if (!conflicts.length) { _finishImport(false); return; }

  const localPulls = Object.fromEntries(
    profiles.map(p => [p.id, readCachedPulls(p.id)])
  );

  let idx = 0;
  function next() {
    if (idx >= conflicts.length) { _finishImport(false); return; }
    const { local, imported } = conflicts[idx++];
    _showConflictModal({
      local, imported,
      localMeta:    _dbMeta(local.id,    localPulls,    null),
      importedMeta: _dbMeta(imported.id, importedPulls, savedAt),
      onKeepLocal:   () => next(),
      onUseImported: () => { _applyImported(local, imported, importedPulls); next(); },
    });
  }
  next();
}

function _applyImported(local, imported, importedPulls) {
  const arr = importedPulls[imported.id] || [];
  if (local.id !== imported.id) {
    localStorage.removeItem(`r1999_cache_${local.id}`);
    profiles = profiles.filter(p => p.id !== local.id);
    profiles.push(imported);
    if (currentProfile === local.id) {
      currentProfile = imported.id;
      localStorage.setItem('r1999_active_profile', currentProfile);
    }
    saveProfiles();
    renderProfileSelect();
  }
  localStorage.setItem(`r1999_cache_${imported.id}`, JSON.stringify(arr));
}

function _finishImport(silent = false) {
  loadProfileDB(false);
  if (typeof gdriveScheduleSave === 'function') gdriveScheduleSave();
  if (!silent) showToast(t('importDone'), 'success', 4000);
}

function _showConflictModal({ local, imported, localMeta, importedMeta, driveDeleted, onKeepLocal, onUseImported }) {
  document.getElementById('conflictModal')?.remove();

  const localName    = escapeHTML(local.name);
  const importedName = imported ? escapeHTML(imported.name) : '';

  const modal     = document.createElement('div');
  modal.id        = 'conflictModal';
  modal.className = 'conflict-modal-overlay';

  if (driveDeleted) {
    modal.innerHTML = `
      <div class="conflict-modal">
        <div class="conflict-modal-title">${t('conflictCloudTitle')}</div>
        <div class="conflict-modal-subtitle">${t('conflictCloudSub', localName)}</div>
        <div class="conflict-columns">
          <div class="conflict-col conflict-col-local">
            <div class="conflict-col-header">${t('conflictCloudLocal')}</div>
            <div class="conflict-col-name">${localName}</div>
            <div class="conflict-stat"><span>${t('conflictStatPulls')}</span><b>${localMeta.count}</b></div>
            <div class="conflict-stat"><span>${t('conflictStatLast')}</span><b>${localMeta.lastPull}</b></div>
          </div>
          <div class="conflict-col-vs">?</div>
          <div class="conflict-col conflict-col-imported" style="display:flex;align-items:center;justify-content:center;">
            <div style="text-align:center;color:#6b6f8a;font-size:13px;">🗑️<br>${t('conflictCloudDel')}</div>
          </div>
        </div>
        <div class="conflict-actions">
          <button class="conflict-btn-local"    id="cmKeepLocal">${t('conflictKeepLocalBtn')}</button>
          <button class="conflict-btn-imported" id="cmUseImported">${t('conflictDeleteBtn')}</button>
        </div>
      </div>`;
  } else {
    modal.innerHTML = `
      <div class="conflict-modal">
        <div class="conflict-modal-title">${t('conflictTitle')}</div>
        <div class="conflict-modal-subtitle">${t('conflictSubtitle', importedName)}</div>
        <div class="conflict-columns">
          <div class="conflict-col conflict-col-local">
            <div class="conflict-col-header">${t('conflictLocal')}</div>
            <div class="conflict-col-name">${localName}</div>
            <div class="conflict-stat"><span>${t('conflictStatPulls')}</span><b>${localMeta.count}</b></div>
            <div class="conflict-stat"><span>${t('conflictStatLast')}</span><b>${localMeta.lastPull}</b></div>
          </div>
          <div class="conflict-col-vs">VS</div>
          <div class="conflict-col conflict-col-imported">
            <div class="conflict-col-header">${t('conflictImported')}</div>
            <div class="conflict-col-name">${importedName}</div>
            <div class="conflict-stat"><span>${t('conflictStatPulls')}</span><b>${importedMeta.count}</b></div>
            <div class="conflict-stat"><span>${t('conflictStatLast')}</span><b>${importedMeta.lastPull}</b></div>
            <div class="conflict-stat"><span>${t('conflictStatSaved')}</span><b>${importedMeta.savedAt}</b></div>
          </div>
        </div>
        <div class="conflict-actions">
          <button class="conflict-btn-local"    id="cmKeepLocal">${t('conflictKeepLocal')}</button>
          <button class="conflict-btn-imported" id="cmUseImported">${t('conflictUseImport')}</button>
        </div>
      </div>`;
  }

  document.body.appendChild(modal);
  requestAnimationFrame(() => modal.classList.add('visible'));

  function close(cb) {
    modal.classList.remove('visible');
    setTimeout(() => { modal.remove(); cb(); }, 250);
  }

  modal.querySelector('#cmKeepLocal').addEventListener('click',   () => close(onKeepLocal));
  modal.querySelector('#cmUseImported').addEventListener('click', () => close(onUseImported));
}

function parseData(list) {
  processedList  = normalizePulls(list);
  processedPity  = [];
  processedFifty = [];

  const pityCounters = {};
  const guarantee    = {};
  const monthly      = {};

  processedList.forEach((e, i) => {
    const key  = getPityKey(e);
    const char = getChar(e.gainIds[0]);
    pityCounters[key] ??= 1;
    processedPity[i]   = pityCounters[key];
    pityCounters[key]  = char.rarity === 6 ? 1 : pityCounters[key] + 1;

    if (char.rarity === 6) {
      const type   = getBannerType(e.poolName);
      const rateUp = BANNERS[e.poolName]?.rateUp6;
      if (type === 'Character' || type === 'Limited' || rateUp) {
        const g = guarantee[key];
        if (!rateUp) {
          processedFifty[i] = null;
          guarantee[key]    = null;
        } else if (g === true) {
          processedFifty[i] = 'guaranteed';
          guarantee[key]    = false;
        } else if (rateUp.includes(char.name)) {
          processedFifty[i] = g === null ? null : 'win';
          guarantee[key]    = false;
        } else {
          processedFifty[i] = 'lose';
          guarantee[key]    = true;
        }
      }
    }

    const month = e.createTime.slice(0, 7);
    monthly[month] ??= { 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
    monthly[month][char.rarity]++;
  });

  processedPityCounters = pityCounters;
  processedGuarantee    = guarantee;

  const hasData = processedList.length > 0;

  renderBannerStats();
  ['statsBox', 'recentSixStarsBox', 'chartsBox'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = hasData ? '' : 'none';
  });

  if (hasData) {
    renderStats();
    chartsMonthly = monthly;
    chartsDirty   = true;
    if (chartsOpen) renderCharts();
    renderRecentSixStars();
  }

  renderTable();
  setTimeout(() => document.querySelectorAll('.stat').forEach(s => s.classList.add('show')), 50);
}

function gameVersionFromPoolId(poolId) {
  const s = String(poolId ?? '');
  return s.length === 5 ? `${s[0]}.${s[1]}` : '';
}

function renderBannerStats() {
  const container = document.getElementById('bannerStats');
  if (!container) return;

  const typeData = {};
  Object.keys(BANNER_TYPE_LABELS).forEach(type => {
    typeData[type] = { pulls: 0, lastKeyIdx: {} };
  });

  const waterSegs = {};

  processedList.forEach((e, i) => {
    const type = getBannerType(e.poolName);
    if (!typeData[type]) return;
    const key = getPityKey(e);
    typeData[type].pulls++;
    typeData[type].lastKeyIdx[key] = i;

    if (type === 'Water') {
      const seg = waterSegs[key] ??= { key, pulls: 0, lastIdx: -1, name: '', lastMonth: '', poolId: e.poolId };
      seg.pulls++;
      seg.lastIdx   = i;
      seg.name      = getBannerName(e.poolName);
      seg.lastMonth = e.createTime.slice(0, 7);
    }
  });

  container.innerHTML = '';

  const activeTypes = Object.entries(BANNER_TYPE_LABELS).filter(([type]) => typeData[type]?.pulls > 0);
  container.style.setProperty('--banner-col-count', activeTypes.length || 1);

  const locale = t('dateLocale');

  const pityOf = key => {
    const pity = (processedPityCounters[key] ?? 1) - 1;
    return {
      pity,
      colorCls: pity < PITY_COLOR_YELLOW ? 'pity-val-green' : pity < PITY_COLOR_RED ? 'pity-val-yellow' : 'pity-val-red',
    };
  };

  const itemsHTML = (pulls, { pity, colorCls }, guaranteed = false) => `
      <div class="banner-stat-item">
        <div class="banner-stat-label">
          ${t('bannerStatPulls')}
          <span class="sub"><img src="static/ui/ClearDrop.webp" alt="💎" onerror="this.outerHTML='💎'"> <span class="banner-stat-gems">${(pulls * 180).toLocaleString(locale)}</span></span>
        </div>
        <div class="banner-stat-value banner-stat-pulls">${pulls}</div>
      </div>
      <div class="banner-stat-item">
        <div class="banner-stat-pity-label">
          ${t('bannerStatPity')}
          <span class="pity-hint">${t('bannerPityHint')}</span>
        </div>
        <div class="banner-stat-pity-value banner-stat-pity ${colorCls}">${guaranteed ? `<span class="pity-guarantee-arrow" title="${t('fifty_guaranteed')}">↑</span>` : ''}${pity} / ${PITY_MAX}</div>
      </div>`;

  activeTypes.forEach(([type, label]) => {
    const data    = typeData[type];
    const typeTag = `<span class="banner-type ${BANNER_TYPE_CLASSES[type]}">${type}</span>`;
    const segs    = type === 'Water' ? Object.values(waterSegs).sort((a, b) => b.lastIdx - a.lastIdx) : null;

    const card     = document.createElement('div');
    card.className = 'banner-stat-card';

    if (segs && segs.length > 1) {
      const nameCount = {};
      segs.forEach(s => { nameCount[s.name] = (nameCount[s.name] || 0) + 1; });
      segs.forEach(s => {
        const tag = gameVersionFromPoolId(s.poolId) || s.lastMonth;
        s.optLabel = nameCount[s.name] > 1 ? `${tag} · ${s.name}` : s.name;
      });

      const options = segs.map((s, idx) => `<option value="${idx}">${escapeHTML(s.optLabel)}</option>`).join('');

      card.innerHTML = `
        <div class="banner-stat-card-title">
          ${typeTag}
          <select class="banner-stat-select">${options}</select>
        </div>
        ${itemsHTML(segs[0].pulls, pityOf(segs[0].key), processedGuarantee[segs[0].key] === true)}`;

      const select  = card.querySelector('.banner-stat-select');
      const pullsEl = card.querySelector('.banner-stat-pulls');
      const gemsEl  = card.querySelector('.banner-stat-gems');
      const pityEl  = card.querySelector('.banner-stat-pity');
      select.addEventListener('change', () => {
        const s = segs[Number(select.value)];
        const d = pityOf(s.key);
        const g = processedGuarantee[s.key] === true;
        pullsEl.textContent = s.pulls;
        gemsEl.textContent  = (s.pulls * 180).toLocaleString(locale);
        pityEl.innerHTML    = `${g ? `<span class="pity-guarantee-arrow" title="${t('fifty_guaranteed')}">↑</span>` : ''}${d.pity} / ${PITY_MAX}`;
        pityEl.className    = `banner-stat-pity-value banner-stat-pity ${d.colorCls}`;
      });
    } else {
      let latestKey = null, latestIdx = -1;
      for (const [key, idx] of Object.entries(data.lastKeyIdx)) {
        if (idx > latestIdx) { latestIdx = idx; latestKey = key; }
      }
      const info = latestKey !== null ? pityOf(latestKey) : { pity: 0, colorCls: 'pity-val-green' };
      const guaranteed = (type === 'Character' || type === 'Limited') &&
        latestKey !== null && processedGuarantee[latestKey] === true;

      card.innerHTML = `
        <div class="banner-stat-card-title">${typeTag} ${label}</div>
        ${itemsHTML(data.pulls, info, guaranteed)}`;
    }

    container.appendChild(card);
    requestAnimationFrame(() => card.classList.add('visible'));
  });
}

function renderStats() {
  let sixCount = 0, pitySum = 0;
  processedList.forEach((e, i) => {
    if (getChar(e.gainIds[0]).rarity === 6) {
      sixCount++;
      pitySum += processedPity[i];
    }
  });

  let fiftyWins = 0, fiftyTotal = 0;
  processedFifty.forEach(s => {
    if (s === 'win' || s === 'lose') {
      fiftyTotal++;
      if (s === 'win') fiftyWins++;
    }
  });

  const pulls = processedList.length;
  document.getElementById('stats').innerHTML = `
    <div class="stat">${t('statTotalPulls')}<br><b>${pulls}</b></div>
    <div class="stat">${t('statSixStars')}<br><b>${sixCount}</b></div>
    <div class="stat">${t('statSixPct')}<br><b>${(sixCount / pulls * 100 || 0).toFixed(2)}%</b></div>
    <div class="stat">${t('statAvgPity')}<br><b>${sixCount ? Math.round(pitySum / sixCount) : 0}</b></div>
    <div class="stat">${t('statFifty')}<br><b>${fiftyTotal ? `${fiftyWins}/${fiftyTotal} (${Math.round(fiftyWins / fiftyTotal * 100)}%)` : '—'}</b></div>
  `;
  setTimeout(() => document.querySelectorAll('#stats .stat').forEach(s => s.classList.add('show')), 50);
}

function renderRecentSixStars() {
  const container = document.getElementById('recentSixStars');

  const sixStars = processedList
    .map((e, i) => ({ char: getChar(e.gainIds[0]), pity: processedPity[i], fifty: processedFifty[i] }))
    .filter(item => item.char.rarity === 6)
    .reverse();

  if (!sixStars.length) {
    container.innerHTML = `<div class="recent-six-stars-placeholder">${t('sixStarsPlaceholder')}</div>`;
    updateRecentToggle();
    return;
  }

  container.innerHTML = '';

  sixStars.forEach(item => {
    const colorClass = item.pity < PITY_COLOR_YELLOW ? 'pity-color-green' : item.pity < PITY_COLOR_RED ? 'pity-color-yellow' : 'pity-color-red';
    const imgSrc     = `static/characters/${item.char.name.replace(/\s+/g, '_')}.webp`;

    const card        = document.createElement('div');
    card.className    = `six-star-card ${colorClass} show`;

    const portrait    = document.createElement('div');
    portrait.className = 'six-star-portrait';

    const img = document.createElement('img');
    img.src   = imgSrc;
    img.alt   = item.char.name;
    img.addEventListener('error', () => {
      img.style.display    = 'none';
      portrait.textContent = item.char.name;
    });

    const pityBadge       = document.createElement('div');
    pityBadge.className   = 'six-star-pity';
    pityBadge.textContent = item.pity;

    const nameLabel       = document.createElement('div');
    nameLabel.className   = 'six-star-name';
    nameLabel.textContent = item.char.name;

    portrait.appendChild(img);
    card.appendChild(portrait);
    card.appendChild(pityBadge);
    if (item.fifty) {
      const fiftyBadge     = document.createElement('div');
      fiftyBadge.className = `six-star-fifty ${item.fifty}`;
      fiftyBadge.innerHTML = fiftyIconSVG(item.fifty);
      fiftyBadge.title     = t('fifty_' + item.fifty);
      card.appendChild(fiftyBadge);
    }
    card.appendChild(nameLabel);
    container.appendChild(card);
  });

  updateRecentToggle();
}

function updateRecentToggle() {
  const box = document.getElementById('recentSixStarsBox');
  const btn = document.getElementById('recentToggle');
  const grid = document.getElementById('recentSixStars');
  if (!box || !btn || !grid) return;
  box.classList.toggle('no-collapse', grid.scrollHeight <= 320);
  btn.textContent = box.classList.contains('collapsed') ? t('recentShowAll') : t('recentCollapse');
}

function toggleRecent() {
  document.getElementById('recentSixStarsBox').classList.toggle('collapsed');
  updateRecentToggle();
}

function fiftyIconSVG(status) {
  const heart = 'M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z';
  if (status === 'win') {
    return `<svg viewBox="0 0 24 24" class="fifty-icon"><path d="${heart}" fill="currentColor"/></svg>`;
  }
  if (status === 'lose') {
    return `<svg viewBox="0 0 24 24" class="fifty-icon"><path d="${heart}" fill="none" stroke="currentColor" stroke-width="2"/><line x1="3.5" y1="3.5" x2="20.5" y2="20.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;
  }
  return `<svg viewBox="0 0 24 24" class="fifty-icon"><path d="${heart}" fill="none" stroke="currentColor" stroke-width="2"/></svg>`;
}

function pityRowColor(v) {
  return v < PITY_COLOR_YELLOW ? 'pity-green' : v < PITY_COLOR_RED ? 'pity-yellow' : 'pity-red';
}

function renderTable() {
  const filtered = [];
  processedList.forEach((e, i) => {
    if (currentFilter     && getChar(e.gainIds[0]).rarity !== currentFilter)     return;
    if (currentTypeFilter && getBannerType(e.poolName)    !== currentTypeFilter) return;
    filtered.push(i);
  });

  const tb = document.getElementById('table');
  tb.innerHTML = '';

  if (!filtered.length) {
    tb.innerHTML = `<tr class="show"><td colspan="6" style="text-align:center;padding:30px;color:#9aa0a6;font-size:18px;">${t('noData')}</td></tr>`;
    return;
  }

  const displayIndices = filtered.toReversed();
  const groupRole      = displayIndices.map(() => null);

  let gi = 0;
  while (gi < displayIndices.length) {
    const gid = processedList[displayIndices[gi]]._groupId;
    if (gid) {
      let gj = gi + 1;
      while (gj < displayIndices.length && processedList[displayIndices[gj]]._groupId === gid) gj++;
      const span = gj - gi;
      if (span > 1) {
        groupRole[gi] = 'start';
        for (let x = gi + 1; x < gj - 1; x++) groupRole[x] = 'mid';
        groupRole[gj - 1] = 'end';
        groupRole[gi + Math.floor(span / 2)] += '-label';
      }
      gi = gj;
    } else {
      gi++;
    }
  }

  const fragment = document.createDocumentFragment();
  const rows     = [];

  displayIndices.forEach((origIdx, di) => {
    const e    = processedList[origIdx];
    const c    = getChar(e.gainIds[0]);
    const type = getBannerType(e.poolName);
    const role = groupRole[di];

    const bracketCell = (role && !currentFilter && !currentTypeFilter)
      ? `<td class="group-bracket group-${role.replace('-label', '')}">${role.endsWith('-label') ? '<span>×10</span>' : ''}</td>`
      : '<td class="group-bracket-empty"></td>';

    const tr     = document.createElement('tr');
    tr.className = pityRowColor(processedPity[origIdx]);
    if (e._groupId) tr.dataset.group = e._groupId;
    tr.innerHTML = `
      ${bracketCell}
      <td style="text-align:center;color:#9aa0a6;font-size:13px;">${origIdx + 1}</td>
      <td><span class="banner-type ${BANNER_TYPE_CLASSES[type] || 'type-other'}">${type}</span> ${getBannerName(e.poolName)}</td>
      <td>${processedPity[origIdx]}${processedFifty[origIdx] ? `<span class="fifty-mark" title="${t('fifty_' + processedFifty[origIdx])}">${fiftyIconSVG(processedFifty[origIdx])}</span>` : ''}</td>
      <td><span class="r${c.rarity}">${c.name} ★${c.rarity}</span></td>
      <td style="text-align:right;color:#9aa0a6;font-size:13px;white-space:nowrap;">${e.createTime}</td>
    `;
    fragment.appendChild(tr);
    rows.push(tr);
  });

  tb.appendChild(fragment);

  let idx = 0;
  (function animateBatch() {
    rows.slice(idx, idx + 30).forEach(tr => tr.classList.add('show'));
    idx += 30;
    if (idx < rows.length) requestAnimationFrame(animateBatch);
  })();
}

function filterByRarity(r, btn) {
  currentFilter = r;
  btn.closest('.filter-bar').querySelectorAll('button:not(.filter-type):not(.filter-type-all)').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderTable();
}

function filterByType(type, btn) {
  currentTypeFilter = type;
  btn.closest('.filter-bar').querySelectorAll('button.filter-type, button.filter-type-all').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderTable();
}

function drawChartPlaceholder() {
  const canvas = document.getElementById('chart');
  if (!canvas) return;
  const dpr = window.devicePixelRatio || 1;
  const w   = canvas.offsetWidth || 600;
  const h   = 280;
  canvas.width        = w * dpr;
  canvas.height       = h * dpr;
  canvas.style.width  = w + 'px';
  canvas.style.height = h + 'px';
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle    = '#9aa0a6';
  ctx.font         = '20px system-ui, -apple-system, sans-serif';
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(t('chartPlaceholder1'), w / 2, h / 2 - 14);
  ctx.fillText(t('chartPlaceholder2'), w / 2, h / 2 + 14);
}

function renderChart(monthly) {
  const labels  = Object.keys(monthly).sort();
  const hasData = labels.some(m => Object.values(monthly[m]).some(v => v > 0));

  if (!hasData) {
    if (chart) { chart.destroy(); chart = null; }
    requestAnimationFrame(drawChartPlaceholder);
    return;
  }

  if (chart) chart.destroy();

  const colors = { 2: '#9aa0a6', 3: '#00ff9c', 4: '#00c8ff', 5: '#ffd54a', 6: '#ff4d5a' };
  chart = new Chart(document.getElementById('chart'), {
    type: 'line',
    data: {
      labels,
      datasets: [2, 3, 4, 5, 6].map(r => ({
        label:            `★${r}`,
        data:             labels.map(m => monthly[m][r]),
        borderColor:      colors[r],
        tension:          0.35,
        borderWidth:      2,
        pointRadius:      3,
        pointHoverRadius: 6,
      })),
    },
    options: {
      animation: false,
      plugins: { legend: { labels: { color: '#eaeaf0' } } },
      scales: {
        x: { ticks: { color: '#eaeaf0' }, grid: { display: false } },
        y: { ticks: { color: '#eaeaf0' }, grid: { display: false } },
      },
    },
  });
}

function renderCharts() {
  if (!chartsMonthly) return;
  renderChart(chartsMonthly);
  renderPityChart();
  chartsDirty = false;
}

function toggleChartsBox() {
  chartsOpen = !chartsOpen;
  const content = document.getElementById('chartsContent');
  const arrow   = document.getElementById('chartsArrow');
  if (content) content.style.display = chartsOpen ? '' : 'none';
  if (arrow) arrow.classList.toggle('open', chartsOpen);
  if (chartsOpen && chartsDirty) renderCharts();
}

function renderPityChart() {
  const canvas = document.getElementById('pityChart');
  if (!canvas) return;

  const counts = new Array(PITY_MAX).fill(0);
  processedList.forEach((e, i) => {
    if (getChar(e.gainIds[0]).rarity === 6) {
      counts[Math.min(processedPity[i], PITY_MAX) - 1]++;
    }
  });

  if (pityChart) pityChart.destroy();

  const colors = counts.map((_, i) => {
    const p = i + 1;
    return p < PITY_COLOR_YELLOW ? 'rgba(0,255,156,0.75)'
         : p < PITY_COLOR_RED    ? 'rgba(255,213,74,0.8)'
         :                         'rgba(255,77,90,0.85)';
  });

  pityChart = new Chart(canvas, {
    type: 'bar',
    data: {
      labels: counts.map((_, i) => i + 1),
      datasets: [{
        data:               counts,
        backgroundColor:    colors,
        borderWidth:        0,
        barPercentage:      1,
        categoryPercentage: 0.85,
      }],
    },
    options: {
      animation: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: '#eaeaf0', maxTicksLimit: 24 }, grid: { display: false } },
        y: { ticks: { color: '#eaeaf0', precision: 0 }, grid: { display: false } },
      },
    },
  });
}

function toggleTlLocalTime(checked) {
  tlUseLocalTime = checked;
  localStorage.setItem('tlUseLocalTime', checked ? 'true' : 'false');
  const box = document.getElementById('bannerTimelineBox');
  box.classList.add('ui-fade');
  setTimeout(() => {
    updateTlTzLabel();
    renderBannerTimeline({ smoothScroll: false });
    setTimeout(() => {
      requestAnimationFrame(() => requestAnimationFrame(() => box.classList.remove('ui-fade')));
    }, 80);
  }, 130);
}

function updateTlTzLabel() {
  const el = document.getElementById('tlTzLabel');
  if (!el) return;
  el.textContent = tlUseLocalTime
    ? formatUtcOffset(getLocalOffsetMin())
    : formatUtcOffset(TIME.SERVER_TZ_OFFSET_MIN);
}

function timelineItemsOverlap(a, b) {
  return a.startMs < b.endMs && a.endMs > b.startMs;
}

function canPlaceTimelineItemInLane(item, lane) {
  return !lane.items.some(other => timelineItemsOverlap(item, other));
}

function getTimelineLaneBestFitEnd(lane, item) {
  const endsBefore = lane.items
    .filter(other => other.endMs <= item.startMs)
    .map(other => other.endMs);
  return endsBefore.length ? Math.max(...endsBefore) : -Infinity;
}

function getTimelineLaneTier(info) {
  if (info.type === 'Limited') return 0;
  if (info.type === 'Character') return 1;
  return 2;
}

function assignTimelineLanesGreedy(items) {
  const lanes = [];

  items.forEach(item => {
    let bestLane = null;
    let bestEnd  = -Infinity;

    for (const lane of lanes) {
      if (!canPlaceTimelineItemInLane(item, lane)) continue;
      const fitEnd = getTimelineLaneBestFitEnd(lane, item);
      if (fitEnd > bestEnd) {
        bestEnd  = fitEnd;
        bestLane = lane;
      }
    }

    if (!bestLane) {
      bestLane = { items: [] };
      lanes.push(bestLane);
    }

    bestLane.items.push(item);
  });

  return lanes;
}

function assignTimelineLanes(items) {
  const tiers = [[], [], []];

  items.forEach(item => {
    tiers[getTimelineLaneTier(item.info)].push(item);
  });

  return tiers.flatMap(tierItems => {
    if (!tierItems.length) return [];
    tierItems.sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
    return assignTimelineLanesGreedy(tierItems);
  });
}

function packTimelineLaneItems(lane) {
  const sorted = [...lane.items].sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
  let packCursor = 0;

  sorted.forEach((item, idx) => {
    const prev    = sorted[idx - 1];
    const gapMs   = prev ? item.startMs - prev.endMs : 0;
    const packTight = prev && gapMs >= 0 && gapMs < TIME.MS_DAY;

    if (packTight) {
      item.displayLeftPx = packCursor;
    } else {
      item.displayLeftPx = item.leftPx;
    }

    packCursor = Math.max(packCursor, item.displayLeftPx + item.widthPx);
  });
}

function renderBannerTimeline(options = {}) {
  const box  = document.getElementById('bannerTimelineBox');
  const wrap = document.getElementById('bannerTimelineWrap');
  if (!box || !wrap) return;
  wrap.innerHTML = '';

  updateTlTzLabel();

  if (timelineTickInterval) {
    clearInterval(timelineTickInterval);
    timelineTickInterval = null;
  }

  const banners = ACTIVE_BANNERS.filter(b => b.startUTC && b.endUTC);
  if (!banners.length) { box.style.display = 'none'; return; }

  const DAY_W       = 40;
  const DAYS_PAD    = 2;
  const DAYS        = t('days');
  const MONTHS_FULL = t('monthsFull');

  const allMs        = banners.flatMap(b => [parseTimeMs(b.startUTC), parseTimeMs(b.endUTC)]);
  const rangeStartMs = getTimelineDayStartMs(Math.min(...allMs)) - DAYS_PAD * TIME.MS_DAY;
  const rangeEndMs   = getTimelineDayStartMs(Math.max(...allMs)) + (DAYS_PAD + 1) * TIME.MS_DAY;
  const totalDays    = Math.round((rangeEndMs - rangeStartMs) / TIME.MS_DAY);
  const totalWidth   = totalDays * DAY_W;
  const nowDayMs     = getTimelineDayStartMs(Date.now());
  const nowDayIdx    = Math.floor((nowDayMs - rangeStartMs) / TIME.MS_DAY);

  wrap.innerHTML = `
    <div class="banner-timeline-inner" style="width:${totalWidth}px;">
      <div class="banner-timeline-header">
        <div class="tl-days-header" id="tlDaysHdr" style="width:${totalWidth}px;flex-shrink:0;"></div>
      </div>
      <div class="banner-timeline-rows" id="timelineRows"></div>
    </div>`;

  const daysHdr = document.getElementById('tlDaysHdr');
  const rowsCnt = document.getElementById('timelineRows');

  let lastMonth = -1;
  for (let i = 0; i < totalDays; i++) {
    const dayMs  = rangeStartMs + i * TIME.MS_DAY;
    const p      = getTimelineDateParts(dayMs);
    const isMonthStart = p.month !== lastMonth;
    const cell   = document.createElement('div');
    cell.className    = 'tl-day-cell' + (getTimelineDayStartMs(dayMs) === nowDayMs ? ' today' : '') + (isMonthStart ? ' month-start' : '');
    cell.style.width    = DAY_W + 'px';
    cell.style.minWidth = DAY_W + 'px';
    const topLabel = isMonthStart
      ? (lastMonth = p.month, MONTHS_FULL[p.month])
      : DAYS[p.weekday];
    cell.innerHTML = `<span class="day-name">${topLabel}</span>${p.date}`;
    daysHdr.appendChild(cell);
  }

  const monthStartIndices = [];
  for (let i = 1; i < totalDays; i++) {
    const p = getTimelineDateParts(rangeStartMs + i * TIME.MS_DAY);
    if (p.date === 1) monthStartIndices.push(i);
  }

  const gridLine = `repeating-linear-gradient(to right, transparent 0px, transparent ${DAY_W - 1}px, #1e2455 ${DAY_W - 1}px, #1e2455 ${DAY_W}px)`;
  const timelineItems = banners
    .map((b, bIdx) => {
      const info      = BANNERS[b.key] || { name: b.key, type: 'Character' };
      const typeClass = BANNER_TYPE_CLASSES[info.type] || 'type-other';
      const startMs   = parseTimeMs(b.startUTC);
      const endMs     = parseTimeMs(b.endUTC);
      const leftPx    = Math.max(0,          getTimelineX(startMs, rangeStartMs, DAY_W));
      const rightPx   = Math.min(totalWidth, getTimelineX(endMs, rangeStartMs, DAY_W));

      return {
        b, bIdx, info, typeClass, startMs, endMs,
        leftPx,
        rightPx,
        widthPx: Math.max(20, rightPx - leftPx),
      };
    })
    .sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);

  const lanes = assignTimelineLanes(timelineItems);
  lanes.forEach(lane => packTimelineLaneItems(lane));

  lanes.forEach(lane => {
    const row     = document.createElement('div');
    row.className = 'tl-row';

    const right           = document.createElement('div');
    right.className       = 'tl-cells';
    right.style.width     = totalWidth + 'px';
    right.style.minWidth  = totalWidth + 'px';
    const bgLayers = [];
    if (nowDayIdx >= 0 && nowDayIdx < totalDays) {
      bgLayers.push(`linear-gradient(to right,
          transparent ${nowDayIdx * DAY_W}px,
          rgba(100,160,255,0.055) ${nowDayIdx * DAY_W}px,
          rgba(100,160,255,0.055) ${(nowDayIdx + 1) * DAY_W}px,
          transparent ${(nowDayIdx + 1) * DAY_W}px)`);
    }
    bgLayers.push(gridLine);
    right.style.backgroundImage = bgLayers.join(', ');

    const barCont     = document.createElement('div');
    barCont.className = 'tl-bar-container';

    lane.items.forEach(item => {
      const bar     = document.createElement('div');
      bar.className = `tl-bar ${item.typeClass}`;
      bar.style.left  = (item.displayLeftPx ?? item.leftPx) + 'px';
      bar.style.width = item.widthPx + 'px';
      applyTimelineBarImage(bar, item.b, () => bar.classList.add('tl-bar--placeholder'));

      bar.innerHTML = `
        <div class="tl-bar-inner">
          <span class="banner-type tl-bar-type ${item.typeClass}">${item.info.type}</span>
          <span class="tl-bar-name">${item.info.name}</span>
          <span class="tl-bar-timer" id="tl-timer-${item.bIdx}">—</span>
        </div>`;

      bar.addEventListener('click', () => openBannerModal(item.b, item.info, item.typeClass));
      barCont.appendChild(bar);
    });

    monthStartIndices.forEach(idx => {
      const sep = document.createElement('div');
      sep.className = 'tl-month-sep';
      sep.style.left = (idx * DAY_W) + 'px';
      right.appendChild(sep);
    });
    right.appendChild(barCont);
    row.appendChild(right);
    rowsCnt.appendChild(row);
  });

  monthStartIndices.forEach(idx => {
    const sep = document.createElement('div');
    sep.className = 'tl-month-sep';
    sep.style.left = (idx * DAY_W) + 'px';
    daysHdr.appendChild(sep);
  });

  const nowLine     = document.createElement('div');
  nowLine.id        = 'tl-now-line';
  nowLine.className = 'tl-now-line';
  rowsCnt.appendChild(nowLine);

  function tickTimeline() {
    const now       = Date.now();
    const nowCellPx = getTimelineX(now, rangeStartMs, DAY_W);
    const line      = document.getElementById('tl-now-line');
    if (line) {
      line.style.left   = nowCellPx + 'px';
      line.style.height = rowsCnt.offsetHeight + 'px';
    }
    timelineItems.forEach(item => {
      const el   = document.getElementById('tl-timer-' + item.bIdx);
      if (!el) return;
      const countdown = getBannerCountdownState(item.startMs, item.endMs, now);
      el.textContent = countdown.shortText;
      el.className = 'tl-bar-timer' + (countdown.state === 'upcoming' ? ' upcoming' : '');
    });
  }

  requestAnimationFrame(() => {
    tickTimeline();
    timelineTickInterval = setInterval(tickTimeline, 1000);
  });

  setTimeout(() => {
    const nowCellPx = getTimelineX(Date.now(), rangeStartMs, DAY_W);
    const targetScrollLeft = Math.max(0, nowCellPx - wrap.clientWidth / 2);
    if (options.smoothScroll && typeof wrap.scrollTo === 'function') {
      wrap.scrollTo({ left: targetScrollLeft, behavior: 'smooth' });
    } else {
      wrap.scrollLeft = targetScrollLeft;
    }
  }, 60);
}

function collectBannerRuns(bannerKey) {
  const runs = {};
  processedList.forEach((e, i) => {
    if (e.poolName !== bannerKey) return;
    const pid = e.poolId;
    const run = runs[pid] ??= {
      poolId: pid, version: gameVersionFromPoolId(pid),
      firstTime: e.createTime, total: 0, sixStars: []
    };
    run.total++;
    if (e.createTime < run.firstTime) run.firstTime = e.createTime;
    const char = getChar(e.gainIds[0]);
    if (char.rarity === 6) {
      run.sixStars.push({ name: char.name, pity: processedPity[i], fifty: processedFifty[i] });
    }
  });
  return Object.values(runs).sort((a, b) => b.firstTime.localeCompare(a.firstTime));
}

function bannerSixChipHTML(s) {
  const colorCls = s.pity < PITY_COLOR_YELLOW ? 'pity-val-green'
                 : s.pity < PITY_COLOR_RED    ? 'pity-val-yellow' : 'pity-val-red';
  const src   = `static/characters/${s.name.replace(/\s+/g, '_')}.webp`;
  const fifty = s.fifty
    ? `<span class="tl-six-fifty ${s.fifty}" title="${t('fifty_' + s.fifty)}">${fiftyIconSVG(s.fifty)}</span>`
    : '';
  return `<div class="tl-six-chip">
      <span class="tl-chip-avatar tl-six-avatar" data-src="${src}"
            data-letter="${(s.name.trim()[0] || '?')}" data-fg="#ff4d5a" data-bg="#2a0a0e"></span>
      <span class="tl-six-name">${escapeHTML(s.name)}</span>
      <span class="tl-six-pity ${colorCls}">${s.pity}</span>
      ${fifty}
    </div>`;
}

function bannerPullsSectionHTML(b) {
  const runs  = collectBannerRuns(b.key);
  const total = runs.reduce((s, r) => s + r.total, 0);

  if (!total) {
    return `<div class="tl-modal-divider"></div>
      <div class="tl-modal-section-title">${t('modalYourPulls')}</div>
      <div class="tl-modal-pulls-empty">${t('modalNoPulls')}</div>`;
  }

  const runsHTML = runs.map(run => {
    const date  = run.firstTime.slice(0, 10);
    const label = run.version ? `v${run.version}` : date;
    const six   = run.sixStars.length;
    const meta  = `${date} · ${run.total} ${t('modalPulls')} · ${six ? six + '× ★6' : t('modalNoSix')}`;
    const chips = six ? run.sixStars.map(bannerSixChipHTML).join('') : '';
    return `<div class="tl-run">
        <div class="tl-run-head">
          <span class="tl-run-ver">${label}</span>
          <span class="tl-run-meta">${meta}</span>
        </div>
        ${chips ? `<div class="tl-run-six">${chips}</div>` : ''}
      </div>`;
  }).join('');

  return `<div class="tl-modal-divider"></div>
    <div class="tl-modal-section-title">${t('modalYourPulls')}
      <span class="tl-pulls-total">${total} ${t('modalPulls')}</span></div>
    <div class="tl-modal-runs">${runsHTML}</div>`;
}

function openBannerModal(b, info, typeClass) {
  const MONTHS_FULL = t('monthsFull');

  function charToSlug(name) {
    return name.toLowerCase().replace(/\./g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }

  const startMs = parseTimeMs(b.startUTC);
  const endMs   = parseTimeMs(b.endUTC);
  const timerId = 'tl-modal-timer';
  const labelId = timerId + '-label';

  const rateUpChips = (b.rateUp || []).map(n => {
    const c      = getCharByName(n);
    const rarity = c ? c.rarity : 0;
    const cls    = rarity ? `tl-modal-chip r${rarity}` : 'tl-modal-chip';
    const fallbackColors = {
      6: ['#ff4d5a', '#2a0a0e'], 5: ['#ffd54a', '#2a2000'],
      4: ['#00c8ff', '#001a22'], 3: ['#00ff9c', '#001a10'], 0: ['#aaa', '#111'],
    };
    const [fg, bg] = fallbackColors[rarity] || fallbackColors[0];
    return `<a class="${cls} tl-modal-chip--link" href="https://www.prydwen.gg/re1999/characters/${charToSlug(n)}" target="_blank" rel="noopener" title="${t('prydwenLabel')}">
      <span class="tl-chip-avatar" data-src="static/characters/${n.replace(/ /g, '_')}.webp"
            data-letter="${n.trim()[0] || '?'}" data-fg="${fg}" data-bg="${bg}"></span>
      ${n}
    </a>`;
  }).join('');

  const overlay     = document.createElement('div');
  overlay.className = 'tl-modal-overlay';
  overlay.addEventListener('click', e => { if (e.target === overlay) closeModal(); });

  overlay.innerHTML = `
    <div class="tl-modal">
      <div class="tl-modal-img-wrap${hasBannerImage(b) ? '' : ' tl-modal-img-wrap--placeholder'}">
        ${hasBannerImage(b) ? `<img src="${escapeHTML(b.image)}" alt="${escapeHTML(info.name)}" onerror="this.closest('.tl-modal-img-wrap').classList.add('tl-modal-img-wrap--placeholder');this.remove()">` : ''}
        ${bannerPlaceholderHTML(info, typeClass, 'tl-modal-img-placeholder')}
        <div class="tl-modal-img-gradient"></div>
        <button class="tl-modal-close">✕</button>
      </div>
      <div class="tl-modal-body">
        <div class="tl-modal-header">
          <div>
            <div class="tl-modal-title">${info.name}</div>
            <div class="tl-modal-dates">${formatTimelineDate(startMs, MONTHS_FULL)} — ${formatTimelineDate(endMs, MONTHS_FULL)}</div>
          </div>
          <div class="tl-modal-countdown-wrap">
            <span class="tl-modal-countdown-label" id="${labelId}">${t('modalCountdownLabel')}</span>
            <div class="tl-modal-timer" id="${timerId}">—</div>
          </div>
        </div>
        ${rateUpChips.length ? `
          <div class="tl-modal-section-title">${t('bannerCharacters')}</div>
          <div class="tl-modal-chips">${rateUpChips}</div>` : ''}
        ${bannerPullsSectionHTML(b)}
      </div>
    </div>`;

  overlay.querySelector('.tl-modal-close').addEventListener('click', closeModal);
  document.body.appendChild(overlay);

  overlay.querySelectorAll('.tl-chip-avatar').forEach(el => {
    const img   = new Image();
    img.onload  = () => {
      el.style.backgroundImage    = `url(${el.dataset.src})`;
      el.style.backgroundSize     = 'cover';
      el.style.backgroundPosition = 'center';
      el.style.backgroundColor    = 'transparent';
      el.textContent              = '';
    };
    img.onerror = () => {
      el.textContent           = el.dataset.letter;
      el.style.color           = el.dataset.fg;
      el.style.backgroundColor = el.dataset.bg;
      el.style.fontWeight      = '700';
      el.style.fontSize        = '11px';
      el.style.display         = 'flex';
      el.style.alignItems      = 'center';
      el.style.justifyContent  = 'center';
    };
    img.src = el.dataset.src;
  });

  const onKey     = e => { if (e.key === 'Escape') closeModal(); };
  const modalTick = setInterval(updateModalTimer, 1000);
  document.addEventListener('keydown', onKey);

  function closeModal() {
    overlay.style.opacity    = '0';
    overlay.style.transition = 'opacity 0.15s';
    setTimeout(() => overlay.remove(), 150);
    document.removeEventListener('keydown', onKey);
    clearInterval(modalTick);
  }

  function updateModalTimer() {
    const el      = document.getElementById(timerId);
    const labelEl = document.getElementById(labelId);
    if (!el) return;
    const countdown = getBannerCountdownState(startMs, endMs);
    if (countdown.state === 'ended') { el.textContent = t('modalEnded'); return; }
    if (labelEl) labelEl.textContent = countdown.modalLabel;
    el.textContent = fmtTimer(countdown.diff);
    const urgency =
      countdown.state === 'active' &&
      (countdown.diff < TIME.MS_HOUR ? ' ending-very-soon' :
       countdown.diff < TIME.MS_DAY  ? ' ending-soon' : '');
    el.className   = 'tl-modal-timer' +
      (countdown.state === 'upcoming' ? ' upcoming' : '') +
      urgency;
  }
  updateModalTimer();
}

function _updateGdriveUILang() {
  const status = document.getElementById('gdriveStatus');
  if (!status) return;
  if (status.classList.contains('connected')) {
    status.innerHTML = status.classList.contains('syncing')
      ? `<span class="gdrive-spinner"></span>${t('gdriveSyncing')}`
      : t('gdriveConnected');
  } else if (status.classList.contains('expired')) {
    status.innerHTML = t('gdriveExpired');
  } else {
    status.innerHTML = t('gdriveNotConnected');
  }
  const connectBtn    = document.getElementById('gdriveSignInBtn');
  const disconnectBtn = document.getElementById('gdriveSignOutBtn');
  if (connectBtn)    connectBtn.textContent    = t('gdriveConnect');
  if (disconnectBtn) disconnectBtn.textContent = t('gdriveDisconnect');
}