/*
 * MiniMarkdown - 学習用の小さなマークダウン変換器（依存ライブラリなし）
 *
 * 対応している記法:
 *   見出し(ATX / Setext)・段落・改行・太字・斜体・打ち消し線・ハイライト
 *   箇条書き(番号なし / 番号付き / 入れ子 / タスクリスト)・表(列揃え)
 *   リンク(インライン / 参照 / 自動リンク)・画像・引用(入れ子 / アラート)
 *   インラインコード・コードブロック(フェンス / インデント)・水平線
 *   脚注・エスケープ・一部の HTML タグ・絵文字ショートコード
 *
 * 使い方: MiniMarkdown.render(markdownText, { breaks: false }) -> HTML 文字列
 * file:// でも動くように ES Modules は使わず、グローバルに公開しています。
 */
(function (global) {
  'use strict';

  /* ---------- ユーティリティ ---------- */

  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function escapeAttr(s) {
    return escapeHtml(s).replace(/"/g, '&quot;');
  }

  function isBlank(line) {
    return /^\s*$/.test(line);
  }

  function indentOf(line) {
    return line.match(/^ */)[0].length;
  }

  // javascript: などの危険な URL を無効化する
  function sanitizeUrl(url, isImage) {
    var u = String(url || '').trim().replace(/ /g, '%20');
    var compact = u.replace(/[\u0000- ]/g, '').toLowerCase();
    if (/^(javascript|vbscript|file):/.test(compact)) return '#';
    if (/^data:/.test(compact)) {
      if (isImage && /^data:image\/(png|gif|jpe?g|webp|svg\+xml)[;,]/.test(compact)) return u;
      return '#';
    }
    return u;
  }

  function normalizeLabel(label) {
    return String(label).trim().replace(/\s+/g, ' ').toLowerCase();
  }

  // 見出しのアンカー用 ID（GitHub に近いルール。日本語もそのまま使える）
  function slugify(text) {
    return String(text)
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s_-]/gu, '')
      .trim()
      .replace(/\s/g, '-');
  }

  function stripTags(html) {
    return html
      .replace(/<[^>]*>/g, '')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, '&');
  }

  var EMOJI = {
    smile: '😄', laughing: '😆', blush: '😊', wink: '😉', heart_eyes: '😍',
    thinking: '🤔', cry: '😢', sob: '😭', joy: '😂', sweat_smile: '😅',
    '+1': '👍', thumbsup: '👍', '-1': '👎', clap: '👏', pray: '🙏', wave: '👋',
    ok_hand: '👌', muscle: '💪', eyes: '👀', heart: '❤️', star: '⭐',
    sparkles: '✨', fire: '🔥', tada: '🎉', rocket: '🚀', bulb: '💡',
    memo: '📝', book: '📖', warning: '⚠️', x: '❌', white_check_mark: '✅',
    heavy_check_mark: '✔️', question: '❓', exclamation: '❗', coffee: '☕',
    cat: '🐱', dog: '🐶', sunny: '☀️', cloud: '☁️', umbrella: '☔',
    cherry_blossom: '🌸', computer: '💻', pencil2: '✏️', link: '🔗', lock: '🔒'
  };

  var ALERTS = {
    note: 'Note', tip: 'Tip', important: 'Important', warning: 'Warning', caution: 'Caution'
  };

  /* ---------- インライン要素 ---------- */

  var PH_RE = /\u0001(\d+)\u0002/g;
  var PH_TEST = /\u0001\d+\u0002/;

  function renderInline(src, ctx) {
    var store = [];

    function hold(html, text) {
      store.push({ html: html, text: text == null ? stripTags(html) : text });
      return '\u0001' + (store.length - 1) + '\u0002';
    }

    function restoreHtml(s) {
      var guard = 0;
      while (PH_TEST.test(s) && guard++ < 50) {
        s = s.replace(PH_RE, function (m, n) { return store[+n].html; });
      }
      return s;
    }

    function restoreText(s) {
      var guard = 0;
      while (PH_TEST.test(s) && guard++ < 50) {
        s = s.replace(PH_RE, function (m, n) { return store[+n].text; });
      }
      return s;
    }

    function makeLink(textHtml, url, title, auto) {
      var href = sanitizeUrl(url, false);
      var attrs = ' href="' + escapeAttr(href) + '"';
      if (auto) attrs += ' class="autolink"';
      if (title) attrs += ' title="' + escapeAttr(title) + '"';
      if (/^(https?:)?\/\//i.test(href)) attrs += ' target="_blank" rel="noopener noreferrer"';
      return '<a' + attrs + '>' + textHtml + '</a>';
    }

    function makeImage(altRaw, url, title) {
      var alt = restoreText(altRaw);
      var attrs = ' src="' + escapeAttr(sanitizeUrl(url, true)) + '" alt="' + escapeAttr(alt) + '"';
      if (title) attrs += ' title="' + escapeAttr(title) + '"';
      return '<img' + attrs + ' loading="lazy">';
    }

    function process(s) {
      // 1. インラインコード（中身は一切変換しない）
      s = s.replace(/(`+)(?!`)([\s\S]*?[^`])\1(?!`)/g, function (m, ticks, code) {
        code = code.replace(/\n/g, ' ');
        if (/^ [\s\S]* $/.test(code) && /\S/.test(code)) code = code.slice(1, -1);
        return hold('<code>' + escapeHtml(code) + '</code>', code);
      });

      // 2. 自動リンク <https://...> / <mail@example.com>
      s = s.replace(/<((?:https?|ftp):\/\/[^\s<>]+)>/gi, function (m, url) {
        return hold(makeLink(escapeHtml(url), url, '', true));
      });
      s = s.replace(/<([^\s<>@]+@[^\s<>@]+\.[^\s<>@]+)>/g, function (m, mail) {
        return hold(makeLink(escapeHtml(mail), 'mailto:' + mail, '', true));
      });

      // 3. HTML コメントは表示しない / 安全なタグだけ許可
      s = s.replace(/<!--[\s\S]*?-->/g, '');
      s = s.replace(/<(\/?)(br|kbd|sub|sup|mark|u|small|ins|s)\s*\/?>/gi, function (m, close, tag) {
        return hold('<' + close + tag.toLowerCase() + '>', tag.toLowerCase() === 'br' ? ' ' : '');
      });

      // 4. 強制改行（行末のスペース2つ以上 または バックスラッシュ）
      s = s.replace(/(?: {2,}|\\)\n/g, function () { return hold('<br>\n', ' '); });

      // 5. バックスラッシュエスケープ
      s = s.replace(/\\([\\`*_{}\[\]()#+\-.!|~<>"'=^:$&])/g, function (m, c) {
        return hold(escapeHtml(c), c);
      });

      // 6. 脚注参照 [^1]
      s = s.replace(/\[\^([^\]\s]+)\]/g, function (m, id) {
        var key = normalizeLabel(id);
        if (!ctx.footnotes.hasOwnProperty(key)) return m;
        if (!ctx.fnIndex.hasOwnProperty(key)) {
          ctx.fnOrder.push(key);
          ctx.fnIndex[key] = ctx.fnOrder.length;
        }
        var num = ctx.fnIndex[key];
        var slug = slugify(key) || String(num);
        var refId = ctx.fnRefSeen[key] ? '' : ' id="fnref-' + escapeAttr(slug) + '"';
        ctx.fnRefSeen[key] = true;
        return hold('<sup class="footnote-ref"><a href="#fn-' + escapeAttr(slug) + '"' + refId + '>' + num + '</a></sup>', '[' + num + ']');
      });

      // 7. 画像・リンク（インライン形式）  ![alt](src "title") / [text](url "title")
      var LINK_RE = /(!?)\[((?:[^\[\]]|\[[^\[\]]*\])*)\]\(\s*(?:<([^>\n]*)>|((?:[^\s()]|\([^\s()]*\))*))(?:\s+(?:"([^"]*)"|'([^']*)'|\(([^)]*)\)))?\s*\)/g;
      s = s.replace(LINK_RE, function (m, bang, text, url1, url2, t1, t2, t3) {
        var url = url1 != null ? url1 : (url2 || '');
        var title = t1 || t2 || t3 || '';
        if (bang) return hold(makeImage(text, url, title));
        return hold(makeLink(process(text), url, title));
      });

      // 8. 参照リンク [text][id] / [text][] / [text]
      s = s.replace(/(!?)\[((?:[^\[\]]|\[[^\[\]]*\])+)\](?:\[([^\[\]]*)\])?/g, function (m, bang, text, label) {
        var key = normalizeLabel(label ? label : restoreText(text));
        var ref = ctx.refs[key];
        if (!ref) return m;
        if (bang) return hold(makeImage(text, ref.url, ref.title));
        return hold(makeLink(process(text), ref.url, ref.title));
      });

      // 9. URL の直書きを自動でリンクにする
      s = s.replace(/(^|[^\w\/])((?:https?:\/\/|www\.)[A-Za-z0-9\-._~:\/?#@!$&'()*+,;=%]+)/g, function (m, pre, url) {
        var trail = '';
        var tm = url.match(/[.,:;!?'"*_~]+$/);
        if (tm) { trail = tm[0]; url = url.slice(0, -trail.length); }
        // 括弧の対応が取れていない末尾の ) は URL に含めない
        while (url.slice(-1) === ')' && (url.split('(').length < url.split(')').length)) {
          trail = ')' + trail;
          url = url.slice(0, -1);
        }
        var href = /^www\./i.test(url) ? 'https://' + url : url;
        return pre + hold(makeLink(escapeHtml(url), href, '', true)) + trail;
      });

      // 10. ここから先は普通のテキストとして HTML エスケープ
      s = escapeHtml(s);

      // 11. 強調（太字・斜体・打ち消し線・ハイライト）
      s = s.replace(/(\*\*\*|___)(?=\S)([\s\S]*?\S)\1/g, '<strong><em>$2</em></strong>');
      s = s.replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, '<strong>$1</strong>');
      s = s.replace(/(^|[^\p{L}\p{N}_])__(?=\S)([\s\S]*?\S)__(?![\p{L}\p{N}_])/gu, '$1<strong>$2</strong>');
      s = s.replace(/~~(?=\S)([\s\S]*?\S)~~/g, '<del>$1</del>');
      s = s.replace(/==(?=[^\s=])([\s\S]*?[^\s=])==/g, '<mark>$1</mark>');
      s = s.replace(/\*(?=[^\s*])([\s\S]*?[^\s*])\*/g, '<em>$1</em>');
      s = s.replace(/(^|[^\p{L}\p{N}_])_(?=[^\s_])([\s\S]*?[^\s_])_(?![\p{L}\p{N}_])/gu, '$1<em>$2</em>');

      // 12. 絵文字 :smile:
      s = s.replace(/:([a-z0-9_+\-]+):/g, function (m, name) {
        return EMOJI.hasOwnProperty(name) ? EMOJI[name] : m;
      });

      // 13. オプション: 改行をそのまま <br> にする
      if (ctx.opts.breaks) s = s.replace(/\n/g, '<br>\n');

      return s;
    }

    return restoreHtml(process(src));
  }

  /* ---------- ブロック要素 ---------- */

  var RE = {
    fence: /^( {0,3})(`{3,}|~{3,})[ \t]*([^\s`]*)[^`]*$/,
    atx: /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/,
    hr: /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/,
    quote: /^ {0,3}>/,
    list: /^( *)([-*+]|\d{1,9}[.)])([ \t]+|$)(.*)$/,
    setext1: /^ {0,3}=+[ \t]*$/,
    setext2: /^ {0,3}-+[ \t]*$/,
    tableDelim: /^ {0,3}\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/,
    indentedCode: /^ {4,}\S/
  };

  function isListStart(line, maxIndent) {
    var m = line.match(RE.list);
    return !!m && m[1].length <= (maxIndent == null ? 3 : maxIndent);
  }

  // 段落の途中に現れたときに、段落を終わらせるブロックかどうか
  function interruptsParagraph(line) {
    if (RE.fence.test(line) || RE.atx.test(line) || RE.hr.test(line) || RE.quote.test(line)) return true;
    var m = line.match(RE.list);
    if (m && m[1].length <= 3 && m[4].trim() !== '') {
      if (!/\d/.test(m[2])) return true;
      return parseInt(m[2], 10) === 1;
    }
    return false;
  }

  function isTableStart(lines, i) {
    if (i + 1 >= lines.length) return false;
    if (lines[i].indexOf('|') === -1 || !RE.tableDelim.test(lines[i + 1])) return false;
    if (lines[i + 1].indexOf('|') === -1 && splitRow(lines[i]).length > 1) return false;
    return splitRow(lines[i]).length === splitRow(lines[i + 1]).length;
  }

  // 表の1行をセルに分割する（\| とインラインコード内の | は区切りとみなさない）
  function splitRow(line) {
    var s = line.trim();
    if (s.charAt(0) === '|') s = s.slice(1);
    if (s.slice(-1) === '|' && s.slice(-2) !== '\\|') s = s.slice(0, -1);
    var cells = [], cur = '', inCode = false;
    for (var i = 0; i < s.length; i++) {
      var c = s.charAt(i);
      if (c === '\\' && s.charAt(i + 1) === '|') {
        cur += inCode ? '|' : '\\|';
        i++;
      } else if (c === '`') {
        inCode = !inCode;
        cur += c;
      } else if (c === '|' && !inCode) {
        cells.push(cur.trim());
        cur = '';
      } else {
        cur += c;
      }
    }
    cells.push(cur.trim());
    return cells;
  }

  function cellAlign(spec) {
    var l = spec.charAt(0) === ':', r = spec.slice(-1) === ':';
    if (l && r) return 'center';
    if (r) return 'right';
    if (l) return 'left';
    return '';
  }

  function renderHeading(level, text, ctx) {
    var html = renderInline(text, ctx);
    var base = slugify(stripTags(html)) || 'section';
    var id = base;
    if (ctx.slugs.hasOwnProperty(base)) {
      ctx.slugs[base]++;
      id = base + '-' + ctx.slugs[base];
    } else {
      ctx.slugs[base] = 0;
    }
    return '<h' + level + ' id="' + escapeAttr(id) + '">' + html + '</h' + level + '>';
  }

  function parseList(lines, start, ctx) {
    var first = lines[start].match(RE.list);
    var baseIndent = first[1].length;
    var ordered = /\d/.test(first[2]);
    var startNum = ordered ? parseInt(first[2], 10) : 1;
    var items = [], cur = null, loose = false, sawBlank = false;
    var i = start;

    while (i < lines.length) {
      var line = lines[i];
      var m = line.match(RE.list);
      var indent = indentOf(line);

      // 同じ階層の新しい項目
      if (m && indent < baseIndent + 2) {
        if (/\d/.test(m[2]) !== ordered) break;
        if (cur && sawBlank) loose = true;
        var spaces = m[3].replace(/\t/g, '    ').length;
        var content = m[4];
        var width = spaces === 0 || spaces > 4 ? 1 : spaces;
        if (spaces > 4) content = m[3].slice(1) + content;
        cur = { lines: [content], contentIndent: indent + m[2].length + width, blankInside: false };
        items.push(cur);
        sawBlank = false;
        i++;
        continue;
      }

      if (isBlank(line)) {
        sawBlank = true;
        cur.lines.push('');
        i++;
        continue;
      }

      // 項目の続き（インデントされた行・入れ子のリスト）
      if (indent >= cur.contentIndent || (m && indent >= baseIndent + 2)) {
        if (sawBlank) cur.blankInside = true;
        cur.lines.push(line.slice(Math.min(indent, cur.contentIndent)));
        sawBlank = false;
        i++;
        continue;
      }

      // 怠惰な継続行（前の行の段落の続き）
      if (!sawBlank && !interruptsParagraph(line) && !isListStart(line)) {
        cur.lines.push(line.trim());
        i++;
        continue;
      }
      break;
    }

    var isTaskList = false;
    var body = items.map(function (it) {
      while (it.lines.length && isBlank(it.lines[it.lines.length - 1])) it.lines.pop();
      if (it.blankInside) loose = true;
      var task = null;
      var tm = (it.lines[0] || '').match(/^\[([ xX])\](?:[ \t]+|$)(.*)$/);
      if (tm) {
        task = tm[1] !== ' ';
        it.lines[0] = tm[2];
        isTaskList = true;
      }
      return { lines: it.lines, task: task };
    }).map(function (it) {
      var inner = parseBlocks(it.lines, ctx, !loose);
      if (it.task === null) return '<li>' + inner + '</li>';
      return '<li class="task-list-item"><input type="checkbox" disabled' + (it.task ? ' checked' : '') + '> ' + inner + '</li>';
    }).join('\n');

    var tag = ordered ? 'ol' : 'ul';
    var attrs = '';
    if (ordered && startNum !== 1) attrs += ' start="' + startNum + '"';
    if (isTaskList) attrs += ' class="task-list"';
    return { html: '<' + tag + attrs + '>\n' + body + '\n</' + tag + '>', next: i };
  }

  function parseBlocks(lines, ctx, tight) {
    var out = [];
    var i = 0, n = lines.length, m;

    while (i < n) {
      var line = lines[i];

      if (isBlank(line)) { i++; continue; }

      // インデント(4スペース)のコードブロック
      if (RE.indentedCode.test(line)) {
        var code = [];
        while (i < n && (RE.indentedCode.test(lines[i]) || /^ {4}/.test(lines[i]) || isBlank(lines[i]))) {
          code.push(lines[i].replace(/^ {4}/, ''));
          i++;
        }
        while (code.length && isBlank(code[code.length - 1])) code.pop();
        out.push('<pre><code>' + escapeHtml(code.join('\n')) + '\n</code></pre>');
        continue;
      }

      // フェンスのコードブロック ``` / ~~~
      if ((m = line.match(RE.fence))) {
        var fence = m[2], fenceIndent = m[1].length, lang = m[3];
        var closeRe = new RegExp('^ {0,3}' + (fence.charAt(0) === '`' ? '`' : '~') + '{' + fence.length + ',}[ \\t]*$');
        var stripRe = new RegExp('^ {0,' + fenceIndent + '}');
        var body = [];
        i++;
        while (i < n && !closeRe.test(lines[i])) {
          body.push(lines[i].replace(stripRe, ''));
          i++;
        }
        i++; // 閉じフェンス
        var cls = lang ? ' class="language-' + escapeAttr(lang) + '"' : '';
        var dataLang = lang ? ' data-lang="' + escapeAttr(lang) + '"' : '';
        out.push('<pre' + dataLang + '><code' + cls + '>' + escapeHtml(body.join('\n')) + (body.length ? '\n' : '') + '</code></pre>');
        continue;
      }

      // 見出し # 〜 ######
      if ((m = line.match(RE.atx))) {
        out.push(renderHeading(m[1].length, m[2] || '', ctx));
        i++;
        continue;
      }

      // 水平線
      if (RE.hr.test(line)) {
        out.push('<hr>');
        i++;
        continue;
      }

      // 引用
      if (RE.quote.test(line)) {
        var q = [];
        while (i < n) {
          var ql = lines[i];
          if (RE.quote.test(ql)) {
            q.push(ql.replace(/^ {0,3}> ?/, ''));
          } else if (q.length && !isBlank(ql) && !isBlank(q[q.length - 1]) && !interruptsParagraph(ql)) {
            q.push(ql); // 怠惰な継続行
          } else {
            break;
          }
          i++;
        }
        var am = (q[0] || '').match(/^\s*\[!(note|tip|important|warning|caution)\]\s*$/i);
        if (am) {
          var kind = am[1].toLowerCase();
          out.push('<div class="md-alert md-alert-' + kind + '"><p class="md-alert-title">' + ALERTS[kind] + '</p>\n' +
            parseBlocks(q.slice(1), ctx, false) + '\n</div>');
        } else {
          out.push('<blockquote>\n' + parseBlocks(q, ctx, false) + '\n</blockquote>');
        }
        continue;
      }

      // 箇条書き
      if (isListStart(line)) {
        var list = parseList(lines, i, ctx);
        out.push(list.html);
        i = list.next;
        continue;
      }

      // 表
      if (isTableStart(lines, i)) {
        var header = splitRow(lines[i]);
        var aligns = splitRow(lines[i + 1]).map(cellAlign);
        var cols = header.length;
        var rows = [];
        i += 2;
        while (i < n && !isBlank(lines[i]) && lines[i].indexOf('|') !== -1 &&
               !RE.quote.test(lines[i]) && !RE.fence.test(lines[i]) && !RE.atx.test(lines[i])) {
          rows.push(splitRow(lines[i]));
          i++;
        }
        var cell = function (tag, text, c) {
          var al = aligns[c] ? ' style="text-align:' + aligns[c] + '"' : '';
          return '<' + tag + al + '>' + renderInline(text || '', ctx) + '</' + tag + '>';
        };
        var thead = '<thead>\n<tr>' + header.map(function (t, c) { return cell('th', t, c); }).join('') + '</tr>\n</thead>';
        var tbody = rows.length ? '\n<tbody>\n' + rows.map(function (r) {
          var cells = [];
          for (var c = 0; c < cols; c++) cells.push(cell('td', r[c], c));
          return '<tr>' + cells.join('') + '</tr>';
        }).join('\n') + '\n</tbody>' : '';
        out.push('<div class="table-wrap"><table>\n' + thead + tbody + '\n</table></div>');
        continue;
      }

      // 段落（Setext 見出しを含む）
      var para = [line];
      var setext = 0;
      i++;
      while (i < n) {
        var pl = lines[i];
        if (isBlank(pl)) break;
        if (RE.setext1.test(pl)) { setext = 1; i++; break; }
        if (RE.setext2.test(pl)) { setext = 2; i++; break; }
        if (interruptsParagraph(pl) || isTableStart(lines, i)) break;
        para.push(pl);
        i++;
      }
      var text = para.map(function (l) { return l.replace(/^[ \t]+/, ''); }).join('\n').replace(/[ \t]+$/, '');
      if (setext) {
        out.push(renderHeading(setext, text, ctx));
      } else {
        var html = renderInline(text, ctx);
        out.push(tight ? html : '<p>' + html + '</p>');
      }
    }

    return out.join('\n');
  }

  /* ---------- 前処理（参照リンク・脚注の定義を集める） ---------- */

  function collectDefinitions(lines, ctx) {
    var out = [];
    var fence = null;
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i], m;

      var fm = line.match(RE.fence);
      if (fence) {
        if (new RegExp('^ {0,3}' + (fence.charAt(0) === '`' ? '`' : '~') + '{' + fence.length + ',}[ \\t]*$').test(line)) fence = null;
        out.push(line);
        continue;
      }
      if (fm) { fence = fm[2]; out.push(line); continue; }

      if ((m = line.match(/^ {0,3}\[\^([^\]\s]+)\]:[ \t]?(.*)$/))) {
        var content = [m[2]];
        while (i + 1 < lines.length) {
          var nl = lines[i + 1];
          if (/^ {2,}\S/.test(nl) || (!isBlank(nl) && !isBlank(lines[i]) && !/^ {0,3}\[\^[^\]\s]+\]:/.test(nl) && !interruptsParagraph(nl))) {
            content.push(nl.trim());
            i++;
          } else {
            break;
          }
        }
        ctx.footnotes[normalizeLabel(m[1])] = content.join('\n');
        continue;
      }

      if ((m = line.match(/^ {0,3}\[([^\]\^][^\]]*)\]:[ \t]*<?([^\s>]+)>?(?:[ \t]+(?:"([^"]*)"|'([^']*)'|\(([^)]*)\)))?[ \t]*$/))) {
        var key = normalizeLabel(m[1]);
        if (!ctx.refs.hasOwnProperty(key)) ctx.refs[key] = { url: m[2], title: m[3] || m[4] || m[5] || '' };
        continue;
      }

      out.push(line);
    }
    return out;
  }

  function render(markdown, opts) {
    var ctx = {
      opts: opts || {},
      refs: {},
      footnotes: {},
      fnOrder: [],
      fnIndex: {},
      fnRefSeen: {},
      slugs: {}
    };
    var text = String(markdown || '').replace(/\r\n?/g, '\n').replace(/\t/g, '    ');
    var lines = collectDefinitions(text.split('\n'), ctx);
    var html = parseBlocks(lines, ctx, false);

    if (ctx.fnOrder.length) {
      var items = [];
      for (var k = 0; k < ctx.fnOrder.length; k++) { // 脚注の中の脚注も拾えるよう長さを毎回確認
        var key = ctx.fnOrder[k];
        var slug = slugify(key) || String(k + 1);
        items.push('<li id="fn-' + escapeAttr(slug) + '">' + renderInline(ctx.footnotes[key], ctx) +
          ' <a href="#fnref-' + escapeAttr(slug) + '" class="footnote-back" aria-label="本文に戻る">↩</a></li>');
      }
      html += '\n<section class="footnotes">\n<hr>\n<ol>\n' + items.join('\n') + '\n</ol>\n</section>';
    }
    return html;
  }

  global.MiniMarkdown = {
    render: render,
    escapeHtml: escapeHtml
  };
})(typeof window !== 'undefined' ? window : globalThis);
