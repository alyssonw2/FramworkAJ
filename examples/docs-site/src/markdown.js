/**
 * Docs site — small Markdown renderer.
 *
 * Supports exactly what the documentation needs: headings, paragraphs, fenced
 * code, inline code, lists (nested), tables, blockquotes, horizontal rules,
 * bold, italic and links.
 *
 * Output is escaped by construction: the source is escaped first and only the
 * generated structural tags are inserted afterwards.
 */

const INLINE_CODE = /\u0000(\d+)\u0000/g;

export function slugify(value) {
  return (
    String(value ?? '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'secao'
  );
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => {
    switch (ch) {
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '"': return '&quot;';
      default: return '&#39;';
    }
  });
}

function safeHref(href) {
  const value = String(href ?? '').trim();
  if (/^(https?:|mailto:|#|\/|\.\/|\.\.\/)/i.test(value)) return escapeHtml(value);
  return '#';
}

function inline(text) {
  const codes = [];
  let output = escapeHtml(text).replace(/`([^`]+)`/g, (_, code) => {
    codes.push(code);
    return `\u0000${codes.length - 1}\u0000`;
  });

  output = output
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s.,;:)]|$)/g, '$1<em>$2</em>')
    .replace(/~~([^~]+)~~/g, '<del>$1</del>')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, href) => {
      const external = /^https?:/i.test(href);
      const attrs = external ? ' rel="noopener noreferrer" target="_blank"' : '';
      return `<a href="${safeHref(href)}"${attrs}>${label}</a>`;
    });

  output = output.replace(INLINE_CODE, (_, index) => `<code>${codes[Number(index)]}</code>`);
  return output;
}

function isTableStart(lines, index) {
  if (!/^\s*\|/.test(lines[index] ?? '')) return false;
  const separator = lines[index + 1] ?? '';
  return /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(separator);
}

const ESCAPED_PIPE = '\u0001';

function splitRow(line) {
  return line
    .trim()
    .replace(/\\\|/g, ESCAPED_PIPE)
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.split(ESCAPED_PIPE).join('|').trim());
}

function parseList(lines, start) {
  const items = [];
  const ordered = /^\s*\d+\.\s+/.test(lines[start]);
  const baseIndent = /^(\s*)/.exec(lines[start])[1].length;
  let i = start;

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim() === '') {
      const next = lines[i + 1] ?? '';
      if (!/^\s*([-*+]|\d+\.)\s+/.test(next)) break;
      i += 1;
      continue;
    }

    const match = /^(\s*)([-*+]|\d+\.)\s+(.*)$/.exec(line);
    if (!match) break;

    const indent = match[1].length;
    if (indent < baseIndent) break;

    if (indent > baseIndent) {
      const nested = parseList(lines, i);
      if (items.length === 0) items.push({ text: '', children: nested.html });
      else items[items.length - 1].children = nested.html;
      i = nested.next;
      continue;
    }

    items.push({ text: match[3], children: '' });
    i += 1;

    // Continuation lines of the same item (indented, no marker).
    while (i < lines.length) {
      const continuation = lines[i];
      if (continuation.trim() === '') break;
      if (/^\s*([-*+]|\d+\.)\s+/.test(continuation)) break;
      if (/^(\s*)/.exec(continuation)[1].length <= baseIndent) break;
      items[items.length - 1].text += ` ${continuation.trim()}`;
      i += 1;
    }
  }

  const tag = ordered ? 'ol' : 'ul';
  const html = `<${tag}>\n${items
    .map((item) => `<li>${inline(item.text)}${item.children}</li>`)
    .join('\n')}\n</${tag}>`;

  return { html, next: i };
}

/**
 * @param {string} source
 * @returns {{html: string, headings: Array<{level: number, text: string, id: string}>, plain: string}}
 */
export function renderMarkdown(source) {
  const lines = String(source ?? '').replace(/\r\n/g, '\n').split('\n');
  const headings = [];
  const usedSlugs = new Map();
  let html = '';
  let i = 0;

  const uniqueSlug = (text) => {
    const base = slugify(text);
    const count = (usedSlugs.get(base) ?? 0) + 1;
    usedSlugs.set(base, count);
    return count === 1 ? base : `${base}-${count}`;
  };

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim() === '') {
      i += 1;
      continue;
    }

    const fence = /^\s*```(\S*)\s*$/.exec(line);
    if (fence) {
      const language = fence[1] ?? '';
      const buffer = [];
      i += 1;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) {
        buffer.push(lines[i]);
        i += 1;
      }
      i += 1;
      const label = language ? `<span class="code-label">${escapeHtml(language)}</span>` : '';
      const className = language ? ` class="language-${escapeHtml(language)}"` : '';
      html += `<div class="code-block">${label}<pre><code${className}>${escapeHtml(
        buffer.join('\n')
      )}</code></pre></div>\n`;
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      const text = heading[2].trim();
      const id = uniqueSlug(text);
      headings.push({ level, text, id });
      html += `<h${level} id="${id}"><a class="anchor" href="#${id}" aria-hidden="true">#</a>${inline(
        text
      )}</h${level}>\n`;
      i += 1;
      continue;
    }

    if (/^\s*(---|\*\*\*|___)\s*$/.test(line)) {
      html += '<hr>\n';
      i += 1;
      continue;
    }

    if (isTableStart(lines, i)) {
      const header = splitRow(lines[i]);
      i += 2;
      const rows = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) {
        rows.push(splitRow(lines[i]));
        i += 1;
      }
      html += '<div class="table-wrap"><table>\n<thead><tr>';
      html += header.map((cell) => `<th>${inline(cell)}</th>`).join('');
      html += '</tr></thead>\n<tbody>\n';
      for (const row of rows) {
        html += `<tr>${row.map((cell) => `<td>${inline(cell)}</td>`).join('')}</tr>\n`;
      }
      html += '</tbody></table></div>\n';
      continue;
    }

    if (/^\s*>/.test(line)) {
      const buffer = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) {
        buffer.push(lines[i].replace(/^\s*>\s?/, ''));
        i += 1;
      }
      html += `<blockquote><p>${inline(buffer.join(' '))}</p></blockquote>\n`;
      continue;
    }

    if (/^\s*([-*+]|\d+\.)\s+/.test(line)) {
      const list = parseList(lines, i);
      html += `${list.html}\n`;
      i = list.next;
      continue;
    }

    const paragraph = [];
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !/^\s*(```|#{1,6}\s|>|([-*+]|\d+\.)\s)/.test(lines[i]) &&
      !/^\s*\|/.test(lines[i])
    ) {
      paragraph.push(lines[i].trim());
      i += 1;
    }
    html += `<p>${inline(paragraph.join(' '))}</p>\n`;
  }

  const plain = html
    .replace(/<a class="anchor"[^>]*>#<\/a>/g, ' ')
    .replace(/<span class="code-label">[\s\S]*?<\/span>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return { html, headings, plain };
}
