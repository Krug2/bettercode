// [REFACTOR] Extracted from browser-preview-panel.tsx — the JS injected into
// the previewed page. Kept as a raw string template so it can be passed to
// either `webview.executeJavaScript()` (Electron) or `document.head.append` a
// <script> tag (iframe fallback) without going through the host bundler.
//
// Performance invariants preserved from the original:
//   - Single-injection guard via `window.__BC_INJECTED__`
//   - Debounced MutationObserver (500 ms initial, 2 s steady-state)
//   - Host-owned selection overlay; inspected pages receive no picking clicks
//   - Batched console forwarding (flush at 50 entries or 250 ms)
//   - Bridge-message filter so our own postMessage traffic doesn't re-enter
//     the console batch and loop

/** Inspector payload JS. Expects a `window.__BC_SEND__(type, data)` function
 *  to be installed first by the transport-specific wrapper. */
export const INJECT_SCRIPT = `
(function() {
  if (window.__BC_INJECTED__) return;
  window.__BC_INJECTED__ = true;

  var _SKIP = {script:1,style:1,link:1,meta:1,noscript:1,br:1,hr:1,wbr:1,head:1,title:1};
  var _STYLE_PROPS = ['display','flex-direction','flex-wrap','justify-content','align-items','align-content','grid-template-columns','grid-template-rows','gap','row-gap','column-gap','position','top','right','bottom','left','z-index','width','height','min-width','min-height','max-width','max-height','margin-top','margin-right','margin-bottom','margin-left','padding-top','padding-right','padding-bottom','padding-left','border','border-width','border-style','border-color','border-radius','box-sizing','overflow','color','background-color','opacity','font-family','font-size','font-weight','line-height','letter-spacing','text-align','box-shadow','filter','backdrop-filter'];

  // ── Fix 4+6: Batched console with bridge-message filter ──
  var origLog = console.log, origWarn = console.warn, origError = console.error;
  var _conBuf = [], _conTimer = null;
  function _flushCon() {
    _conTimer = null;
    if (_conBuf.length === 0) return;
    window.__BC_SEND__('console-batch', { entries: _conBuf });
    _conBuf = [];
  }
  function _fwd(level, args) {
    try {
      var msg = Array.prototype.map.call(args, function(a) {
        return typeof a === 'object' ? JSON.stringify(a) : String(a);
      }).join(' ');
      if (msg.indexOf('__BC_MSG__') === 0) return; // Fix 6: skip bridge messages
      if (msg.length > 500) msg = msg.slice(0, 500) + '...';
      _conBuf.push({ level: level, message: msg });
      if (_conBuf.length >= 50) { if (_conTimer) { clearTimeout(_conTimer); _conTimer = null; } _flushCon(); }
      else if (!_conTimer) _conTimer = setTimeout(_flushCon, 250);
    } catch(e) { /* Expected: console forwarding must not throw */ }
  }
  console.log = function() { _fwd('log', arguments); origLog.apply(console, arguments); };
  console.warn = function() { _fwd('warn', arguments); origWarn.apply(console, arguments); };
  console.error = function() { _fwd('error', arguments); origError.apply(console, arguments); };

  // ── Selector builder ──
  function buildSelector(el) {
    if (!el || el === document.body || el === document.documentElement) return 'body';
    var root = el.getRootNode();
    if (el.id && root.querySelectorAll('#' + CSS.escape(el.id)).length === 1) return '#' + CSS.escape(el.id);
    var parts = [], cur = el, d = 0;
    while (cur && cur !== document.body && cur !== document.documentElement && d < 30) {
      var tag = cur.tagName.toLowerCase();
      if (cur.id && root.querySelectorAll('#' + CSS.escape(cur.id)).length === 1) { parts.unshift('#' + CSS.escape(cur.id)); break; }
      var par = cur.parentElement || (cur.parentNode === root ? root : null);
      if (par) {
        var sibs = par.children, count = 0, idx = 0;
        for (var i = 0; i < sibs.length; i++) {
          if (sibs[i].tagName === cur.tagName) { count++; if (sibs[i] === cur) idx = count; }
        }
        if (count > 1) tag += ':nth-of-type(' + idx + ')';
      }
      parts.unshift(tag);
      cur = par === root ? null : par; d++;
    }
    return parts.join(' > ') || el.tagName.toLowerCase();
  }

  // ── Fix 1: DOM tree with reduced limits ──
  function buildTree(el, depth) {
    if (!el || depth > 5) return null;
    var tag = el.tagName ? el.tagName.toLowerCase() : '';
    if (!tag || _SKIP[tag]) return null;
    var text = '';
    for (var i = 0; i < el.childNodes.length; i++) {
      if (el.childNodes[i].nodeType === 3) text += el.childNodes[i].textContent;
    }
    text = text.trim().slice(0, 40);
    var children = [];
    for (var j = 0; j < el.children.length && j < 30; j++) {
      var ch = buildTree(el.children[j], depth + 1);
      if (ch) children.push(ch);
    }
    return { tag: tag, id: el.id || '', classes: el.className && typeof el.className === 'string' ? el.className.trim().split(/\\s+/).filter(Boolean).slice(0, 3) : [], selector: buildSelector(el), text: text, children: children };
  }

  function sendDomTree() {
    var body = document.body;
    if (!body) return;
    _domTreeSent = true;
    window.__BC_SEND__('dom-tree', { tree: buildTree(body, 0) });
  }

  // ── Fix 1: Debounced MutationObserver ──
  var _domTimer = null, _domTreeSent = false;
  function _scheduleDomTree() {
    if (_domTimer) clearTimeout(_domTimer);
    _domTimer = setTimeout(function() { _domTimer = null; sendDomTree(); }, _domTreeSent ? 2000 : 500);
  }

  function elementAt(x, y) {
    var el = document.elementFromPoint(x, y);
    while (el && el.shadowRoot && el.shadowRoot.elementFromPoint) {
      var inner = el.shadowRoot.elementFromPoint(x, y);
      if (!inner || inner === el) break;
      el = inner;
    }
    return el;
  }

  function elementSnapshot(el) {
    if (!el || !el.tagName) return null;
    var computed = window.getComputedStyle(el), styles = {};
    _STYLE_PROPS.forEach(function(p) { styles[p] = computed.getPropertyValue(p); });
    var rect = el.getBoundingClientRect();
    var selector = buildSelector(el), root = el.getRootNode();
    while (root && root.host) { selector = buildSelector(root.host) + ' >>> ' + selector; root = root.host.getRootNode(); }
    var text = /^(input|textarea|select)$/i.test(el.tagName) || el.isContentEditable ? '' : (el.innerText || el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 4000);
    return {
      selector: selector, tagName: el.tagName.toLowerCase(),
      id: el.id || '', className: typeof el.className === 'string' ? el.className.trim() : '',
      text: text, label: el.getAttribute('aria-label') || el.getAttribute('alt') || text.slice(0, 60),
      url: location.href, childCount: el.children.length, styles: styles,
      rect: { x: rect.x, y: rect.y, w: rect.width, h: rect.height },
      viewport: { width: window.innerWidth, height: window.innerHeight }
    };
  }

  function findElement(selector) {
    var parts = selector.split(' >>> '), root = document, el = null;
    for (var i = 0; i < parts.length; i++) { el = root.querySelector(parts[i]); if (!el) return null; root = el.shadowRoot || el; }
    return el;
  }

  window.__BC_PREVIEW__ = {
    inspectPoint: function(x, y) { return elementSnapshot(elementAt(x * window.innerWidth, y * window.innerHeight)); },
    scrollPoint: function(x, y, dx, dy) {
      var el = elementAt(x * window.innerWidth, y * window.innerHeight);
      while (el && el !== document.body) {
        var style = getComputedStyle(el);
        var canY = /(auto|scroll)/.test(style.overflowY) &&
          (dy < 0 ? el.scrollTop > 0 : dy > 0 && el.scrollTop + el.clientHeight < el.scrollHeight - 1);
        var canX = /(auto|scroll)/.test(style.overflowX) &&
          (dx < 0 ? el.scrollLeft > 0 : dx > 0 && el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
        if (canY || canX) {
          el.scrollBy({ left: canX ? dx : 0, top: canY ? dy : 0, behavior: 'instant' }); return;
        }
        if ((dy && /(contain|none)/.test(style.overscrollBehaviorY)) ||
            (dx && /(contain|none)/.test(style.overscrollBehaviorX))) return;
        el = el.parentElement || (el.getRootNode().host || null);
      }
      window.scrollBy({ left: dx, top: dy, behavior: 'instant' });
    }
  };

  // Commands inspect the DOM directly; selecting from the tree never clicks it.
  window.addEventListener('message', function(e) {
    if (e.source !== window.parent) return;
    if (!e.data || !e.data.type) return;
    if (String(e.data.type).indexOf('bc-') !== 0) return;
    if (e.data.type === 'bc-apply-style') {
      try { var els = document.querySelectorAll(e.data.selector); els.forEach(function(el) { el.style[e.data.property] = e.data.value; }); } catch(ex) { /* Expected: invalid selector or style property from user input */ }
    }
    if (e.data.type === 'bc-select') {
      try { var selected = elementSnapshot(findElement(e.data.selector)); if (selected) window.__BC_SEND__('element-selected', selected); } catch(ex) {}
    }
    if (e.data.type === 'bc-highlight') {
      try { var el = findElement(e.data.selector); if (el) el.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch(ex) {}
    }
  });

  // ── Init: send tree on load, observe mutations ──
  if (document.readyState === 'complete') setTimeout(sendDomTree, 300);
  else window.addEventListener('load', function() { setTimeout(sendDomTree, 300); });
  new MutationObserver(_scheduleDomTree).observe(document.body || document.documentElement, { childList: true, subtree: true });
})();
`

/** Webview variant: uses `window.cursorBrowser.send` exposed by the preload
 *  script (`electron/browser-preview-preload.cjs`). */
export const INJECT_SCRIPT_WEBVIEW = `
window.__BC_SEND__ = function(type, data) {
  if (window.cursorBrowser && typeof window.cursorBrowser.send === 'function') {
    window.cursorBrowser.send(type, data);
  }
};
${INJECT_SCRIPT}
`

/** Iframe-fallback variant: postMessage to the parent with a concrete origin.
 *  When `parentOrigin` is unknown or `"null"` (sandboxed iframes), falls back
 *  to `"*"`. */
export function buildIframeInjectScript(parentOrigin: string): string {
  const targetOrigin =
    parentOrigin && parentOrigin !== "null" ? parentOrigin : "*"
  return `
window.__BC_SEND__ = function(type, data) {
  window.parent.postMessage({ type: 'bc-' + type, data: data }, ${JSON.stringify(targetOrigin)});
};
${INJECT_SCRIPT}
`
}
