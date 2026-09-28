/*
 * マークダウン練習帳 - 画面の動き
 */
(function () {
  'use strict';

  var MD = window.MiniMarkdown;
  var DATA = window.MDLearnData;

  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  var editor = $('#editor');
  var preview = $('#preview');
  var previewScroll = $('#preview-scroll');
  var workspace = $('#workspace');
  var sidebar = $('#sidebar');
  var filenameInput = $('#filename');
  var optBreaks = $('#opt-breaks');
  var optSync = $('#opt-sync');

  /* ---------- 保存（localStorage が使えない環境でも動くように） ---------- */

  var STORE_KEY = 'mdlearn.v1';

  function loadState() {
    try {
      var raw = window.localStorage.getItem(STORE_KEY);
      return raw ? JSON.parse(raw) || {} : {};
    } catch (e) {
      return {};
    }
  }

  var state = loadState();

  function saveState() {
    try {
      window.localStorage.setItem(STORE_KEY, JSON.stringify(state));
    } catch (e) { /* 保存できなくても動作は続ける */ }
  }

  var saveTimer = null;
  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      state.content = editor.value;
      state.filename = filenameInput.value;
      saveState();
    }, 400);
  }

  /* ---------- トースト通知 ---------- */

  var toastTimer = null;
  function toast(msg) {
    var el = $('#toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('show'); }, 2200);
  }

  /* ---------- プレビュー描画 ---------- */

  var renderQueued = false;
  var dirty = false;

  function render() {
    renderQueued = false;
    preview.innerHTML = MD.render(editor.value, { breaks: optBreaks.checked });
    updateStats();
    updateHints();
    updatePractice();
    syncScroll();
  }

  function queueRender() {
    if (renderQueued) return;
    renderQueued = true;
    window.requestAnimationFrame(render);
  }

  function updateStats() {
    var v = editor.value;
    var chars = v.replace(/\n/g, '').length;
    var lines = v === '' ? 0 : v.split('\n').length;
    $('#stats').textContent = chars + ' 文字 / ' + lines + ' 行';
  }

  function onEdited() {
    dirty = true;
    queueRender();
    scheduleSave();
  }

  function setContent(text, isClean) {
    editor.value = text;
    editor.setSelectionRange(0, 0);
    editor.scrollTop = 0;
    dirty = !isClean;
    render();
    scheduleSave();
  }

  /* ---------- よくある間違いのヒント ---------- */

  function findHints(text) {
    var hints = [];
    var inFence = false;
    text.split('\n').forEach(function (line, idx) {
      if (/^\s{0,3}(`{3,}|~{3,})/.test(line)) { inFence = !inFence; return; }
      if (inFence || /^ {4,}/.test(line)) return;
      var code = line.replace(/`[^`]*`/g, '');
      var no = idx + 1;

      if (/!\([^()\n]*\)\[[^\[\]\n]+\]/.test(code)) {
        hints.push({ line: no, msg: '画像は ![代替テキスト](パス) の順番です。( ) と [ ] が逆になっていませんか？' });
      } else if (/(^|[^!\]])\([^()\n]+\)\[[^\[\]\n]+\]/.test(code)) {
        hints.push({ line: no, msg: 'リンクは [表示する文字](URL) の順番です。( ) と [ ] が逆になっていませんか？' });
      }
      if (/^#{1,6}\u3000/.test(code)) {
        hints.push({ line: no, msg: '# の後が全角スペースです。見出しにするには半角スペースを入れましょう。' });
      } else if (/^#{1,6}[^#\s]/.test(code)) {
        hints.push({ line: no, msg: '見出しにするには # の後に半角スペースが必要です。' });
      }
      if (/^\s*[＃＊－＋＞｜]/.test(code) || /^\s*[0-9０-９]+[．]/.test(code)) {
        hints.push({ line: no, msg: '行頭の記号が全角になっています。マークダウンの記号は半角で書きましょう。' });
      }
      if (/^\s*[-+]\u3000/.test(code) || /^\s*\d+\.\u3000/.test(code) || /^\s*>\u3000/.test(code)) {
        hints.push({ line: no, msg: '記号の後が全角スペースです。半角スペースにすると記法として認識されます。' });
      } else if (/^\s*[-+][^\s\-+]/.test(code) || /^\s*\d+\.[^\s\d]/.test(code)) {
        hints.push({ line: no, msg: 'リストにするには - や 1. の後に半角スペースが必要です。' });
      }
    });
    return hints;
  }

  function updateHints() {
    var box = $('#hints');
    var hints = findHints(editor.value);
    if (!hints.length) {
      box.hidden = true;
      box.innerHTML = '';
      return;
    }
    box.hidden = false;
    var shown = hints.slice(0, 4);
    box.innerHTML = shown.map(function (h) {
      return '<button type="button" class="hint" data-line="' + h.line + '">💡 <b>' + h.line + '行目</b> ' + MD.escapeHtml(h.msg) + '</button>';
    }).join('') + (hints.length > shown.length ? '<p class="hint-more">ほか ' + (hints.length - shown.length) + ' 件</p>' : '');
  }

  function jumpToLine(no) {
    var lines = editor.value.split('\n');
    var start = 0;
    for (var i = 0; i < no - 1 && i < lines.length; i++) start += lines[i].length + 1;
    var end = start + (lines[no - 1] || '').length;
    var lh = parseFloat(window.getComputedStyle(editor).lineHeight) || 20;
    editor.focus();
    editor.setSelectionRange(start, end);
    editor.scrollTop = Math.max(0, (no - 3) * lh);
  }

  $('#hints').addEventListener('click', function (e) {
    var btn = e.target.closest('.hint');
    if (btn) jumpToLine(parseInt(btn.getAttribute('data-line'), 10));
  });

  /* ---------- テキスト編集の補助 ---------- */

  // 取り消し(Ctrl+Z)が効くように execCommand を優先して使う
  function replaceRange(start, end, text, selStart, selEnd) {
    editor.focus();
    editor.setSelectionRange(start, end);
    var ok = false;
    try { ok = document.execCommand('insertText', false, text); } catch (e) { ok = false; }
    if (!ok || editor.value.slice(start, start + text.length) !== text) {
      editor.setRangeText(text, start, end, 'end');
    }
    editor.setSelectionRange(selStart == null ? start + text.length : selStart,
                             selEnd == null ? (selStart == null ? start + text.length : selStart) : selEnd);
    onEdited();
  }

  function wrapSelection(before, after, placeholder) {
    var v = editor.value, s = editor.selectionStart, e = editor.selectionEnd;
    var sel = v.slice(s, e);

    // すでに囲まれていれば外す（トグル）
    if (sel.length >= before.length + after.length && sel.indexOf(before) === 0 &&
        sel.slice(-after.length) === after && sel.length > before.length) {
      var inner = sel.slice(before.length, sel.length - after.length);
      replaceRange(s, e, inner, s, s + inner.length);
      return;
    }
    var around = v.slice(s - before.length, s) === before && v.slice(e, e + after.length) === after;
    if (around && before.length === 1 && v.charAt(s - 2) === before && v.charAt(e + 1) === after) around = false;
    if (around) {
      replaceRange(s - before.length, e + after.length, sel, s - before.length, e - before.length);
      return;
    }
    var text = sel || placeholder;
    replaceRange(s, e, before + text + after, s + before.length, s + before.length + text.length);
  }

  // 選択中の行（またはカーソルのある行）をまとめて変換する
  function transformLines(fn) {
    var v = editor.value, s = editor.selectionStart, e = editor.selectionEnd;
    var ls = v.lastIndexOf('\n', s - 1) + 1;
    var endPos = e > s && v.charAt(e - 1) === '\n' ? e - 1 : e;
    var le = v.indexOf('\n', endPos);
    if (le === -1) le = v.length;
    var lines = v.slice(ls, le).split('\n');
    var out = fn(lines).join('\n');
    if (s === e) replaceRange(ls, le, out);
    else replaceRange(ls, le, out, ls, ls + out.length);
  }

  var LIST_MARK = /^(\s*)(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/;

  function toggleHeading(level) {
    var mark = new Array(level + 1).join('#') + ' ';
    transformLines(function (lines) {
      var all = lines.every(function (l) { return l.indexOf(mark) === 0; });
      return lines.map(function (l) {
        var body = l.replace(/^#{1,6}\s+/, '');
        return all ? body : mark + body;
      });
    });
  }

  function toggleList(kind) {
    transformLines(function (lines) {
      var test = {
        ul: /^\s*[-*+]\s+(?!\[[ xX]\])/,
        ol: /^\s*\d+[.)]\s+/,
        task: /^\s*[-*+]\s+\[[ xX]\]\s+/
      }[kind];
      var all = lines.every(function (l) { return test.test(l) || l.trim() === ''; });
      var n = 0;
      return lines.map(function (l) {
        var m = l.match(LIST_MARK);
        var indent = m ? m[1] : l.match(/^\s*/)[0];
        var body = m ? l.slice(m[0].length) : l.replace(/^\s*/, '');
        if (all) return indent + body;
        if (lines.length > 1 && l.trim() === '') return l;
        n++;
        if (kind === 'ul') return indent + '- ' + body;
        if (kind === 'ol') return indent + n + '. ' + body;
        return indent + '- [ ] ' + body;
      });
    });
  }

  function toggleQuote() {
    transformLines(function (lines) {
      var all = lines.every(function (l) { return /^\s*>/.test(l); });
      return lines.map(function (l) { return all ? l.replace(/^(\s*)>\s?/, '$1') : '> ' + l; });
    });
  }

  // 前後に空行を入れてブロックを挿入する。selFrom / selLen は text 内で選択状態にする範囲
  // replaceSel が false のときは、選択範囲を消さずにその行の末尾へ挿入する
  function insertBlock(text, selFrom, selLen, replaceSel) {
    var v = editor.value, s = editor.selectionStart, e = editor.selectionEnd;
    if (!replaceSel) {
      // カーソルのある段落・表などの途中に割り込まないよう、そのブロックの終わりまで進める
      var ls = v.lastIndexOf('\n', e - 1) + 1;
      var le = v.indexOf('\n', e);
      if (le === -1) le = v.length;
      if (s !== e || v.slice(ls, le).trim() !== '') {
        var blockEnd = v.slice(e).search(/\n[ \t]*(\n|$)/);
        s = e = blockEnd === -1 ? v.length : e + blockEnd;
      }
    }
    var before = v.slice(0, s), after = v.slice(e);
    var pre = '';
    if (before.length && !/\n\n$/.test(before)) pre = /\n$/.test(before) ? '\n' : '\n\n';
    var post = '';
    if (!after.length) post = '\n';
    else if (!/^\n\n/.test(after)) post = /^\n/.test(after) ? '\n' : '\n\n';
    var base = s + pre.length;
    if (selFrom == null) {
      replaceRange(s, e, pre + text + post, base + text.length);
    } else {
      replaceRange(s, e, pre + text + post, base + selFrom, base + selFrom + selLen);
    }
  }

  var COMMANDS = {
    h1: function () { toggleHeading(1); },
    h2: function () { toggleHeading(2); },
    h3: function () { toggleHeading(3); },
    bold: function () { wrapSelection('**', '**', '太字'); },
    italic: function () { wrapSelection('*', '*', '斜体'); },
    strike: function () { wrapSelection('~~', '~~', '打ち消し'); },
    code: function () { wrapSelection('`', '`', 'code'); },
    ul: function () { toggleList('ul'); },
    ol: function () { toggleList('ol'); },
    task: function () { toggleList('task'); },
    quote: function () { toggleQuote(); },
    link: function () {
      var s = editor.selectionStart, e = editor.selectionEnd;
      var sel = editor.value.slice(s, e);
      if (/^https?:\/\/\S+$/.test(sel)) {
        replaceRange(s, e, '[リンクテキスト](' + sel + ')', s + 1, s + 8);
      } else if (sel) {
        var url = 'https://example.com';
        var t = '[' + sel + '](' + url + ')';
        replaceRange(s, e, t, s + sel.length + 3, s + sel.length + 3 + url.length);
      } else {
        replaceRange(s, e, '[リンクテキスト](https://example.com)', s + 1, s + 8);
      }
    },
    image: function () {
      var img = DATA.SAMPLE_IMAGES[0];
      var t = '![' + img.alt + '](' + img.file + ')';
      insertBlock(t, 2, img.alt.length);
      openSidebar('images');
      toast('「画像」タブから他のサンプル画像も選べます');
    },
    table: function () {
      var t = '| 見出し1 | 見出し2 | 見出し3 |\n| --- | --- | --- |\n| セル | セル | セル |\n| セル | セル | セル |';
      insertBlock(t, 2, 4);
    },
    codeblock: function () {
      var s = editor.selectionStart, e = editor.selectionEnd;
      var sel = editor.value.slice(s, e) || 'ここにコード';
      insertBlock('```\n' + sel + '\n```', 4, sel.length, true);
    },
    hr: function () { insertBlock('---'); }
  };

  $$('.toolbar [data-cmd]').forEach(function (btn) {
    btn.addEventListener('mousedown', function (e) { e.preventDefault(); }); // 選択範囲を保つ
    btn.addEventListener('click', function () { COMMANDS[btn.getAttribute('data-cmd')](); });
  });

  function inCodeFence(pos) {
    var before = editor.value.slice(0, pos).split('\n');
    before.pop();
    var open = false;
    before.forEach(function (l) { if (/^\s{0,3}(`{3,}|~{3,})/.test(l)) open = !open; });
    return open;
  }

  editor.addEventListener('keydown', function (e) {
    var mod = e.ctrlKey || e.metaKey;
    if (e.isComposing || e.keyCode === 229) return; // 日本語入力の変換中は何もしない

    if (mod && !e.shiftKey && !e.altKey) {
      var k = e.key.toLowerCase();
      if (k === 'b') { e.preventDefault(); COMMANDS.bold(); return; }
      if (k === 'i') { e.preventDefault(); COMMANDS.italic(); return; }
      if (k === 'k') { e.preventDefault(); COMMANDS.link(); return; }
    }

    var v = editor.value, s = editor.selectionStart, en = editor.selectionEnd;

    // Tab: 字下げ / Shift+Tab: 字下げ解除
    if (e.key === 'Tab' && !mod && !e.altKey) {
      var ls = v.lastIndexOf('\n', s - 1) + 1;
      var lineText = v.slice(ls, v.indexOf('\n', s) === -1 ? v.length : v.indexOf('\n', s));
      if (e.shiftKey || s !== en || LIST_MARK.test(lineText)) {
        e.preventDefault();
        var caretOffset = s - ls;
        var multi = s !== en;
        var removed = 0;
        transformLines(function (lines) {
          return lines.map(function (l, i) {
            if (!e.shiftKey) return '  ' + l;
            var r = l.match(/^ {1,2}/);
            if (i === 0 && r) removed = r[0].length;
            return r ? l.slice(r[0].length) : l;
          });
        });
        if (!multi) {
          var p = ls + Math.max(0, caretOffset + (e.shiftKey ? -removed : 2));
          editor.setSelectionRange(p, p);
        }
      } else {
        e.preventDefault();
        replaceRange(s, en, '  ');
      }
      return;
    }

    // Enter: リストや引用の記号を次の行にも自動で入れる
    if (e.key === 'Enter' && !e.shiftKey && !mod && !e.altKey && s === en && !inCodeFence(s)) {
      var lineStart = v.lastIndexOf('\n', s - 1) + 1;
      var line = v.slice(lineStart, s);
      var m = line.match(/^(\s*)([-*+]|(\d+)([.)]))(\s+)(\[[ xX]\]\s+)?(.*)$/);
      var q = line.match(/^(\s*(?:>\s?)+)(.*)$/);
      if (m) {
        e.preventDefault();
        if (m[7].trim() === '') {
          replaceRange(lineStart, s, ''); // 空の項目で Enter → リスト終了
          return;
        }
        var marker = m[3] ? (parseInt(m[3], 10) + 1) + m[4] : m[2];
        replaceRange(s, s, '\n' + m[1] + marker + m[5] + (m[6] ? '[ ] ' : ''));
        return;
      }
      if (q) {
        e.preventDefault();
        if (q[2].trim() === '') { replaceRange(lineStart, s, ''); return; }
        replaceRange(s, s, '\n' + q[1].replace(/\s*$/, ' '));
      }
    }
  });

  editor.addEventListener('input', onEdited);

  document.addEventListener('keydown', function (e) {
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 's') {
      e.preventDefault();
      downloadMarkdown();
    }
    if (e.key === 'Escape' && !sidebar.hidden && window.matchMedia('(max-width: 1100px)').matches) {
      closeSidebar();
    }
  });

  /* ---------- スクロール同期 ---------- */

  function syncScroll() {
    if (!optSync.checked) return;
    var max = editor.scrollHeight - editor.clientHeight;
    var ratio = max > 0 ? editor.scrollTop / max : 0;
    previewScroll.scrollTop = ratio * (previewScroll.scrollHeight - previewScroll.clientHeight);
  }
  editor.addEventListener('scroll', syncScroll);
  optSync.addEventListener('change', function () {
    state.sync = optSync.checked;
    saveState();
    syncScroll();
  });

  optBreaks.addEventListener('change', function () {
    state.breaks = optBreaks.checked;
    saveState();
    render();
    renderDictionary();
  });

  /* ---------- ページ内リンク（#見出し）をプレビュー内でスクロール ---------- */

  function handleAnchors(container) {
    container.addEventListener('click', function (e) {
      var a = e.target.closest('a');
      if (!a || !container.contains(a)) return;
      var href = a.getAttribute('href') || '';
      if (href.charAt(0) !== '#') return;
      e.preventDefault();
      var raw = href.slice(1);
      try { raw = decodeURIComponent(raw); } catch (err) { /* そのまま使う */ }
      var candidates = [raw, raw.toLowerCase(), raw.toLowerCase().replace(/\s/g, '-')];
      var target = null;
      for (var i = 0; i < candidates.length && !target; i++) {
        target = container.querySelector('[id="' + candidates[i].replace(/["\\]/g, '\\$&') + '"]');
      }
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      else toast('リンク先の見出し「' + raw + '」が見つかりません');
    });
  }
  handleAnchors(preview);

  /* ---------- ファイル操作 ---------- */

  function safeFilename(name, ext) {
    var n = String(name || '').trim().replace(/[\\\/:*?"<>|]/g, '_') || 'document';
    n = n.replace(/\.(md|markdown|txt|html?)$/i, '');
    return n + ext;
  }

  function downloadFile(name, content, type) {
    var blob = new Blob([content], { type: type });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
  }

  function downloadMarkdown() {
    var name = safeFilename(filenameInput.value, '.md');
    filenameInput.value = name;
    downloadFile(name, editor.value, 'text/markdown;charset=utf-8');
    dirty = false;
    scheduleSave();
    toast(name + ' をダウンロードしました');
  }

  function confirmDiscard(message) {
    if (!dirty || editor.value.trim() === '') return true;
    return window.confirm(message + '\n（今の内容は消えます。必要なら先に「ダウンロード」してください）');
  }

  function openFile(file) {
    if (!file) return;
    if (!/\.(md|markdown|txt)$/i.test(file.name) && file.type && !/^text\//.test(file.type)) {
      toast('.md / .markdown / .txt ファイルを選んでください');
      return;
    }
    if (!confirmDiscard('「' + file.name + '」を開きますか？')) return;
    var reader = new FileReader();
    reader.onload = function () {
      var text = String(reader.result).replace(/^\uFEFF/, '');
      filenameInput.value = file.name;
      setContent(text, true);
      toast(file.name + ' を開きました');
    };
    reader.onerror = function () { toast('ファイルを読み込めませんでした'); };
    reader.readAsText(file, 'UTF-8');
  }

  $('#btn-save').addEventListener('click', downloadMarkdown);
  $('#btn-open').addEventListener('click', function () { $('#file-input').click(); });
  $('#file-input').addEventListener('change', function (e) {
    openFile(e.target.files[0]);
    e.target.value = '';
  });
  $('#btn-new').addEventListener('click', function () {
    if (!confirmDiscard('新しく書き始めますか？')) return;
    filenameInput.value = 'document.md';
    setContent('', true);
    editor.focus();
  });
  $('#btn-sample').addEventListener('click', function () {
    if (!confirmDiscard('サンプルの文章を読み込みますか？')) return;
    setContent(DATA.TUTORIAL, true);
  });
  filenameInput.addEventListener('input', scheduleSave);

  // ドラッグ & ドロップで開く
  var editorWrap = $('#editor-wrap');
  var dragDepth = 0;
  editorWrap.addEventListener('dragenter', function (e) {
    if (!e.dataTransfer || Array.prototype.indexOf.call(e.dataTransfer.types, 'Files') === -1) return;
    e.preventDefault();
    dragDepth++;
    editorWrap.classList.add('dragging');
  });
  editorWrap.addEventListener('dragover', function (e) {
    if (e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types, 'Files') !== -1) e.preventDefault();
  });
  editorWrap.addEventListener('dragleave', function () {
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) editorWrap.classList.remove('dragging');
  });
  editorWrap.addEventListener('drop', function (e) {
    dragDepth = 0;
    editorWrap.classList.remove('dragging');
    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) {
      e.preventDefault();
      openFile(e.dataTransfer.files[0]);
    }
  });

  // HTML として書き出す
  var EXPORT_CSS = [
    'body{font-family:system-ui,-apple-system,"Hiragino Sans","Noto Sans JP","Yu Gothic UI",sans-serif;line-height:1.8;color:#1f2328;max-width:820px;margin:40px auto;padding:0 20px}',
    'h1,h2{border-bottom:1px solid #d8dee4;padding-bottom:.3em}h1,h2,h3,h4,h5,h6{line-height:1.35;margin:1.6em 0 .6em}',
    'a{color:#0969da}img{max-width:100%}hr{border:0;border-top:2px solid #d8dee4;margin:2em 0}',
    'code{font-family:ui-monospace,Consolas,monospace;background:#eff1f3;padding:.15em .4em;border-radius:4px;font-size:.9em}',
    'pre{background:#f6f8fa;padding:14px 16px;border-radius:8px;overflow:auto}pre code{background:none;padding:0}',
    'blockquote{margin:1em 0;padding:.2em 1em;color:#57606a;border-left:4px solid #d0d7de}',
    'table{border-collapse:collapse;margin:1em 0}th,td{border:1px solid #d0d7de;padding:6px 12px}th{background:#f6f8fa}',
    '.task-list-item{list-style:none}.task-list-item input{margin:0 .4em 0 -1.4em}',
    '.md-alert{border-left:4px solid #0969da;padding:.4em 1em;margin:1em 0}.md-alert-title{font-weight:bold;margin:.2em 0}',
    '.md-alert-tip{border-color:#1a7f37}.md-alert-important{border-color:#8250df}.md-alert-warning{border-color:#9a6700}.md-alert-caution{border-color:#cf222e}',
    '.footnotes{font-size:.9em;color:#57606a}mark{background:#fff3a3}kbd{border:1px solid #d0d7de;border-bottom-width:2px;border-radius:4px;padding:0 .35em;font-size:.85em}'
  ].join('\n');

  $('#btn-export').addEventListener('click', function () {
    var h1 = preview.querySelector('h1');
    var title = h1 ? h1.textContent.trim() : safeFilename(filenameInput.value, '');
    var html = '<!DOCTYPE html>\n<html lang="ja">\n<head>\n<meta charset="UTF-8">\n' +
      '<meta name="viewport" content="width=device-width, initial-scale=1">\n' +
      '<title>' + MD.escapeHtml(title) + '</title>\n<style>\n' + EXPORT_CSS + '\n</style>\n</head>\n<body>\n' +
      preview.innerHTML + '\n</body>\n</html>\n';
    var name = safeFilename(filenameInput.value, '.html');
    downloadFile(name, html, 'text/html;charset=utf-8');
    toast(name + ' を書き出しました');
  });

  /* ---------- 表示モード ---------- */

  function setView(view) {
    workspace.setAttribute('data-view', view);
    $$('.segmented [data-view]').forEach(function (b) {
      var on = b.getAttribute('data-view') === view;
      b.classList.toggle('active', on);
      b.setAttribute('aria-checked', on ? 'true' : 'false');
    });
    state.view = view;
    saveState();
  }
  $$('.segmented [data-view]').forEach(function (b) {
    b.addEventListener('click', function () { setView(b.getAttribute('data-view')); });
  });

  /* ---------- サイドパネル ---------- */

  function openSidebar(panel) {
    sidebar.hidden = false;
    workspace.classList.add('has-sidebar');
    $$('.panel', sidebar).forEach(function (p) { p.hidden = p.id !== 'panel-' + panel; });
    $$('[data-panel]').forEach(function (b) {
      var on = b.getAttribute('data-panel') === panel;
      b.classList.toggle('active', on);
      if (b.getAttribute('role') === 'tab') b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    state.panel = panel;
    saveState();
  }

  function closeSidebar() {
    sidebar.hidden = true;
    workspace.classList.remove('has-sidebar');
    $$('[data-panel]').forEach(function (b) { b.classList.remove('active'); });
    state.panel = null;
    saveState();
  }

  $$('.btn-tab[data-panel]').forEach(function (b) {
    b.addEventListener('click', function () {
      var panel = b.getAttribute('data-panel');
      if (!sidebar.hidden && state.panel === panel) closeSidebar();
      else openSidebar(panel);
    });
  });
  $$('.sidebar-tabs [data-panel]').forEach(function (b) {
    b.addEventListener('click', function () { openSidebar(b.getAttribute('data-panel')); });
  });
  $('#sidebar-close').addEventListener('click', closeSidebar);

  /* ---------- クリップボード ---------- */

  function copyText(text) {
    function fallback() {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      ta.remove();
      toast(ok ? 'コピーしました' : 'コピーできませんでした');
    }
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(function () { toast('コピーしました'); }, fallback);
    } else {
      fallback();
    }
  }

  // 挿入後、狭い画面ではパネルを閉じて書き込み画面を見せる
  function insertFromPanel(text) {
    if (workspace.getAttribute('data-view') === 'preview') setView('split');
    insertBlock(text);
    if (window.matchMedia('(max-width: 1100px)').matches) closeSidebar();
    toast('書き込み画面に挿入しました');
  }

  /* ---------- 辞書 ---------- */

  var dictList = $('#dict-list');
  handleAnchors(dictList);

  function renderDictionary() {
    var esc = MD.escapeHtml;
    var html = '';
    DATA.DICTIONARY.forEach(function (cat, ci) {
      html += '<section class="dict-cat" id="dict-cat-' + ci + '"><h3 class="dict-cat-title">' + esc(cat.category) + '</h3>';
      cat.items.forEach(function (item, ii) {
        var search = (cat.category + ' ' + item.title + ' ' + item.desc + ' ' + item.md + ' ' + (item.note || '')).toLowerCase();
        html += '<article class="dict-item" data-search="' + esc(search).replace(/"/g, '&quot;') + '">' +
          '<h4>' + esc(item.title) + '</h4>' +
          '<p class="dict-desc">' + esc(item.desc) + '</p>' +
          '<div class="dict-demo">' +
            '<div class="dict-col"><span class="dict-label">書き方</span><pre class="dict-md">' + esc(item.md) + '</pre></div>' +
            '<div class="dict-col"><span class="dict-label">表示</span><div class="dict-result markdown-body">' +
              MD.render(item.md, { breaks: optBreaks.checked }) + '</div></div>' +
          '</div>' +
          (item.note ? '<p class="dict-note">⚠ ' + esc(item.note) + '</p>' : '') +
          '<div class="dict-actions">' +
            '<button type="button" class="btn btn-small" data-insert="' + ci + '-' + ii + '">書き込み画面に挿入</button>' +
            '<button type="button" class="btn btn-small btn-ghost" data-copy="' + ci + '-' + ii + '">コピー</button>' +
          '</div>' +
        '</article>';
      });
      html += '</section>';
    });
    html += '<p class="dict-empty" hidden>見つかりませんでした。別の言葉で検索してみてください。</p>';
    dictList.innerHTML = html;
    filterDictionary();
  }

  function dictItem(key) {
    var p = key.split('-');
    return DATA.DICTIONARY[+p[0]].items[+p[1]];
  }

  dictList.addEventListener('click', function (e) {
    var ins = e.target.closest('[data-insert]');
    var cp = e.target.closest('[data-copy]');
    if (ins) insertFromPanel(dictItem(ins.getAttribute('data-insert')).md);
    if (cp) copyText(dictItem(cp.getAttribute('data-copy')).md);
  });

  $('#dict-nav').innerHTML = DATA.DICTIONARY.map(function (cat, ci) {
    return '<button type="button" data-cat="' + ci + '">' + MD.escapeHtml(cat.category) + '</button>';
  }).join('');
  $('#dict-nav').addEventListener('click', function (e) {
    var b = e.target.closest('[data-cat]');
    if (!b) return;
    var search = $('#dict-search');
    if (search.value) { search.value = ''; filterDictionary(); }
    var sec = $('#dict-cat-' + b.getAttribute('data-cat'));
    dictList.scrollTop = sec.offsetTop - dictList.offsetTop;
  });

  function filterDictionary() {
    var q = $('#dict-search').value.trim().toLowerCase();
    var words = q ? q.split(/\s+/) : [];
    var any = false;
    $$('.dict-cat', dictList).forEach(function (sec) {
      var visible = 0;
      $$('.dict-item', sec).forEach(function (item) {
        var text = item.getAttribute('data-search');
        var hit = words.every(function (w) { return text.indexOf(w) !== -1; });
        item.hidden = !hit;
        if (hit) visible++;
      });
      sec.hidden = visible === 0;
      if (visible) any = true;
    });
    $('.dict-empty', dictList).hidden = any;
  }
  $('#dict-search').addEventListener('input', filterDictionary);

  /* ---------- サンプル画像 ---------- */

  (function renderImages() {
    var esc = MD.escapeHtml;
    $('#image-grid').innerHTML = DATA.SAMPLE_IMAGES.map(function (img, i) {
      var md = '![' + img.alt + '](' + img.file + ')';
      return '<figure class="image-card">' +
        '<div class="image-thumb"><img src="' + esc(img.file) + '" alt="' + esc(img.alt) + '"></div>' +
        '<figcaption>' +
          '<span class="image-name">' + esc(img.alt) + ' <small>' + esc(img.size) + '</small></span>' +
          '<code class="image-md">' + esc(md) + '</code>' +
          '<span class="image-actions">' +
            '<button type="button" class="btn btn-small" data-img-insert="' + i + '">挿入</button>' +
            '<button type="button" class="btn btn-small btn-ghost" data-img-copy="' + i + '">コピー</button>' +
          '</span>' +
        '</figcaption>' +
      '</figure>';
    }).join('');
    $('#image-grid').addEventListener('click', function (e) {
      var ins = e.target.closest('[data-img-insert]');
      var cp = e.target.closest('[data-img-copy]');
      var pick = function (i) { var img = DATA.SAMPLE_IMAGES[+i]; return '![' + img.alt + '](' + img.file + ')'; };
      if (ins) insertFromPanel(pick(ins.getAttribute('data-img-insert')));
      if (cp) copyText(pick(cp.getAttribute('data-img-copy')));
    });
  })();

  /* ---------- 練習問題 ---------- */

  var practiceDone = null;

  (function renderPractice() {
    var esc = MD.escapeHtml;
    $('#practice-list').innerHTML = DATA.PRACTICE.map(function (task, i) {
      return '<li class="practice-item" data-index="' + i + '">' +
        '<span class="practice-mark" aria-hidden="true"></span>' +
        '<div class="practice-body">' +
          '<h4>' + esc(task.title) + ' <span class="visually-hidden practice-status"></span></h4>' +
          '<p>' + esc(task.desc) + '</p>' +
          '<details><summary>ヒントを見る</summary>' +
            '<pre class="dict-md">' + esc(task.example.replace(/^\n+|\n+$/g, '')) + '</pre>' +
            '<button type="button" class="btn btn-small" data-practice-insert="' + i + '">例を挿入</button>' +
          '</details>' +
        '</div>' +
      '</li>';
    }).join('') +
    '';
    var reset = document.createElement('div');
    reset.className = 'practice-reset';
    reset.innerHTML = '<p>判定は「書き込み画面」の今の内容で行います。サンプル文章が残っていると最初からクリア扱いになるので、白紙から挑戦してみましょう。</p>' +
      '<button type="button" class="btn" id="practice-blank">白紙から練習を始める</button>';
    $('#panel-practice .panel-body').appendChild(reset);

    $('#practice-list').addEventListener('click', function (e) {
      var b = e.target.closest('[data-practice-insert]');
      if (b) insertFromPanel(DATA.PRACTICE[+b.getAttribute('data-practice-insert')].example.replace(/^\n+|\n+$/g, ''));
    });
    $('#practice-blank').addEventListener('click', function () {
      if (!confirmDiscard('書き込み画面を空にして練習を始めますか？')) return;
      setContent('', true);
      editor.focus();
      toast('上から順番に挑戦してみましょう！');
    });
  })();

  function updatePractice() {
    var total = DATA.PRACTICE.length;
    var done = 0;
    var current = DATA.PRACTICE.map(function (task) {
      var ok = false;
      try { ok = !!task.check(preview); } catch (e) { ok = false; }
      if (ok) done++;
      return ok;
    });
    $$('.practice-item').forEach(function (li, i) {
      li.classList.toggle('done', current[i]);
      $('.practice-status', li).textContent = current[i] ? '（クリア）' : '（未クリア）';
    });
    $('#practice-bar').style.width = (done / total * 100) + '%';
    $('#practice-label').textContent = done === total ? '🎉 全問クリア！おめでとうございます' : done + ' / ' + total + ' クリア';
    $('#practice-badge').textContent = done + '/' + total;

    if (practiceDone) {
      var newly = DATA.PRACTICE.filter(function (t, i) { return current[i] && !practiceDone[i]; });
      if (newly.length === 1) toast('✅ クリア: ' + newly[0].title);
    }
    practiceDone = current;
  }

  /* ---------- 初期化 ---------- */

  optBreaks.checked = !!state.breaks;
  optSync.checked = state.sync !== false;
  if (state.filename) filenameInput.value = state.filename;
  editor.value = typeof state.content === 'string' ? state.content : DATA.TUTORIAL;

  setView(state.view || 'split');
  renderDictionary();
  render();
  if (state.panel) openSidebar(state.panel);
})();
