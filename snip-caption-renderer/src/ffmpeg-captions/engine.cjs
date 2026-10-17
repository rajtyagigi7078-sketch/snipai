'use strict';

const fs = require('node:fs');
const path = require('node:path');

const TEMPLATES = Object.freeze({
  pop: { primaryColor: '#FFFFFF', accentColor: '#FFE500', fontSize: 64, weight: 900, wordsPerLine: 5, gap: 0.12, opacity: 0.72, animation: 'pop', shadow: true, verticalPosition: 0.62 },
  karaoke: { primaryColor: '#D9D9D9', accentColor: '#00E5FF', fontSize: 62, weight: 800, wordsPerLine: 5, gap: 0.10, opacity: 0.92, animation: 'karaoke', shadow: true, verticalPosition: 0.62 },
  'bold-center': { primaryColor: '#FFFFFF', accentColor: '#FFFFFF', fontSize: 76, weight: 900, wordsPerLine: 1, gap: 0.10, opacity: 1, animation: 'fade', fadeInDuration: 0.16, shadow: true, verticalPosition: 0.62 },
  punch: { primaryColor: '#FFFFFF', accentColor: '#FF2A2A', fontSize: 66, weight: 900, wordsPerLine: 5, gap: 0.12, opacity: 0.72, animation: 'punch', shadow: true, verticalPosition: 0.62 },
  minimal: { primaryColor: '#F5F5F5', accentColor: '#FFFFFF', fontSize: 48, weight: 700, wordsPerLine: 1, gap: 0.08, opacity: 1, animation: 'single-fade', fadeInDuration: 0.22, shadow: false, verticalPosition: 0.60 },
  'highlight-box': { primaryColor: '#FFFFFF', accentColor: '#FFFFFF', boxColor: '#0F766E', fontSize: 60, weight: 800, wordsPerLine: 5, gap: 0.12, opacity: 0.9, animation: 'side-reveal', fadeInDuration: 0.16, shadow: true, verticalPosition: 0.62 },
  typewriter: { primaryColor: '#FFFFFF', accentColor: '#22C55E', fontSize: 58, weight: 800, wordsPerLine: 5, gap: 0.10, opacity: 0.95, animation: 'typewriter', shadow: true, verticalPosition: 0.62 },
  bounce: { primaryColor: '#FFFFFF', accentColor: '#FF2D9A', fontSize: 68, weight: 900, wordsPerLine: 4, gap: 0.12, opacity: 0.72, animation: 'single-fade', fadeInDuration: 0.14, shadow: true, verticalPosition: 0.62 },
  kinetic: { primaryColor: '#FFFFFF', accentColor: '#00E5FF', fontSize: 64, weight: 900, wordsPerLine: 5, gap: 0.12, opacity: 0.76, animation: 'kinetic', shadow: true, verticalPosition: 0.62 },
  podcast: { primaryColor: '#FFFFFF', accentColor: '#FFD928', boxColor: '#161616', fontSize: 52, weight: 700, wordsPerLine: 6, gap: 0.10, opacity: 0.95, animation: 'podcast', shadow: true, verticalPosition: 0.62 },
  'yellow-stack': { primaryColor: '#FFD928', accentColor: '#FFD928', fontSize: 72, weight: 900, wordsPerLine: 3, gap: 0.08, opacity: 1, animation: 'dual-line', shadow: true, verticalPosition: 0.62, secondaryFontSize: 68, dualSecondaryColor: '#FFD928' },
  'violet-pill': { primaryColor: '#FFFFFF', accentColor: '#FFFFFF', boxColor: '#8B5CF6', fontSize: 64, weight: 800, wordsPerLine: 4, gap: 0.10, opacity: 0.90, animation: 'blur-in', fadeInDuration: 0.16, shadow: true, verticalPosition: 0.62 },
  'dual-line': { primaryColor: '#FFD928', accentColor: '#FFD928', secondaryColor: '#FFFFFF', fontSize: 64, weight: 900, wordsPerLine: 3, gap: 0.08, opacity: 0.94, animation: 'dual-line', shadow: true, verticalPosition: 0.62, secondaryFontSize: 48, dualPrimaryUppercase: true },
  'bold-karaoke': { primaryColor: '#FFFFFF', accentColor: '#FFD928', fontSize: 64, weight: 900, wordsPerLine: 4, gap: 0.10, opacity: 0.76, animation: 'fade', fadeInDuration: 0.12, shadow: true, verticalPosition: 0.62, uppercase: true },
  'soft-lyric': { primaryColor: '#F4F1EA', accentColor: '#FFFFFF', fontSize: 48, weight: 700, wordsPerLine: 5, gap: 0.08, opacity: 0.72, animation: 'single-fade', fadeInDuration: 0.22, shadow: true, verticalPosition: 0.60 },
});

