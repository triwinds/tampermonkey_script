// ==UserScript==
// @name         Bilibili Live No P2P Upload
// @namespace    https://tampermonkey.net/
// @version      1.0.0
// @description  Disable Bilibili Live WebRTC P2P upload by blocking peer/data-channel APIs on live pages.
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
  ];

  const LOG_PREFIX = '[Bilibili Live No P2P]';
  const STATE_KEY = '__bilibiliLiveNoP2PBlocked__';

  if (window[STATE_KEY]) {
    return;
  }

  Object.defineProperty(window, STATE_KEY, {
    value: true,
    configurable: false,
    enumerable: false,
    writable: false,
  });

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

  const blocked = BLOCKED_APIS.filter(blockWindowApi);

  if (blocked.length > 0) {
    console.info(`${LOG_PREFIX} blocked: ${blocked.join(', ')}`);
  }
})();
