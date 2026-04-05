const PROXY             = 'https://r1999tracker.posofrefraction.workers.dev/';
const PITY_MAX          = 70;
const PITY_COLOR_YELLOW = 50;
const PITY_COLOR_RED    = 60;
const BANNER_TYPE_LABELS  = { Limited: 'Limited Event', Character: 'Character Event', Water: 'Water', Regular: 'Regular', Special: 'Special' };
const BANNER_TYPE_CLASSES = { Limited: 'type-limited',  Character: 'type-character',  Water: 'type-water',  Regular: 'type-regular', Special: 'type-special' };

let localDB               = [];
let processedList         = [];
let processedPity         = [];
let processedPityCounters = {};
let chart                 = null;
let currentFilter         = 0;
let currentTypeFilter     = null;
let profiles              = [];
let currentProfile        = null;

document.getElementById('fileInput').addEventListener('change', loadFromFile);
document.getElementById('dbInput').addEventListener('change', loadDBFile);

window.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.box').forEach(b => b.classList.add('visible'));
  loadProfiles();
  renderActiveBanners();

  const tb = document.getElementById('table');
  tb.addEventListener('mouseover', ev => {
    const tr = ev.target.closest('tr');
    const gid = tr?.dataset.group;
    if (!gid) return;
    tb.querySelectorAll(`tr[data-group="${CSS.escape(gid)}"]`).forEach(r => r.classList.add('group-hover'));
  });
  tb.addEventListener('mouseout', ev => {
    const tr = ev.target.closest('tr');
    const gid = tr?.dataset.group;
    if (!gid) return;
    tb.querySelectorAll(`tr[data-group="${CSS.escape(gid)}"]`).forEach(r => r.classList.remove('group-hover'));
  });
});

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
  const el = document.getElementById('top-bar');
  let finishTimer = null;
  let startTime = 0;
  const MIN_MS = 400;

  function start(work) {
    clearTimeout(finishTimer);
    el.style.width = '0%';
    el.classList.remove('finishing', 'running');
    startTime = Date.now();

    requestAnimationFrame(() => {
      el.style.width = '70%';
      el.classList.add('running');
      if (work) requestAnimationFrame(work);
    });
  }

  function finish() {
    const elapsed = Date.now() - startTime;
    const delay = Math.max(0, MIN_MS - elapsed);
    clearTimeout(finishTimer);
    finishTimer = setTimeout(() => {
      el.classList.add('finishing');
      el.classList.remove('running');
      finishTimer = setTimeout(() => {
        el.style.width = '0%';
        el.classList.remove('finishing');
      }, 650);
    }, delay);
  }

  return { start, finish };
})();

