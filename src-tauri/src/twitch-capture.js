// Injected into Twitch's own player page (twitch_official.rs) to read the master playlist it loads,
// the way the Adblock extension reaches inside Twitch's worker. Twitch fetches the playlist from a
// Web Worker on the browser's own connection (which usher accepts), and the token is single-use, so
// Rust can neither fetch nor refetch it. Here the worker's fetch is hooked; the playlist it gets is
// stored in IndexedDB (shared by worker and page, and it survives Twitch rewriting the page URL);
// the page copies it to window.__syncrMaster, which Rust reads. __VIDEO__ is replaced with the
// video's id (digits only) by Rust.
;(function () {
  var VIDEO = '__VIDEO__'

  // Runs inside Twitch's worker (prepended to its code): hook the worker's fetch, keep the master
  // playlist it loads in IndexedDB.
  function workerHook() {
    var VIDEO = '__VIDEO__'
    function save(key, value) {
      try {
        var open = indexedDB.open('syncr-capture', 1)
        open.onupgradeneeded = function () { try { open.result.createObjectStore('kv') } catch (e) {} }
        open.onsuccess = function () { try { open.result.transaction('kv', 'readwrite').objectStore('kv').put(value, key) } catch (e) {} }
      } catch (e) {}
    }
    var realFetch = self.fetch
    self.fetch = function (input) {
      var url = typeof input === 'string' ? input : input && input.url
      var answer = realFetch.apply(this, arguments)
      if (url && url.indexOf('usher.ttvnw.net') !== -1 && url.indexOf('/vod/') !== -1 && url.indexOf(VIDEO) !== -1) {
        answer.then(function (r) { save('status', r.status); return r.clone().text() })
          .then(function (text) { if (text && text.indexOf('#EXTM3U') !== -1) save('master', text) })
          .catch(function (e) { save('err', '' + e) })
      }
      return answer
    }
  }
  var WORKER_HOOK = '(' + workerHook.toString() + ')();'

  // Page side: copy the stored playlist (and the worker's trace) out of IndexedDB for Rust to read.
  function pagePoll() {
    try {
      var open = indexedDB.open('syncr-capture', 1)
      open.onupgradeneeded = function () { try { open.result.createObjectStore('kv') } catch (e) {} }
      open.onsuccess = function () {
        try {
          var store = open.result.transaction('kv', 'readonly').objectStore('kv')
          store.get('master').onsuccess = function (e) { if (e.target.result) window.__syncrMaster = e.target.result }
          store.get('status').onsuccess = function (e) { if (e.target.result !== undefined) window.__syncrStatus = e.target.result }
          store.get('err').onsuccess = function (e) { if (e.target.result) window.__syncrErr = e.target.result }
        } catch (e) {}
      }
    } catch (e) {}
  }
  setInterval(pagePoll, 250)
  pagePoll()

  // Twitch builds its worker from a blob URL. Fetch that code, put our hook in front of it, and make
  // the worker from the combined blob. Chains over any existing override (the Adblock extension's).
  try {
    var Base = self.Worker
    self.Worker = class extends Base {
      constructor(url, options) {
        try {
          var request = new XMLHttpRequest()
          request.open('GET', String(url).replace(/'/g, '%27'), false)
          request.overrideMimeType('text/javascript')
          request.send()
          var blob = URL.createObjectURL(new Blob([WORKER_HOOK + '\n' + request.responseText]))
          super(blob, options)
        } catch (e) {
          super(url, options)
        }
      }
    }
  } catch (e) {}
})()
