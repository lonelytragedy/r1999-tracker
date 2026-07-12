const GDRIVE_CLIENT_ID   = '579096807032-2u5js0g94p8n4h2a8ugjckari71stsut.apps.googleusercontent.com';
const GDRIVE_SCOPE       = 'https://www.googleapis.com/auth/drive.appdata';
const GDRIVE_FILE_NAME   = 'r1999_tracker_db.json';
const GDRIVE_AUTOSAVE_MS = 2000;
const GDRIVE_WORKER      = 'https://r1999tracker.posofrefraction.workers.dev';

let gdriveToken      = null;
let gdriveRefresh    = null;
let gdriveFileId     = null;
let gdriveCodeClient = null;
let _autoSaveTimer   = null;
let _pendingSave     = false;

const GDRIVE_IN_APP = !!(window.AndroidBridge && window.AndroidBridge.connectDrive);

function gdriveInit() {
  gdriveRefresh = localStorage.getItem('gdrive_refresh') || null;
  const savedTok = localStorage.getItem('gdrive_token');
  if (savedTok) {
    try { gdriveToken = JSON.parse(savedTok); } catch { gdriveToken = null; }
  }

  if (!GDRIVE_IN_APP) {
    if (!window.google?.accounts?.oauth2) {
      console.warn('GIS SDK not loaded yet');
      return;
    }
    gdriveCodeClient = google.accounts.oauth2.initCodeClient({
      client_id: GDRIVE_CLIENT_ID,
      scope:     GDRIVE_SCOPE,
      ux_mode:   'popup',
      callback:  _onCodeResponse,
      error_callback: err => {
        console.warn('GIS popup error:', err);
        showToast(t('gdriveAuthError', err.type || 'popup blocked'), 'error', 5000);
      },
    });
  }

  if (!gdriveRefresh) {
    if (_isTokenValid()) {
      _updateGdriveUI(true);
      gdriveLoad();
    } else if (gdriveToken) {
      _setExpiredUI();
    }
    return;
  }

  _updateGdriveUI(true);
  _ensureToken().then(ok => ok ? gdriveLoad() : _setExpiredUI());
}

window.__driveConnected = function (refreshToken) {
  if (refreshToken) {
    gdriveRefresh = refreshToken;
    localStorage.setItem('gdrive_refresh', refreshToken);
  }
  gdriveToken = null;
  gdriveFileId = null;
  _updateGdriveUI(true);
  showToast(t('gdriveConnectedMsg'), 'success');
  _ensureToken().then(ok => ok ? gdriveLoad() : _setExpiredUI());
};

window.__driveRestore = function (refreshToken) {
  if (!refreshToken) return;
  gdriveRefresh = refreshToken;
  localStorage.setItem('gdrive_refresh', refreshToken);
  _updateGdriveUI(true);
  _ensureToken().then(ok => ok ? gdriveLoad() : _setExpiredUI());
};

window.__driveDisconnected = function () {
  gdriveSignOut();
};

function gdriveSignIn() {
  if (GDRIVE_IN_APP) { window.AndroidBridge.connectDrive(); return; }
  if (!gdriveCodeClient) { showToast(t('gdriveSDKError'), 'error'); return; }
  gdriveCodeClient.requestCode();
}

function gdriveSignOut() {
  if (!GDRIVE_IN_APP && gdriveToken?.access_token) {
    google.accounts.oauth2.revoke(gdriveToken.access_token, () => {});
  }
  if (GDRIVE_IN_APP && window.AndroidBridge.disconnectDrive) {
    window.AndroidBridge.disconnectDrive();
  }
  gdriveToken   = null;
  gdriveRefresh = null;
  gdriveFileId  = null;
  _pendingSave  = false;
  clearTimeout(_autoSaveTimer);
  localStorage.removeItem('gdrive_token');
  localStorage.removeItem('gdrive_refresh');
  _updateGdriveUI(false);
  showToast(t('gdriveDisconnectedMsg'), 'info');
}