function renderActiveBanners() {
  const container = document.getElementById('activeBanners');
  const box       = document.getElementById('activeBannersBox');
  if (!container || !box) return;

  if (!ACTIVE_BANNERS.length) {
    box.style.display = 'none';
    return;
  }

  container.innerHTML = '';

  const timerEls = [];

  ACTIVE_BANNERS.forEach(b => {
    const info      = BANNERS[b.key] || { name: b.key, type: 'Character' };
    const endTime   = new Date(b.endUTC);
    const typeClass = BANNER_TYPE_CLASSES[info.type] || 'type-other';

    const card = document.createElement('div');
    card.className = 'active-banner-card';

    const typeBadge = document.createElement('div');
    typeBadge.className = 'active-banner-type-overlay';
    typeBadge.innerHTML = `<span class="banner-type ${typeClass}">${info.type}</span>`;

    const imgEl = document.createElement('img');
    imgEl.className = 'active-banner-img';
    imgEl.alt = info.name;
    imgEl.addEventListener('error', () => {
      const ph = document.createElement('div');
      ph.className = 'active-banner-img-placeholder';
      ph.textContent = '🎴';
      card.replaceChild(ph, imgEl);
    });
    imgEl.src = b.image;

    const rateUpHTML = b.rateUp?.length
      ? `<div class="active-banner-rate-up">${b.rateUp.map(n => {
          const c = getCharByName(n);
          const cls = c ? `active-banner-rate-up-chip r${c.rarity}` : 'active-banner-rate-up-chip';
          return `<span class="${cls}">${n}</span>`;
        }).join('')}</div>`
      : '';

    const infoDiv = document.createElement('div');
    infoDiv.className = 'active-banner-info';
    infoDiv.innerHTML = `
      <div class="active-banner-name">${info.name}</div>
      ${rateUpHTML}
      <div class="active-banner-countdown">
        <span class="active-banner-countdown-label">До конца баннера</span>
        <span class="active-banner-timer" id="timer-${b.key}">—</span>
      </div>`;

    card.appendChild(typeBadge);
    card.appendChild(imgEl);
    card.appendChild(infoDiv);
    container.appendChild(card);

    timerEls.push({ el: document.getElementById(`timer-${b.key}`), endTime });
  });

  function tick() {
    const now = Date.now();

    for (let i = timerEls.length - 1; i >= 0; i--) {
      const { el, endTime } = timerEls[i];
      if (!el) { timerEls.splice(i, 1); continue; }
      const diff = endTime - now;

      if (diff <= 0) {
        const countdown = el.closest('.active-banner-countdown');
        if (countdown) countdown.innerHTML = '<span class="active-banner-expired">Баннер завершён</span>';
        timerEls.splice(i, 1);
        continue;
      }

      const d = Math.floor(diff / 86400000);
      const h = Math.floor((diff % 86400000) / 3600000);
      const m = Math.floor((diff % 3600000)  / 60000);
      const s = Math.floor((diff % 60000)    / 1000);

      const pad = n => String(n).padStart(2, '0');
      el.textContent = d > 0
        ? `${d}д ${pad(h)}:${pad(m)}:${pad(s)}`
        : `${pad(h)}:${pad(m)}:${pad(s)}`;

      el.className = 'active-banner-timer' +
        (diff < 3600000  ? ' ending-very-soon' :
         diff < 86400000 ? ' ending-soon' : '');
    }

    if (timerEls.length) setTimeout(tick, 1000);
  }

  tick();
}

function showToast(message, type = 'info', duration = 3000) {
  activeToast?._dismiss();

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
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
  activeToast = toast;
  return toast;
}

function saveToStorage() {
  try {
    localStorage.setItem(`r1999_cache_${currentProfile}`, JSON.stringify(localDB));
  } catch (err) {
    if (err.name === 'QuotaExceededError') {
      showToast('Недостаточно места в хранилище браузера', 'error');
    } else {
      console.error('Storage error:', err);
    }
  }
}

function loadProfiles() {
  profiles = JSON.parse(localStorage.getItem('r1999_profiles') || '[]');

  if (!profiles.length) {
    profiles = [{ id: 1, name: 'Основной' }];
    localStorage.setItem('r1999_profiles', JSON.stringify(profiles));
  }

  currentProfile = Number(localStorage.getItem('r1999_active_profile')) || profiles[0].id;
  renderProfileSelect();
  loadProfileDB();
}

function renderProfileSelect() {
  document.getElementById('profileSelect').innerHTML = profiles.map(p =>
    `<option value="${p.id}"${p.id === currentProfile ? ' selected' : ''}>${p.name}</option>`
  ).join('');
}

function switchProfile(id) {
  currentProfile = Number(id);
  localStorage.setItem('r1999_active_profile', currentProfile);
  loadProfileDB(true);
  showToast('Профиль переключён', 'info');
}

function loadProfileDB(withBar = false) {
  const cache = localStorage.getItem(`r1999_cache_${currentProfile}`);
  localDB = cache ? JSON.parse(cache) : [];
  if (withBar) {
    topBar.start(() => { parseData(localDB); topBar.finish(); });
  } else {
    parseData(localDB);
  }
}

function addProfile() {
  const name = prompt('Введите имя профиля:');
  if (!name) return;

  const id = Date.now();
  profiles.push({ id, name });
  currentProfile = id;
  localStorage.setItem('r1999_profiles', JSON.stringify(profiles));
  localStorage.setItem('r1999_active_profile', id);

  renderProfileSelect();
  loadProfileDB();
  showToast(`Профиль "${name}" создан`, 'success');
}

