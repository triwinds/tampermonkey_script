document.addEventListener('DOMContentLoaded', () => {
  const btn = document.getElementById('refresh');
  const toggle = document.getElementById('allowExternalControl');
  btn.addEventListener('click', fetchCookies);
  toggle.addEventListener('change', onToggleExternalControl);
  refreshControlState();
  fetchCookies();
});

async function refreshControlState() {
  const bridgeStatus = document.getElementById('bridgeStatus');
  const toggle = document.getElementById('allowExternalControl');
  const toggleText = document.getElementById('toggleText');

  try {
    const resp = await chrome.runtime.sendMessage({ cmd: 'controlState', method: 'get' });
    if (!resp?.ok) {
      bridgeStatus.textContent = '状态读取失败: ' + (resp?.error || 'unknown');
      return;
    }

    applyControlState(resp.data);
  } catch (e) {
    toggle.disabled = true;
    toggleText.textContent = '不可用';
    bridgeStatus.textContent = '状态读取失败: ' + e.message;
  }
}

async function onToggleExternalControl(event) {
  const toggle = event.currentTarget;
  const bridgeStatus = document.getElementById('bridgeStatus');
  const previous = !toggle.checked;

  toggle.disabled = true;
  bridgeStatus.textContent = '正在更新设置...';

  try {
    const resp = await chrome.runtime.sendMessage({
      cmd: 'controlState',
      method: 'set',
      allow: toggle.checked,
    });
    if (!resp?.ok) {
      toggle.checked = previous;
      bridgeStatus.textContent = '设置失败: ' + (resp?.error || 'unknown');
      return;
    }

    applyControlState(resp.data);
  } catch (e) {
    toggle.checked = previous;
    bridgeStatus.textContent = '设置失败: ' + e.message;
  } finally {
    toggle.disabled = false;
  }
}

function applyControlState(data) {
  const toggle = document.getElementById('allowExternalControl');
  const toggleText = document.getElementById('toggleText');
  const bridgeStatus = document.getElementById('bridgeStatus');
  const allowExternalControl = data?.allowExternalControl !== false;

  toggle.checked = allowExternalControl;
  toggle.disabled = false;
  toggleText.textContent = allowExternalControl ? '已开启' : '已关闭';
  bridgeStatus.textContent = allowExternalControl
    ? (data?.wsConnected ? '外部控制已开启，本地桥接已连接。' : '外部控制已开启，等待本地桥接连接。')
    : '外部控制已关闭。';
}

async function fetchCookies() {
  const out = document.getElementById('out');
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url) {
      out.textContent = 'No active tab';
      return;
    }
    if (!TMWDCookieUtils.isSupportedCookieUrl(tab.url)) {
      out.textContent = TMWDCookieUtils.cookieErrorMessage(tab.url);
      return;
    }

    const resp = await chrome.runtime.sendMessage({ cmd: 'cookies', url: tab.url });
    if (!resp?.ok) {
      out.textContent = 'Error: ' + (resp?.error || 'unknown');
      return;
    }
    if (!resp.data.length) {
      out.textContent = '(no cookies)';
      return;
    }

    out.textContent = resp.data.map(c =>
      `${c.name}=${c.value}` +
      (c.httpOnly ? ' [H]' : '') +
      (c.secure ? ' [S]' : '') +
      (c.partitionKey ? ' [P]' : '')
    ).join('\n');

    const cookieString = resp.data.map(c => `${c.name}=${c.value}`).join('; ');
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(cookieString);
    }
  } catch (e) {
    out.textContent = 'Error: ' + e.message;
  }
}