function escapeText(value) {
  // drawtext filter option escaping. Use textfile in production for arbitrary
  // user text; escaping here supports the common inline filter path.
  return String(value).replace(/\\/g, '\\\\').replace(/'/g, "'\\''").replace(/:/g, '\\:').replace(/%/g, '\\%').replace(/,/g, '\\,').replace(/\[/g, '\\[').replace(/\]/g, '\\]').replace(/;/g, '\\;').replace(/\n/g, ' ');
}
function color(value) { return String(value || '#FFFFFF').replace(/^#/, '0x'); }
function finite(value, fallback) { const n = Number(value); return Number.isFinite(n) ? n : fallback; }
const fontMetricCache = new Map();

function readFontMetrics(fontFile) {
  if (!fontFile) return null;
  const key = path.resolve(fontFile);
  if (fontMetricCache.has(key)) return fontMetricCache.get(key);
  try {
    const data = fs.readFileSync(key);
    const u16 = (at) => data.readUInt16BE(at);
    const u32 = (at) => data.readUInt32BE(at);
    const tables = new Map();
    const count = u16(4);
    for (let i = 0; i < count; i += 1) {
      const entry = 12 + i * 16;
      tables.set(data.toString('ascii', entry, entry + 4), { offset: u32(entry + 8), length: u32(entry + 12) });
    }
    const head = tables.get('head');
    const hhea = tables.get('hhea');
    const maxp = tables.get('maxp');
    const cmap = tables.get('cmap');
    const hmtx = tables.get('hmtx');
    if (!head || !hhea || !maxp || !cmap || !hmtx) throw new Error('Required TrueType tables are missing');
    const unitsPerEm = u16(head.offset + 18);
    const metricCount = u16(hhea.offset + 34);
    const glyphCount = u16(maxp.offset + 4);
    const advances = new Uint16Array(glyphCount);
    let lastAdvance = 0;
    for (let i = 0; i < glyphCount; i += 1) {
      if (i < metricCount) lastAdvance = u16(hmtx.offset + i * 4);
      advances[i] = lastAdvance;
    }
    let format4 = null;
    let format12 = null;
    const cmapCount = u16(cmap.offset + 2);
    for (let i = 0; i < cmapCount; i += 1) {
      const record = cmap.offset + 4 + i * 8;
      const sub = cmap.offset + u32(record + 4);
      const format = u16(sub);
      if (format === 12) format12 = { offset: sub, groups: u32(sub + 12) };
      if (format === 4) format4 = { offset: sub, segments: u16(sub + 6) / 2 };
    }
    const glyphFor = (code) => {
      if (code > 0xFFFF && format12) {
        let lo = 0, hi = format12.groups - 1;
        while (lo <= hi) {
          const mid = (lo + hi) >> 1;
          const group = format12.offset + 16 + mid * 12;
          const start = u32(group), end = u32(group + 4);
          if (code < start) hi = mid - 1;
          else if (code > end) lo = mid + 1;
          else return u32(group + 8) + code - start;
        }
      }
      if (!format4 || code > 0xFFFF) return 0;
      const base = format4.offset;
      const endBase = base + 14;
      const startBase = endBase + format4.segments * 2 + 2;
      const deltaBase = startBase + format4.segments * 2;
      const rangeBase = deltaBase + format4.segments * 2;
      for (let i = 0; i < format4.segments; i += 1) {
        const end = u16(endBase + i * 2);
        const start = u16(startBase + i * 2);
        if (code < start || code > end) continue;
        const delta = data.readInt16BE(deltaBase + i * 2);
        const range = u16(rangeBase + i * 2);
        if (!range) return (code + delta) & 0xFFFF;
        const glyphAt = rangeBase + i * 2 + range + (code - start) * 2;
        const glyph = u16(glyphAt);
        return glyph ? (glyph + delta) & 0xFFFF : 0;
      }
      return 0;
    };
    const metrics = { unitsPerEm, advances, glyphFor };
    fontMetricCache.set(key, metrics);
    return metrics;
  } catch (_) {
    fontMetricCache.set(key, null);
    return null;
  }
}

function measureText(text, size, ctx, fontFile) {
  if (ctx && typeof ctx.measureText === 'function') return ctx.measureText(text).width;
  const metrics = readFontMetrics(fontFile);
  if (metrics) {
    let advance = 0;
    for (const character of text) advance += metrics.advances[metrics.glyphFor(character.codePointAt(0))] || 0;
    return advance * size / metrics.unitsPerEm;
  }
  // Last-resort estimate for environments where no canvas or TrueType font is available.
  let units = 0;
  for (const ch of text) {
    if ("ilI.,'!:;|".includes(ch)) units += 0.30;
    else if ('mwMW@%&'.includes(ch)) units += 0.88;
    else if ('ABCDEFGHKNOPQRSTUVXYZ'.includes(ch)) units += 0.68;
    else if (ch === ' ') units += 0.32;
    else units += 0.56;
  }
  return units * size;
}
function resolveTemplate(name, overrides = {}) {
  const key = String(name || 'pop').toLowerCase();
  const template = TEMPLATES[key];
  if (!template) throw new Error(`Unknown caption template "${name}". Available: ${Object.keys(TEMPLATES).join(', ')}`);
  return { key, ...template, ...overrides };
}
function normalizeWords(words) {
  if (!Array.isArray(words)) throw new TypeError('words must be an array');
  return words.map((w, i) => {
    const text = String(w && w.text != null ? w.text : '').trim();
    const start = finite(w && w.start, NaN);
    const end = finite(w && w.end, NaN);
    if (!text) return null;
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) {
      throw new Error(`Invalid word timing at index ${i}: ${JSON.stringify(w)}`);
    }
    return { text, start, end };
  }).filter(Boolean).sort((a, b) => a.start - b.start);
}
function wrapWords(words, options, ctx) {
  const maxWidth = options.width * finite(options.safeWidthRatio, 0.84);
  const gap = options.fontSize * Math.min(0.18, Math.max(0.06, finite(options.gap, 0.12)));
  const scaleReserve = options.animation === 'punch' ? 1.22 : (options.animation === 'pop' ? 1.14 : (options.animation === 'bounce' ? 1.12 : (options.animation === 'kinetic' ? 1.08 : 1.04)));
  const measure = (word) => {
    const fontSize = finite(word.fontSize, options.fontSize);
    const isSecondary = word.fontKey === 'secondary' && options.secondaryFontFamily;
    const family = isSecondary ? options.secondaryFontFamily : options.primaryFontFamily;
    const weight = finite(word.fontWeight, isSecondary ? 700 : options.weight);
    if (ctx) ctx.font = `${weight} ${fontSize}px ${family}`;
    const fontFile = isSecondary ? options.secondaryFontFile : options.fontFile;
    const measuredWidth = measureText(word.text, fontSize, ctx, fontFile);
    return { ...word, fontSize, measuredWidth, reservedWidth: measuredWidth * scaleReserve };
  };

  if (options.animation === 'dual-line') {
    const lines = [];
    let cursor = 0;
    while (cursor < words.length) {
      const chunk = words.slice(cursor, cursor + Math.max(2, options.wordsPerLine * 2));
      const splitAt = Math.ceil(chunk.length / 2);
      const groupStart = chunk[0].start;
      const groupEnd = chunk[chunk.length - 1].end;
      for (const [rowIndex, rawRow] of [[0, chunk.slice(0, splitAt)], [1, chunk.slice(splitAt)]]) {
        if (!rawRow.length) continue;
        const row = rawRow.map((word) => ({
          ...word,
          text: rowIndex === 0 && options.dualPrimaryUppercase ? word.text.toUpperCase() : word.text,
          rowIndex,
          fontKey: rowIndex === 1 && options.secondaryFontFamily ? 'secondary' : 'primary',
          fontSize: rowIndex === 1 ? finite(options.secondaryFontSize, options.fontSize * 0.82) : options.fontSize,
          fontWeight: rowIndex === 1 ? 700 : options.weight,
        })).map(measure);
        row.groupStart = groupStart;
        row.groupEnd = groupEnd;
        row.rowIndex = rowIndex;
        lines.push(row);
      }
      cursor += chunk.length;
    }
    return lines;
  }

  if (options.animation === 'kinetic') {
    const lines = [];
    let cursor = 0;
    let groupId = 0;
    while (cursor < words.length) {
      const remaining = words.slice(cursor).map(measure);
      let chunkSize = Math.min(6, remaining.length);
      if (chunkSize > 2) {
        const row2 = remaining.slice(2, chunkSize);
        const row2Width = row2.reduce((sum, w) => sum + w.reservedWidth, 0) + gap * Math.max(0, row2.length - 1);
        while (chunkSize > 3 && row2Width > maxWidth) {
          chunkSize -= 1;
          const retry = remaining.slice(2, chunkSize);
          if (retry.reduce((sum, w) => sum + w.reservedWidth, 0) + gap * Math.max(0, retry.length - 1) <= maxWidth) break;
        }
      }
      const chunk = remaining.slice(0, chunkSize);
      const firstRow = chunk.slice(0, Math.min(2, chunk.length));
      const secondRow = chunk.slice(2);
      const groupStart = chunk[0].start;
      const groupEnd = chunk[chunk.length - 1].end;
      for (const [rowIndex, row] of [[0, firstRow], [1, secondRow]]) {
        if (!row.length) continue;
        row.groupId = groupId;
        row.groupStart = groupStart;
        row.groupEnd = groupEnd;
        row.rowIndex = rowIndex;
        lines.push(row);
      }
      cursor += chunkSize;
      groupId += 1;
    }
    return lines;
  }

  const lines = [];
  let current = [], width = 0;
  for (const word of words) {
    const measured = measure(word);
    const needed = current.length ? gap + measured.reservedWidth : measured.reservedWidth;
    if (current.length && (current.length >= options.wordsPerLine || width + needed > maxWidth)) {
      lines.push(current); current = []; width = 0;
    }
    current.push(measured);
    width += current.length === 1 ? measured.reservedWidth : gap + measured.reservedWidth;
  }
  if (current.length) lines.push(current);
  return lines;
}
function animationExpression(animation, start, fontSize) {
  const t = start.toFixed(3);
  if (animation === 'pop') return `1+0.14*max(0\\,1-(t-${t})/0.16)`;
  if (animation === 'punch') return `1+0.22*max(0\\,1-(t-${t})/0.18)`;
  if (animation === 'bounce' || animation === 'kinetic') return String(1);
  return String(1);
}
function buildCaptionFilter(inputWords, userOptions = {}) {
  const base = resolveTemplate(userOptions.template || 'pop', userOptions);
  const options = {
    ...base,
    width: Math.max(1, Math.round(finite(userOptions.width, 1080))),
    height: Math.max(1, Math.round(finite(userOptions.height, 1920))),
    fontSize: Math.max(12, finite(userOptions.fontSize, base.fontSize)),
    wordsPerLine: Math.max(1, Math.floor(finite(userOptions.wordsPerLine, base.wordsPerLine))),
  };
  options.wordsPerLine = options.maxWordsPerLine || options.wordsPerLine;
  let words = normalizeWords(inputWords);
  if (options.uppercase) words = words.map((word) => ({ ...word, text: word.text.toUpperCase() }));
  if (!words.length) return { filter: '', wordCount: 0, lineCount: 0, template: base.key };

  let ctx = null;
  const fontFile = userOptions.fontFile ? path.resolve(userOptions.fontFile) : null;
  const secondaryFontFile = userOptions.secondaryFontFile ? path.resolve(userOptions.secondaryFontFile) : null;
  if (fontFile && !fs.existsSync(fontFile)) throw new Error(`Font file not found: ${fontFile}`);
  if (secondaryFontFile && !fs.existsSync(secondaryFontFile)) throw new Error(`Secondary font file not found: ${secondaryFontFile}`);
  options.primaryFontFamily = fontFile ? 'SnipCaptionFont' : 'sans-serif';
  options.fontFile = fontFile;
  options.secondaryFontFile = secondaryFontFile || fontFile;
  options.secondaryFontFamily = secondaryFontFile ? 'SnipCaptionSecondaryFont' : options.primaryFontFamily;
  try {
    const { createCanvas, GlobalFonts } = require('@napi-rs/canvas');
    if (fontFile) GlobalFonts.registerFromPath(fontFile, 'SnipCaptionFont');
    if (secondaryFontFile) GlobalFonts.registerFromPath(secondaryFontFile, 'SnipCaptionSecondaryFont');
    ctx = createCanvas(8, 8).getContext('2d');
    ctx.font = `${Math.max(100, finite(options.weight, 800))} ${options.fontSize}px ${options.primaryFontFamily}`;
  } catch (_) { /* optional fallback is intentionally supported */ }

  const lines = wrapWords(words, options, ctx);
  const lineHeight = options.fontSize * Math.min(1.34, Math.max(1.18, finite(userOptions.lineHeightRatio, finite(base.lineHeightRatio, 1.24))));
  // Keep captions in a stable lower-middle safe area across canvas sizes.
  const captionCenterY = Math.round(options.height * finite(userOptions.verticalPosition, finite(base.verticalPosition, 0.62)));
  const captionTopY = captionCenterY - options.fontSize / 2;
  const kineticStartY = captionCenterY - lineHeight;
  const dualLineTopY = captionCenterY - lineHeight / 2 - options.fontSize / 2;
  const fontOption = fontFile ? `fontfile='${escapeText(fontFile.replace(/\\/g, '/'))}':` : '';
  const secondaryFontOption = secondaryFontFile ? `fontfile='${escapeText(secondaryFontFile.replace(/\\/g, '/'))}':` : fontOption;
  const shadow = options.shadow ? ':shadowcolor=black@0.55:shadowx=2:shadowy=2' : '';
  const filters = [];

  lines.forEach((line, lineIndex) => {
    const gap = options.fontSize * Math.min(0.18, Math.max(0.06, finite(options.gap, 0.12)));
    const lineWidth = line.reduce((sum, w) => sum + w.measuredWidth, 0) + gap * Math.max(0, line.length - 1);
    let cursor = (options.width - lineWidth) / 2;
    const y = options.animation === 'kinetic'
      ? kineticStartY + (line.rowIndex || 0) * lineHeight
      : options.animation === 'dual-line'
        ? dualLineTopY + (line.rowIndex || 0) * lineHeight
        : captionTopY; // Keep each timed caption line on the same stable vertical anchor.
    const hasTimedGroup = options.animation === 'kinetic' || options.animation === 'dual-line';
    const lineStart = (hasTimedGroup ? line.groupStart : line[0].start).toFixed(3);
    const lineEnd = (hasTimedGroup ? line.groupEnd : line[line.length - 1].end).toFixed(3);
    const lineEnable = `between(t\\,${lineStart}\\,${lineEnd})`;

    // Typewriter is rendered as cumulative text prefixes, not separately
    // positioned glyphs. This preserves real FFmpeg font kerning/spacing.
    if (base.key === 'typewriter') {
      const reveal = [];
      line.forEach((item, itemIndex) => {
        const chars = Array.from(item.text);
        const charDuration = (item.end - item.start) / Math.max(1, chars.length);
        chars.forEach((character, charIndex) => {
          reveal.push({
            character,
            at: item.start + charIndex * charDuration,
          });
        });
        if (itemIndex < line.length - 1) {
          reveal.push({ character: ' ', at: item.end });
        }
      });
      let prefix = '';
      const lineWidth = measureText(line.map((item) => item.text).join(' '), options.fontSize, ctx);
      const lineX = Math.max(0, (options.width - lineWidth) / 2);
      reveal.forEach((item, revealIndex) => {
        prefix += item.character;
        const prefixStart = Math.max(Number(lineStart), item.at);
        const nextStart = revealIndex + 1 < reveal.length
          ? Math.max(prefixStart + 0.001, reveal[revealIndex + 1].at)
          : Number(lineEnd);
        const prefixText = `${fontOption}text='${escapeText(prefix)}':expansion=none:fix_bounds=true`;
        filters.push(`drawtext=${prefixText}:x=${lineX.toFixed(2)}:y=${y.toFixed(2)}:fontsize=${options.fontSize}:fontcolor=${color(options.accentColor)}:alpha='if(between(t\\,${prefixStart.toFixed(3)}\\,${nextStart.toFixed(3)})\\,1\\,0)':enable='between(t\\,${prefixStart.toFixed(3)}\\,${nextStart.toFixed(3)})'${shadow}`);
      });
      return;
    }

    // Podcast uses a fixed word panel. Only the yellow active word changes;
    // the panel does not scale, bounce, or move.
    if (base.key === 'podcast') {
      let slotCursor = (options.width - lineWidth) / 2;
      line.forEach((item) => {
        const left = Math.max(0, slotCursor - 12);
        const boxW = item.reservedWidth + 24;
        const boxH = options.fontSize * 1.02;
        const active = `between(t\,${item.start.toFixed(3)}\,${item.end.toFixed(3)})`;
        filters.push(`drawbox=x=${left.toFixed(2)}:y=${(y + options.fontSize * 0.07).toFixed(2)}:w=${boxW.toFixed(2)}:h=${boxH.toFixed(2)}:color=0x161616@0.78:t=fill:enable='${active}'`);
        slotCursor += item.reservedWidth + gap;
      });
    }

    line.forEach((word, wordIndex) => {
      const slotX = cursor;
      const centerX = slotX + word.measuredWidth / 2;
      cursor += word.measuredWidth + gap;
      const text = escapeText(word.text);
      const active = `between(t\\,${word.start.toFixed(3)}\\,${word.end.toFixed(3)})`;
      const fontSize = finite(word.fontSize, options.fontSize);
      const wordFontOption = word.fontKey === 'secondary' ? secondaryFontOption : fontOption;
      const common = `${wordFontOption}text='${text}':expansion=none:fix_bounds=true`;
      const baseX = centerX - word.measuredWidth / 2;
      const singleWord = base.key === 'bold-center' || base.key === 'minimal' || base.key === 'typewriter';
      const baseAlpha = options.animation === 'kinetic' || options.animation === 'dual-line'
        ? `if(between(t\\,${word.start.toFixed(3)}\\,${word.end.toFixed(3)})\\,0\\,if(between(t\\,${word.end.toFixed(3)}\\,${lineEnd})\\,${finite(options.opacity, 0.9)}\\,0))`
        : singleWord ? '0' : `if(${active}\\,0\\,if(${lineEnable}\\,${finite(options.opacity, 0.9)}\\,0))`;
      const baseColor = options.animation === 'dual-line'
        ? (word.rowIndex === 0 ? options.dualPrimaryColor || options.primaryColor : options.dualSecondaryColor || options.secondaryColor || options.primaryColor)
        : options.primaryColor;
      const baseLayer = `drawtext=${common}:x=${baseX.toFixed(2)}:y=${y.toFixed(2)}:fontsize=${fontSize}:fontcolor=${color(baseColor)}:alpha='${baseAlpha}':enable='${lineEnable}'${shadow}`;
      filters.push(baseLayer);

      let activeColor = options.animation === 'dual-line'
        ? (word.rowIndex === 0 ? options.dualPrimaryColor || options.accentColor : options.dualSecondaryColor || options.secondaryColor || options.accentColor)
        : options.accentColor;
      if (base.key === 'punch') activeColor = (wordIndex + lineIndex) % 2 === 0 ? '#FF2A2A' : '#FFE600';
      let boxOption = '';
      if (base.key === 'highlight-box' || base.key === 'violet-pill') {
        activeColor = options.primaryColor;
        boxOption = `:box=1:boxcolor=${color(options.boxColor || '#0F766E')}@0.98:boxborderw=${Math.round(options.fontSize * 0.18)}`;
      }
      const scale = animationExpression(options.animation, word.start, fontSize);
      const activeX = options.animation === 'punch'
        ? `${centerX.toFixed(2)}-text_w/2+(1-min(1,max(0,(t-${word.start.toFixed(3)})/0.12)))*${wordIndex % 2 === 0 ? '-86' : '86'}`
        : options.animation === 'side-reveal'
          ? `${centerX.toFixed(2)}-text_w/2+(1-min(1\,max(0\,(t-${word.start.toFixed(3)})/0.16)))*22`
          : `${centerX.toFixed(2)}-text_w/2`;
      let yExpr = `${(y + fontSize / 2).toFixed(2)}-text_h/2`;
      let activeAlpha = `if(${active}\\,1\\,0)`;
      if (base.key === 'karaoke') {
        const blurProgress = `min(1\\,max(0\\,(t-${word.start.toFixed(3)})/0.24))`;
        const haloAlpha = `if(${active}\\,0.30*(1-${blurProgress})\\,0)`;
        for (const [dx, dy] of [[-5,0],[5,0],[0,-5],[0,5],[-3,-3],[3,-3],[-3,3],[3,3]]) {
          filters.push(`drawtext=${common}:x='${centerX.toFixed(2)}-text_w/2+(${dx})*(1-${blurProgress})':y='${yExpr}+(${dy})*(1-${blurProgress})':fontsize=${options.fontSize}:fontcolor=${color(options.accentColor)}:alpha='${haloAlpha}':enable='${active}'${shadow}`);
        }
      }

      if (options.animation === 'blur-in') {
        const blurProgress = `min(1\,max(0\,(t-${word.start.toFixed(3)})/0.16))`;
        const blurAlpha = `if(${active}\,0.18*(1-${blurProgress})\,0)`;
        const blurColor = color(options.boxColor || options.accentColor);
        for (const [dx, dy] of [[-4,0],[4,0],[0,-4],[0,4],[-3,-3],[3,-3],[-3,3],[3,3]]) {
          filters.push(`drawtext=${common}:x='${centerX.toFixed(2)}-text_w/2+(${dx})*(1-${blurProgress})':y='${yExpr}+(${dy})*(1-${blurProgress})':fontsize=${fontSize}:fontcolor=${blurColor}:alpha='${blurAlpha}':enable='${active}'${shadow}`);
        }
      }

      if (options.animation === 'fade' || options.animation === 'single-fade' || options.animation === 'side-reveal' || options.animation === 'blur-in') {
        const fadeDuration = finite(options.fadeInDuration, 0.10);
        activeAlpha = `if(${active}\\,min(1,(t-${word.start.toFixed(3)})/${fadeDuration.toFixed(3)})\\,0)`;
      }
      if (options.animation === 'karaoke') activeAlpha = `if(${active}\\,min(1\\,max(0\\,(t-${word.start.toFixed(3)})/0.24))\\,0)`;
      if (options.animation === 'kinetic') activeAlpha = `if(${active}\\,min(1\\,max(0\\,(t-${word.start.toFixed(3)})/0.22))\\,0)`;
      if (options.animation === 'pop' || options.animation === 'punch' || options.animation === 'bounce') activeAlpha = `if(${active}\\,min(1,(t-${word.start.toFixed(3)})/0.07)\\,0)`;
      if (options.animation === 'single') activeAlpha = `if(${active}\\,1\\,0)`;
      if (options.animation === 'typewriter') {
        // Handled once per complete line above to keep cumulative text aligned.
      } else {
        if (base.key === 'punch') {
          const flashAlpha = `if(${active}\\,max(0\\,1-(t-${word.start.toFixed(3)})/0.07)\\,0)`;
          const flashLayer = `drawtext=${common}:x='${activeX}':y='${yExpr}':fontsize=${Math.round(fontSize * 1.12)}:fontcolor=0xFFE600:alpha='${flashAlpha}':box=1:boxcolor=0xFF2A2A@0.85:boxborderw=12:enable='${active}'${shadow}`;
          filters.push(flashLayer);
        }
        const activeLayer = `drawtext=${common}:x='${activeX}':y='${yExpr}':fontsize='${fontSize}*(${scale})':fontcolor=${color(activeColor)}:alpha='${activeAlpha}'${boxOption}:enable='${active}'${shadow}`;
        filters.push(activeLayer);
      }
    });
  });
  return { filter: filters.join(','), wordCount: words.length, lineCount: lines.length, template: base.key };
}

function getTemplateNames() { return Object.keys(TEMPLATES); }
module.exports = { TEMPLATES, getTemplateNames, buildCaptionFilter, normalizeWords };

// Production bridge: read one JSON request from stdin and emit the generated
// FFmpeg filter JSON on stdout. Diagnostics are intentionally sent to stderr.
if (require.main === module) {
  let raw = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => { raw += chunk; });
  process.stdin.on('end', () => {
    try {
      const request = JSON.parse(raw || '{}');
      const result = buildCaptionFilter(request.words, request.options || {});
      process.stdout.write(JSON.stringify(result));
    } catch (error) {
      process.stderr.write(String(error && error.stack || error));
      process.exitCode = 1;
    }
  });
}