function removeProfile() {
  if (currentProfile === 1) {
    if (!confirm('Очистить данные стандартного профиля?')) return;
    localStorage.removeItem(`r1999_cache_${currentProfile}`);
    localDB = [];
    loadProfileDB(true);
    showToast('Стандартный профиль очищен', 'info');
    return;
  }

  if (profiles.length === 1) { showToast('Нельзя удалить единственный профиль', 'warning'); return; }
  if (!confirm('Удалить профиль и все его данные?')) return;

  localStorage.removeItem(`r1999_cache_${currentProfile}`);
  profiles = profiles.filter(p => p.id !== currentProfile);
  currentProfile = profiles[0].id;
  localStorage.setItem('r1999_profiles', JSON.stringify(profiles));
  localStorage.setItem('r1999_active_profile', currentProfile);

  renderProfileSelect();
  loadProfileDB(true);
  showToast('Профиль удалён', 'info');
}

function validateImportData(data) {
  if (!data?.data?.pageData || !Array.isArray(data.data.pageData))
    throw new Error('Неверная структура JSON. Ожидается формат истории круток Reverse 1999');
  const s = data.data.pageData[0];
  if (s && (!s.createTime || !s.poolId || !s.gainIds))
    throw new Error('Данные не соответствуют формату истории круток');
}

function validateDBData(data) {
  if (!Array.isArray(data)) throw new Error('Файл базы данных повреждён');
  const s = data[0];
  if (s && (!s.createTime || !s.poolId || !s.gainIds))
    throw new Error('Неверный формат базы данных');
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
    showToast('Выберите JSON файл', 'error');
    input.value = '';
    return;
  }

  const reader = new FileReader();
  reader.onerror = () => { showToast('Ошибка чтения файла', 'error'); input.value = ''; };
  reader.onload = () => {
    try {
      onSuccess(JSON.parse(reader.result));
    } catch (err) {
      console.error('File read error:', err);
      showToast(`Ошибка: ${err.message}`, 'error', 5000);
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
      const added = processedList.length - before;
      if (added === 0) {
        showToast('Все крутки уже есть в базе, новых записей не добавлено', 'warning');
      } else {
        showToast(`Добавлено ${added} новых круток (всего ${processedList.length})`, 'success');
      }
    });
  });
}

async function loadFromURL() {
  const url = document.getElementById('urlInput').value.trim();
  if (!url)                    { showToast('Введите ссылку', 'warning'); return; }
  if (!url.startsWith('http')) { showToast('Неверный формат ссылки', 'error'); return; }

  const btn = document.querySelector('.url-import button');
  const originalText = btn.textContent;
  btn.disabled = true;
  btn.textContent = '⏳ Загрузка...';

  const loadingToast = showToast('Загрузка данных...', 'info', 60000);
  topBar.start();
  try {
    const res = await fetch(PROXY + '?url=' + encodeURIComponent(url));
    if (!res.ok) throw new Error(`Сервер вернул ошибку: ${res.status}`);

    const json = await res.json();
    loadingToast._dismiss();
    validateImportData(json);

    const before = countPulls(localDB);
    localDB = mergeDatabases(localDB, json.data.pageData);
    parseData(localDB);
    saveToStorage();
    const added = processedList.length - before;
    if (added === 0) {
      showToast('Все крутки уже есть в базе, новых записей не добавлено', 'warning', 4000);
    } else {
      showToast(`Добавлено ${added} новых круток (всего ${processedList.length})`, 'success', 4000);
    }
  } catch (err) {
    loadingToast._dismiss();
    console.error('URL import error:', err);
    showToast(`Ошибка импорта: ${err.message}`, 'error', 5000);
  } finally {
    topBar.finish();
    btn.disabled = false;
    btn.textContent = originalText;
  }
}

function loadDBFile(e) {
  readJSONFile(e.target, json => {
    validateDBData(json);
    localDB = json;
    topBar.start(() => {
      parseData(localDB);
      saveToStorage();
      topBar.finish();
      showToast('База данных загружена', 'success');
    });
  });
}

