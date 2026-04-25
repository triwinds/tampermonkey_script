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
  const MUTATION_SETTLE_DELAY_MS = 60;
  const SCROLL_IDLE_DELAY_MS = 180;
  const INTERACTION_IDLE_DELAY_MS = 900;
  const SCROLLER_REPAIR_DELAY_MS = 80;
  const SCROLLER_REPAIR_PASSES = 2;
  const SCROLLER_RUNTIME_FLAG = '__weiboFeedCleanerScrollerRuntime__';
  const SCROLLER_REPAIR_TIMER_FLAG = '__weiboFeedCleanerScrollerRepairTimer__';
  const START_FLAG = '__weiboFeedCleanerIntervalId__';
  const FEED_CARD_SELECTOR = 'article.woo-panel-main';
  const ACTIVE_FEED_INTERACTION_SELECTOR = [
    `${FEED_CARD_SELECTOR} [aria-expanded="true"]`,
    `${FEED_CARD_SELECTOR} [aria-pressed="true"]`,
    `${FEED_CARD_SELECTOR} textarea`,
    `${FEED_CARD_SELECTOR} input:not([type="hidden"])`,
    `${FEED_CARD_SELECTOR} [contenteditable="true"]`,
    `${FEED_CARD_SELECTOR} [role="textbox"]`,
  ].join(', ');
  const FEED_MUTATION_SELECTOR = `${FEED_CARD_SELECTOR}, .wbpro-scroller-item, .vue-recycle-scroller__item-view`;

  function normalizeText(value) {
    return String(value ?? '').replace(/\s+/g, ' ').trim();
  }

  function isLikelyHeaderMetaText(value) {
    const text = normalizeText(value);
    if (!text) {
      return false;
    }

    return /^(刚刚|今天|昨天|前天|[0-9]{1,2}:[0-9]{2}|[0-9]+(?:分钟|小时|天|周|月|年)前|来自|已编辑|置顶|[0-9])/u.test(text);
  }

  function isBlockedLabelBoundaryChar(value = '') {
    return !value || /[\s|｜/:：·•,【】()（）<>{}\[\]\-0-9]/u.test(value);
  }

  function findBlockedLabel(value) {
    const text = normalizeText(value);
    if (!text) {
      return '';
    }

    for (const label of BLOCKED_LABELS) {
      if (text === label) {
        return label;
      }

      if (text.startsWith(label) && isLikelyHeaderMetaText(text.slice(label.length))) {
        return label;
      }

      let searchIndex = text.indexOf(label);
      while (searchIndex !== -1) {
        const before = text[searchIndex - 1] || '';
        const after = text[searchIndex + label.length] || '';
        if (isBlockedLabelBoundaryChar(before) && isBlockedLabelBoundaryChar(after)) {
          return label;
        }

        searchIndex = text.indexOf(label, searchIndex + label.length);
      }
    }

    return '';
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
    return values.some((value) => Boolean(findBlockedLabel(value)));
  }

  function shouldRemoveCardBySignals(signals = {}) {
    if (findBlockedLabel(signals.headerText)) {
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
      matchedLabel: findBlockedLabel(signals.headerText)
        || signals.tagTexts.map((value) => findBlockedLabel(value)).find(Boolean)
        || signals.titleTexts.map((value) => findBlockedLabel(value)).find(Boolean)
        || signals.ariaLabels.map((value) => findBlockedLabel(value)).find(Boolean)
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

  function collectFeedStatusLists(feedState = {}) {
    const latestList = feedState?.latestList;
    if (!latestList || typeof latestList !== 'object') {
      return [];
    }

    const seen = new Set();
    const statusLists = [];

    for (const bucket of Object.values(latestList)) {
      if (!Array.isArray(bucket?.statuses) || seen.has(bucket.statuses)) {
        continue;
      }

      seen.add(bucket.statuses);
      statusLists.push(bucket.statuses);
    }

    return statusLists;
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

  function getStatusDedupKey(status = {}) {
    return getStatusId(status) || status;
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

  function cleanFeedWithRuntime(runtime, removedStatusIds = null) {
    if (!runtime?.store?.state?.feed?.latestList) {
      return 0;
    }

    const feedState = runtime.store.state.feed;
    const statusLists = collectFeedStatusLists(feedState);
    if (statusLists.length === 0) {
      return 0;
    }

    let removedCount = 0;
    const seenRemovals = removedStatusIds || new Set();

    for (const statuses of statusLists) {
      for (let index = statuses.length - 1; index >= 0; index -= 1) {
        const status = statuses[index];
        if (!isBlockedStatus(status)) {
          continue;
        }

        statuses.splice(index, 1);

        const dedupKey = getStatusDedupKey(status);
        if (seenRemovals.has(dedupKey)) {
          continue;
        }

        seenRemovals.add(dedupKey);
        const menu = findHideStatusMenu(status);
        reportStatusHidden(runtime, status, menu);
        logCardRemoval('runtime', summarizeStatus(status));
        removedCount += 1;
      }
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

  function collectDuplicateScrollerIndexes(items = []) {
    const seenStatusIds = new Set();
    const duplicateIndexes = [];

    for (let index = 0; index < items.length; index += 1) {
      const statusId = getStatusId(items[index]);
      if (!statusId) {
        continue;
      }

      if (seenStatusIds.has(statusId)) {
        duplicateIndexes.push(index);
        continue;
      }

      seenStatusIds.add(statusId);
    }

    return duplicateIndexes;
  }

  function repairDuplicateScrollerItems(
    runtime,
    win = typeof window !== 'undefined' ? window : null,
    removedStatusIds = null,
  ) {
    const items = runtime?.dynamicScroller?.items;
    if (!Array.isArray(items)) {
      return 0;
    }

    const duplicateIndexes = collectDuplicateScrollerIndexes(items)
      .filter((index) => index >= 0 && index < items.length)
      .sort((left, right) => right - left);

    if (duplicateIndexes.length === 0) {
      return 0;
    }

    for (const index of duplicateIndexes) {
      const item = items[index];
      items.splice(index, 1);
      const dedupKey = getStatusDedupKey(item);
      if (!removedStatusIds || !removedStatusIds.has(dedupKey)) {
        logCardRemoval('scroller', {
          index,
          id: getStatusId(item),
          text: summarizeText(item?.text_raw || item?.text || ''),
          mark: normalizeText(item?.mark),
          reason: 'duplicate',
        });

        if (removedStatusIds) {
          removedStatusIds.add(dedupKey);
        }
      }
    }

    runtime.dynamicScroller.forceUpdate?.(true);
    scheduleScrollerItemSizeRepair(runtime, win);
    return duplicateIndexes.length;
  }

  function cleanFeedWithScrollerRuntime(
    runtime,
    root = document,
    win = typeof window !== 'undefined' ? window : null,
    removedStatusIds = null,
  ) {
    if (!root || typeof root.querySelectorAll !== 'function') {
      return 0;
    }

    const items = runtime?.dynamicScroller?.items;
    if (!Array.isArray(items)) {
      return 0;
    }

    const duplicateIndexes = new Set(collectDuplicateScrollerIndexes(items));
    const blockedIndexes = new Set();
    for (const duplicateIndex of duplicateIndexes) {
      blockedIndexes.add(duplicateIndex);
    }

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
      const dedupKey = getStatusDedupKey(item);
      if (!removedStatusIds || !removedStatusIds.has(dedupKey)) {
        logCardRemoval('scroller', {
          index,
          id: getStatusId(item),
          text: summarizeText(item?.text_raw || item?.text || ''),
          mark: normalizeText(item?.mark),
          reason: duplicateIndexes.has(index) ? 'duplicate' : 'runtime-or-dom-match',
        });

        if (removedStatusIds) {
          removedStatusIds.add(dedupKey);
        }
      }
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

  function hasActiveFeedInteraction(root = document) {
    if (!root || typeof root.querySelector !== 'function') {
      return false;
    }

    if (root.querySelector(ACTIVE_FEED_INTERACTION_SELECTOR)) {
      return true;
    }

    const activeElement = root.activeElement;
    if (!activeElement || typeof activeElement.closest !== 'function') {
      return false;
    }

    if (activeElement.closest(`${FEED_CARD_SELECTOR} textarea, ${FEED_CARD_SELECTOR} input:not([type="hidden"]), ${FEED_CARD_SELECTOR} [contenteditable="true"], ${FEED_CARD_SELECTOR} [role="textbox"]`)) {
      return true;
    }

    return activeElement.getAttribute?.('aria-expanded') === 'true'
      && Boolean(activeElement.closest(FEED_CARD_SELECTOR));
  }

  function isFeedMutationNode(node) {
    if (!node) {
      return false;
    }

    if (node.nodeType === 3) {
      return isFeedMutationNode(node.parentElement || node.parentNode);
    }

    if (node.nodeType !== 1) {
      return false;
    }

    return Boolean(node.matches?.(FEED_MUTATION_SELECTOR) || node.closest?.(FEED_MUTATION_SELECTOR));
  }

  function hasRelevantFeedMutation(records = []) {
    return Array.from(records).some((record) => {
      if (!record) {
        return false;
      }

      if (isFeedMutationNode(record.target)) {
        return true;
      }

      if (Array.from(record.addedNodes || []).some(isFeedMutationNode)) {
        return true;
      }

      if (Array.from(record.removedNodes || []).some(isFeedMutationNode)) {
        return true;
      }

      return false;
    });
  }

  function cleanFeed(root = document) {
    const runtime = typeof window !== 'undefined' && typeof document !== 'undefined'
      ? getWeiboRuntime(root, window)
      : null;
    const scrollerRuntime = typeof window !== 'undefined' && typeof document !== 'undefined'
      ? getFeedScrollerRuntime(root, window)
      : null;
    const removedStatusIds = new Set();

    const runtimeRemoved = cleanFeedWithRuntime(runtime, removedStatusIds);
    const scrollerRemoved = cleanFeedWithScrollerRuntime(scrollerRuntime, root, typeof window !== 'undefined' ? window : null, removedStatusIds);
    const domRemoved = cleanFeedByDom(root);

    return runtimeRemoved + scrollerRemoved + domRemoved;
  }

  function startCleaner(
    doc = document,
    intervalMs = SCAN_INTERVAL_MS,
    win = typeof window !== 'undefined' ? window : null,
    cleaner = cleanFeed,
    interactionRepairer = null,
  ) {
    if (!win || typeof win.setTimeout !== 'function') {
      return null;
    }

    let isInteractionActive = false;
    let pendingClean = false;
    let interactionIdleTimer = null;
    let mutationSettleTimer = null;
    const ObserverCtor = win.MutationObserver || (typeof MutationObserver !== 'undefined' ? MutationObserver : null);
    const observerTarget = doc?.querySelector?.('#app') || doc?.body || doc?.documentElement || doc;

    const controller = {
      intervalId: null,
      observer: null,
    };

    const runInteractionRepair = () => {
      if (typeof interactionRepairer === 'function') {
        return interactionRepairer(doc, win);
      }

      return repairDuplicateScrollerItems(getFeedScrollerRuntime(doc, win), win);
    };

    const runCleaner = () => {
      if (hasActiveFeedInteraction(doc)) {
        runInteractionRepair();
        pendingClean = true;
        markInteractionActive(INTERACTION_IDLE_DELAY_MS);
        return;
      }

      pendingClean = false;
      cleaner(doc);
    };

    const flushPendingClean = () => {
      if (hasActiveFeedInteraction(doc)) {
        runInteractionRepair();
        interactionIdleTimer = null;
        markInteractionActive(INTERACTION_IDLE_DELAY_MS);
        return;
      }

      isInteractionActive = false;
      interactionIdleTimer = null;

      if (pendingClean) {
        runCleaner();
      }
    };

    const markInteractionActive = (delayMs) => {
      if (typeof win.setTimeout !== 'function') {
        return;
      }

      isInteractionActive = true;

      if (interactionIdleTimer && typeof win.clearTimeout === 'function') {
        win.clearTimeout(interactionIdleTimer);
      }

      interactionIdleTimer = win.setTimeout(flushPendingClean, delayMs);
    };

    const markScrollActive = () => {
      markInteractionActive(SCROLL_IDLE_DELAY_MS);
    };

    const markPointerActive = () => {
      markInteractionActive(INTERACTION_IDLE_DELAY_MS);
    };

    const requestClean = () => {
      if (mutationSettleTimer && typeof win.clearTimeout === 'function') {
        win.clearTimeout(mutationSettleTimer);
      }

      mutationSettleTimer = win.setTimeout(() => {
        mutationSettleTimer = null;

        if (isInteractionActive) {
          runInteractionRepair();
          pendingClean = true;
          return;
        }

        runCleaner();
      }, MUTATION_SETTLE_DELAY_MS);
    };

    if (typeof win.addEventListener === 'function') {
      win.addEventListener('wheel', markScrollActive, { passive: true });
      win.addEventListener('scroll', markScrollActive, { passive: true, capture: true });
      win.addEventListener('pointerdown', markPointerActive, { passive: true, capture: true });
      win.addEventListener('click', markPointerActive, { passive: true, capture: true });
      win.addEventListener('touchstart', markPointerActive, { passive: true, capture: true });
    }

    if (ObserverCtor && observerTarget) {
      controller.observer = new ObserverCtor((records) => {
        if (!hasRelevantFeedMutation(records)) {
          return;
        }

        requestClean();
      });

      controller.observer.observe(observerTarget, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true,
        attributeFilter: ['title', 'aria-label', 'aria-expanded', 'aria-pressed', 'data-index'],
      });
    }

    runCleaner();

    if (!controller.observer && typeof win.setInterval === 'function' && intervalMs > 0) {
      controller.intervalId = win.setInterval(() => {
        if (isInteractionActive) {
          pendingClean = true;
          return;
        }

        runCleaner();
      }, intervalMs);
    }

    return controller;
  }

  const api = {
    BLOCKED_LABELS,
    SCAN_INTERVAL_MS,
    MUTATION_SETTLE_DELAY_MS,
    SCROLL_IDLE_DELAY_MS,
    INTERACTION_IDLE_DELAY_MS,
    hasActiveFeedInteraction,
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
    repairDuplicateScrollerItems,
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
