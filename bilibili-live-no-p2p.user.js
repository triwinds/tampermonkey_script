// ==UserScript==
// @name         Bilibili Live No P2P Upload
// @namespace    https://tampermonkey.net/
// @version      1.1.0
// @description  Disable Bilibili Live P2P upload by blocking WebRTC APIs and forcing live playback URLs to non-P2P mode.
// @author       Codex
// @match        *://live.bilibili.com/*
// @match        *://*.live.bilibili.com/*
// @grant        none
// @run-at       document-start
// ==/UserScript==

(function () {
  'use strict';

  const BLOCKED_APIS = [
    'RTCPeerConnection',
    'webkitRTCPeerConnection',
    'mozRTCPeerConnection',
    'RTCDataChannel',
    'WebTransport',
  ];

  const LOG_PREFIX = '[Bilibili Live No P2P]';
  const STATE_KEY = '__bilibiliLiveNoP2PState__';
  const LEGACY_STATE_KEY = '__bilibiliLiveNoP2PBlocked__';
  const BILIBILI_HOST_RE = /(^|\.)bilibili\.com$|(^|\.)bilivideo\.com$|(^|\.)hdslb\.com$/i;
  const P2P_PARAM_RE = /(?:p2p|pcdn|mcdn|peer|webrtc|rtc|strategy_type)/i;

  if (window[STATE_KEY]) {
    return;
  }

  Object.defineProperty(window, STATE_KEY, {
    value: true,
    configurable: false,
    enumerable: false,
    writable: false,
  });

  try {
    Object.defineProperty(window, LEGACY_STATE_KEY, {
      value: true,
      configurable: false,
      enumerable: false,
      writable: false,
    });
  } catch (_) {
    // The old script version may already have installed this marker.
  }

  function createBlockedConstructor(apiName) {
    return function blockedWebRTCConstructor() {
      throw new DOMException(`${apiName} is disabled on Bilibili Live.`, 'NotSupportedError');
    };
  }

  function blockWindowApi(apiName) {
    try {
      delete window[apiName];
    } catch (_) {
      // Some browsers expose native WebRTC globals as non-deletable properties.
    }

    try {
      Object.defineProperty(window, apiName, {
        configurable: false,
        enumerable: false,
        get() {
          return undefined;
        },
        set() {
          return false;
        },
      });
      return true;
    } catch (_) {
      try {
        window[apiName] = createBlockedConstructor(apiName);
        return true;
      } catch (error) {
        console.warn(`${LOG_PREFIX} failed to block ${apiName}`, error);
        return false;
      }
    }
  }

  function isBilibiliUrl(url) {
    return BILIBILI_HOST_RE.test(url.hostname);
  }

  function hasP2PHint(value) {
    return typeof value === 'string' && P2P_PARAM_RE.test(value);
  }

  function sanitizeSearchParams(url) {
    let changed = false;

    if (url.searchParams.has('p2p_type')) {
      url.searchParams.set('p2p_type', '0');
      changed = true;
    }

    for (const key of ['enable_p2p', 'force_p2p', 'pcdn', 'mcdn']) {
      if (url.searchParams.has(key)) {
        url.searchParams.set(key, '0');
        changed = true;
      }
    }

    if (url.searchParams.has('strategy_types')) {
      const values = url.searchParams
        .get('strategy_types')
        .split(',')
        .map((value) => value.trim())
        .filter((value) => value && value !== '1');
      url.searchParams.set('strategy_types', values.length > 0 ? values.join(',') : '0');
      changed = true;
    }

    if (url.searchParams.has('strategy_type') && url.searchParams.get('strategy_type') === '1') {
      url.searchParams.set('strategy_type', '0');
      changed = true;
    }

    return changed;
  }

  function sanitizeUrl(value) {
    if (typeof value !== 'string' || !hasP2PHint(value)) {
      return value;
    }

    try {
      const url = new URL(value, window.location.href);
      if (!isBilibiliUrl(url) || !sanitizeSearchParams(url)) {
        return value;
      }
      return url.href;
    } catch (_) {
      return sanitizeUrlText(value);
    }
  }

  function sanitizeUrlText(text) {
    if (!hasP2PHint(text)) {
      return text;
    }

    return text
      .replace(/((?:[?&]|\\u0026|%26)p2p_type(?:=|%3D))1\b/gi, (_, prefix) => `${prefix}0`)
      .replace(/((?:[?&]|\\u0026|%26)(?:enable_p2p|force_p2p|pcdn|mcdn)(?:=|%3D))1\b/gi, (_, prefix) => `${prefix}0`)
      .replace(/((?:[?&]|\\u0026|%26)strategy_type(?:=|%3D))1\b/gi, (_, prefix) => `${prefix}0`)
      .replace(
        /((?:[?&]|\\u0026|%26)strategy_types(?:=|%3D))([^&"\\\s]+)/gi,
        (_, prefix, rawValue) => {
          const separator = rawValue.includes('%2C') || rawValue.includes('%2c') ? '%2C' : ',';
          const values = rawValue
            .split(/(?:,|%2C)/i)
            .map((value) => value.trim())
            .filter((value) => value && value !== '1');
          return `${prefix}${values.length > 0 ? values.join(separator) : '0'}`;
        },
      )
      .replace(/("p2p_type"\s*:\s*)1\b/gi, (_, prefix) => `${prefix}0`)
      .replace(/("enable_p2p"\s*:\s*)true\b/gi, '$1false')
      .replace(/("force_p2p"\s*:\s*)true\b/gi, '$1false');
  }

  function sanitizeFetchInput(input) {
    if (typeof input === 'string') {
      return sanitizeUrl(input);
    }

    if (input instanceof URL) {
      const sanitized = sanitizeUrl(input.href);
      return sanitized === input.href ? input : sanitized;
    }

    if (typeof Request === 'function' && input instanceof Request) {
      const sanitized = sanitizeUrl(input.url);
      return sanitized === input.url ? input : new Request(sanitized, input);
    }

    return input;
  }

  function shouldSanitizeResponse(response, requestedUrl) {
    const url = `${response.url || requestedUrl || ''}`;
    if (!hasP2PHint(url) && !/play-gateway|xlive\/.*\/url|master\/url/i.test(url)) {
      return false;
    }

    const contentType = response.headers && response.headers.get('content-type');
    return (
      /\.m3u8(?:[?#]|$)/i.test(url) ||
      /json|text|mpegurl|vnd\.apple\.mpegurl/i.test(contentType || '')
    );
  }

  async function sanitizeFetchResponse(response, requestedUrl) {
    if (!response || !shouldSanitizeResponse(response, requestedUrl)) {
      return response;
    }

    try {
      const text = await response.clone().text();
      const sanitized = sanitizeUrlText(text);
      if (sanitized === text) {
        return response;
      }

      const headers = new Headers(response.headers);
      headers.delete('content-length');
      headers.delete('content-encoding');
      return new Response(sanitized, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    } catch (_) {
      return response;
    }
  }

  function patchRequestConstructor() {
    if (typeof Request !== 'function') {
      return false;
    }

    const NativeRequest = Request;
    const PatchedRequest = new Proxy(NativeRequest, {
      construct(target, args, newTarget) {
        if (args.length > 0) {
          args[0] = sanitizeFetchInput(args[0]);
        }
        return Reflect.construct(target, args, newTarget);
      },
    });

    window.Request = PatchedRequest;
    return true;
  }

  function patchFetch() {
    if (typeof fetch !== 'function') {
      return false;
    }

    const nativeFetch = fetch;
    window.fetch = function patchedFetch(input, init) {
      const sanitizedInput = sanitizeFetchInput(input);
      const requestedUrl =
        typeof sanitizedInput === 'string'
          ? sanitizedInput
          : sanitizedInput && typeof sanitizedInput.url === 'string'
            ? sanitizedInput.url
            : '';

      return nativeFetch
        .call(this, sanitizedInput, init)
        .then((response) => sanitizeFetchResponse(response, requestedUrl));
    };

    return true;
  }

  function patchXMLHttpRequest() {
    if (typeof XMLHttpRequest !== 'function') {
      return false;
    }

    const nativeOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function patchedOpen(method, url, ...rest) {
      return nativeOpen.call(this, method, sanitizeUrl(url), ...rest);
    };

    return true;
  }

  function createWorkerBootstrap(url, options) {
    const isModule = options && options.type === 'module';
    const apiPatchSource = `
      (() => {
        const blockedApis = ${JSON.stringify(BLOCKED_APIS)};
        for (const apiName of blockedApis) {
          try {
            Object.defineProperty(globalThis, apiName, {
              configurable: false,
              enumerable: false,
              get: () => undefined,
              set: () => false,
            });
          } catch (_) {}
        }
      })();
    `;

    return isModule
      ? `${apiPatchSource}\nimport(${JSON.stringify(url)});`
      : `${apiPatchSource}\nimportScripts(${JSON.stringify(url)});`;
  }

  function patchWorkers() {
    if (typeof Worker !== 'function') {
      return false;
    }

    const NativeWorker = Worker;
    window.Worker = function patchedWorker(url, options) {
      const sourceUrl = typeof url === 'string' || url instanceof URL ? new URL(url, window.location.href).href : url;

      if (typeof sourceUrl === 'string' && /p2p|pcdn|mcdn|webrtc|rtc|peer/i.test(sourceUrl)) {
        const blobUrl = URL.createObjectURL(
          new Blob([createWorkerBootstrap(sourceUrl, options)], { type: 'text/javascript' }),
        );
        return new NativeWorker(blobUrl, options);
      }

      return new NativeWorker(url, options);
    };
    window.Worker.prototype = NativeWorker.prototype;

    return true;
  }

  const blocked = BLOCKED_APIS.filter(blockWindowApi);
  const patched = [
    patchRequestConstructor() && 'Request',
    patchFetch() && 'fetch',
    patchXMLHttpRequest() && 'XMLHttpRequest',
    patchWorkers() && 'Worker',
  ].filter(Boolean);

  if (blocked.length > 0 || patched.length > 0) {
    console.info(`${LOG_PREFIX} blocked: ${blocked.join(', ')}; patched: ${patched.join(', ')}`);
  }
})();
