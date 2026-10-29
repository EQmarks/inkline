/* 抄写台 — 逐句线性抄写逻辑 */
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
    autoScroll: true
  };
  var THEMES = ['auto', 'light', 'dark'];
  var FONTS = ['kai', 'song', 'hei'];

  var TERMINALS = '。！？!?…';
  var CLOSERS = '”’」』）)】》〉]"\u2019\u201d';
  var MAX_SENTENCE = 42;

  var state = {
    text: '',
    sentences: [],
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

  /* ---------- 智能分句 ---------- */

  function isDotTerminal(text, i) {
    var prev = text.charAt(i - 1);
    var next = text.charAt(i + 1);
    if (!next) return true;
    if (/\d/.test(prev) && /\d/.test(next)) return false;
    if (!/\s/.test(next)) return false;
    if (/^\s*\d+\.\s*$/.test(text.slice(0, i + 1))) return false;
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

  function splitSentences(text) {
    if (!text) return [];
    var paragraphs = String(text).replace(/\r\n?/g, '\n').split('\n');
    var out = [];
    for (var p = 0; p < paragraphs.length; p++) {
      var para = cleanLine(paragraphs[p]);
      if (!para) continue;
      var pieces = splitParagraph(para);
      for (var i = 0; i < pieces.length; i++) {
        var piece = cleanLine(pieces[i]);
        if (!piece) continue;
        var parts = breakLong(piece);
        for (var j = 0; j < parts.length; j++) {
          var sentence = cleanLine(parts[j]);
          if (sentence) out.push(sentence);
        }
      }
    }
    return out;
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
    state.updatedAt = Number(data.updatedAt) || 0;
    state.completedAt = Number(data.completedAt) || 0;
    state.sentences = splitSentences(state.text);
    state.cursor = clamp(Number(data.cursor) || 0, 0, state.sentences.length);
  }

  function save(immediate) {
    state.updatedAt = Date.now();
    var payload = JSON.stringify({
      text: state.text,
      cursor: state.cursor,
      settings: state.settings,
      updatedAt: state.updatedAt,
      completedAt: state.completedAt
    });
    clearTimeout(saveTimer);
    function flush() {
      try { localStorage.setItem(STORAGE_KEY, payload); } catch (e) {}
    }
    if (immediate) { flush(); return; }
    saveTimer = setTimeout(flush, 240);
  }

  /* ---------- 主题与显示设置 ---------- */

  function resolvedTheme() {
    var t = state.settings.theme;
    if (t === 'dark' || t === 'light') return t;
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  function applyTheme() {
    var theme = resolvedTheme();
    var root = document.documentElement;
    root.setAttribute('data-theme', theme);
    root.style.colorScheme = theme;
    var meta = document.getElementById('meta-theme');
    if (meta) meta.setAttribute('content', theme === 'dark' ? '#12160f' : '#f1f4ee');
    var glyph = theme === 'dark' ? '☀' : '☾';
    var label = theme === 'dark' ? '切换到浅色主题' : '切换到深色主题';
    if (els.themeToggle) { els.themeToggle.textContent = glyph; els.themeToggle.setAttribute('aria-label', label); }
    if (els.themeToggle2) { els.themeToggle2.textContent = glyph; els.themeToggle2.setAttribute('aria-label', label); }
  }

  function applySettings() {
    var s = state.settings;
    var root = document.documentElement;
    root.style.setProperty('--size', s.size + 'px');
    root.style.setProperty('--leading', String(s.leading));
    root.setAttribute('data-font', s.font);
    root.setAttribute('data-focus', s.focus ? 'on' : 'off');
    root.setAttribute('data-numbers', s.numbers ? 'on' : 'off');
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
  }

  function setSetting(key, value) {
    if (key === 'size') value = clamp(Math.round(value), 15, 30);
    if (key === 'leading') value = Math.round(clamp(value, 1.4, 2.6) * 10) / 10;
    if (key === 'theme' && THEMES.indexOf(value) === -1) return;
    if (key === 'font' && FONTS.indexOf(value) === -1) return;
    state.settings[key] = value;
    applySettings();
    save();
  }

  function cycleTheme() {
    var next = resolvedTheme() === 'dark' ? 'light' : 'dark';
    state.settings.theme = next;
    applySettings();
    save();
    toast(next === 'dark' ? '已切换为深色' : '已切换为浅色');
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
    buildList();
    paint();
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
    var sentences = splitSentences(text);
    var chars = countChars(sentences);
    els.sourceStats.textContent = sentences.length + ' 句 · ' + chars + ' 字';
  }

  function onTextInput() {
    state.text = els.source.value;
    state.sentences = splitSentences(state.text);
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
    var sentences = splitSentences(text);
    if (!sentences.length) {
      toast('先录入一点要抄的内容');
      els.source.focus();
      return;
    }
    if (text !== state.text) state.cursor = 0;
    state.text = text;
    state.sentences = sentences;
    state.cursor = clamp(state.cursor, 0, sentences.length);
    if (state.cursor >= sentences.length) state.completedAt = state.completedAt || Date.now();
    enterReader();
    save(true);
  }

  function resumeReading() {
    state.text = els.source.value;
    state.sentences = splitSentences(state.text);
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

  function buildList() {
    var list = els.list;
    if (!list) return;
    list.textContent = '';
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
    list.appendChild(frag);
  }

  function makeReaderTitle() {
    var first = state.sentences[0] || '';
    if (first.length > 18) first = first.slice(0, 18) + '…';
    return first || '抄写中';
  }

  function paint() {
    if (!els.list) return;
    var buttons = els.list.querySelectorAll('.line');
    var total = state.sentences.length;
    var cursor = state.cursor;
    var completed = total > 0 && cursor >= total;

    for (var i = 0; i < buttons.length; i++) {
      var btn = buttons[i];
      var isPast = i < cursor;
      var isCurrent = i === cursor;
      var isFuture = i > cursor;
      var far = !!state.settings.focus && cursor >= 0 && Math.abs(i - cursor) > 2;
      btn.classList.toggle('is-past', isPast);
      btn.classList.toggle('is-current', isCurrent);
      btn.classList.toggle('is-future', isFuture);
      btn.classList.toggle('is-far', isFuture && far);
      if (isCurrent) btn.setAttribute('aria-current', 'step');
      else btn.removeAttribute('aria-current');
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
    var btn = els.list.querySelector('.line[data-i="' + state.cursor + '"]');
    if (!btn) return;
    var mode = reduceMotion() ? 'auto' : (behavior || 'smooth');
    try { btn.scrollIntoView({ block: 'center', behavior: mode }); } catch (e) { btn.scrollIntoView(); }
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
      if (state.text.trim() && !window.confirm('用示例替换当前内容？')) return;
      els.source.value = SAMPLE_TEXT;
      onTextInput();
      els.source.focus();
      toast('已填入示例');
    });

    els.clearBtn.addEventListener('click', function () {
      if (!els.source.value) return;
      if (!window.confirm('清空录入的内容和抄写进度？')) return;
      els.source.value = '';
      state.text = '';
      state.sentences = [];
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
      var btn = target && target.closest ? target.closest('.line') : null;
      if (!btn || !els.list.contains(btn)) return;
      activateLine(Number(btn.getAttribute('data-i')));
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
  }

  function bindKeyboard() {
    document.addEventListener('keydown', function (e) {
      if (els.dialog && els.dialog.open) return;
      if (document.body.getAttribute('data-view') !== 'reader') return;
      var target = e.target;
      var tag = target && target.tagName ? target.tagName.toLowerCase() : '';
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || tag === 'button' || tag === 'a' || (target && target.isContentEditable)) return;
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
    els.importBtn = $('#import-btn');
    els.sampleBtn = $('#sample-btn');
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

  var SAMPLE_TEXT = [
    '君子曰：学不可以已。青，取之于蓝，而青于蓝；冰，水为之，而寒于水。故木受绳则直，金就砺则利。',
    '君子博学而日参省乎己，则知明而行无过矣。吾尝终日而思矣，不如须臾之所学也；吾尝跂而望矣，不如登高之博见也。'
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
    registerServiceWorker();
    if (els.source) els.source.focus({ preventScroll: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
