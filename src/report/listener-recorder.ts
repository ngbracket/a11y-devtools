/**
 * Records which event types each element listens for, so the keyboard layer can
 * see click and key handlers on a production build, where Angular's
 * `window.ng.getListeners` doesn't exist. Report mode adds this as an init
 * script, so it runs before any of the page's own scripts: it wraps
 * `EventTarget.prototype.addEventListener` and `removeEventListener` and keeps
 * a per-element list of live listeners. zone.js patches the same methods after
 * it and calls through to these, so its listeners are recorded too.
 *
 * The page reads it through `__ngbA11yListeners.events(element)` (see
 * `resolveListenerEvents` in attribution.ts). A plain string, not a function:
 * Playwright would serialise a function with `toString()`, and the compiled
 * output must not depend on helpers outside it.
 *
 * Only elements are tracked (not window or document), and a listener removed
 * by an AbortSignal or after `once` stays listed. Both err towards "has a
 * handler", which keeps findings down rather than up.
 */
export const LISTENER_RECORDER_SCRIPT = `(() => {
  if (window.__ngbA11yListeners) return;
  const registry = new WeakMap();
  const proto = EventTarget.prototype;
  const add = proto.addEventListener;
  const remove = proto.removeEventListener;
  const captureOf = (options) => (typeof options === 'boolean' ? options : !!(options && options.capture));
  proto.addEventListener = function (type, listener, options) {
    try {
      if (listener && this instanceof Element) {
        let byType = registry.get(this);
        if (!byType) registry.set(this, (byType = new Map()));
        const key = String(type).toLowerCase();
        const capture = captureOf(options);
        const list = byType.get(key) || [];
        if (!list.some((l) => l[0] === listener && l[1] === capture)) list.push([listener, capture]);
        byType.set(key, list);
      }
    } catch {}
    return add.call(this, type, listener, options);
  };
  proto.removeEventListener = function (type, listener, options) {
    try {
      const byType = registry.get(this);
      const key = String(type).toLowerCase();
      const list = byType && byType.get(key);
      if (list) {
        const capture = captureOf(options);
        const kept = list.filter((l) => !(l[0] === listener && l[1] === capture));
        if (kept.length) byType.set(key, kept);
        else byType.delete(key);
      }
    } catch {}
    return remove.call(this, type, listener, options);
  };
  Object.defineProperty(window, '__ngbA11yListeners', {
    value: Object.freeze({
      events(element) {
        const byType = registry.get(element);
        return byType ? [...byType.keys()] : [];
      },
    }),
  });
})();`;
