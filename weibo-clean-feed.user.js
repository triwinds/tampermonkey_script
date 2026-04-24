// ==UserScript==
// @name         Weibo Feed Cleaner
// @namespace    https://tampermonkey.net/
// @version      0.3.0
// @description  Remove recommended / advertisement cards from the Weibo feed using Weibo's own feed runtime when available.
// @author       Codex
// @match        https://weibo.com/*
// @match        https://www.weibo.com/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const BLOCKED_LABELS = ['推荐', '广告', '\u8350\u8bfb'];
  const SCAN_INTERVAL_MS = 1000;
  const SCROLLER_REPAIR_DELAY_MS = 80;
  const SCROLLER_REPAIR_PASSES = 2;
  const SCROLLER_RUNTIME_FLAG = '__weiboFeedCleanerScrollerRuntime__';
  const SCROLLER_REPAIR_TIMER_FLAG = '__weiboFeedCleanerScrollerRepairTimer__';
  const START_FLAG = '__weiboFeedCleanerIntervalId__';

  function normalizeText(value) {
    return String(value ?? '').replace(/\s+/g, ' ').trim();
  }

  function summarizeText(value, maxLength = 80) {
    const text = normalizeText(value);
    if (text.length <= maxLength) {
      return text;
    }

    return `${text.slice(0, maxLength)}...`;
  }

  function logCardRemoval(source, details = {}) {
    if (typeof console === 'undefined' || typeof console.info !== 'function') {
      return;
    }

    console.info('[weibo-clean-feed] removed card', {
      source,
      ...details,
    });
  }

  function hasBlockedLabel(values) {
    return values.some((value) => BLOCKED_LABELS.includes(normalizeText(value)));
  }

  function shouldRemoveCardBySignals(signals = {}) {
    const headerText = normalizeText(signals.headerText);

    if (BLOCKED_LABELS.includes(headerText)) {
      return true;
    }

    return hasBlockedLabel(signals.tagTexts || [])
      || hasBlockedLabel(signals.titleTexts || [])
      || hasBlockedLabel(signals.ariaLabels || []);
  }

  function collectTextContent(nodes) {
    return Array.from(nodes || [], (node) => normalizeText(node.textContent)).filter(Boolean);
  }

  function collectAttribute(nodes, attributeName) {
    return Array.from(nodes || [], (node) => normalizeText(node.getAttribute(attributeName))).filter(Boolean);
  }

  function collectCardSignals(card) {
    const header = card.querySelector('header') || card;

    return {
      headerText: normalizeText(header.textContent),
      tagTexts: collectTextContent(header.querySelectorAll('*')),
      titleTexts: collectAttribute(header.querySelectorAll('[title]'), 'title'),
      ariaLabels: collectAttribute(header.querySelectorAll('[aria-label]'), 'aria-label'),
    };
  }

  function summarizeCard(card) {
    const signals = collectCardSignals(card);
    return {
      headerText: summarizeText(signals.headerText),
      matchedLabel: signals.tagTexts.find((value) => BLOCKED_LABELS.includes(normalizeText(value)))
        || signals.titleTexts.find((value) => BLOCKED_LABELS.includes(normalizeText(value)))
        || signals.ariaLabels.find((value) => BLOCKED_LABELS.includes(normalizeText(value)))
        || '',
      itemIndex: getScrollerItemIndex(card),
      preview: summarizeText(card?.innerText || card?.textContent || ''),
    };
  }

  function shouldRemoveCard(card) {
    return shouldRemoveCardBySignals(collectCardSignals(card));
  }

  function getVueApp(doc = document) {
    return doc.querySelector('#app')?.__vue_app__
      || doc.body?.__vue_app__
      || null;
  }

  function getWeiboRuntime(doc = document, win = window) {
    const app = getVueApp(doc);
    const globalProperties = app?._context?.config?.globalProperties;
    const store = globalProperties?.$store;
    const http = globalProperties?.$http;

    if (!app || !store || !http) {
      return null;
    }

    return {
      app,
      doc,
      http,
      locationHref: win?.location?.href || '',
      store,
      toast: globalProperties?.$_w_toast,
      win,
    };
  }

  function resolveCurrentGroupId(locationHref = '', latestList = {}, feedState = {}) {
    try {
      const gid = new URL(locationHref).searchParams.get('gid');
      if (gid && latestList[gid]) {
        return gid;
      }
      if (gid) {
        return gid;
      }
    } catch {
      // Ignore URL parsing failures and fall back to store state.
    }

    const candidates = [
      feedState?.feedGroup?.gid,
      feedState?.curTab?.gid,
      typeof feedState?.curTab === 'string' ? feedState.curTab : null,
    ].filter(Boolean);

    for (const candidate of candidates) {
      if (latestList[candidate]) {
        return candidate;
      }
    }

    return Object.keys(latestList)[0] || null;
  }

  function getStatusesBucket(feedState, groupId) {
    const bucket = feedState?.latestList?.[groupId];
    return Array.isArray(bucket?.statuses) ? bucket : null;
  }

  function isBlockedStatus(status = {}) {
    return Boolean(
      status
      && typeof status === 'object'
      && (
        status.isAd === 1
        || status.isAd === true
        || normalizeText(status.mark).includes('reallog_mark_ad')
        || status.promotion?.type === 'ad'
        || status.readtimetype === 'adMblog'
      )
    );
  }

  function findHideStatusMenu(status = {}) {
    const menus = Array.isArray(status.mblog_menus_new) ? status.mblog_menus_new : [];

    return menus.find((menu) => menu?.type === 'mblog_menus_hide_status' && menu?.name === '不感兴趣')
      || menus.find((menu) => menu?.type === 'mblog_menus_hide_status' && menu?.name === '屏蔽此博主')
      || menus.find((menu) => menu?.type === 'mblog_menus_hide_status')
      || null;
  }

  function getMenuBackKey(menu = {}) {
    if (menu.name === '不感兴趣') {
      return '1';
    }

    if (menu.name === '屏蔽此博主') {
      return '2';
    }

    return normalizeText(menu.need_back);
  }

  function getStatusId(status = {}) {
    return String(status.idstr || status.id || '');
  }

  function getPreferredActionlog(status = {}, menu = null) {
    return menu?.actionlog || status.extra_button_info?.actionlog || null;
  }

  function safePost(http, url, payload) {
    if (!http || typeof http.post !== 'function') {
      return false;
    }

    try {
      const request = http.post.call(http, url, payload);
      if (request && typeof request.catch === 'function') {
        request.catch(() => {});
      }
      return true;
    } catch {
      return false;
    }
  }

  function reportStatusHidden(runtime, status, menu) {
    const id = getStatusId(status);
    const actionlog = getPreferredActionlog(status, menu);

    if (actionlog) {
      safePost(runtime.http, '/ajax/feed/throwbatch', { actionlog });
    }

    const menuKey = getMenuBackKey(menu);
    if (menuKey && id) {
      safePost(runtime.http, '/ajax/feed/menuback', {
        menu_key: menuKey,
        mid: id,
      });
    }
  }

  function summarizeStatus(status = {}) {
    return {
      id: getStatusId(status),
      user: status?.user?.screen_name || '',
      mark: normalizeText(status?.mark),
      readtimetype: normalizeText(status?.readtimetype),
      text: summarizeText(status?.text_raw || status?.text || ''),
    };
  }

  function removeStatusFromList(statuses, statusId) {
    const index = statuses.findIndex((status) => getStatusId(status) === String(statusId));
    if (index === -1) {
      return false;
    }

    statuses.splice(index, 1);
    return true;
  }

  function cleanFeedWithRuntime(runtime, groupId) {
    if (!runtime?.store?.state?.feed?.latestList) {
      return 0;
    }

    const feedState = runtime.store.state.feed;
    const gid = groupId || resolveCurrentGroupId(runtime.locationHref, feedState.latestList, feedState);
    const bucket = getStatusesBucket(feedState, gid);

    if (!bucket) {
      return 0;
    }

    let removedCount = 0;
    for (let index = bucket.statuses.length - 1; index >= 0; index -= 1) {
      const status = bucket.statuses[index];
      if (!isBlockedStatus(status)) {
        continue;
      }

      const menu = findHideStatusMenu(status);
      reportStatusHidden(runtime, status, menu);
      bucket.statuses.splice(index, 1);
      logCardRemoval('runtime', summarizeStatus(status));
      removedCount += 1;
    }

    return removedCount;
  }

  function enqueueVueComponentChildren(queue, vnode) {
    if (!vnode) {
      return;
    }

    if (Array.isArray(vnode)) {
      for (const child of vnode) {
        enqueueVueComponentChildren(queue, child);
      }
      return;
    }

    if (vnode.component) {
      queue.push(vnode.component);
    }

    if (Array.isArray(vnode.children)) {
      for (const child of vnode.children) {
        enqueueVueComponentChildren(queue, child);
      }
    }

    if (Array.isArray(vnode.dynamicChildren)) {
      for (const child of vnode.dynamicChildren) {
        enqueueVueComponentChildren(queue, child);
      }
    }

    if (vnode.suspense?.activeBranch) {
      enqueueVueComponentChildren(queue, vnode.suspense.activeBranch);
    }

    if (vnode.ssContent) {
      enqueueVueComponentChildren(queue, vnode.ssContent);
    }

    if (vnode.ssFallback) {
      enqueueVueComponentChildren(queue, vnode.ssFallback);
    }
  }

  function getVisibleScrollerMetrics(root = document) {
    if (!root || typeof root.querySelectorAll !== 'function') {
      return { maxIndex: null, visibleCount: 0 };
    }

    let maxIndex = null;
    let visibleCount = 0;
    const items = root.querySelectorAll('.wbpro-scroller-item');

    for (const item of items) {
      visibleCount += 1;
      const rawIndex = item?.dataset?.index ?? '';
      const index = Number.parseInt(rawIndex, 10);
      if (!Number.isInteger(index)) {
        continue;
      }

      if (maxIndex === null || index > maxIndex) {
        maxIndex = index;
      }
    }

    return { maxIndex, visibleCount };
  }

  function getScrollerItemsLength(scroller) {
    return Array.isArray(scroller?.items) ? scroller.items.length : 0;
  }

  function isUsableScrollerRuntime(runtime, root = document) {
    if (!Array.isArray(runtime?.dynamicScroller?.items)) {
      return false;
    }

    const { maxIndex, visibleCount } = getVisibleScrollerMetrics(root);
    const itemsLength = runtime.dynamicScroller.items.length;

    if (maxIndex !== null && itemsLength <= maxIndex) {
      return false;
    }

    if (visibleCount > 0 && itemsLength < visibleCount) {
      return false;
    }

    return true;
  }

  function pickBestDynamicScroller(scrollers, root = document) {
    const candidates = scrollers.filter((scroller) => Array.isArray(scroller?.items));
    if (candidates.length === 0) {
      return null;
    }

    const { maxIndex, visibleCount } = getVisibleScrollerMetrics(root);
    const minimumLength = Math.max(visibleCount, maxIndex === null ? 0 : maxIndex + 1);
    const validCandidates = candidates.filter((scroller) => scroller.items.length >= minimumLength);
    const pool = validCandidates.length > 0 ? validCandidates : candidates;

    return pool.reduce((best, scroller) => {
      if (!best || getScrollerItemsLength(scroller) > getScrollerItemsLength(best)) {
        return scroller;
      }

      return best;
    }, null);
  }

  function getFeedScrollerRuntime(doc = document, win = window) {
    const cached = win?.[SCROLLER_RUNTIME_FLAG];
    if (isUsableScrollerRuntime(cached, doc)) {
      return cached;
    }

    const app = getVueApp(doc);
    const rootComponent = app?._container?._vnode?.component;
    if (!rootComponent) {
      return null;
    }

    const seen = new Set();
    const queue = [rootComponent];
    const dynamicScrollerCandidates = [];
    const recycleScrollerCandidates = [];

    while (queue.length) {
      const component = queue.shift();
      if (!component || seen.has(component)) {
        continue;
      }

      seen.add(component);
      const componentName = component.type?.name || component.type?.__name || '';
      if (componentName === 'DynamicScroller') {
        dynamicScrollerCandidates.push(component.proxy || null);
      } else if (componentName === 'RecycleScroller') {
        recycleScrollerCandidates.push(component.proxy || null);
      }

      enqueueVueComponentChildren(queue, component.subTree);
    }

    const dynamicScroller = pickBestDynamicScroller(dynamicScrollerCandidates, doc);
    const recycleScroller = recycleScrollerCandidates.find((scroller) => typeof scroller?.handleScroll === 'function') || null;

    if (!dynamicScroller && !recycleScroller) {
      if (win) {
        win[SCROLLER_RUNTIME_FLAG] = null;
      }
      return null;
    }

    const runtime = { dynamicScroller, recycleScroller };
    if (win) {
      win[SCROLLER_RUNTIME_FLAG] = runtime;
    }
    return runtime;
  }

  function getScrollerItemIndex(card) {
    if (!card?.closest?.('.vue-recycle-scroller__item-view')) {
      return null;
    }

    const item = card?.closest?.('.wbpro-scroller-item');
    const rawIndex = item?.dataset?.index ?? '';
    const index = Number.parseInt(rawIndex, 10);
    return Number.isInteger(index) ? index : null;
  }

  function collectScrollerItemProxies(scrollerRuntime) {
    const rootComponent = scrollerRuntime?.dynamicScroller?._ || scrollerRuntime?.recycleScroller?._;
    if (!rootComponent) {
      return [];
    }

    const seen = new Set();
    const queue = [rootComponent];
    const items = [];

    while (queue.length) {
      const component = queue.shift();
      if (!component || seen.has(component)) {
        continue;
      }

      seen.add(component);
      const componentName = component.type?.name || component.type?.__name || '';
      if (componentName === 'DynamicScrollerItem' && component.proxy) {
        items.push(component.proxy);
      }

      enqueueVueComponentChildren(queue, component.subTree);
    }

    return items;
  }

  function repairScrollerItemSizes(scrollerRuntime) {
    let repairedCount = 0;

    for (const item of collectScrollerItemProxies(scrollerRuntime)) {
      if (item?.finalActive === false || typeof item?.updateSize !== 'function') {
        continue;
      }

      item.updateSize();
      repairedCount += 1;
    }

    if (repairedCount > 0) {
      scrollerRuntime?.recycleScroller?.handleScroll?.();
    }

    return repairedCount;
  }

  function scheduleScrollerItemSizeRepair(scrollerRuntime, win = typeof window !== 'undefined' ? window : null) {
    if (!scrollerRuntime || !win || typeof win.setTimeout !== 'function') {
      return 0;
    }

    const previousTimer = win[SCROLLER_REPAIR_TIMER_FLAG];
    if (previousTimer && typeof win.clearTimeout === 'function') {
      win.clearTimeout(previousTimer);
    }

    let remainingPasses = SCROLLER_REPAIR_PASSES;
    const runPass = () => {
      repairScrollerItemSizes(scrollerRuntime);
      remainingPasses -= 1;

      if (remainingPasses > 0) {
        win[SCROLLER_REPAIR_TIMER_FLAG] = win.setTimeout(runPass, SCROLLER_REPAIR_DELAY_MS);
        return;
      }

      win[SCROLLER_REPAIR_TIMER_FLAG] = null;
    };

    win[SCROLLER_REPAIR_TIMER_FLAG] = win.setTimeout(runPass, SCROLLER_REPAIR_DELAY_MS);
    return SCROLLER_REPAIR_PASSES;
  }

  function cleanFeedWithScrollerRuntime(runtime, root = document, win = typeof window !== 'undefined' ? window : null) {
    if (!root || typeof root.querySelectorAll !== 'function') {
      return 0;
    }

    const items = runtime?.dynamicScroller?.items;
    if (!Array.isArray(items)) {
      return 0;
    }

    const blockedIndexes = new Set();
    const cards = root.querySelectorAll('article.woo-panel-main');

    for (const card of cards) {
      const index = getScrollerItemIndex(card);
      if (index === null || !shouldRemoveCard(card)) {
        continue;
      }

      blockedIndexes.add(index);
    }

    for (let index = 0; index < items.length; index += 1) {
      if (isBlockedStatus(items[index])) {
        blockedIndexes.add(index);
      }
    }

    const indexes = Array.from(blockedIndexes)
      .filter((index) => index >= 0 && index < items.length)
      .sort((left, right) => right - left);

    if (indexes.length === 0) {
      return 0;
    }

    for (const index of indexes) {
      const item = items[index];
      items.splice(index, 1);
      logCardRemoval('scroller', {
        index,
        id: getStatusId(item),
        text: summarizeText(item?.text_raw || item?.text || ''),
        mark: normalizeText(item?.mark),
      });
    }

    runtime.dynamicScroller.forceUpdate?.(true);
    scheduleScrollerItemSizeRepair(runtime, win);
    return indexes.length;
  }

  function findRemovalTarget(card) {
    if (card.closest('.vue-recycle-scroller__item-view')) {
      return null;
    }

    return card.closest('.wbpro-scroller-item')
      || card;
  }

  function cleanFeedByDom(root = document) {
    if (!root || typeof root.querySelectorAll !== 'function') {
      return 0;
    }

    const cards = root.querySelectorAll('article.woo-panel-main');
    let removedCount = 0;

    for (const card of cards) {
      if (!shouldRemoveCard(card)) {
        continue;
      }

      const target = findRemovalTarget(card);
      if (!target || !target.isConnected) {
        continue;
      }

      logCardRemoval('dom', summarizeCard(card));
      target.remove();
      removedCount += 1;
    }

    return removedCount;
  }

  function cleanFeed(root = document) {
    const runtime = typeof window !== 'undefined' && typeof document !== 'undefined'
      ? getWeiboRuntime(root, window)
      : null;
    const scrollerRuntime = typeof window !== 'undefined' && typeof document !== 'undefined'
      ? getFeedScrollerRuntime(root, window)
      : null;

    const runtimeRemoved = cleanFeedWithRuntime(runtime);
    const scrollerRemoved = cleanFeedWithScrollerRuntime(scrollerRuntime, root);
    const domRemoved = cleanFeedByDom(root);

    return runtimeRemoved + scrollerRemoved + domRemoved;
  }

  function startCleaner(doc = document, intervalMs = SCAN_INTERVAL_MS) {
    cleanFeed(doc);
    return window.setInterval(() => {
      cleanFeed(doc);
    }, intervalMs);
  }

  const api = {
    BLOCKED_LABELS,
    SCAN_INTERVAL_MS,
    normalizeText,
    shouldRemoveCardBySignals,
    collectCardSignals,
    shouldRemoveCard,
    getWeiboRuntime,
    resolveCurrentGroupId,
    isBlockedStatus,
    findHideStatusMenu,
    getMenuBackKey,
    getStatusId,
    getPreferredActionlog,
    removeStatusFromList,
    cleanFeedWithRuntime,
    getVisibleScrollerMetrics,
    isUsableScrollerRuntime,
    getFeedScrollerRuntime,
    getScrollerItemIndex,
    collectScrollerItemProxies,
    repairScrollerItemSizes,
    scheduleScrollerItemSizeRepair,
    cleanFeedWithScrollerRuntime,
    findRemovalTarget,
    cleanFeedByDom,
    cleanFeed,
    startCleaner,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }

  if (typeof window !== 'undefined' && typeof document !== 'undefined' && !window[START_FLAG]) {
    window[START_FLAG] = startCleaner(document, SCAN_INTERVAL_MS);
  }
})();