async function _onCodeResponse(resp) {
  if (resp.error) {
    console.error('GIS code error:', resp);
    showToast(t('gdriveAuthError', resp.error), 'error', 5000);
    return;
  }
  try {
    const data = await _workerPost('/oauth/exchange', { code: resp.code });
    if (!data.access_token) throw new Error('no access_token');
    _storeAccess(data);
    if (data.refresh_token) {
      gdriveRefresh = data.refresh_token;
      localStorage.setItem('gdrive_refresh', gdriveRefresh);
    }
    gdriveFileId = null;
    _updateGdriveUI(true);
    showToast(t('gdriveConnectedMsg'), 'success');
    await gdriveLoad();
    if (_pendingSave) { _pendingSave = false; gdriveSave(); }
  } catch (err) {
    console.error('GDrive auth error:', err);
    showToast(t('gdriveAuthError', err.message || err), 'error', 5000);
    _setExpiredUI();
  }
}

function _storeAccess(data) {
  gdriveToken = {
    access_token: data.access_token,
    expires_at:   Date.now() + (data.expires_in - 60) * 1000,
  };
  localStorage.setItem('gdrive_token', JSON.stringify(gdriveToken));
}

function _isTokenValid() {
  return gdriveToken && Date.now() < gdriveToken.expires_at;
}

async function _ensureToken() {
  if (_isTokenValid()) return true;
  if (!gdriveRefresh)  return false;
  try {
    const data = await _workerPost('/oauth/refresh', { refresh_token: gdriveRefresh });
    if (!data.access_token) return false;
    _storeAccess(data);
    return true;
  } catch (err) {
    console.warn('GDrive refresh failed:', err);
    if (err.status === 400 || err.status === 401) {
      gdriveRefresh = null;
      localStorage.removeItem('gdrive_refresh');
    }
    return false;
  }
}

async function _workerPost(path, payload) {
  const res  = await fetch(GDRIVE_WORKER + path, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err  = new Error(data.error || ('HTTP ' + res.status));
    err.status = res.status;
    throw err;
  }
  return data;
}

function gdriveScheduleSave() {
  if (!gdriveRefresh && !gdriveToken) return;
  if (!navigator.onLine) { _pendingSave = true; _setOfflineUI(); return; }
  clearTimeout(_autoSaveTimer);
  _autoSaveTimer = setTimeout(() => gdriveSave(), GDRIVE_AUTOSAVE_MS);
}

