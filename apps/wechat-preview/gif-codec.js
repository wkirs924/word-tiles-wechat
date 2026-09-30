(function (root, factory) {
  var api = factory(); root.WordTilesGif = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof GameGlobal !== 'undefined' ? GameGlobal : globalThis, function () {
  'use strict';
  // Bounded GIF89a decoder. No DOM/WeChat dependencies; disposal and interlace
  // are applied before sampling, so skipped frames do not corrupt later frames.
  var MAX_FILE = 2 * 1024 * 1024;
  function invalid(message) { throw new Error(message || 'GIF 文件损坏或不受支持'); }
  function parse(input) {
    var bytes = new Uint8Array(input), at = 0;
    if (bytes.length < 14 || bytes.length > MAX_FILE) invalid('图片须小于 2 MB');
    function u8() { if (at >= bytes.length) invalid(); return bytes[at++]; }
    function u16() { return u8() | (u8() << 8); }
    function take(n) { if (at + n > bytes.length) invalid(); var v = bytes.subarray(at, at + n); at += n; return v; }
    function blocks() {
      var pieces = [], size = 0, n;
      while ((n = u8())) { pieces.push(take(n)); size += n; }
      var joined = new Uint8Array(size), offset = 0;
      pieces.forEach(function (p) { joined.set(p, offset); offset += p.length; }); return joined;
    }
    var signature = String.fromCharCode.apply(null, take(6));
    if (signature !== 'GIF87a' && signature !== 'GIF89a') invalid();
    var width = u16(), height = u16(), packed = u8(), background = u8(); u8();
    if (!width || !height || width > 1024 || height > 1024) invalid('GIF 宽高不能超过 1024 像素');
    var palette = packed & 128 ? take(3 * (1 << ((packed & 7) + 1))) : null;
    var frames = [], duration = 0, pixels = 0, gce = null, ended = false;
    while (at < bytes.length) {
      var tag = u8();
      if (tag === 59) { ended = true; break; }
      if (tag === 33) {
        var type = u8();
        if (type === 249) {
          if (u8() !== 4) invalid();
          var flags = u8(), delay = u16(), transparent = u8(); if (u8() !== 0) invalid();
          var disposal = (flags >> 2) & 7; if (disposal > 3) invalid();
          gce = {disposal: disposal, delay: Math.max(20, delay * 10 || 100), transparent: flags & 1 ? transparent : -1};
        } else {
          // Plain text rendering is intentionally unsupported, not silently lost.
          if (type === 1) invalid('暂不支持包含文字绘制扩展的 GIF');
          blocks();
        }
      } else if (tag === 44) {
        var x = u16(), y = u16(), w = u16(), h = u16(), info = u8();
        if (!w || !h || x + w > width || y + h > height) invalid();
        var colors = info & 128 ? take(3 * (1 << ((info & 7) + 1))) : palette;
        if (!colors) invalid();
        var minCode = u8(); if (minCode < 2 || minCode > 8) invalid();
        var control = gce || {disposal: 0, delay: 100, transparent: -1};
        frames.push({x: x, y: y, width: w, height: h, interlace: !!(info & 64), colors: colors,
          minCode: minCode, data: blocks(), disposal: control.disposal, delay: control.delay, transparent: control.transparent});
        gce = null; duration += control.delay; pixels += w * h;
        if (frames.length > 300 || duration > 30000 || pixels > 50000000) invalid('GIF 过长：最多 30 秒、300 帧，请裁剪后添加');
      } else invalid();
    }
    if (!ended || !frames.length) invalid();
    return {width: width, height: height, background: background, palette: palette, frames: frames, duration: duration};
  }
  function lzw(frame) {
    var clear = 1 << frame.minCode, end = clear + 1, next = end + 1, size = frame.minCode + 1;
    var prefix = new Uint16Array(4096), suffix = new Uint8Array(4096), stack = new Uint8Array(4097);
    var output = new Uint8Array(frame.width * frame.height), out = 0, bit = 0, previous = -1, first = 0, ended = false;
    for (var i = 0; i < clear; i++) suffix[i] = i;
    while (bit + size <= frame.data.length * 8) {
      var code = 0;
      for (var b = 0; b < size; b++) code |= ((frame.data[(bit + b) >> 3] >> ((bit + b) & 7)) & 1) << b;
      bit += size;
      if (code === clear) { next = end + 1; size = frame.minCode + 1; previous = -1; continue; }
      if (code === end) { ended = true; break; }
      var original = code, depth = 0;
      if (code > next || code >= 4096 || (previous < 0 && code >= clear)) invalid();
      if (code === next) { if (previous < 0) invalid(); stack[depth++] = first; code = previous; }
      while (code >= clear) { if (code >= next || depth > 4095) invalid(); stack[depth++] = suffix[code]; code = prefix[code]; }
      first = suffix[code]; stack[depth++] = first;
      while (depth) { if (out >= output.length) invalid(); output[out++] = stack[--depth]; }
      if (previous >= 0 && next < 4096) {
        prefix[next] = previous; suffix[next++] = first;
        if (next === (1 << size) && size < 12) size++;
      }
      previous = original;
    }
    if (!ended || out !== output.length) invalid(); return output;
  }
  function decode(input, posterOnly) {
    var gif;
    try { gif = parse(input); } catch (error) { return Promise.reject(error); }
    var ratio = Math.min(1, 256 / Math.max(gif.width, gif.height));
    var width = Math.max(1, Math.round(gif.width * ratio)), height = Math.max(1, Math.round(gif.height * ratio));
    var count = posterOnly ? 1 : Math.max(1, Math.min(32, gif.frames.length, Math.max(2, Math.floor(gif.duration / 83.34))));
    var frameMs = gif.duration / count, sampled = [], composite = new Uint8ClampedArray(gif.width * gif.height * 4);
    var index = 0, time = 0, nextSample = 0, previous = null, restore = null;
    function fill(rect, transparent) {
      var p = gif.palette, bg = gif.background * 3;
      for (var y = rect.y; y < rect.y + rect.height; y++) for (var x = rect.x; x < rect.x + rect.width; x++) {
        var offset = (y * gif.width + x) * 4;
        composite[offset] = !transparent && p && p[bg] || 0;
        composite[offset + 1] = !transparent && p && p[bg + 1] || 0;
        composite[offset + 2] = !transparent && p && p[bg + 2] || 0;
        composite[offset + 3] = transparent || !p ? 0 : 255;
      }
    }
    fill({x: 0, y: 0, width: gif.width, height: gif.height}, gif.frames[0].transparent >= 0);
    return new Promise(function (resolve, reject) {
      function step() {
        try {
          var batch = 0;
          while (index < gif.frames.length && batch++ < 3) {
            if (previous && previous.disposal === 2) fill(previous, previous.transparent >= 0);
            else if (previous && previous.disposal === 3 && restore) composite.set(restore);
            var frame = gif.frames[index++]; restore = frame.disposal === 3 ? composite.slice() : null;
            var data = lzw(frame), rows = [], y, x;
            if (frame.interlace) {
              var starts = [0, 4, 2, 1], strides = [8, 8, 4, 2];
              for (var pass = 0; pass < 4; pass++) for (y = starts[pass]; y < frame.height; y += strides[pass]) rows.push(y);
            } else for (y = 0; y < frame.height; y++) rows.push(y);
            for (y = 0; y < frame.height; y++) for (x = 0; x < frame.width; x++) {
              var color = data[y * frame.width + x]; if (color === frame.transparent) continue;
              if (color * 3 + 2 >= frame.colors.length) invalid();
              var target = ((rows[y] + frame.y) * gif.width + x + frame.x) * 4;
              composite[target] = frame.colors[color * 3]; composite[target + 1] = frame.colors[color * 3 + 1];
              composite[target + 2] = frame.colors[color * 3 + 2]; composite[target + 3] = 255;
            }
            while (nextSample < count && nextSample * frameMs < time + frame.delay) {
              var rgba = new Uint8ClampedArray(width * height * 4);
              for (y = 0; y < height; y++) for (x = 0; x < width; x++) {
                var src = (Math.min(gif.height - 1, Math.floor((y + 0.5) / ratio)) * gif.width +
                  Math.min(gif.width - 1, Math.floor((x + 0.5) / ratio))) * 4, dst = (y * width + x) * 4;
                rgba[dst] = composite[src]; rgba[dst + 1] = composite[src + 1]; rgba[dst + 2] = composite[src + 2]; rgba[dst + 3] = composite[src + 3];
              }
              sampled.push(rgba); nextSample++;
            }
            previous = frame; time += frame.delay;
            if (posterOnly) break;
          }
          if (index < gif.frames.length && !posterOnly) setTimeout(step, 0);
          else resolve({width: width, height: height, frames: sampled, frame_ms: frameMs, duration: gif.duration});
        } catch (error) { reject(error); }
      }
      step();
    });
  }
  return {inspect: parse, decode: decode};
});
