let localDB = [];
let processedList = [];
let processedPity = [];
let chart = null;
let currentFilter = 0;
let profiles = [];
let currentProfile = null;

document.getElementById('fileInput').addEventListener('change', loadFromFile);
document.getElementById('dbInput').addEventListener('change', loadDBFile);

window.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.box').forEach(b => b.classList.add('visible'));
  loadProfiles();
});

function showToast(message, type = 'info', duration = 3000) {
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  
  document.body.appendChild(toast);
  setTimeout(() => toast.classList.add('show'), 10);
  
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

function validateImportData(data) {
  if (!data || typeof data !== 'object') {
    throw new Error('Файл повреждён или имеет неверный формат');
  }
  
  if (!data.data || !data.data.pageData || !Array.isArray(data.data.pageData)) {
    throw new Error('Неверная структура JSON. Ожидается формат истории круток Reverse 1999');
  }
  
  if (data.data.pageData.length > 0) {
    const sample = data.data.pageData[0];
    if (!sample.createTime || !sample.poolId || !sample.gainIds) {
      throw new Error('Данные не соответствуют формату истории круток');
    }
  }
  
  return true;
}

function validateDBData(data) {
  if (!Array.isArray(data)) {
    throw new Error('Файл базы данных повреждён');
  }
  
  if (data.length > 0) {
    const sample = data[0];
    if (!sample.createTime || !sample.poolId || !sample.gainIds) {
      throw new Error('Неверный формат базы данных');
    }
  }
  
  return true;
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
  const sel = document.getElementById('profileSelect');
  sel.innerHTML = '';
  profiles.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.name;
    if (p.id === currentProfile) opt.selected = true;
    sel.appendChild(opt);
  });
}

function switchProfile(id) {
  currentProfile = Number(id);
  localStorage.setItem('r1999_active_profile', currentProfile);
  loadProfileDB();
  showToast('Профиль переключён', 'info');
}

function loadProfileDB() {
  const cache = localStorage.getItem(`r1999_cache_${currentProfile}`);
  localDB = cache ? JSON.parse(cache) : [];
  parseData(localDB);
}

function addProfile() {
  const name = prompt('Введите имя профиля:');
  if (!name) return;

  const id = Date.now();
  profiles.push({ id, name });
  localStorage.setItem('r1999_profiles', JSON.stringify(profiles));

  currentProfile = id;
  localStorage.setItem('r1999_active_profile', id);

  renderProfileSelect();
  loadProfileDB();
  showToast(`Профиль "${name}" создан`, 'success');
}

function removeProfile() {
  if (profiles.length === 1 || currentProfile === 1) {
    showToast('Нельзя удалить стандартный профиль', 'warning');
    return;
  }

  if (!confirm('Удалить профиль и все его данные?')) return;

  localStorage.removeItem(`r1999_cache_${currentProfile}`);
  localStorage.removeItem(`r1999_meta_${currentProfile}`);
  profiles = profiles.filter(p => p.id !== currentProfile);

  currentProfile = profiles[0].id;
  localStorage.setItem('r1999_profiles', JSON.stringify(profiles));
  localStorage.setItem('r1999_active_profile', currentProfile);

  renderProfileSelect();
  loadProfileDB();
  showToast('Профиль удалён', 'info');
}

function normalizePulls(db) {
  const out = [];
  db.forEach(e => {
    if (Number(e.summonType) === 10 && e.gainIds.length === 10) {
      e.gainIds.forEach(id => out.push({ ...e, summonType: 1, gainIds: [id] }));
    } else {
      out.push({ ...e, summonType: 1 });
    }
  });
  return out;
}

function generateKey(e) {
  return `${e.createTime}_${e.poolId}_${e.gainIds.join('-')}`;
}

function mergeDatabases(oldDB, newDB) {
  const map = new Map();
  [...oldDB, ...newDB].forEach(e => map.set(generateKey(e), e));
  return [...map.values()].sort((a, b) => new Date(a.createTime) - new Date(b.createTime));
}

function loadFromFile(e) {
  const input = e.target;
  const file = input.files[0];
  
  if (!file) return;
  
  if (!file.name.endsWith('.json')) {
    showToast('Выберите JSON файл', 'error');
    input.value = '';
    return;
  }
  
  const reader = new FileReader();
  
  reader.onerror = () => {
    showToast('Ошибка чтения файла', 'error');
    input.value = '';
  };
  
  reader.onload = () => {
    try {
      const json = JSON.parse(reader.result);
      validateImportData(json);
      
      localDB = mergeDatabases(localDB, json.data.pageData);
      parseData(localDB);
      showToast('Данные успешно загружены', 'success');
      
      if (localDB.length > 0) {
        try {
          localStorage.setItem(`r1999_cache_${currentProfile}`, JSON.stringify(localDB));
          const meta = {
            lastSave: new Date().toISOString(),
            pullsCount: localDB.length
          };
          localStorage.setItem(`r1999_meta_${currentProfile}`, JSON.stringify(meta));
        } catch (err) {
          if (err.name === 'QuotaExceededError') {
            showToast('Недостаточно места в хранилище браузера', 'error');
          } else {
            console.error('Save error:', err);
          }
        }
      }
    } catch (err) {
      console.error('Import error:', err);
      showToast(`Ошибка импорта: ${err.message}`, 'error', 5000);
    } finally {
      input.value = '';
    }
  };
  
  reader.readAsText(file);
}