function exportDB() {
  if (!localDB.length) { showToast('База пуста', 'warning'); return; }

  const profileName = profiles.find(p => p.id === currentProfile)?.name || 'Profile';
  const filename = `${profileName}_${new Date().toISOString().slice(0, 10)}.json`;
  const blob = new Blob([JSON.stringify(localDB, null, 2)], { type: 'application/json' });
  const objectURL = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objectURL;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(objectURL);
  showToast('База данных экспортирована', 'success');
}

function parseData(list) {
  processedList = normalizePulls(list);
  processedPity = [];

  const pityCounters = {};
  const monthly      = {};

  processedList.forEach((e, i) => {
    const key  = getPityKey(e);
    const char = getChar(e.gainIds[0]);
    pityCounters[key] ??= 1;
    processedPity[i]   = pityCounters[key];

    pityCounters[key] = char.rarity === 6 ? 1 : pityCounters[key] + 1;

    const month = e.createTime.slice(0, 7);
    monthly[month] ??= { 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
    monthly[month][char.rarity]++;
  });

  processedPityCounters = pityCounters;

  const hasData = processedList.length > 0;

  renderBannerStats();
  ['statsBox', 'recentSixStarsBox', 'chartBox'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = hasData ? '' : 'none';
  });

  if (hasData) {
    renderStats();
    renderChart(monthly);
    renderRecentSixStars();
  }

  renderTable();
  setTimeout(() => document.querySelectorAll('.stat').forEach(s => s.classList.add('show')), 50);
}

