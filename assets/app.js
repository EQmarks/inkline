/* 抄写台 — 逐句线性抄写逻辑（段落模式 + 分句列表模式，中英文） */
(function () {
  'use strict';

  var STORAGE_KEY = 'inkline:v1';
  var DEFAULT_SETTINGS = {
    theme: 'auto',
    font: 'kai',
    size: 19,
    leading: 1.9,
    focus: true,
    numbers: true,
    autoScroll: true,
    layout: 'paragraph',
    indent: true
  };
  var PALETTES = [
    { id: 'qinglan', name: '青岚', dark: false, meta: '#f1f4ee' },
    { id: 'moye', name: '墨夜', dark: true, meta: '#12160f' },
    { id: 'suzhi', name: '素纸', dark: false, meta: '#f4efe2' },
    { id: 'haiyan', name: '海盐', dark: false, meta: '#eef3f4' },
    { id: 'nuanri', name: '暖阳', dark: false, meta: '#fbf1e4' },
    { id: 'songyan', name: '松烟', dark: true, meta: '#12171a' }
  ];
  var THEME_IDS = ['auto'].concat(PALETTES.map(function (p) { return p.id; }));
  var FONTS = ['kai', 'song', 'hei'];
  var LAYOUTS = ['paragraph', 'sentences'];

  var TERMINALS = '。！？!?…';
  var CLOSERS = '”’」』）)】》〉]"\u2019\u201d';
  var MAX_SENTENCE = 42;
  var ABBREVIATIONS = ['mr', 'mrs', 'ms', 'dr', 'prof', 'st', 'jr', 'sr', 'vs', 'etc', 'inc', 'ltd', 'co', 'corp', 'no', 'fig', 'al', 'eg', 'ie', 'am', 'pm'];

  var state = {
    text: '',
    sentences: [],
    paragraphs: [],
    paraOf: [],
    cursor: 0,
    settings: null,
    updatedAt: 0,
    completedAt: 0
  };
  var saveTimer = null;
  var toastTimer = null;
  var pushedHistory = false;
  var els = {};

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function defaults() {
    var copy = {};
    for (var k in DEFAULT_SETTINGS) {
      if (Object.prototype.hasOwnProperty.call(DEFAULT_SETTINGS, k)) copy[k] = DEFAULT_SETTINGS[k];
    }
    return copy;
  }

  function clamp(n, lo, hi) { return Math.min(hi, Math.max(lo, n)); }

  function cleanLine(line) {
    return line.replace(/\u00a0/g, ' ').trim();
  }

  function trimEnd(line) {
    return line.replace(/\s+$/, '');
  }

  /* ---------- 智能分句（中英文） ---------- */

  function isDotTerminal(text, i) {
    var prev = text.charAt(i - 1);
    var next = text.charAt(i + 1);
    if (!next) return true;
    if (/\d/.test(prev) && /\d/.test(next)) return false;
    if (/^\s*\d+\.\s*$/.test(text.slice(0, i + 1))) return false;

    var k = i + 1;
    var hadCloser = false;
    while (k < text.length) {
      var ch = text.charAt(k);
      if (CLOSERS.indexOf(ch) !== -1) { hadCloser = true; k++; continue; }
      if (/\s/.test(ch)) { k++; continue; }
      break;
    }
    var afterChar = k < text.length ? text.charAt(k) : '';
    var hasSpaceAfter = /\s/.test(next);
    if (!hasSpaceAfter && !hadCloser) return false;

    var before = text.slice(0, i).replace(/\s+$/, '');
    var wordMatch = before.match(/([A-Za-z]+)$/);
    if (wordMatch) {
      var word = wordMatch[1].toLowerCase();
      if (ABBREVIATIONS.indexOf(word) !== -1) return false;
      if (wordMatch[1].length === 1) return false;
    }
    if (/(?:[A-Za-z]\.){2,}$/.test(before)) return false;

    if (afterChar && /^[a-z]/.test(afterChar)) return false;
    return true;
  }

  function splitParagraph(para) {
    var out = [];
    var buf = '';
    for (var i = 0; i < para.length; i++) {
      var ch = para.charAt(i);
      buf += ch;
      var terminal = TERMINALS.indexOf(ch) !== -1;
      if (!terminal && ch === '.') terminal = isDotTerminal(para, i);
      if (!terminal) continue;
      var j = i + 1;
      while (j < para.length) {
        var nextCh = para.charAt(j);
        if (TERMINALS.indexOf(nextCh) === -1 && CLOSERS.indexOf(nextCh) === -1) break;
        buf += nextCh;
        j++;
      }
      out.push(buf);
      buf = '';
      i = j - 1;
    }
    if (buf.trim()) out.push(buf);
    return out;
  }

  function breakLong(text) {
    if (text.length <= MAX_SENTENCE) return [text];
    var windowEnd = Math.min(text.length, MAX_SENTENCE + 10);
    var best = -1;
    var groups = ['；;', '，,'];
    for (var g = 0; g < groups.length && best < 0; g++) {
      for (var i = windowEnd - 1; i >= 0; i--) {
        if (groups[g].indexOf(text.charAt(i)) !== -1) { best = i; break; }
      }
    }
    if (best < 0) return [text];
    var head = trimEnd(text.slice(0, best + 1));
    var rest = text.slice(best + 1);
    var result = [head];
    var tail = breakLong(rest);
    for (var k = 0; k < tail.length; k++) result.push(tail[k]);
    return result;
  }

  function parseDocument(text) {
    var doc = { sentences: [], paragraphs: [], paraOf: [] };
    if (!text) return doc;
    var lines = String(text).replace(/\r\n?/g, '\n').split('\n');
    for (var li = 0; li < lines.length; li++) {
      var line = cleanLine(lines[li]);
      if (!line) continue;
      var pieces = splitParagraph(line);
      var indices = [];
      for (var i = 0; i < pieces.length; i++) {
        var piece = cleanLine(pieces[i]);
        if (!piece) continue;
        var hasCjk = /[\u4e00-\u9fff]/.test(piece);
        var parts = hasCjk ? breakLong(piece) : [piece];
        for (var k = 0; k < parts.length; k++) {
          var sentence = cleanLine(parts[k]);
          if (!sentence) continue;
          doc.paraOf.push(doc.paragraphs.length);
          indices.push(doc.sentences.length);
          doc.sentences.push(sentence);
        }
      }
      if (indices.length) doc.paragraphs.push(indices);
    }
    return doc;
  }

  function splitSentences(text) {
    return parseDocument(text).sentences;
  }

  function applyDocument(text) {
    var doc = parseDocument(text);
    state.sentences = doc.sentences;
    state.paragraphs = doc.paragraphs;
    state.paraOf = doc.paraOf;
  }

  function countChars(sentences) {
    var n = 0;
    for (var i = 0; i < sentences.length; i++) {
      n += sentences[i].replace(/\s/g, '').length;
    }
    return n;
  }

  function timeAgo(ts) {
    if (!ts) return '刚刚';
    var diff = Date.now() - ts;
    if (diff < 60000) return '刚刚';
    var m = Math.floor(diff / 60000);
    if (m < 60) return m + ' 分钟前';
    var h = Math.floor(m / 60);
    if (h < 24) return h + ' 小时前';
    var d = Math.floor(h / 24);
    if (d < 30) return d + ' 天前';
    return '很久以前';
  }

  function reduceMotion() {
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  /* ---------- 存储 ---------- */

  function load() {
    state.settings = defaults();
    var raw = null;
    try { raw = localStorage.getItem(STORAGE_KEY); } catch (e) { raw = null; }
    if (!raw) return;
    var data = null;
    try { data = JSON.parse(raw); } catch (e) { return; }
    if (!data || typeof data !== 'object') return;

    if (typeof data.text === 'string') state.text = data.text;
    if (data.settings && typeof data.settings === 'object') {
      var keys = Object.keys(DEFAULT_SETTINGS);
      for (var i = 0; i < keys.length; i++) {
        var k = keys[i];
        if (typeof data.settings[k] !== 'undefined') state.settings[k] = data.settings[k];
      }
    }
    if (LAYOUTS.indexOf(state.settings.layout) === -1) state.settings.layout = 'paragraph';
    if (data.indentMigrated !== 2) state.settings.indent = true;
    if (state.settings.theme === 'light') state.settings.theme = 'qinglan';
    else if (state.settings.theme === 'dark') state.settings.theme = 'moye';
    if (THEME_IDS.indexOf(state.settings.theme) === -1) state.settings.theme = 'auto';
    state.updatedAt = Number(data.updatedAt) || 0;
    state.completedAt = Number(data.completedAt) || 0;
    applyDocument(state.text);
    state.cursor = clamp(Number(data.cursor) || 0, 0, state.sentences.length);
  }

  function save(immediate) {
    state.updatedAt = Date.now();
    var payload = JSON.stringify({
      text: state.text,
      cursor: state.cursor,
      settings: state.settings,
      updatedAt: state.updatedAt,
      completedAt: state.completedAt,
      indentMigrated: 2
    });
    clearTimeout(saveTimer);
    function flush() {
      try { localStorage.setItem(STORAGE_KEY, payload); } catch (e) {}
    }
    if (immediate) { flush(); return; }
    saveTimer = setTimeout(flush, 240);
  }

  /* ---------- 主题与显示设置 ---------- */

  function findPalette(id) {
    for (var i = 0; i < PALETTES.length; i++) {
      if (PALETTES[i].id === id) return PALETTES[i];
    }
    return PALETTES[0];
  }

  function resolvePalette() {
    var t = state.settings.theme;
    if (t === 'auto') {
      var dark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
      return findPalette(dark ? 'moye' : 'qinglan');
    }
    return findPalette(t);
  }

  function applyTheme() {
    var palette = resolvePalette();
    var root = document.documentElement;
    root.setAttribute('data-palette', palette.id);
    root.setAttribute('data-theme', palette.dark ? 'dark' : 'light');
    root.style.colorScheme = palette.dark ? 'dark' : 'light';
    var meta = document.getElementById('meta-theme');
    if (meta) meta.setAttribute('content', palette.meta);
    var glyph = palette.dark ? '☀' : '☾';
    var auto = state.settings.theme === 'auto';
    var title = auto ? '主题：跟随系统（' + palette.name + '）' : '主题：' + palette.name;
    if (els.themeToggle) {
      els.themeToggle.textContent = glyph;
      els.themeToggle.setAttribute('aria-label', '切换主题');
      els.themeToggle.setAttribute('title', title);
    }
    if (els.themeToggle2) {
      els.themeToggle2.textContent = glyph;
      els.themeToggle2.setAttribute('aria-label', '切换主题');
      els.themeToggle2.setAttribute('title', title);
    }
  }

  function applySettings() {
    var s = state.settings;
    var root = document.documentElement;
    root.style.setProperty('--size', s.size + 'px');
    root.style.setProperty('--leading', String(s.leading));
    root.setAttribute('data-font', s.font);
    root.setAttribute('data-focus', s.focus ? 'on' : 'off');
    root.setAttribute('data-numbers', s.numbers ? 'on' : 'off');
    root.setAttribute('data-layout', s.layout);
    root.setAttribute('data-indent', s.indent ? 'on' : 'off');
    applyTheme();
    syncSettingsForm();
    if (state.sentences.length) paint();
  }

  function syncSettingsForm() {
    $$('[data-segmented]').forEach(function (group) {
      var key = group.getAttribute('data-segmented');
      $$('input', group).forEach(function (inp) {
        inp.checked = inp.value === state.settings[key];
      });
    });
    $$('[data-setting]').forEach(function (inp) {
      var key = inp.getAttribute('data-setting');
      var val = state.settings[key];
      if (inp.type === 'checkbox') inp.checked = !!val;
      else if (inp.type === 'range') inp.value = String(val);
    });
    if (els.sizeOut) els.sizeOut.textContent = String(state.settings.size);
    if (els.leadingOut) els.leadingOut.textContent = Number(state.settings.leading).toFixed(1);
    $$('.theme-card').forEach(function (cardEl) {
      cardEl.setAttribute('aria-checked', cardEl.getAttribute('data-theme-id') === state.settings.theme ? 'true' : 'false');
    });
  }

  function setSetting(key, value) {
    if (key === 'size') value = clamp(Math.round(value), 15, 30);
    if (key === 'leading') value = Math.round(clamp(value, 1.4, 2.6) * 10) / 10;
    if (key === 'theme' && THEME_IDS.indexOf(value) === -1) return;
    if (key === 'font' && FONTS.indexOf(value) === -1) return;
    if (key === 'layout' && LAYOUTS.indexOf(value) === -1) return;
    state.settings[key] = value;
    applySettings();
    if (key === 'layout' && document.body.getAttribute('data-view') === 'reader') {
      buildView();
      scrollToCurrent('auto');
    }
    save();
  }

  function cycleTheme() {
    var index = THEME_IDS.indexOf(state.settings.theme);
    var next = THEME_IDS[(index + 1) % THEME_IDS.length];
    state.settings.theme = next;
    applySettings();
    save();
    var palette = resolvePalette();
    toast('主题：' + (next === 'auto' ? '跟随系统（' + palette.name + '）' : palette.name));
  }

  /* ---------- 提示 ---------- */

  function toast(message) {
    if (!els.toast) return;
    els.toast.textContent = message;
    els.toast.classList.add('is-show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { els.toast.classList.remove('is-show'); }, 1900);
  }

  /* ---------- 视图切换 ---------- */

  function setView(view) {
    document.body.setAttribute('data-view', view);
    document.title = view === 'reader' ? '抄写中 · 抄写台' : '抄写台 · 逐句抄写，不写串';
    if (view === 'editor') syncResumeCard();
  }

  function enterReader() {
    state.cursor = clamp(state.cursor, 0, state.sentences.length);
    buildView();
    setView('reader');
    if (state.cursor >= state.sentences.length) window.scrollTo({ top: 0, behavior: 'auto' });
    else scrollToCurrent('auto');
    if (!pushedHistory) {
      try {
        history.pushState({ inkline: 'reader' }, '');
        pushedHistory = true;
      } catch (e) {}
    }
  }

  function closeReader() {
    setView('editor');
    syncEditorForm();
    if (pushedHistory) {
      pushedHistory = false;
      try { history.back(); } catch (e) {}
    }
  }

  /* ---------- 录入页 ---------- */

  function syncEditorForm() {
    if (!els.source) return;
    els.source.value = state.text;
    updateEditorStats();
    els.startBtn.disabled = state.sentences.length === 0;
    syncSettingsForm();
  }

  function updateEditorStats() {
    if (!els.source || !els.sourceStats) return;
    var text = els.source.value;
    var doc = parseDocument(text);
    var chars = countChars(doc.sentences);
    els.sourceStats.textContent = doc.sentences.length + ' 句 · ' + chars + ' 字';
  }

  function onTextInput() {
    state.text = els.source.value;
    applyDocument(state.text);
    state.cursor = clamp(state.cursor, 0, state.sentences.length);
    updateEditorStats();
    els.startBtn.disabled = state.sentences.length === 0;
    syncResumeCard();
    save();
  }

  function syncResumeCard() {
    if (!els.resumeCard) return;
    var total = state.sentences.length;
    var visible = total > 0 && state.cursor > 0;
    els.resumeCard.hidden = !visible;
    if (!visible) return;
    if (state.cursor >= total) {
      els.resumeTitle.textContent = '上次已全部抄完';
      els.resumeBtn.textContent = '查看';
      els.resumeMeta.textContent = '共 ' + total + ' 句 · ' + timeAgo(state.updatedAt);
    } else {
      els.resumeTitle.textContent = '上次没抄完';
      els.resumeBtn.textContent = '继续';
      els.resumeMeta.textContent = '上次抄到第 ' + (state.cursor + 1) + ' / ' + total + ' 句 · ' + timeAgo(state.updatedAt);
    }
  }

  function startReading() {
    var text = els.source.value;
    var doc = parseDocument(text);
    if (!doc.sentences.length) {
      toast('先录入一点要抄的内容');
      els.source.focus();
      return;
    }
    if (text !== state.text) state.cursor = 0;
    state.text = text;
    state.sentences = doc.sentences;
    state.paragraphs = doc.paragraphs;
    state.paraOf = doc.paraOf;
    state.cursor = clamp(state.cursor, 0, doc.sentences.length);
    if (state.cursor >= doc.sentences.length) state.completedAt = state.completedAt || Date.now();
    enterReader();
    save(true);
  }

  function resumeReading() {
    state.text = els.source.value;
    applyDocument(state.text);
    if (!state.sentences.length) { toast('没有可抄的内容'); return; }
    state.cursor = clamp(state.cursor, 0, state.sentences.length);
    enterReader();
    save(true);
  }

  function resetProgress(skipConfirm) {
    if (!skipConfirm && !window.confirm('从第一句重新开始？')) return;
    state.cursor = 0;
    state.completedAt = 0;
    paint();
    save(true);
    window.scrollTo({ top: 0, behavior: reduceMotion() ? 'auto' : 'smooth' });
    toast('已回到第一句');
  }

  /* ---------- 抄写页渲染 ---------- */

  function buildView() {
    if (!els.list) return;
    els.list.textContent = '';
    var mode = state.settings.layout === 'sentences' ? 'sentences' : 'paragraph';
    els.list.className = mode === 'paragraph' ? 'paras' : 'lines';
    if (mode === 'paragraph') buildParagraphs();
    else buildLines();
    paint();
  }

  function buildLines() {
    var frag = document.createDocumentFragment();
    for (var i = 0; i < state.sentences.length; i++) {
      var li = document.createElement('li');
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'line';
      btn.setAttribute('data-i', String(i));
      btn.setAttribute('aria-label', '第 ' + (i + 1) + ' 句：' + state.sentences[i]);

      var no = document.createElement('span');
      no.className = 'line__no';
      no.textContent = String(i + 1);

      var txt = document.createElement('span');
      txt.className = 'line__text';
      txt.textContent = state.sentences[i];

      btn.appendChild(no);
      btn.appendChild(txt);
      li.appendChild(btn);
      frag.appendChild(li);
    }
    els.list.appendChild(frag);
  }

  function buildParagraphs() {
    var frag = document.createDocumentFragment();
    for (var p = 0; p < state.paragraphs.length; p++) {
      var li = document.createElement('li');
      li.className = 'para';
      li.setAttribute('data-p', String(p));
      var indices = state.paragraphs[p];
      for (var j = 0; j < indices.length; j++) {
        var i = indices[j];
        var sentence = state.sentences[i];
        if (j > 0) {
          var prev = state.sentences[indices[j - 1]];
          if (/[A-Za-z0-9)\]]$/.test(prev) || /^[A-Za-z0-9(\[]/.test(sentence)) {
            li.appendChild(document.createTextNode(' '));
          }
        }
        var sentenceNode = document.createElement('span');
        sentenceNode.className = 'sentence';
        sentenceNode.setAttribute('data-i', String(i));
        sentenceNode.setAttribute('role', 'button');
        sentenceNode.setAttribute('tabindex', '-1');
        sentenceNode.setAttribute('aria-label', '第 ' + (i + 1) + ' 句：' + sentence);
        sentenceNode.textContent = sentence;
        li.appendChild(sentenceNode);
      }
      frag.appendChild(li);
    }
    els.list.appendChild(frag);
  }

  function makeReaderTitle() {
    var first = state.sentences[0] || '';
    if (first.length > 18) first = first.slice(0, 18).replace(/\s+$/, '') + '…';
    return first || '抄写中';
  }

  function paint() {
    if (!els.list) return;
    var total = state.sentences.length;
    var cursor = state.cursor;
    var completed = total > 0 && cursor >= total;
    var paragraphMode = state.settings.layout !== 'sentences';

    if (paragraphMode) {
      var spans = els.list.querySelectorAll('.sentence');
      for (var s = 0; s < spans.length; s++) {
        var span = spans[s];
        var idx = Number(span.getAttribute('data-i'));
        var past = idx < cursor;
        var current = idx === cursor;
        span.classList.toggle('is-past', past);
        span.classList.toggle('is-current', current);
        if (current) span.setAttribute('aria-current', 'step');
        else span.removeAttribute('aria-current');
      }
      var paraEls = els.list.querySelectorAll('.para');
      var curPara = -1;
      if (total) curPara = state.paraOf[cursor >= total ? total - 1 : cursor];
      for (var p = 0; p < paraEls.length; p++) {
        var farPara = !!state.settings.focus && curPara >= 0 && Math.abs(p - curPara) > 1;
        paraEls[p].classList.toggle('is-far-para', farPara);
      }
    } else {
      var buttons = els.list.querySelectorAll('.line');
      for (var b = 0; b < buttons.length; b++) {
        var btn = buttons[b];
        var isPast = b < cursor;
        var isCurrent = b === cursor;
        var isFuture = b > cursor;
        var far = !!state.settings.focus && cursor >= 0 && Math.abs(b - cursor) > 2;
        btn.classList.toggle('is-past', isPast);
        btn.classList.toggle('is-current', isCurrent);
        btn.classList.toggle('is-future', isFuture);
        btn.classList.toggle('is-far', isFuture && far);
        if (isCurrent) btn.setAttribute('aria-current', 'step');
        else btn.removeAttribute('aria-current');
      }
    }

    var pct = total ? Math.round((cursor / total) * 100) : 0;
    if (els.progressFill) els.progressFill.style.width = pct + '%';
    if (els.progressBar) els.progressBar.setAttribute('aria-valuenow', String(pct));
    if (els.progressText) {
      els.progressText.textContent = completed ? '全部完成' : '第 ' + (cursor + 1) + ' / ' + total + ' 句';
    }

    if (els.prevBtn) els.prevBtn.disabled = cursor <= 0;
    if (els.nextBtn) {
      els.nextBtn.disabled = completed;
      els.nextBtn.textContent = completed ? '已全部抄完' : (total && cursor === total - 1 ? '完成最后一句' : '下一句');
    }

    if (els.banner) {
      els.banner.hidden = !completed;
      if (completed) {
        if (els.bannerTitle) els.bannerTitle.textContent = '全部 ' + total + ' 句抄完了';
        if (els.bannerMeta) els.bannerMeta.textContent = '共 ' + total + ' 句 · ' + countChars(state.sentences) + ' 字';
      }
    }

    if (els.readerTitle) els.readerTitle.textContent = makeReaderTitle();
    document.title = completed ? '全部抄完 · 抄写台' : '第 ' + (cursor + 1) + ' / ' + total + ' 句 · 抄写台';
  }

  function scrollToCurrent(behavior) {
    if (!els.list || state.cursor < 0 || state.cursor >= state.sentences.length) return;
    var node = els.list.querySelector('[data-i="' + state.cursor + '"]');
    if (!node) return;
    var mode = reduceMotion() ? 'auto' : (behavior || 'smooth');
    try { node.scrollIntoView({ block: 'center', behavior: mode }); } catch (e) { node.scrollIntoView(); }
  }

  function setCursor(index, options) {
    var opts = options || {};
    var total = state.sentences.length;
    var next = clamp(index, 0, total);
    if (next === state.cursor) {
      if (opts.scroll) scrollToCurrent('smooth');
      return;
    }
    state.cursor = next;
    state.completedAt = next >= total ? Date.now() : 0;
    paint();
    save();
    if (opts.scroll !== false) {
      if (next >= total) window.scrollTo({ top: 0, behavior: reduceMotion() ? 'auto' : 'smooth' });
      else scrollToCurrent('smooth');
    }
  }

  function advance() {
    if (state.cursor >= state.sentences.length) return;
    setCursor(state.cursor + 1, { scroll: state.settings.autoScroll });
  }

  function retreat() {
    if (state.cursor <= 0) return;
    setCursor(state.cursor - 1, { scroll: state.settings.autoScroll });
  }

  function activateLine(i) {
    if (!(i >= 0 && i < state.sentences.length)) return;
    if (i === state.cursor) return;
    setCursor(i, { scroll: false });
  }

  function openSettings() {
    if (!els.dialog) return;
    if (els.dialog.open) return;
    if (typeof els.dialog.showModal === 'function') els.dialog.showModal();
    else els.dialog.setAttribute('open', '');
  }

  function closeSettings() {
    if (!els.dialog) return;
    if (typeof els.dialog.close === 'function') els.dialog.close();
    else els.dialog.removeAttribute('open');
  }

  /* ---------- 绑定 ---------- */

  /* ---------- 安装到桌面（PWA） ---------- */

  var deferredPrompt = null;
  var INSTALL_DISMISS_KEY = 'inkline:install-dismissed';

  function isStandalone() {
    return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true;
  }

  function isIOS() {
    var ua = window.navigator.userAgent || '';
    return /iphone|ipad|ipod/i.test(ua) && !window.MSStream;
  }

  function showInstallCard() {
    if (!els.installCard || isStandalone()) return;
    try {
      if (localStorage.getItem(INSTALL_DISMISS_KEY) === '1') return;
    } catch (e) {}
    els.installCard.hidden = false;
  }

  function hideInstallCard() {
    if (els.installCard) els.installCard.hidden = true;
  }

  function openInstallDialog() {
    if (!els.installDialog) return;
    if (typeof els.installDialog.showModal === 'function') els.installDialog.showModal();
    else els.installDialog.setAttribute('open', '');
  }

  function setupInstall() {
    if (!els.installCard) return;
    if (isStandalone()) { hideInstallCard(); return; }
    if (isIOS()) showInstallCard();

    window.addEventListener('beforeinstallprompt', function (event) {
      event.preventDefault();
      deferredPrompt = event;
      showInstallCard();
    });

    window.addEventListener('appinstalled', function () {
      deferredPrompt = null;
      hideInstallCard();
      toast('已添加到桌面，下次从桌面图标打开');
    });

    els.installBtn.addEventListener('click', function () {
      if (isIOS()) { openInstallDialog(); return; }
      var promptEvent = deferredPrompt;
      if (promptEvent) {
        deferredPrompt = null;
        promptEvent.prompt();
        if (promptEvent.userChoice && promptEvent.userChoice.then) {
          promptEvent.userChoice.then(function (choice) {
            if (choice.outcome === 'accepted') hideInstallCard();
          });
        }
      } else {
        openInstallDialog();
      }
    });

    els.installClose.addEventListener('click', function () {
      try { localStorage.setItem(INSTALL_DISMISS_KEY, '1'); } catch (e) {}
      hideInstallCard();
    });
  }

  function bindEditor() {
    els.source.addEventListener('input', onTextInput);

    els.source.addEventListener('keydown', function (e) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        if (!els.startBtn.disabled) startReading();
      }
    });

    els.startBtn.addEventListener('click', startReading);
    els.resumeBtn.addEventListener('click', resumeReading);

    els.source.addEventListener('dragover', function (e) { e.preventDefault(); });
    els.source.addEventListener('drop', function (e) {
      e.preventDefault();
      var file = e.dataTransfer && e.dataTransfer.files ? e.dataTransfer.files[0] : null;
      if (file) readFile(file);
    });

    els.importBtn.addEventListener('click', function () { els.fileInput.click(); });
    els.fileInput.addEventListener('change', function () {
      var file = els.fileInput.files && els.fileInput.files[0];
      if (file) readFile(file);
      els.fileInput.value = '';
    });

    els.sampleBtn.addEventListener('click', function () {
      if (state.text.trim() && !window.confirm('用中文示例替换当前内容？')) return;
      els.source.value = SAMPLE_CN;
      onTextInput();
      els.source.focus();
      toast('已填入中文示例');
    });

    els.sampleEnBtn.addEventListener('click', function () {
      if (state.text.trim() && !window.confirm('用英文示例替换当前内容？')) return;
      els.source.value = SAMPLE_EN;
      onTextInput();
      els.source.focus();
      toast('已填入英文示例');
    });

    els.clearBtn.addEventListener('click', function () {
      if (!els.source.value) return;
      if (!window.confirm('清空录入的内容和抄写进度？')) return;
      els.source.value = '';
      state.text = '';
      applyDocument('');
      state.cursor = 0;
      state.completedAt = 0;
      syncResumeCard();
      onTextInput();
      save(true);
      toast('已清空');
    });

    els.themeToggle.addEventListener('click', cycleTheme);
    els.themeToggle2.addEventListener('click', cycleTheme);
  }

  function readFile(file) {
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { toast('文件太大了，建议小于 2 MB'); return; }
    var reader = new FileReader();
    reader.onload = function () {
      if (typeof reader.result !== 'string') return;
      els.source.value = reader.result;
      onTextInput();
      els.source.focus();
      toast('已导入 ' + file.name);
    };
    reader.onerror = function () { toast('文件读取失败，换个文件试试'); };
    reader.readAsText(file);
  }

  function bindReader() {
    els.list.addEventListener('click', function (e) {
      var target = e.target;
      var node = target && target.closest ? target.closest('.line, .sentence') : null;
      if (!node || !els.list.contains(node)) return;
      activateLine(Number(node.getAttribute('data-i')));
    });

    els.nextBtn.addEventListener('click', advance);
    els.prevBtn.addEventListener('click', retreat);
    els.backBtn.addEventListener('click', closeReader);
    els.settingsBtn.addEventListener('click', openSettings);
    els.bannerEditBtn.addEventListener('click', closeReader);
    els.restartBtn.addEventListener('click', function () { resetProgress(); });
    els.resetProgressBtn.addEventListener('click', function () {
      closeSettings();
      resetProgress();
    });
    els.editFromSheetBtn.addEventListener('click', function () {
      closeSettings();
      closeReader();
    });

    if (els.dialog) {
      els.dialog.addEventListener('click', function (e) {
        if (e.target === els.dialog) closeSettings();
      });
    }

    window.addEventListener('popstate', function () {
      if (document.body.getAttribute('data-view') === 'reader') {
        pushedHistory = false;
        setView('editor');
        syncEditorForm();
      }
    });
  }

  function bindSettings() {
    $$('[data-setting]').forEach(function (inp) {
      inp.addEventListener('input', function () {
        var key = inp.getAttribute('data-setting');
        var val;
        if (inp.type === 'checkbox') val = inp.checked;
        else if (inp.type === 'range') val = Number(inp.value);
        else val = inp.value;
        setSetting(key, val);
      });
    });

    $$('[data-segmented]').forEach(function (group) {
      var key = group.getAttribute('data-segmented');
      $$('input', group).forEach(function (inp) {
        inp.addEventListener('change', function () {
          if (!inp.checked) return;
          setSetting(key, inp.value);
        });
      });
    });

    $$('.theme-card').forEach(function (cardEl) {
      cardEl.addEventListener('click', function () {
        var id = cardEl.getAttribute('data-theme-id');
        setSetting('theme', id);
        var palette = resolvePalette();
        toast(id === 'auto' ? '主题：跟随系统（' + palette.name + '）' : '主题：' + palette.name);
      });
    });
  }

  function bindKeyboard() {
    document.addEventListener('keydown', function (e) {
      if (els.dialog && els.dialog.open) return;
      if (document.body.getAttribute('data-view') !== 'reader') return;
      var target = e.target;
      var tag = target && target.tagName ? target.tagName.toLowerCase() : '';
      var isTextButton = !!(target && target.classList && (target.classList.contains('sentence') || target.classList.contains('line')));
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || tag === 'a' || (target && target.isContentEditable)) return;
      if (tag === 'button' && !isTextButton) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === ' ' || e.key === 'Enter' || e.key === 'ArrowRight') {
        e.preventDefault();
        advance();
      } else if (e.key === 'Backspace' || e.key === 'ArrowLeft' || e.key === 'z' || e.key === 'Z') {
        e.preventDefault();
        retreat();
      } else if (e.key === 'e' || e.key === 'E') {
        e.preventDefault();
        closeReader();
      } else if (e.key === '+' || e.key === '=' || e.key === '-' || e.key === '_') {
        e.preventDefault();
        var delta = e.key === '+' || e.key === '=' ? 1 : -1;
        setSetting('size', state.settings.size + delta);
        toast('字号 ' + state.settings.size + 'px');
      }
    });

    if (window.matchMedia) {
      try {
        var mq = window.matchMedia('(prefers-color-scheme: dark)');
        var handler = function () {
          if (state.settings.theme === 'auto') applyTheme();
        };
        if (mq.addEventListener) mq.addEventListener('change', handler);
        else if (mq.addListener) mq.addListener(handler);
      } catch (e) {}
    }

    window.addEventListener('pagehide', function () { save(true); });
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') save(true);
    });
  }

  function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    var proto = location.protocol;
    if (proto !== 'http:' && proto !== 'https:') return;
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('./sw.js').catch(function () {});
    });
  }

  /* ---------- 启动 ---------- */

  function cacheEls() {
    els.source = $('#source-text');
    els.sourceStats = $('#source-stats');
    els.startBtn = $('#start-btn');
    els.resumeCard = $('#resume-card');
    els.resumeTitle = $('#resume-title');
    els.resumeMeta = $('#resume-meta');
    els.resumeBtn = $('#resume-btn');
    els.installCard = $('#install-card');
    els.installBtn = $('#install-btn');
    els.installClose = $('#install-close');
    els.installDialog = $('#install-dialog');
    els.importBtn = $('#import-btn');
    els.sampleBtn = $('#sample-btn');
    els.sampleEnBtn = $('#sample-en-btn');
    els.clearBtn = $('#clear-btn');
    els.fileInput = $('#file-input');
    els.themeToggle = $('#theme-toggle');
    els.themeToggle2 = $('#theme-toggle-2');

    els.backBtn = $('#back-btn');
    els.list = $('#line-list');
    els.readerTitle = $('#reader-title');
    els.progressBar = $('#progress-bar');
    els.progressFill = $('#progress-fill');
    els.progressText = $('#progress-text');
    els.banner = $('#done-banner');
    els.bannerTitle = $('#banner-title');
    els.bannerMeta = $('#banner-meta');
    els.restartBtn = $('#restart-btn');
    els.bannerEditBtn = $('#banner-edit-btn');
    els.nextBtn = $('#next-btn');
    els.prevBtn = $('#prev-btn');
    els.settingsBtn = $('#settings-btn');

    els.dialog = $('#settings-dialog');
    els.sizeOut = $('#size-out');
    els.leadingOut = $('#leading-out');
    els.resetProgressBtn = $('#reset-progress-btn');
    els.editFromSheetBtn = $('#edit-from-sheet-btn');
    els.toast = $('#toast');
  }

  var SAMPLE_CN = [
    '君子曰：学不可以已。青，取之于蓝，而青于蓝；冰，水为之，而寒于水。故木受绳则直，金就砺则利。',
    '君子博学而日参省乎己，则知明而行无过矣。吾尝终日而思矣，不如须臾之所学也；吾尝跂而望矣，不如登高之博见也。'
  ].join('\n');

  var SAMPLE_EN = [
    'Reading is to the mind what exercise is to the body. A room without books is like a body without a soul.',
    'Mr. Smith said, "The more that you read, the more things you will know." It is about 3.14 in the U.S. system. Does it split correctly? Yes, it does!'
  ].join('\n');

  function init() {
    cacheEls();
    load();
    applySettings();
    syncEditorForm();
    syncResumeCard();
    bindEditor();
    bindReader();
    bindSettings();
    bindKeyboard();
    setupInstall();
    registerServiceWorker();
    if (els.source) els.source.focus({ preventScroll: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
