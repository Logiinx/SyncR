// Injected into Twitch's own player page (twitch_official.rs) to read the master playlist it loads,
// the way the Adblock extension reaches inside Twitch's worker. Twitch fetches the playlist from a
// Web Worker on the browser's own connection (which usher accepts), so Rust can't fetch or read it;
// here the worker's fetch is hooked, and the playlist text is passed out to the page, where Rust
// reads window.__syncrMaster. __VIDEO__ is replaced with the video's id (digits only) by Rust.
;(function () {
  var VIDEO = '__VIDEO__'
  var CHANNEL = 'syncr-capture-' + VIDEO

  function isMaster(url) {
    return !!url && url.indexOf('usher.ttvnw.net') !== -1 && (url.indexOf('/vod/' + VIDEO + '.m3u8') !== -1 || url.indexOf('/vod/v2/' + VIDEO + '.m3u8') !== -1)
  }

  // The worker posts the playlist here; the page keeps the latest one for Rust to read.
  try {
    var channel = new BroadcastChannel(CHANNEL)
    channel.onmessage = function (event) {
      if (typeof event.data === 'string' && event.data.indexOf('#EXTM3U') !== -1) window.__syncrMaster = event.data
    }
  } catch (e) {}

  // In case the page itself fetches the master (not only the worker)
  try {
    var pageFetch = self.fetch
    self.fetch = function (input) {
      var url = typeof input === 'string' ? input : input && input.url
      var answer = pageFetch.apply(this, arguments)
      if (isMaster(url)) {
        answer.then(function (r) { return r.clone().text() }).then(function (text) {
          if (text.indexOf('#EXTM3U') !== -1) window.__syncrMaster = text
        }).catch(function () {})
      }
      return answer
    }
  } catch (e) {}

  // Runs inside Twitch's worker (prepended to its code): hook the worker's fetch, post the master out
  function workerHook() {
    var VIDEO = '__VIDEO__'
    var CHANNEL = 'syncr-capture-' + VIDEO
    var realFetch = self.fetch
    self.fetch = function (input) {
      var url = typeof input === 'string' ? input : input && input.url
      var answer = realFetch.apply(this, arguments)
      if (url && url.indexOf('usher.ttvnw.net') !== -1 && (url.indexOf('/vod/' + VIDEO + '.m3u8') !== -1 || url.indexOf('/vod/v2/' + VIDEO + '.m3u8') !== -1)) {
        answer.then(function (r) { return r.clone().text() }).then(function (text) {
          try { new BroadcastChannel(CHANNEL).postMessage(text) } catch (e) {}
        }).catch(function () {})
      }
      return answer
    }
  }
  var WORKER_HOOK = '(' + workerHook.toString() + ')();'

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
