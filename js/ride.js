/* Moonrail: the page is a ride.
   Scroll progress t (0..1) drives the night train through five stations. The scene is drawn in a
   332 x 208 "art px" space at S device px per art px (the smallest scale that covers the canvas, in
   1/8 steps), entirely from the HD paintings. Between CLOCK TOWER and END OF THE LINE the Old Town
   crossfades into the Snow Mountain Line, which rides from night into sunrise.
   The train follows NightTrainArt/train-hd (README and canvas board); the Snow Mountain Line follows
   NightTrainArt/snow-line. */
(function () {
  'use strict';

  var W = 332, H = 208, L = 700;           // art size, art px between stations
  var B = 9.6;                              // HD train image px per art px
  var BX = 32, BY = 103.5;                  // the train body's top-left (wheels on the rail at y 149)
  var SNOW = 1536 / 332;                    // Snow Mountain Line image px per art px
  var STEP = 8;                             // the scale moves in 1/8 steps, so small resizes keep the cache

  // Art sets, loaded as WebP from art/. The first screen needs only `core`; `halt` (the empty train
  // and Momo) and `snow` load once the page has loaded, or as soon as the ride leaves CENTRAL.
  var SETS = {
    core: {
      sky: 'town/sky', moon: 'town/moon', far: 'town/far', near: 'town/near', bridge: 'town/bridge',
      station: 'town/station', bodyMomo: 'train/body_momo', rod: 'train/rod',
      wheelBig: 'train/wheel_big', wheelCoach: 'train/wheel_coach', wheelFront: 'train/wheel_front',
      steam0: 'train/steam0', steam1: 'train/steam1', steam2: 'train/steam2', steam3: 'train/steam3', steam4: 'train/steam4'
    },
    halt: { body: 'train/body', momo: 'town/momo' },
    snow: {
      skyN: 'snow/sky_night', skyD: 'snow/sky_dawn', farN: 'snow/far_night', farD: 'snow/far_dawn',
      nearN: 'snow/near_night', nearD: 'snow/near_dawn', bridgeN: 'snow/bridge_night', bridgeD: 'snow/bridge_dawn',
      stationN: 'snow/station_night', stationD: 'snow/station_dawn'
    }
  };

  // Old Town paintings: [art width, art height, y]. Far, near and bridge are seamless tiles.
  var TOWN = { sky: [332, 208, 0], far: [404, 61, 52], near: [404, 96, 63], bridge: [352, 82, 134], station: [434, 107, 42] };
  // Snow Mountain Line: each image is drawn at its own size / SNOW. They were exported cropped to
  // their painted rows, so y is where the crop's top lands (README y + rows cropped / SNOW).
  var SNOWY = { far: -20 + 286 / SNOW, near: 298 / SNOW, bridge: 6.4 + 588 / SNOW, station: 149 - 645 / SNOW + 201 / SNOW };

  // The HD train, in B px from the body's top-left: [image, hub x, hub y, disc diameter].
  var WHEELS = [
    ['wheelCoach', 185, 384, 100], ['wheelCoach', 358, 384, 100], ['wheelCoach', 863, 384, 100], ['wheelCoach', 1041, 384, 100],
    ['wheelBig', 1331, 381, 114], ['wheelBig', 1453, 381, 114], ['wheelBig', 1574, 381, 114], ['wheelBig', 1685, 381, 114],
    ['wheelFront', 1773, 403, 58], ['wheelFront', 1885, 403, 58]
  ];
  var BODY_W = 2054, BODY_H = 445;
  // Momo's platform frames (stand, sip, sip, wave): box inside his 29 x 30 art px cell, and the
  // matching box on the HD sheet. He keeps the painting's aspect, standing on the box's bottom left.
  var MOMO = {
    lb: [[2, 5, 24, 25], [3, 5, 22, 25], [4, 5, 21, 25], [0, 4, 26, 26]],
    hb: [[44, 249, 297, 307], [400, 248, 271, 308], [739, 248, 264, 308], [1063, 232, 354, 323]]
  };

  function base() {
    var s = document.querySelector('script[src$="ride.js"]');
    return s ? s.src.replace(/js\/ride\.js.*$/, '') : '';
  }

  // Load a set of images; each one is tried up to three times, so a dropped request doesn't stop the ride.
  function loadSet(dir, files) {
    var out = {};
    function one(k, tries) {
      return new Promise(function (resolve, reject) {
        var im = new Image();
        im.onload = function () { out[k] = im; resolve(); };
        im.onerror = function () {
          if (tries > 1) setTimeout(function () { one(k, tries - 1).then(resolve, reject); }, 400);
          else reject(new Error('could not load ' + files[k]));
        };
        im.src = dir + files[k] + '.webp';
      });
    }
    return Promise.all(Object.keys(files).map(function (k) {
      return one(k, 3).then(function () { return out[k].decode ? out[k].decode().catch(function () {}) : null; });
    })).then(function () { return out; });
  }

  // Train position in stations (0..4) with an eased dwell at each station.
  function sOf(t) {
    var x = t * 4, k = Math.floor(x), u = x - k;
    if (k >= 4) return 4;
    var v = Math.min(1, Math.max(0, (u - 0.25) / 0.5));
    return k + v * v * (3 - 2 * v);
  }

  function clamp01(x) { return Math.min(1, Math.max(0, x)); }
  function mix(a, b, k) { return a + (b - a) * k; }

  // The Snow Mountain Line over the second half of CLOCK TOWER -> END OF THE LINE: `a` how much of
  // it shows, `m` its sunrise (night at first, full sunrise on arrival at END OF THE LINE).
  function snowMix(s) {
    var q = clamp01((s - 3.5) / 0.5);
    return { a: q, m: clamp01((q - 0.15) / 0.85) };
  }

  /* ---------- the scene renderer ---------- */
  function Scene(canvas, art) {
    this.cv = canvas;
    this.ctx = this.g = canvas.getContext('2d');
    this.art = art;
    this.S = 1; this.ox = 0; this.oy = 0;
    this.focus = 190;
    this.cache = {}; this.cacheS = 0;
    this.off = null;
    this.fill = null;
  }

  Scene.prototype.add = function (more) {
    for (var k in more) this.art[k] = more[k];
    this.fill = null;
  };
  Scene.prototype.has = function (set) {
    for (var k in SETS[set]) if (!this.art[k]) return false;
    return true;
  };

  // Smallest scale (in 1/8 steps) that covers the canvas, cropped around the focus point.
  Scene.prototype.layout = function () {
    var dw = this.cv.width, dh = this.cv.height;
    var S = Math.ceil(Math.max(dw / W, dh / H) * STEP - 1e-6) / STEP;
    this.S = S;
    this.focus = dw / dh < 1 ? 212 : 190;   // tall boxes (phones): keep the engine and Momo in view
    var ox = Math.round(dw / 2 - this.focus * S);
    this.ox = Math.min(0, Math.max(Math.ceil(dw - W * S), ox));
    this.oy = Math.floor((dh - H * S) / 2);
  };

  Scene.prototype.X = function (ax) { return this.ox + ax * this.S; };
  Scene.prototype.Y = function (ay) { return this.oy + ay * this.S; };

  // An image (or a part of it, src = [x, y, w, h]) drawn at aw x ah art px. When that's smaller
  // on screen than the image, it's resampled once per scale with high-quality smoothing so each
  // frame copies it 1:1; when it's as big or bigger, it's drawn straight from the image.
  Scene.prototype.piece = function (key, aw, ah, src) {
    if (this.cacheS !== this.S) { this.cache = {}; this.cacheS = this.S; }
    var id = key + (src ? ':' + src.join() : ''), c = this.cache[id];
    if (c) return c;
    var im = this.art[key], r = src || [0, 0, im.naturalWidth, im.naturalHeight];
    var dw = Math.max(1, Math.round(aw * this.S)), dh = Math.max(1, Math.round(ah * this.S));
    if (dw < r[2] || dh < r[3]) {
      var cv = document.createElement('canvas');
      cv.width = dw; cv.height = dh;
      var x = cv.getContext('2d');
      x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high';
      x.drawImage(im, r[0], r[1], r[2], r[3], 0, 0, dw, dh);
      c = { im: cv, r: [0, 0, dw, dh] };
    } else c = { im: im, r: r };
    return (this.cache[id] = c);
  };

  // Draw a piece at art (ax, ay) and size (aw, ah), on whole device pixels.
  Scene.prototype.blit = function (c, ax, ay, aw, ah) {
    var r = c.r;
    this.g.drawImage(c.im, r[0], r[1], r[2], r[3], Math.round(this.X(ax)), Math.round(this.Y(ay)),
      Math.round(aw * this.S), Math.round(ah * this.S));
  };
  // Draw the part (fx, fy, fw, fh, as fractions) of a piece at art (ax, ay), size (aw, ah).
  Scene.prototype.blitPart = function (c, fx, fy, fw, fh, ax, ay, aw, ah) {
    var r = c.r;
    this.g.drawImage(c.im, r[0] + fx * r[2], r[1] + fy * r[3], fw * r[2], fh * r[3], this.X(ax), this.Y(ay), aw * this.S, ah * this.S);
  };

  // A seamless tile scrolled by `off` art px, placed edge to edge on whole device pixels.
  Scene.prototype.tile = function (c, aw, ah, off, ay) {
    var S = this.S, r = c.r, wdev = Math.round(aw * S), hdev = Math.round(ah * S);
    var o = ((off % aw) + aw) % aw, y = Math.round(this.Y(ay));
    for (var x = Math.round(this.ox - o * S); x < this.cv.width; x += wdev) this.g.drawImage(c.im, r[0], r[1], r[2], r[3], x, y, wdev, hdev);
  };

  Scene.prototype.rect = function (ax, ay, aw, ah) {
    this.g.fillRect(this.X(ax), this.Y(ay), aw * this.S, ah * this.S);
  };

  /* st: { t, s, d (seconds of animation time), star (shooting star or null), snowIn (0..1, the
     Snow Mountain Line art fading in once it has loaded) } */
  Scene.prototype.draw = function (st) {
    var g = this.ctx, t = st.t, s = st.s, d = st.d;
    var travel = s * L;
    var stopped = Math.abs(s - Math.round(s)) < 0.001;
    var k = Math.round(s);
    var sm = snowMix(s), a = this.has('snow') ? sm.a * (st.snowIn == null ? 1 : st.snowIn) : 0;
    var m = a > 0 ? sm.m : 0;

    // One moon for both lines, moving from the Old Town's path to the Snow line's, paling at dawn.
    var moon = {
      x: mix(18 + t * 270, 30 + t * 260, a),
      y: mix(32 - Math.sin(t * Math.PI) * 22, 40 - Math.sin(t * Math.PI) * 26 + m * 8, a),
      size: mix(26, 22, a),
      alpha: 1 - 0.55 * m
    };

    g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
    g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'low';
    this.g = g;

    if (a < 1) this.drawTown(travel, moon, st.star);
    if (a > 0) {
      if (a < 1) {
        // The Snow line is painted on its own canvas, then laid over the Old Town as a whole.
        var off = this.off;
        if (!off || off.width !== this.cv.width || off.height !== this.cv.height) {
          off = this.off = document.createElement('canvas');
          off.width = this.cv.width; off.height = this.cv.height;
        }
        this.g = off.getContext('2d');
        this.g.imageSmoothingEnabled = true; this.g.imageSmoothingQuality = 'low';
        this.drawSnow(travel, moon, m);
        this.g = g;
        g.globalAlpha = a; g.drawImage(off, 0, 0); g.globalAlpha = 1;
      } else this.drawSnow(travel, moon, m);
    }

    var momoOut = stopped && k >= 1 && this.has('halt');
    this.drawTrain(d, travel, stopped, momoOut ? 'body' : 'bodyMomo', a, m);

    // Momo on the platform: tea (frames 1-2, frame 0 now and then); waves at the end of the line.
    if (momoOut) {
      var beat = Math.floor(d / 0.8);
      var fr = k === 4 ? 3 : (beat % 5 === 4 ? 0 : 1 + (beat % 2));
      var lb = MOMO.lb[fr], hb = MOMO.hb[fr], h = lb[3], w = hb[2] * h / hb[3];
      this.blit(this.piece('momo', w, h, hb), 266 + lb[0], 119 + lb[1], w, h);
    }
  };

  // Do the first-use work for newly arrived art ahead of time (resampling, the Snow line's first
  // paint and sky colour), so the frame that first needs it doesn't stutter.
  Scene.prototype.warm = function () {
    if (this.has('halt')) {
      this.piece('body', BODY_W / B, BODY_H / B);
      for (var f = 0; f < 4; f++) this.piece('momo', MOMO.hb[f][2] * MOMO.lb[f][3] / MOMO.hb[f][3], MOMO.lb[f][3], MOMO.hb[f]);
    }
    if (this.has('snow')) {
      var off = this.off;
      if (!off || off.width !== this.cv.width || off.height !== this.cv.height) {
        off = this.off = document.createElement('canvas');
        off.width = this.cv.width; off.height = this.cv.height;
      }
      var g = this.g;
      this.g = off.getContext('2d');
      this.drawSnow(4 * L, { x: 0, y: 0, size: 22, alpha: 1 }, 0.5);
      this.g = g;
    }
  };

  Scene.prototype.drawMoon = function (moon) {
    this.g.globalAlpha = moon.alpha;
    this.blit(this.piece('moon', moon.size, moon.size), moon.x, moon.y, moon.size, moon.size);
    this.g.globalAlpha = 1;
  };

  Scene.prototype.drawTown = function (travel, moon, star) {
    var g = this.g, T = TOWN;
    g.fillStyle = '#0d0f24';
    g.fillRect(0, 0, this.cv.width, this.cv.height);
    this.blit(this.piece('sky', 332, 208), 0, 0, 332, 208);
    if (star) this.drawStar(star);
    this.drawMoon(moon);
    this.tile(this.piece('far', T.far[0], T.far[1]), T.far[0], T.far[1], travel * 0.125, T.far[2]);
    this.tile(this.piece('near', T.near[0], T.near[1]), T.near[0], T.near[1], travel * 0.25, T.near[2]);
    this.tile(this.piece('bridge', T.bridge[0], T.bridge[1]), T.bridge[0], T.bridge[1], travel, T.bridge[2]);
    // Each station rests at x -12, in front of the bridge.
    for (var j = 0; j <= 4; j++) {
      var sx = -12 + (j * L - travel);
      if (sx > -440 && sx < 340) this.blit(this.piece('station', T.station[0], T.station[1]), sx, T.station[2], T.station[0], T.station[1]);
    }
  };

  // The Snow Mountain Line: every painting is its night version with its dawn version on top at
  // opacity m (they line up pixel for pixel).
  Scene.prototype.drawSnow = function (travel, moon, m) {
    var g = this.g, self = this;
    if (!this.fill) {
      // Below the sky painting, its bottom colour (night and dawn).
      var px = function (im) {
        var c = document.createElement('canvas'); c.width = c.height = 1;
        var x = c.getContext('2d');
        x.drawImage(im, im.naturalWidth / 2, im.naturalHeight - 3, 1, 1, 0, 0, 1, 1);
        return x.getImageData(0, 0, 1, 1).data;
      };
      this.fill = [px(this.art.skyN), px(this.art.skyD)];
    }
    var n = this.fill[0], dd = this.fill[1];
    g.fillStyle = 'rgb(' + Math.round(mix(n[0], dd[0], m)) + ',' + Math.round(mix(n[1], dd[1], m)) + ',' + Math.round(mix(n[2], dd[2], m)) + ')';
    g.fillRect(0, 0, this.cv.width, this.cv.height);

    function pair(name, fn) {
      fn(name + 'N');
      if (m > 0.002) { g.globalAlpha = m; fn(name + 'D'); g.globalAlpha = 1; }
    }
    function size(key) { var im = self.art[key]; return [im.naturalWidth / SNOW, im.naturalHeight / SNOW]; }
    function strip(name, speed) {
      pair(name, function (key) { var z = size(key); self.tile(self.piece(key, z[0], z[1]), z[0], z[1], travel * speed, SNOWY[name]); });
    }

    pair('sky', function (key) { self.blit(self.piece(key, 332, 110), 0, 0, 332, 110); });
    this.drawMoon(moon);
    strip('far', 0.125);
    strip('near', 0.25);
    // END OF THE LINE's station, behind the bridge: the train stands beside the platform.
    var sx = -12 + (4 * L - travel);
    if (sx > -340 && sx < 340) pair('station', function (key) { var z = size(key); self.blit(self.piece(key, z[0], z[1]), sx, SNOWY.station, z[0], z[1]); });
    strip('bridge', 1);
  };

  // The HD train, as the canvas board draws it: reflection, steam, body, wheels, the carriage band
  // and cylinder over the wheels, the side rod, the headlamp beam. `a` is the Snow line's share
  // (its reflection is a little different), `m` its sunrise (dims the beam).
  Scene.prototype.drawTrain = function (d, travel, stopped, bodyKey, a, m) {
    var g = this.g, S = this.S, self = this;
    var bw = BODY_W / B, bh = BODY_H / B;
    var body = this.piece(bodyKey, bw, bh);
    function P(bx, by) { return [BX + bx / B, BY + by / B]; }   // body px -> art px

    // River reflection: the body flipped, squashed and dim, wheels on the reflection's top line.
    var top = mix(181.5, 190, a), sy = mix(0.55, 0.5, a);
    g.save();
    g.globalCompositeOperation = 'lighter';
    g.globalAlpha = mix(0.16, 0.13, a);
    g.translate(0, this.Y(top));
    g.scale(1, -sy);
    g.drawImage(body.im, body.r[0], body.r[1], body.r[2], body.r[3], this.X(BX + Math.sin(d * 2) * 0.4), -bh * S, bw * S, bh * S);
    g.restore();

    // Steam: three puffs while moving, one slow puff while stopped, rising from the chimney.
    var chim = P(1855, 41), puffs = stopped ? 1 : 3;
    for (var i = 0; i < puffs; i++) {
      var ph = ((stopped ? d * 0.3 : d * 0.7) + i / 3) % 1;
      var key = 'steam' + Math.min(4, Math.floor(ph * 5)), im = this.art[key];
      var big = 0.55 * 1.2 / B, kk = (0.45 + 0.75 * ph) / 1.2;
      var pw = im.naturalWidth * big, phh = im.naturalHeight * big;
      var w = pw * kk, h = phh * kk;
      g.globalAlpha = 0.95 * (1 - 0.85 * ph);
      var c = this.piece(key, pw, phh);
      g.drawImage(c.im, c.r[0], c.r[1], c.r[2], c.r[3],
        this.X(chim[0] - w / 2 - ph * (stopped ? 5 : 27.5)), this.Y(chim[1] - h - ph * 17.5), w * S, h * S);
    }
    g.globalAlpha = 1;

    this.blit(body, BX, BY, bw, bh);

    // Wheels roll exactly with the scenery: angle = distance / radius.
    WHEELS.forEach(function (wh) {
      var dia = wh[3] / B, size = dia * 1.015, c = self.piece(wh[0], size, size), p = P(wh[1], wh[2]);
      g.save();
      g.translate(self.X(p[0]), self.Y(p[1]));
      g.rotate(travel / (dia / 2));
      g.drawImage(c.im, c.r[0], c.r[1], c.r[2], c.r[3], -size * S / 2, -size * S / 2, size * S, size * S);
      g.restore();
    });

    // The carriage's bottom edge and the cylinder sit in front of the wheels.
    this.blitPart(body, 0, 0, 1103 / BODY_W, 356 / BODY_H, BX, BY, 1103 / B, 356 / B);
    this.blitPart(body, 1763 / BODY_W, 268 / BODY_H, 115 / BODY_W, 120 / BODY_H, BX + 1763 / B, BY + 268 / B, 115 / B, 120 / B);

    // Side rod: its pins sit on the inner gold dot of each driving wheel and turn with it.
    var ang = travel / (114 / B / 2), cr = 16;
    var p1 = P(1331 + Math.cos(ang) * cr, 381 + Math.sin(ang) * cr), p4 = P(1685 + Math.cos(ang) * cr, 381 + Math.sin(ang) * cr);
    var th = 33.6 / B, rod = this.art.rod, rh = rod.naturalHeight, rl = rod.naturalWidth;
    var x1 = this.X(p1[0]), x4 = this.X(p4[0]), yy = this.Y(p1[1]), thd = th * S;
    g.drawImage(rod, rh, 0, rl - 2 * rh, rh, x1, yy - thd / 2, x4 - x1, thd);
    g.drawImage(rod, 0, 0, rh, rh, x1 - thd / 2, yy - thd / 2, thd, thd);
    g.drawImage(rod, rl - rh, 0, rh, rh, x4 - thd / 2, yy - thd / 2, thd, thd);

    // Headlamp beam, only while moving, weaker as the sun comes up.
    if (!stopped) {
      var lamp = P(1968, 200), lx = this.X(lamp[0]), ly = this.Y(lamp[1]), len = 456 / B * S;
      var h0 = 12 / B * S, h1 = 82 / B * S, al = 0.45 * (1 - 0.5 * m);
      var gr = g.createLinearGradient(lx, 0, lx + len, 0);
      gr.addColorStop(0, 'rgba(255,214,110,' + al + ')'); gr.addColorStop(1, 'rgba(255,214,110,0)');
      g.fillStyle = gr;
      g.beginPath(); g.moveTo(lx, ly - h0); g.lineTo(lx + len, ly - h1); g.lineTo(lx + len, ly + h1); g.lineTo(lx, ly + h0); g.closePath(); g.fill();
    }
  };

  // A shooting star: a short streak of art pixels sliding down-left, fading out.
  Scene.prototype.drawStar = function (star) {
    var c = this.g, p = star.age / star.dur;
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
  var STILL = { t: 0.5, s: 2, d: 0.9, star: null };   // at River Gate, Momo with his tea

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
    var scene = null, asked = {}, snowAt = -1, pageLoaded = false, warmId = 0;
    var idle = window.requestIdleCallback || function (f) { return setTimeout(f, 200); };
    var t = 0, tShown = -1, d = 0, last = 0, raf = 0;
    var star = null, nextStar = 4 + Math.random() * 6;
    var lastClock = '', lastHere = -1, lastSig = [];

    function riding() { return root.classList.contains('ride'); }

    function scrollMax() { return Math.max(1, document.documentElement.scrollHeight - window.innerHeight); }
    function readT() { return Math.min(1, Math.max(0, window.scrollY / scrollMax())); }

    // Fetch an art set once; the scene picks it up when it arrives.
    function fetchSet(name) {
      if (asked[name] || !scene) return;
      asked[name] = true;
      loadSet(dir, SETS[name]).then(function (more) {
        scene.add(more);
        if (name === 'snow') snowAt = d;
        paint();
        warm();
      }, function () { /* ride on without it */ });
    }
    // The rest of the ride's art, once the first screen is done (or sooner, see frame()).
    function fetchLater() {
      if (!pageLoaded || !scene) return;
      idle(function () { fetchSet('halt'); if (riding()) fetchSet('snow'); }, { timeout: 2000 });
    }

    function size() {
      var r = canvas.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
      return [Math.max(1, Math.round(r.width * dpr)), Math.max(1, Math.round(r.height * dpr))];
    }
    function resize(w, h) {
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
      if (!scene) return;
      scene.layout();
      paint();
      warm();
    }
    // Once things settle, prepare whatever art the ride will need next at this size.
    function warm() {
      if (warmId) return;
      warmId = idle(function () { warmId = 0; if (scene && riding()) scene.warm(); }, { timeout: 1000 });
    }

    function paint() {
      if (!scene) return;
      if (!riding()) { scene.draw(STILL); return; }
      var tv = Math.max(0, tShown);
      scene.draw({ t: tv, s: sOf(tv), d: d, star: star, snowIn: snowAt < 0 ? 0 : Math.min(1, (d - snowAt) / 0.6) });
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

      // Follow the scroll position with a little easing so the train glides.
      t = readT();
      if (tShown < 0) tShown = t;
      else {
        tShown += (t - tShown) * (1 - Math.exp(-dt * 14));
        if (Math.abs(t - tShown) < 0.00005) tShown = t;
      }
      var s = sOf(tShown);
      // Past CENTRAL: the rest of the line's art is needed soon.
      if (s > 0.5) { fetchSet('halt'); fetchSet('snow'); }

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
      if (still) fetchSet('halt'); else fetchLater();
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

    function onLoad() { pageLoaded = true; fetchLater(); }
    if (document.readyState === 'complete') pageLoaded = true;
    else window.addEventListener('load', onLoad);

    loadSet(dir, SETS.core).then(function (art) {
      scene = new Scene(canvas, art);
      var sz = size(); resize(sz[0], sz[1]);
      if (riding()) {
        var hit = signs.filter(function (el) { return '#' + el.id === location.hash; })[0];
        if (hit) goTo(+hit.getAttribute('data-station'), false);
        flap();
        raf = requestAnimationFrame(frame);
        fetchLater();
      } else fetchSet('halt');
    });

    if (reduceQ) {
      var onChange = setMode;
      if (reduceQ.addEventListener) reduceQ.addEventListener('change', onChange);
      else if (reduceQ.addListener) reduceQ.addListener(onChange);
    }
  }

  window.MoonrailScene = { Scene: Scene, sOf: sOf, load: loadSet, SETS: SETS };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
