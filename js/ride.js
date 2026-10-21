/* Moonrail: the page is a ride.
   Scroll progress t (0..1) drives the night train through five stations. The scene is drawn in a
   332 x 208 "art px" space, scaled by a whole number S so every art pixel is exactly S device pixels.
   Below 5x it uses the low-res pixel art; at 5x and up it swaps in the hi-res paintings, drawn at
   the same low-res layout x S. */
(function () {
  'use strict';

  var W = 332, H = 208, L = 700;           // art size, art px between stations
  var TX = 30, TY = 48;                     // train position
  var HIRES_FROM = 5;

  // Low-res sizes of each layer (hi-res images are drawn at these sizes x S).
  var DIM = {
    sky: [332, 208], moon: [26, 26], far: [404, 61], near: [404, 96], bridge: [352, 82],
    station: [434, 107], train: [232, 145], train_empty: [232, 145]
  };
  // Sprite strips: low-res cell size and frame bounding boxes [x, y, w, h] inside each cell,
  // matched to the frame's bounding box on the hi-res sheet.
  var SPRITES = {
    big: { lo: 'bigwheel', hi: 'wheels', cw: 11, ch: 11,
      lb: [[0, 0, 11, 11], [0, 0, 11, 11], [0, 0, 11, 11], [0, 0, 11, 11]],
      hb: [[74, 49, 277, 278], [395, 49, 277, 278], [713, 49, 278, 278], [1033, 49, 278, 278]] },
    small: { lo: 'smallwheel', hi: 'wheels', cw: 8, ch: 8,
      lb: [[0, 0, 8, 8], [0, 0, 8, 8], [0, 0, 8, 8], [0, 0, 8, 8]],
      hb: [[100, 354, 166, 166], [398, 354, 166, 166], [698, 354, 166, 166], [999, 354, 166, 166]] },
    steam: { lo: 'steam', hi: 'wheels', cw: 18, ch: 11,
      lb: [[7, 7, 4, 4], [3, 3, 12, 8], [1, 0, 16, 11], [0, 1, 18, 10], [3, 4, 12, 7]],
      hb: [[204, 754, 62, 60], [426, 729, 171, 117], [739, 687, 225, 161], [1094, 704, 258, 148], [1435, 737, 176, 101]] },
    // Momo keeps the hi-res aspect, anchored at the feet (bottom-left of the low-res box).
    momo: { lo: 'momo_platform', hi: 'momo', cw: 29, ch: 30, keepAspect: true,
      lb: [[2, 5, 24, 25], [3, 5, 22, 25], [4, 5, 21, 25], [0, 4, 26, 26]],
      hb: [[44, 249, 297, 307], [400, 248, 271, 308], [739, 248, 264, 308], [1063, 232, 354, 323]] }
  };
  var LO_FILES = ['sky', 'moon', 'far', 'near', 'bridge', 'station', 'train', 'train_empty',
    'momo_platform', 'bigwheel', 'smallwheel', 'steam'];
  var HI_FILES = { sky: 'sky', moon: 'moon', far: 'far', near: 'near', bridge: 'bridge',
    station: 'station', train: 'train', train_empty: 'train_empty',
    momo: 'momo_platform_sheet', wheels: 'wheels_and_steam_sheet' };

  function base() {
    var s = document.querySelector('script[src$="ride.js"]');
    return s ? s.src.replace(/js\/ride\.js.*$/, '') : '';
  }

  function loadSet(dir, files) {
    var out = {};
    var names = Array.isArray(files) ? files : Object.keys(files);
    return Promise.all(names.map(function (k) {
      return new Promise(function (resolve, reject) {
        var im = new Image();
        im.onload = function () { out[k] = im; resolve(); };
        im.onerror = reject;
        im.src = dir + (Array.isArray(files) ? k : files[k]) + '.png';
      }).then(function () { return out[k].decode ? out[k].decode().catch(function () {}) : null; });
    })).then(function () { return out; });
  }

  // Train position in stations (0..4) with an eased dwell at each station.
  function sOf(t) {
    var x = t * 4, k = Math.floor(x), u = x - k;
    if (k >= 4) return 4;
    var v = Math.min(1, Math.max(0, (u - 0.25) / 0.5));
    return k + v * v * (3 - 2 * v);
  }

  /* ---------- the scene renderer ---------- */
  function Scene(canvas, lo) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d');
    this.lo = lo;
    this.hi = null;
    this.S = 1; this.ox = 0; this.oy = 0; this.useHi = false;
    this.focus = 166;
    this.cache = {}; this.cacheS = 0;
  }

  // Hi-res art is resampled once per scale into canvases at its exact on-screen size, so each
  // frame is a 1:1 copy: cheap, and nothing gets resampled differently from frame to frame.
  function prescale(src, sx, sy, sw, sh, dw, dh) {
    var cv = document.createElement('canvas');
    cv.width = dw; cv.height = dh;
    var x = cv.getContext('2d');
    x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high';
    x.drawImage(src, sx, sy, sw, sh, 0, 0, dw, dh);
    return cv;
  }
  Scene.prototype.hiLayer = function (name) {
    if (this.cacheS !== this.S) { this.cache = {}; this.cacheS = this.S; }
    var c = this.cache[name];
    if (!c) {
      var im = this.hi[name], d = DIM[name];
      c = this.cache[name] = prescale(im, 0, 0, im.naturalWidth, im.naturalHeight, d[0] * this.S, d[1] * this.S);
    }
    return c;
  };
  Scene.prototype.hiFrame = function (key, f) {
    if (this.cacheS !== this.S) { this.cache = {}; this.cacheS = this.S; }
    var id = key + f, c = this.cache[id];
    if (!c) {
      var sp = SPRITES[key], lb = sp.lb[f], hb = sp.hb[f];
      var dh = lb[3] * this.S, dw = sp.keepAspect ? Math.round(hb[2] * dh / hb[3]) : lb[2] * this.S;
      c = this.cache[id] = prescale(this.hi[sp.hi], hb[0], hb[1], hb[2], hb[3], dw, dh);
    }
    return c;
  };

  // Smallest whole scale that covers the canvas, cropped around the focus point.
  Scene.prototype.layout = function () {
    var dw = this.cv.width, dh = this.cv.height;
    var S = Math.max(1, Math.ceil(Math.max(dw / W, dh / H) - 1e-6));
    this.S = S;
    this.focus = dw / dh < 1 ? 212 : 190;   // tall boxes (phones): keep the engine and Momo in view
    var ox = Math.round(dw / 2 - this.focus * S);
    this.ox = Math.min(0, Math.max(dw - W * S, ox));
    this.oy = Math.round((dh - H * S) / 2);
    this.useHi = !!this.hi && S >= HIRES_FROM;
  };
  Scene.prototype.wantsHi = function () { return this.S >= HIRES_FROM; };

  Scene.prototype.X = function (ax) { return this.ox + Math.round(ax * this.S); };
  Scene.prototype.Y = function (ay) { return this.oy + Math.round(ay * this.S); };

  // Draw a whole layer at art position (ax, ay).
  Scene.prototype.layer = function (name, ax, ay) {
    var S = this.S, d = DIM[name];
    if (this.useHi) this.ctx.drawImage(this.hiLayer(name), this.X(ax), this.Y(ay));
    else this.ctx.drawImage(this.lo[name], this.X(ax), this.Y(ay), d[0] * S, d[1] * S);
  };

  // A seamless tile scrolled by `off` art px; tiles are placed edge to edge in device px.
  Scene.prototype.tile = function (name, off, ay) {
    var S = this.S, tw = DIM[name][0], th = DIM[name][1];
    var im = this.useHi ? this.hiLayer(name) : this.lo[name];
    var o = ((off % tw) + tw) % tw;
    var x0 = this.ox - Math.round(o * S), y = this.Y(ay), wdev = tw * S;
    for (var x = x0; x < this.cv.width; x += wdev) this.ctx.drawImage(im, x, y, wdev, th * S);
  };

  Scene.prototype.sprite = function (key, f, ax, ay) {
    var sp = SPRITES[key], S = this.S, c = this.ctx;
    if (!this.useHi) {
      c.drawImage(this.lo[sp.lo], f * sp.cw, 0, sp.cw, sp.ch, this.X(ax), this.Y(ay), sp.cw * S, sp.ch * S);
      return;
    }
    var lb = sp.lb[f];
    c.drawImage(this.hiFrame(key, f), this.X(ax + lb[0]), this.Y(ay + lb[1]));
  };

  Scene.prototype.rect = function (ax, ay, aw, ah) {
    var x = this.X(ax), y = this.Y(ay);
    this.ctx.fillRect(x, y, this.X(ax + aw) - x, this.Y(ay + ah) - y);
  };

  /* st: { t, s, d (seconds of animation time), wheel (wheel phase), star (shooting star or null) } */
  Scene.prototype.draw = function (st) {
    var c = this.ctx, S = this.S, t = st.t, s = st.s, d = st.d;
    var travel = s * L;
    var stopped = Math.abs(s - Math.round(s)) < 0.001;
    var k = Math.round(s);
    var momoOut = stopped && k >= 1;
    var trainName = momoOut ? 'train_empty' : 'train';

    c.globalAlpha = 1; c.globalCompositeOperation = 'source-over';
    c.imageSmoothingEnabled = false;
    c.fillStyle = '#0d0f24';
    c.fillRect(0, 0, this.cv.width, this.cv.height);

    this.layer('sky', 0, 0);
    if (st.star) this.drawStar(st.star);
    this.layer('moon', 18 + t * 270, 32 - Math.sin(t * Math.PI) * 22);

    // Dawn warms the horizon over the last 20% of the ride.
    // Same colours and reach as the mock, faded row by row so it reads as a glow, not two bars.
    if (t > 0.8) {
      var dawn = (t - 0.8) / 0.2;
      for (var y = 26; y < 62; y++) {
        c.globalAlpha = dawn * 0.2 * Math.sin((y - 26) / 36 * Math.PI); c.fillStyle = '#7a4a6a'; this.rect(0, y, W, 1);
        if (y >= 42 && y < 58) { c.globalAlpha = dawn * 0.16 * Math.sin((y - 42) / 16 * Math.PI); c.fillStyle = '#f29b38'; this.rect(0, y, W, 1); }
      }
      c.globalAlpha = 1;
    }

    this.tile('far', travel * 0.125, 52);
    this.tile('near', travel * 0.25, 63);
    this.tile('bridge', travel, 134);

    for (var j = 0; j <= 4; j++) {
      var sx = -12 + (j * L - travel);
      if (sx > -440 && sx < 340) this.layer('station', sx, 42);
    }

    // River reflection of the train: flipped rows, rippling.
    var tr = this.useHi ? this.hiLayer(trainName) : this.lo[trainName];
    var ky = tr.height / 145;
    c.globalCompositeOperation = 'lighter';
    for (var r = 0; r < 29; r++) {
      var sr = 92 - Math.floor(r * 2.4);
      if (sr < 22) break;
      var wave = Math.round(Math.sin(d * 3 + r * 0.9) * 1.2);
      c.globalAlpha = 0.3 * (1 - r / 29);
      c.drawImage(tr, 0, sr * ky, tr.width, ky, this.X(TX + wave), this.Y(179 + r), 232 * S, S);
    }
    c.globalAlpha = 1; c.globalCompositeOperation = 'source-over';

    // Steam: three puffs while moving, one slow puff while stopped.
    var puffs = stopped ? 1 : 3;
    for (var i = 0; i < puffs; i++) {
      var ph = ((stopped ? d * 0.35 : d * 0.75) + i / 3) % 1;
      this.sprite('steam', Math.min(4, Math.floor(ph * 5)), Math.round(TX + 186 - ph * 22), Math.round(TY + 47 - ph * 26));
    }

    this.layer(trainName, TX, TY);

    var wf = ((Math.floor(st.wheel) % 4) + 4) % 4;
    var self = this;
    [17, 34, 88, 106, 192].forEach(function (x) { self.sprite('small', wf, TX + x, TY + 93); });
    [135, 148, 160, 172].forEach(function (x) { self.sprite('big', wf, TX + x, TY + 89); });
    var cr = [[2, 0], [0, 2], [-2, 0], [0, -2]][wf];
    c.fillStyle = '#3a2410'; this.rect(TX + 140 + cr[0], TY + 93 + cr[1], 40, 4);
    c.fillStyle = '#f2b632'; this.rect(TX + 141 + cr[0], TY + 94 + cr[1], 38, 2);

    // Headlamp beam, only while moving.
    if (!stopped) {
      c.fillStyle = '#ffd66e';
      for (i = 0; i < 44; i++) {
        var hh = 1 + Math.floor(i * 0.16);
        c.globalAlpha = 0.4 * (1 - i / 44);
        this.rect(TX + 205 + i, TY + 74 - hh, 1, hh * 2 + 1);
      }
      c.globalAlpha = 1;
    }

    // Momo on the platform: tea (frames 1-2, frame 0 now and then); waves at the end of the line.
    if (momoOut) {
      var beat = Math.floor(d / 0.8);
      var fr = k === 4 ? 3 : (beat % 5 === 4 ? 0 : 1 + (beat % 2));
      this.sprite('momo', fr, 266, 119);
    }
  };

  // A shooting star: a short streak of art pixels sliding down-left, fading out.
  Scene.prototype.drawStar = function (star) {
    var c = this.ctx, p = star.age / star.dur;
    if (p < 0 || p > 1) return;
    var hx = star.x - p * 46, hy = star.y + p * 18;
    c.fillStyle = '#fff4d6';
    for (var i = 0; i < 9; i++) {
      c.globalAlpha = (1 - i / 9) * Math.sin(p * Math.PI) * 0.9;
      this.rect(Math.round(hx + i * 2.4), Math.round(hy - i * 0.95), 1, 1);
    }
    c.globalAlpha = 1;
  };

  /* ---------- the page ---------- */
  var root = document.documentElement;
  var reduceQ = window.matchMedia ? matchMedia('(prefers-reduced-motion: reduce)') : null;
  var STILL = { t: 0.5, s: 2, d: 0.9, wheel: 0, star: null };   // at River Gate, Momo with his tea

  function start() {
    var canvas = document.getElementById('scene');
    if (!canvas || !canvas.getContext) return;
    var dir = base() + 'art/';
    var signs = Array.prototype.slice.call(document.querySelectorAll('.sign[data-station]'));
    var clock = document.getElementById('clock');
    var gold = document.getElementById('route-gold');
    var marker = document.getElementById('route-train');
    var stops = document.querySelectorAll('.route-stop');
    var names = Array.prototype.slice.call(document.querySelectorAll('.route-names a'));
    var scene = null, hiLoading = false;
    var t = 0, tShown = -1, sPrev = 0, wheel = 0, d = 0, last = 0, raf = 0;
    var star = null, nextStar = 4 + Math.random() * 6;
    var lastClock = '', lastHere = -1, lastSig = [];

    function riding() { return root.classList.contains('ride'); }

    function scrollMax() { return Math.max(1, document.documentElement.scrollHeight - window.innerHeight); }
    function readT() { return Math.min(1, Math.max(0, window.scrollY / scrollMax())); }

    function size() {
      var r = canvas.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
      return [Math.max(1, Math.round(r.width * dpr)), Math.max(1, Math.round(r.height * dpr))];
    }
    function resize(w, h) {
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
      if (!scene) return;
      scene.layout();
      if (scene.wantsHi() && !scene.hi && !hiLoading) {
        hiLoading = true;
        loadSet(dir + 'hi/', HI_FILES).then(function (hi) {
          scene.hi = hi; scene.layout(); paint();
        }, function () { /* stay on the low-res art */ });
      }
      paint();
    }

    function paint() {
      if (!scene) return;
      if (!riding()) { scene.draw(STILL); return; }
      var s = sOf(tShown < 0 ? 0 : tShown);
      scene.draw({ t: Math.max(0, tShown), s: s, d: d, wheel: wheel, star: star });
    }

    function updateUI(tv, s) {
      // Clock counts down 25:00 -> 00:00 over the ride.
      var left = Math.round((1 - tv) * 1500);
      var txt = 'RIDE ' + String(Math.floor(left / 60)).padStart(2, '0') + ':' + String(left % 60).padStart(2, '0');
      if (txt !== lastClock && clock) { clock.textContent = txt; lastClock = txt; }

      // Station signs fade and rise in as the train arrives.
      for (var k = 0; k < signs.length; k++) {
        var v = Math.max(0, 1 - Math.abs(s - k) * 2.2);
        var sig = Math.round(v * 500);
        if (sig === lastSig[k]) continue;
        lastSig[k] = sig;
        var el = signs[k];
        el.style.opacity = v.toFixed(3);
        el.style.transform = 'translateY(' + ((1 - v) * 14).toFixed(1) + 'px)';
        el.style.pointerEvents = v > 0.6 ? 'auto' : 'none';
        el.style.zIndex = v > 0.5 ? 4 : 3;
      }

      // Route bar.
      var pct = (s * 25).toFixed(2) + '%';
      gold.style.width = pct;
      marker.style.left = pct;
      for (k = 0; k < stops.length; k++) stops[k].classList.toggle('on', s >= k - 0.01);
      var here = Math.round(s);
      if (here !== lastHere) {
        names.forEach(function (a, i) {
          a.classList.toggle('here', i === here);
          a.parentNode.classList.toggle('here', i === here);
          if (i === here) a.setAttribute('aria-current', 'location'); else a.removeAttribute('aria-current');
        });
        lastHere = here;
      }
    }

    function frame(now) {
      raf = 0;
      if (!riding()) return;
      var dt = last ? Math.min(0.05, (now - last) / 1000) : 0;
      last = now; d += dt;

      // Follow the scroll position with a little easing so wheel steps glide.
      t = readT();
      if (tShown < 0) tShown = t;
      else {
        tShown += (t - tShown) * (1 - Math.exp(-dt * 14));
        if (Math.abs(t - tShown) < 0.00005) tShown = t;
      }
      var s = sOf(tShown);
      wheel += (s - sPrev) * L / 4;
      sPrev = s;

      nextStar -= dt;
      if (star) { star.age += dt; if (star.age > star.dur) star = null; }
      else if (nextStar <= 0) {
        star = { x: 90 + Math.random() * 220, y: 6 + Math.random() * 22, age: 0, dur: 0.9 };
        nextStar = 7 + Math.random() * 10;
      }

      paint();
      updateUI(tShown, s);
      raf = requestAnimationFrame(frame);
    }

    function goTo(k, smooth) {
      var y = Math.round(k / 4 * scrollMax());
      window.scrollTo({ top: y, behavior: smooth ? 'smooth' : 'auto' });
    }

    // Route bar links: glide to that station on the ride, plain anchors otherwise.
    names.forEach(function (a) {
      a.addEventListener('click', function (e) {
        if (!riding()) return;
        e.preventDefault();
        goTo(+a.getAttribute('data-go'), true);
        history.replaceState(null, '', a.getAttribute('href'));
      });
    });
    // Keyboard focus inside a sign brings the train to that station.
    signs.forEach(function (el, k) {
      el.addEventListener('focusin', function () { if (riding() && Math.round(sOf(readT())) !== k) goTo(k, false); });
    });

    // Split-flap "MOONRAIL" on Central.
    function flap() {
      var cells = document.querySelectorAll('#flap span[aria-hidden]');
      var word = 'MOONRAIL', abc = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', n = 0;
      var id = setInterval(function () {
        n += 1;
        for (var i = 0; i < cells.length; i++) {
          cells[i].textContent = n > 6 + i * 2 ? word[i] : abc[Math.floor(Math.random() * 26)];
        }
        if (n > 24) clearInterval(id);
      }, 70);
    }

    function setMode() {
      var still = reduceQ && reduceQ.matches;
      root.classList.toggle('ride', !still);
      signs.forEach(function (el) { el.removeAttribute('style'); });
      lastSig = []; lastHere = -1; tShown = -1; last = 0;
      requestAnimationFrame(function () {
        var sz = size(); resize(sz[0], sz[1]);
        if (riding() && !raf) raf = requestAnimationFrame(frame);
      });
    }

    if ('ResizeObserver' in window) {
      var ro = new ResizeObserver(function (entries) {
        var e = entries[0], w, h;
        if (e.devicePixelContentBoxSize && e.devicePixelContentBoxSize[0]) {
          w = e.devicePixelContentBoxSize[0].inlineSize; h = e.devicePixelContentBoxSize[0].blockSize;
        } else { var sz = size(); w = sz[0]; h = sz[1]; }
        resize(w, h);   // resizing clears the canvas, so redraw right away
      });
      try { ro.observe(canvas, { box: 'device-pixel-content-box' }); } catch (err) { ro.observe(canvas); }
    } else {
      window.addEventListener('resize', function () { var sz = size(); resize(sz[0], sz[1]); });
    }

    loadSet(dir + 'lo/', LO_FILES).then(function (lo) {
      scene = new Scene(canvas, lo);
      var sz = size(); resize(sz[0], sz[1]);
      if (riding()) {
        var hit = signs.filter(function (el) { return '#' + el.id === location.hash; })[0];
        if (hit) goTo(+hit.getAttribute('data-station'), false);
        flap();
        raf = requestAnimationFrame(frame);
      }
    });

    if (reduceQ) {
      var onChange = setMode;
      if (reduceQ.addEventListener) reduceQ.addEventListener('change', onChange);
      else if (reduceQ.addListener) reduceQ.addListener(onChange);
    }
  }

  window.MoonrailScene = { Scene: Scene, sOf: sOf, load: loadSet, LO_FILES: LO_FILES, HI_FILES: HI_FILES };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
