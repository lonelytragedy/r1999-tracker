const GDRIVE_CLIENT_ID   = '579096807032-2u5js0g94p8n4h2a8ugjckari71stsut.apps.googleusercontent.com';
const GDRIVE_SCOPE       = 'https://www.googleapis.com/auth/drive.appdata';
const GDRIVE_FILE_NAME   = 'r1999_tracker_db.json';
const GDRIVE_AUTOSAVE_MS = 2000;

let gdriveToken       = null;
let gdriveFileId      = null;
let gdriveTokenClient = null;
let _autoSaveTimer    = null;

function gdriveInit() {
  if (!window.google?.accounts?.oauth2) {
    console.warn('GIS SDK not loaded yet');
    return;
  }

  gdriveTokenClient = google.accounts.oauth2.initTokenClient({
    client_id: GDRIVE_CLIENT_ID,
    scope:     GDRIVE_SCOPE,
    callback:  _onTokenResponse,
  });

  const saved = localStorage.getItem('gdrive_token');
  if (!saved) return;

  gdriveToken = JSON.parse(saved);
  _updateGdriveUI(true);

  if (_isTokenValid()) {
    gdriveLoad();
  } else {
    gdriveTokenClient.requestAccessToken({
      prompt:   '',
      callback: resp => {
        if (resp.error) {
          gdriveToken = null;
          localStorage.removeItem('gdrive_token');
          _updateGdriveUI(false);
          return;
        }
        gdriveToken = {
          access_token: resp.access_token,
          expires_at:   Date.now() + (resp.expires_in - 60) * 1000
        };
        localStorage.setItem('gdrive_token', JSON.stringify(gdriveToken));
        gdriveLoad();
      }
    });
  }
}

function _onTokenResponse(resp) {
  if (resp.error) {
    console.error('GIS token error:', resp);
    showToast(t('gdriveAuthError', resp.error), 'error', 5000);
    return;
  }
  gdriveToken = {
    access_token: resp.access_token,
    expires_at:   Date.now() + (resp.expires_in - 60) * 1000
  };
  localStorage.setItem('gdrive_token', JSON.stringify(gdriveToken));
  gdriveFileId = null;
  _updateGdriveUI(true);
  showToast(t('gdriveConnectedMsg'), 'success');
  gdriveLoad();
}

function gdriveSignIn() {
  if (!gdriveTokenClient) { showToast(t('gdriveSDKError'), 'error'); return; }
  gdriveTokenClient.requestAccessToken({ prompt: '' });
}

function gdriveSignOut() {
  if (gdriveToken?.access_token) {
    google.accounts.oauth2.revoke(gdriveToken.access_token, () => {});
  }
  gdriveToken  = null;
  gdriveFileId = null;
  clearTimeout(_autoSaveTimer);
  localStorage.removeItem('gdrive_token');
  _updateGdriveUI(false);
  showToast(t('gdriveDisconnectedMsg'), 'info');
}

function _isTokenValid() {
  return gdriveToken && Date.now() < gdriveToken.expires_at;
}

async function _ensureToken() {
  if (_isTokenValid()) return true;
  return new Promise(resolve => {
    gdriveTokenClient.requestAccessToken({
      prompt:   '',
      callback: resp => {
        if (resp.error) { resolve(false); return; }
        gdriveToken = {
          access_token: resp.access_token,
          expires_at:   Date.now() + (resp.expires_in - 60) * 1000
        };
        localStorage.setItem('gdrive_token', JSON.stringify(gdriveToken));
        resolve(true);
      }
    });
  });
}

function gdriveScheduleSave() {
  if (!gdriveToken) return;
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
  if (!_isTokenValid()) {
    const ok = await _ensureToken();
    if (!ok) return;
  }

  _setSyncing(true);

  try {
    const freshProfiles = JSON.parse(localStorage.getItem('r1999_profiles') || '[]');
    const pulls = {};
    freshProfiles.forEach(p => {
      pulls[p.id] = JSON.parse(localStorage.getItem(`r1999_cache_${p.id}`) || '[]');
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
  if (!_isTokenValid()) return;

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

window.addEventListener('load', () => {
  const ready = () => {
    if (window.google?.accounts?.oauth2) gdriveInit();
    else setTimeout(ready, 100);
  };
  ready();
});
