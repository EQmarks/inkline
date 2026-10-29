/* 抄写台 — 交互逻辑 */
(function () {
  'use strict';

  var STORAGE_KEY = 'chaoxie:v1';
  var DEFAULT_SETTINGS = {
    theme: 'auto',
    font: 'kai',
    size: 19,
    leading: 1.9,
    focus: true,
    numbers: true,
    hideDone: false,
    strike: false,
    autoScroll: true
  };
  var THEMES = ['auto', 'light', 'dark'];
  var FONTS = ['kai', 'song', 'hei'];

  var state = {
    text: '',
    mode: 'line',
    lines: [],
    done: [],
    cursor: 0,
    settings: null,
    updatedAt: 0,
    firstDoneAt: 0,
    allDoneAt: 0
  };
  var undoStack = [];
  var saveTimer = null;
  var toastTimer = null;
  var pushedHistory = false;
  var els = {};

  /* ---------- 小工具 ---------- */

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
    return line.replace(/^[ \t\u00a0]+/, '').replace(/[ \t\u00a0\u3000]+$/, '');
  }

  function splitSentences(text) {
    var out = [];
    var buf = '';
    var marks = '。！？!?；;…';
    for (var i = 0; i < text.length; i++) {
      var ch = text.charAt(i);
      buf += ch;
      if (marks.indexOf(ch) !== -1) {
        if (!buf.replace(/\s/g, '').length && out.length) {
          out[out.length - 1] += buf;
        } else {
          out.push(buf);
        }
        buf = '';
      }
    }
    if (buf.length) out.push(buf);
    return out;
  }

  function parseLines(text, mode) {
    if (!text) return [];
    var paragraphs = String(text).replace(/\r\n?/g, '\n').split('\n');
    var out = [];
    for (var i = 0; i < paragraphs.length; i++) {
      var para = cleanLine(paragraphs[i]);
      if (!para.replace(/\s/g, '').length) continue;
      if (mode === 'sentence') {
        var parts = splitSentences(para);
        for (var j = 0; j < parts.length; j++) {
          var s = cleanLine(parts[j]);
          if (s.replace(/\s/g, '').length) out.push(s);
        }
      } else {
        out.push(para);
      }
    }
    return out;
  }

  function fitDone(done, n) {
    var out = done.slice(0, n);
    while (out.length < n) out.push(false);
    return out;
  }

  function firstUndone() {
    for (var i = 0; i < state.done.length; i++) {
      if (!state.done[i]) return i;
    }
    return -1;
  }

  function countDone() {
    var n = 0;
    for (var i = 0; i < state.done.length; i++) {
      if (state.done[i]) n++;
    }
    return n;
  }

  function countChars(lines) {
    var n = 0;
    for (var i = 0; i < lines.length; i++) {
      n += lines[i].replace(/\s/g, '').length;
    }
    return n;
  }

  function pad2(n) { return n < 10 ? '0' + n : String(n); }

  function formatDuration(ms) {
    var total = Math.max(0, Math.round(ms / 1000));
    var m = Math.floor(total / 60);
    var s = total % 60;
    if (m >= 60) {
      var h = Math.floor(m / 60);
      m = m % 60;
      return h + ' 小时 ' + pad2(m) + ' 分';
    }
    if (m > 0) return m + ' 分 ' + pad2(s) + ' 秒';
    return s + ' 秒';
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
    state.mode = data.mode === 'sentence' ? 'sentence' : 'line';
    if (Array.isArray(data.done)) state.done = data.done.map(Boolean);
    if (data.settings && typeof data.settings === 'object') {
      var keys = Object.keys(DEFAULT_SETTINGS);
      for (var i = 0; i < keys.length; i++) {
        var k = keys[i];
        if (typeof data.settings[k] !== 'undefined') state.settings[k] = data.settings[k];
      }
    }
    state.updatedAt = Number(data.updatedAt) || 0;
    state.firstDoneAt = Number(data.firstDoneAt) || 0;
    state.allDoneAt = Number(data.allDoneAt) || 0;

    state.lines = parseLines(state.text, state.mode);
    state.done = fitDone(state.done, state.lines.length);
    state.cursor = firstUndone();
    if (state.cursor < 0 && state.lines.length) state.cursor = state.lines.length - 1;
  }

  function save(immediate) {
    state.updatedAt = Date.now();
    var payload = JSON.stringify({
      text: state.text,
      mode: state.mode,
      done: state.done,
      settings: state.settings,
      updatedAt: state.updatedAt,
      firstDoneAt: state.firstDoneAt,
      allDoneAt: state.allDoneAt
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
    if (meta) meta.setAttribute('content', theme === 'dark' ? '#15120e' : '#f6f1e8');
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
    root.setAttribute('data-hide-done', s.hideDone ? 'on' : 'off');
    root.setAttribute('data-strike', s.strike ? 'on' : 'off');
    applyTheme();
    syncSettingsForm();
    if (state.lines.length) paint();
  }

  function syncSettingsForm() {
    $$('[data-segmented]').forEach(function (group) {
      var key = group.getAttribute('data-segmented');
      var value = key === 'mode' ? state.mode : state.settings[key];
      $$('input', group).forEach(function (inp) {
        inp.checked = inp.value === value;
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
    document.title = view === 'reader' ? '抄写中 · 抄写台' : '抄写台 · 逐行抄写，不写串';
    if (view === 'editor') syncResumeCard();
  }

  function enterReader() {
    state.cursor = firstUndone();
    buildList();
    paint();
    setView('reader');
    if (state.cursor < 0) {
      window.scrollTo({ top: 0, behavior: 'auto' });
    } else {
      scrollToCurrent('auto');
    }
    if (!pushedHistory) {
      try {
        history.pushState({ chaoxie: 'reader' }, '');
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
    els.startBtn.disabled = parseLines(state.text, state.mode).length === 0;
    syncSettingsForm();
  }

  function updateEditorStats() {
    if (!els.source || !els.sourceStats) return;
    var text = els.source.value;
    var lines = parseLines(text, state.mode);
    var chars = (text.replace(/\s/g, '')).length;
    els.sourceStats.textContent = lines.length + ' 行 · ' + chars + ' 字';
  }

  function onTextInput() {
    state.text = els.source.value;
    updateEditorStats();
    els.startBtn.disabled = parseLines(state.text, state.mode).length === 0;
    syncResumeCard();
    save();
  }

  function syncResumeCard() {
    if (!els.resumeCard) return;
    var total = parseLines(state.text, state.mode).length;
    var done = countDone();
    if (done > total) done = total;
    var visible = total > 0 && done > 0;
    els.resumeCard.hidden = !visible;
    if (!visible) return;
    var meta = '';
    if (done >= total) {
      meta = '共 ' + total + ' 行，全部抄完 · ' + timeAgo(state.updatedAt);
      els.resumeBtn.textContent = '查看';
      els.resumeTitle.textContent = '上次已全部抄完';
    } else {
      meta = '共 ' + total + ' 行，已抄 ' + done + ' 行 · ' + timeAgo(state.updatedAt);
      els.resumeBtn.textContent = '继续';
      els.resumeTitle.textContent = '上次没抄完';
    }
    els.resumeMeta.textContent = meta;
  }

  function startReading() {
    var text = els.source.value;
    var lines = parseLines(text, state.mode);
    if (!lines.length) {
      toast('先录入一点要抄的内容');
      els.source.focus();
      return;
    }
    state.text = text;
    state.lines = lines;
    state.done = fitDone(state.done, lines.length);
    undoStack = [];
    if (state.done.every(Boolean)) state.allDoneAt = state.allDoneAt || Date.now();
    enterReader();
    save(true);
  }

  function resumeReading() {
    state.text = els.source.value;
    state.lines = parseLines(state.text, state.mode);
    state.done = fitDone(state.done, state.lines.length);
    undoStack = [];
    if (!state.lines.length) { toast('没有可抄的内容'); return; }
    enterReader();
    save(true);
  }

  function resetProgress(skipConfirm) {
    if (!skipConfirm && !window.confirm('清空抄写进度？内容会保留，可以从第一行重新抄。')) return;
    state.done = state.lines.map(function () { return false; });
    state.cursor = state.lines.length ? 0 : -1;
    state.firstDoneAt = 0;
    state.allDoneAt = 0;
    undoStack = [];
    paint();
    save(true);
    scrollToCurrent('auto');
    toast('进度已清空');
  }

  /* ---------- 抄写页渲染 ---------- */

  function buildList() {
    var list = els.list;
    if (!list) return;
    list.textContent = '';
    var frag = document.createDocumentFragment();
    for (var i = 0; i < state.lines.length; i++) {
      var li = document.createElement('li');
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'line';
      btn.setAttribute('data-i', String(i));
      btn.setAttribute('aria-pressed', 'false');

      var no = document.createElement('span');
      no.className = 'line__no';
      no.textContent = String(i + 1);

      var txt = document.createElement('span');
      txt.className = 'line__text';
      txt.textContent = state.lines[i];

      var mark = document.createElement('span');
      mark.className = 'line__mark';
      mark.setAttribute('aria-hidden', 'true');

      btn.appendChild(no);
      btn.appendChild(txt);
      btn.appendChild(mark);
      li.appendChild(btn);
      frag.appendChild(li);
    }
    list.appendChild(frag);
  }

  function makeReaderTitle() {
    var first = state.lines[0] || '';
    if (first.length > 18) first = first.slice(0, 18) + '…';
    return first || '抄写中';
  }

  function completionMeta() {
    var parts = [];
    parts.push('共 ' + state.lines.length + ' 行 · ' + countChars(state.lines) + ' 字');
    if (state.firstDoneAt && state.allDoneAt && state.allDoneAt >= state.firstDoneAt) {
      parts.push('耗时 ' + formatDuration(state.allDoneAt - state.firstDoneAt));
    }
    return parts.join(' · ');
  }

  function canUndo() {
    for (var i = 0; i < undoStack.length; i++) {
      if (state.done[undoStack[i]]) return true;
    }
    return false;
  }

  function paint() {
    if (!els.list) return;
    var buttons = els.list.querySelectorAll('.line');
    var total = state.lines.length;
    var doneCount = 0;
    var cur = state.cursor;

    for (var i = 0; i < buttons.length; i++) {
      var btn = buttons[i];
      var isDone = !!state.done[i];
      if (isDone) doneCount++;
      var isCurrent = !isDone && i === cur;
      var isFar = !!state.settings.focus && cur >= 0 && Math.abs(i - cur) > 2;
      btn.classList.toggle('is-done', isDone);
      btn.classList.toggle('is-current', isCurrent);
      btn.classList.toggle('is-far', isFar);
      btn.setAttribute('aria-pressed', isDone ? 'true' : 'false');
      if (isCurrent) btn.setAttribute('aria-current', 'true');
      else btn.removeAttribute('aria-current');
    }

    var pct = total ? Math.round((doneCount / total) * 100) : 0;
    if (els.progressFill) els.progressFill.style.width = pct + '%';
    if (els.progressBar) els.progressBar.setAttribute('aria-valuenow', String(pct));
    if (els.progressText) els.progressText.textContent = doneCount + ' / ' + total;

    if (els.undoBtn) els.undoBtn.disabled = !canUndo();

    var allDone = total > 0 && doneCount === total;
    if (els.completeBtn) {
      els.completeBtn.disabled = allDone;
      els.completeBtn.textContent = allDone ? '已全部完成' : '完成本行';
    }
    if (els.banner) {
      els.banner.hidden = !allDone;
      if (allDone) {
        if (els.bannerTitle) els.bannerTitle.textContent = '全部 ' + total + ' 行抄完了';
        if (els.bannerMeta) els.bannerMeta.textContent = completionMeta();
      }
    }
    if (els.readerTitle) els.readerTitle.textContent = makeReaderTitle();
  }

  function scrollToCurrent(behavior) {
    if (!els.list || state.cursor < 0) return;
    var btn = els.list.querySelector('.line[data-i="' + state.cursor + '"]');
    if (!btn) return;
    var mode = reduceMotion() ? 'auto' : (behavior || 'smooth');
    try { btn.scrollIntoView({ block: 'center', behavior: mode }); } catch (e) { btn.scrollIntoView(); }
  }

  function completeLine(i) {
    if (!(i >= 0 && i < state.lines.length) || state.done[i]) return;
    state.done[i] = true;
    if (!state.firstDoneAt) state.firstDoneAt = Date.now();
    undoStack.push(i);
    if (undoStack.length > 300) undoStack.shift();
    state.cursor = firstUndone();
    if (state.cursor === -1) state.allDoneAt = Date.now();
    paint();
    save();
    if (state.settings.autoScroll) {
      if (state.cursor === -1) {
        window.scrollTo({ top: 0, behavior: reduceMotion() ? 'auto' : 'smooth' });
      } else {
        scrollToCurrent('smooth');
      }
    }
  }

  function activateLine(i) {
    if (!(i >= 0 && i < state.lines.length)) return;
    if (state.done[i]) {
      state.done[i] = false;
      state.allDoneAt = 0;
      state.cursor = firstUndone();
      paint();
      save();
      scrollToCurrent('smooth');
      toast('第 ' + (i + 1) + ' 行已改回未抄');
    } else {
      completeLine(i);
    }
  }

  function undo() {
    var idx = -1;
    while (undoStack.length) {
      var j = undoStack.pop();
      if (state.done[j]) { idx = j; break; }
    }
    if (idx === -1) { toast('没有可以撤回的行'); return; }
    state.done[idx] = false;
    state.allDoneAt = 0;
    state.cursor = firstUndone();
    paint();
    save();
    scrollToCurrent('smooth');
    toast('已撤回第 ' + (idx + 1) + ' 行');
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

    els.source.addEventListener('dragover', function (e) {
      e.preventDefault();
      els.source.classList.add('is-dragover');
    });
    els.source.addEventListener('dragleave', function () { els.source.classList.remove('is-dragover'); });
    els.source.addEventListener('drop', function (e) {
      e.preventDefault();
      els.source.classList.remove('is-dragover');
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
      state.lines = [];
      state.done = [];
      state.cursor = -1;
      state.firstDoneAt = 0;
      state.allDoneAt = 0;
      undoStack = [];
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

    els.completeBtn.addEventListener('click', function () {
      if (state.cursor >= 0) completeLine(state.cursor);
    });
    els.undoBtn.addEventListener('click', undo);
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
      inp.addEventListener('change', function () {
        if (inp.type !== 'range') return;
        setSetting(inp.getAttribute('data-setting'), Number(inp.value));
      });
    });

    $$('[data-segmented]').forEach(function (group) {
      var key = group.getAttribute('data-segmented');
      $$('input', group).forEach(function (inp) {
        inp.addEventListener('change', function () {
          if (!inp.checked) return;
          if (key === 'mode') {
            state.mode = inp.value;
            updateEditorStats();
            els.startBtn.disabled = parseLines(state.text, state.mode).length === 0;
            syncSettingsForm();
            save();
          } else {
            setSetting(key, inp.value);
          }
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
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        if (state.cursor >= 0) completeLine(state.cursor);
      } else if (e.key === 'Backspace' || e.key === 'z' || e.key === 'Z') {
        e.preventDefault();
        undo();
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
    els.resumeTitle = $('.resume__title');
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
    els.completeBtn = $('#complete-btn');
    els.undoBtn = $('#undo-btn');
    els.settingsBtn = $('#settings-btn');

    els.dialog = $('#settings-dialog');
    els.sizeOut = $('#size-out');
    els.leadingOut = $('#leading-out');
    els.resetProgressBtn = $('#reset-progress-btn');
    els.editFromSheetBtn = $('#edit-from-sheet-btn');
    els.toast = $('#toast');
  }

  var SAMPLE_TEXT = [
    '立身以立学为先，立学以读书为本。',
    '读书之法，在循序而渐进，熟读而精思。',
    '博观而约取，厚积而薄发。',
    '纸上得来终觉浅，绝知此事要躬行。',
    '问渠那得清如许？为有源头活水来。'
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