function loadDBFile(e) {
  const input = e.target;
  const file = input.files[0];
  
  if (!file) return;
  
  if (!file.name.endsWith('.json')) {
    showToast('Выберите JSON файл базы данных', 'error');
    input.value = '';
    return;
  }
  
  const reader = new FileReader();
  
  reader.onerror = () => {
    showToast('Ошибка чтения файла', 'error');
    input.value = '';
  };
  
  reader.onload = () => {
    try {
      const json = JSON.parse(reader.result);
      validateDBData(json);
      
      localDB = json;
      parseData(localDB);
      showToast('База данных загружена', 'success');
      
      localStorage.setItem(`r1999_cache_${currentProfile}`, JSON.stringify(localDB));
      const meta = {
        lastSave: new Date().toISOString(),
        pullsCount: localDB.length
      };
      localStorage.setItem(`r1999_meta_${currentProfile}`, JSON.stringify(meta));
    } catch (err) {
      console.error('DB load error:', err);
      showToast(`Ошибка загрузки: ${err.message}`, 'error', 5000);
    } finally {
      input.value = '';
    }
  };
  
  reader.readAsText(file);
}

function exportDB() {
  if (!localDB.length) {
    showToast('База пуста', 'warning');
    return;
  }
  
  const profileName = profiles.find(p => p.id === currentProfile)?.name || 'Profile';
  const timestamp = new Date().toISOString().slice(0, 10);
  const filename = `${profileName}_${timestamp}.json`;
  
  const blob = new Blob([JSON.stringify(localDB, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  showToast('База данных экспортирована', 'success');
}

function saveToCache() {
  if (!localDB.length) {
    showToast('База пуста', 'warning');
    return;
  }
  
  try {
    localStorage.setItem(`r1999_cache_${currentProfile}`, JSON.stringify(localDB));
    const meta = {
      lastSave: new Date().toISOString(),
      pullsCount: localDB.length
    };
    localStorage.setItem(`r1999_meta_${currentProfile}`, JSON.stringify(meta));
    showToast('База сохранена', 'success');
  } catch (err) {
    if (err.name === 'QuotaExceededError') {
      showToast('Недостаточно места в хранилище браузера', 'error');
    } else {
      showToast('Ошибка сохранения', 'error');
    }
  }
}

function deleteCache() {
  if (confirm('Удалить данные профиля?')) {
    localStorage.removeItem(`r1999_cache_${currentProfile}`);
    localStorage.removeItem(`r1999_meta_${currentProfile}`);
    localDB = [];
    parseData(localDB);
    showToast('Кеш очищен', 'info');
  }
}

function parseData(list) {
  processedList = normalizePulls(list);

  const monthly = {};
  const pityCounters = {};
  processedPity = [];

  processedList.forEach((e, i) => {
    pityCounters[e.poolId] ??= 1;
    processedPity[i] = pityCounters[e.poolId];

    const isSix = e.gainIds.some(id => getChar(id).rarity === 6);
    pityCounters[e.poolId] = isSix ? 1 : pityCounters[e.poolId] + 1;

    const m = e.createTime.slice(0, 7);
    monthly[m] ??= { 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
    e.gainIds.forEach(id => monthly[m][getChar(id).rarity]++);
  });

  renderStats();
  renderChart(monthly);
  renderRecentSixStars();
  renderTableFast();

  document.querySelectorAll('.box').forEach(b => b.classList.add('visible'));
  setTimeout(() => {
    document.querySelectorAll('.stat').forEach(s => s.classList.add('show'));
  }, 50);
}

function renderStats() {
  const pulls = processedList.length;
  let six = 0, sum = 0;

  processedList.forEach((e, i) => {
    if (getChar(e.gainIds[0]).rarity === 6) {
      six++;
      sum += processedPity[i];
    }
  });

  document.getElementById('stats').innerHTML = `
    <div class="stat">Всего круток<br><b>${pulls}</b></div>
    <div class="stat">Выпало 6★<br><b>${six}</b></div>
    <div class="stat">% 6★<br><b>${(six / pulls * 100 || 0).toFixed(2)}%</b></div>
    <div class="stat">Средний pity<br><b>${six ? Math.round(sum / six) : 0}</b></div>
  `;
}

function renderRecentSixStars() {
  const container = document.getElementById('recentSixStars');
  
  const sixStars = [];
  processedList.forEach((e, i) => {
    const char = getChar(e.gainIds[0]);
    if (char.rarity === 6) {
      sixStars.push({
        char: char,
        id: e.gainIds[0],
        pity: processedPity[i],
        date: e.createTime
      });
    }
  });
  
  if (sixStars.length === 0) {
    container.innerHTML = '<div class="recent-six-stars-placeholder">🌟 Здесь появятся ваши последние 6★ персонажи</div>';
    return;
  }
  
  const recent = sixStars.slice().reverse();
  container.innerHTML = '';
  
  recent.forEach((item) => {
    const card = document.createElement('div');
    const colorClass = item.pity <= 30 ? 'pity-color-green' : 
                       item.pity <= 55 ? 'pity-color-yellow' : 
                       'pity-color-red';
    
    card.className = `six-star-card ${colorClass}`;
    const portraitPath = `icons/${item.char.name.replace(/\s+/g, '_')}.webp`;
    
    card.innerHTML = `
      <div class="six-star-portrait">
        <img src="${portraitPath}" alt="${item.char.name}" onerror="this.style.display='none'; this.parentElement.textContent='${item.char.name}';">
      </div>
      <div class="six-star-pity">${item.pity}</div>
      <div class="six-star-name">${item.char.name}</div>
    `;
    
    container.appendChild(card);
    card.classList.add('show');
  });
}

function renderTablePlaceholder(msg = '📂 Здесь пока нет данных') {
  const tbody = document.getElementById('table');
  tbody.innerHTML = `<tr class="show"><td colspan="4" style="text-align:center; padding:30px; color:#9aa0a6; font-size:18px;">${msg}</td></tr>`;
}

function renderTableFast() {
  const filtered = processedList.filter(e => !currentFilter || getChar(e.gainIds[0]).rarity === currentFilter);

  if (!filtered.length) {
    renderTablePlaceholder(currentFilter ? `📂 Нет данных для ★${currentFilter}` : undefined);
    return;
  }

  const tbody = document.getElementById('table');
  tbody.innerHTML = '';
  
  const fragment = document.createDocumentFragment();
  const rows = [];

  filtered.slice().reverse().forEach(e => {
    const pity = processedPity[processedList.indexOf(e)];
    const c = getChar(e.gainIds[0]);

    const tr = document.createElement('tr');
    tr.className = pityColor(pity);
    tr.innerHTML = `
      <td>${e.createTime}</td>
      <td>${getBannerName(e.poolName)}</td>
      <td>${pity}</td>
      <td><span class="r${c.rarity}">${c.name} ★${c.rarity}</span></td>
    `;

    fragment.appendChild(tr);
    rows.push(tr);
  });

  tbody.appendChild(fragment);

  let index = 0;
  const batchSize = 30;

  function animateBatch() {
    const batch = rows.slice(index, index + batchSize);
    batch.forEach(tr => tr.classList.add('show'));
    index += batchSize;
    
    if (index < rows.length) {
      requestAnimationFrame(animateBatch);
    }
  }

  requestAnimationFrame(animateBatch);
}

function pityColor(v) {
  return v <= 30 ? 'pity-green' : v <= 55 ? 'pity-yellow' : 'pity-red';
}

function renderChart(monthly) {
  const labels = Object.keys(monthly).sort();
  const hasData = labels.some(m => Object.values(monthly[m]).some(v => v > 0));

  if (!hasData) {
    if (chart) chart.destroy();
    chart = null;
    const canvas = document.getElementById('chart');
    const ctx = canvas.getContext('2d');
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#9aa0a6';
    ctx.font = '24px system-ui';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('📊 Здесь появится график статистики', canvas.width / 2, canvas.height / 2 - 14);
    ctx.fillText('после загрузки данных', canvas.width / 2, canvas.height / 2 + 14);
    return;
  }

  const colors = { 2: '#9aa0a6', 3: '#00ff9c', 4: '#00c8ff', 5: '#ffd54a', 6: '#ff4d5a' };
  const datasets = [2, 3, 4, 5, 6].map(r => ({
    label: `★${r}`,
    data: labels.map(m => monthly[m][r]),
    borderColor: colors[r],
    tension: .35,
    borderWidth: 2,
    pointRadius: 3,
    pointHoverRadius: 6
  }));

  if (chart) chart.destroy();

  chart = new Chart(document.getElementById('chart'), {
    type: 'line',
    data: { labels, datasets },
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

function filterByRarity(r, btn) {
  currentFilter = r;
  document.querySelectorAll('.filter-bar button').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderTableFast();
}