function renderBannerStats() {
  const container = document.getElementById('bannerStats');
  if (!container) return;

  const typeData = {};
  Object.keys(BANNER_TYPE_LABELS).forEach(t => { typeData[t] = { pulls: 0, lastKeyIdx: {} }; });

  processedList.forEach((e, i) => {
    const type = getBannerType(e.poolName);
    if (!typeData[type]) return;
    typeData[type].pulls++;
    typeData[type].lastKeyIdx[getPityKey(e)] = i;
  });

  container.innerHTML = '';

  const activeTypes = Object.entries(BANNER_TYPE_LABELS).filter(([type]) => typeData[type]?.pulls > 0);
  container.style.setProperty('--banner-col-count', activeTypes.length || 1);

  activeTypes.forEach(([type, label]) => {
    const data = typeData[type];

    let latestKey = null, latestIdx = -1;
    for (const [key, idx] of Object.entries(data.lastKeyIdx)) {
      if (idx > latestIdx) { latestIdx = idx; latestKey = key; }
    }

    const currentPity = latestKey !== null ? (processedPityCounters[latestKey] ?? 1) - 1 : 0;
    const typeTag     = `<span class="banner-type ${BANNER_TYPE_CLASSES[type]}">${type}</span>`;
    const card        = document.createElement('div');
    card.className    = 'banner-stat-card';

    const pityColorCls = currentPity < PITY_COLOR_YELLOW ? 'pity-val-green' : currentPity < PITY_COLOR_RED ? 'pity-val-yellow' : 'pity-val-red';
    card.innerHTML = `
      <div class="banner-stat-card-title">${typeTag} ${label}</div>
      <div class="banner-stat-item">
        <div class="banner-stat-label">
          Круток за всё время
          <span class="sub"><img src="static/ui/ClearDrop.webp" alt="💎" onerror="this.outerHTML='💎'"> ${(data.pulls * 180).toLocaleString('ru-RU')}</span>
        </div>
        <div class="banner-stat-value">${data.pulls}</div>
      </div>
      <div class="banner-stat-item">
        <div class="banner-stat-pity-label">
          6★ Гарант
          <span class="pity-hint">Гарант на ${PITY_MAX} крутке</span>
        </div>
        <div class="banner-stat-pity-value ${pityColorCls}">${currentPity} / ${PITY_MAX}</div>
      </div>`;

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

  const pulls = processedList.length;
  document.getElementById('stats').innerHTML = `
    <div class="stat">Всего круток<br><b>${pulls}</b></div>
    <div class="stat">Выпало 6★<br><b>${sixCount}</b></div>
    <div class="stat">% 6★<br><b>${(sixCount / pulls * 100 || 0).toFixed(2)}%</b></div>
    <div class="stat">Средний pity<br><b>${sixCount ? Math.round(pitySum / sixCount) : 0}</b></div>
  `;
}

function renderRecentSixStars() {
  const container = document.getElementById('recentSixStars');

  const sixStars = processedList
    .map((e, i) => ({ char: getChar(e.gainIds[0]), pity: processedPity[i] }))
    .filter(item => item.char.rarity === 6)
    .reverse();

  if (!sixStars.length) {
    container.innerHTML = '<div class="recent-six-stars-placeholder">🌟 Здесь появятся ваши последние 6★ персонажи</div>';
    return;
  }

  container.innerHTML = '';

  sixStars.forEach(item => {
    const colorClass = item.pity < PITY_COLOR_YELLOW ? 'pity-color-green' : item.pity < PITY_COLOR_RED ? 'pity-color-yellow' : 'pity-color-red';
    const imgSrc     = `static/characters/${item.char.name.replace(/\s+/g, '_')}.webp`;

    const card = document.createElement('div');
    card.className = `six-star-card ${colorClass} show`;

    const portrait = document.createElement('div');
    portrait.className = 'six-star-portrait';

    const img = document.createElement('img');
    img.src = imgSrc;
    img.alt = item.char.name;
    img.addEventListener('error', () => {
      img.style.display = 'none';
      portrait.textContent = item.char.name;
    });

    const pityBadge = document.createElement('div');
    pityBadge.className = 'six-star-pity';
    pityBadge.textContent = item.pity;

    const nameLabel = document.createElement('div');
    nameLabel.className = 'six-star-name';
    nameLabel.textContent = item.char.name;

    portrait.appendChild(img);
    card.appendChild(portrait);
    card.appendChild(pityBadge);
    card.appendChild(nameLabel);
    container.appendChild(card);
  });
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
    tb.innerHTML = `<tr class="show"><td colspan="6" style="text-align:center; padding:30px; color:#9aa0a6; font-size:18px;">📂 Здесь пока нет данных</td></tr>`;
    return;
  }

  const displayIndices = filtered.toReversed();

  const groupRole = displayIndices.map(() => null);
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
  const rows = [];

  displayIndices.forEach((origIdx, di) => {
    const e    = processedList[origIdx];
    const c    = getChar(e.gainIds[0]);
    const type = getBannerType(e.poolName);
    const gid  = e._groupId;
    const role = groupRole[di];

    const bracketCell = (role && !currentFilter && !currentTypeFilter)
      ? `<td class="group-bracket group-${role.replace('-label', '')}">${role.endsWith('-label') ? '<span>×10</span>' : ''}</td>`
      : '<td class="group-bracket-empty"></td>';

    const tr = document.createElement('tr');
    tr.className = pityRowColor(processedPity[origIdx]);
    if (gid) tr.dataset.group = gid;
    tr.innerHTML = `
      ${bracketCell}
      <td style="text-align:center; color:#9aa0a6; font-size:13px;">${origIdx + 1}</td>
      <td><span class="banner-type ${BANNER_TYPE_CLASSES[type] || 'type-other'}">${type}</span> ${getBannerName(e.poolName)}</td>
      <td>${processedPity[origIdx]}</td>
      <td><span class="r${c.rarity}">${c.name} ★${c.rarity}</span></td>
      <td style="text-align:right; color:#9aa0a6; font-size:13px; white-space:nowrap;">${e.createTime}</td>
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
  ctx.fillText('📊 Здесь появится график статистики', w / 2, h / 2 - 14);
  ctx.fillText('после загрузки данных',                w / 2, h / 2 + 14);
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
        pointHoverRadius: 6
      }))
    },
    options: {
      animation: false,
      plugins: { legend: { labels: { color: '#eaeaf0' } } },
      scales: {
        x: { ticks: { color: '#eaeaf0' }, grid: { display: false } },
        y: { ticks: { color: '#eaeaf0' }, grid: { display: false } }
      }
    }
  });
}