async function _findFileId() {
  if (gdriveFileId) return gdriveFileId;
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=name='${GDRIVE_FILE_NAME}'&fields=files(id)&pageSize=1`,
    { headers: { Authorization: 'Bearer ' + gdriveToken.access_token } }
  );
  if (!res.ok) throw new Error('Drive list failed: ' + res.statusText);
  const data = await res.json();
  gdriveFileId = data.files?.[0]?.id || null;
  return gdriveFileId;
}

async function _downloadFile(fileId) {
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
    { headers: { Authorization: 'Bearer ' + gdriveToken.access_token } }
  );
  if (!res.ok) throw new Error('Download failed: ' + res.statusText);
  return res.json();
}

async function _createFile(content) {
  const meta = JSON.stringify({ name: GDRIVE_FILE_NAME, parents: ['appDataFolder'] });
  const body = new FormData();
  body.append('metadata', new Blob([meta],    { type: 'application/json' }));
  body.append('media',    new Blob([content], { type: 'application/json' }));
  const res = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id',
    { method: 'POST', headers: { Authorization: 'Bearer ' + gdriveToken.access_token }, body }
  );
  if (!res.ok) throw new Error('Create failed: ' + res.statusText);
  const data = await res.json();
  gdriveFileId = data.id;
  return gdriveFileId;
}

async function _updateFile(fileId, content) {
  const res = await fetch(
    `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`,
    {
      method:  'PATCH',
      headers: { Authorization: 'Bearer ' + gdriveToken.access_token, 'Content-Type': 'application/json' },
      body:    content
    }
  );
  if (!res.ok) throw new Error('Update failed: ' + res.statusText);
}

async function gdriveSave() {
  if (!navigator.onLine) {
    _pendingSave = true;
    _setOfflineUI();
    return;
  }
  if (!await _ensureToken()) {
    _pendingSave = true;
    _setExpiredUI();
    return;
  }

  _setSyncing(true);

  try {
    const freshProfiles = readJSONStorage('r1999_profiles', []);
    const pulls = {};
    freshProfiles.forEach(p => {
      pulls[p.id] = readCachedPulls(p.id);
    });

    const payload = JSON.stringify({
      version: 2,
      savedAt: new Date().toISOString(),
      profiles: freshProfiles,
      pulls
    }, null, 2);

    const fileId = await _findFileId();
    if (fileId) {
      await _updateFile(fileId, payload);
    } else {
      await _createFile(payload);
    }
  } catch (err) {
    console.error('GDrive save error:', err);
    showToast(t('gdriveSaveError', err.message), 'error', 5000);
  } finally {
    _setSyncing(false);
  }
}

async function gdriveLoad() {
  if (!navigator.onLine) return;
  if (!await _ensureToken()) return;

  _setSyncing(true);

  try {
    const fileId = await _findFileId();
    if (!fileId) return;

    const data = await _downloadFile(fileId);
    if (!data?.profiles || !data?.pulls) throw new Error(t('gdriveInvalidFile'));

    _resolveConflicts(data.profiles, data.pulls, data.savedAt, true);
  } catch (err) {
    console.error('GDrive load error:', err);
    showToast(t('gdriveLoadError', err.message), 'error', 5000);
  } finally {
    _setSyncing(false);
  }
}

function _updateGdriveUI(signedIn) {
  const status  = document.getElementById('gdriveStatus');
  const signIn  = document.getElementById('gdriveSignInBtn');
  const signOut = document.getElementById('gdriveSignOutBtn');
  if (!status) return;

  if (signedIn) {
    status.innerHTML      = t('gdriveConnected');
    status.className      = 'gdrive-status connected';
    signIn.style.display  = 'none';
    signOut.style.display = '';
  } else {
    status.innerHTML      = t('gdriveNotConnected');
    status.className      = 'gdrive-status';
    signIn.style.display  = '';
    signOut.style.display = 'none';
  }
}

function _setSyncing(active) {
  const status = document.getElementById('gdriveStatus');
  if (!status) return;
  if (active) {
    status.innerHTML = `<span class="gdrive-spinner"></span>${t('gdriveSyncing')}`;
    status.className = 'gdrive-status connected syncing';
  } else {
    status.innerHTML = t('gdriveConnected');
    status.className = 'gdrive-status connected';
  }
}

function _setExpiredUI() {
  const status  = document.getElementById('gdriveStatus');
  const signIn  = document.getElementById('gdriveSignInBtn');
  const signOut = document.getElementById('gdriveSignOutBtn');
  if (!status) return;
  if (!navigator.onLine) { _setOfflineUI(); return; }
  status.innerHTML = t('gdriveExpired');
  status.className = 'gdrive-status expired';
  if (signIn)  signIn.style.display  = '';
  if (signOut) signOut.style.display = 'none';
}

function _setOfflineUI() {
  const status  = document.getElementById('gdriveStatus');
  const signIn  = document.getElementById('gdriveSignInBtn');
  const signOut = document.getElementById('gdriveSignOutBtn');
  if (!status) return;
  status.innerHTML = t('gdriveOffline');
  status.className = 'gdrive-status offline';
  if (gdriveRefresh || gdriveToken) {
    if (signIn)  signIn.style.display  = 'none';
    if (signOut) signOut.style.display = '';
  }
}

window.addEventListener('offline', () => {
  if (gdriveRefresh || gdriveToken) _setOfflineUI();
});

window.addEventListener('online', () => {
  if (!(gdriveRefresh || gdriveToken)) return;
  _updateGdriveUI(true);
  _ensureToken().then(ok => {
    if (!ok) { _setExpiredUI(); return; }
    gdriveLoad().then(() => {
      if (_pendingSave) { _pendingSave = false; gdriveSave(); }
    });
  });
});

window.addEventListener('load', () => {
  const ready = () => {
    if (window.google?.accounts?.oauth2) gdriveInit();
    else setTimeout(ready, 100);
  };
  ready();
});
