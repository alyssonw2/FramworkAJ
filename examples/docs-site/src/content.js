/**
 * Docs site — content loader.
 *
 * Reads `docs/*.md`, parses a small front matter block, renders Markdown once
 * and caches the result while files are unchanged.
 *
 * Front matter (optional):
 *
 *   ---
 *   title: Templates
 *   section: Templates
 *   description: Sintaxe completa
 *   ---
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { safeHtml } from '../../../src/shared/escaping.js';
import { renderMarkdown } from './markdown.js';

const SECTION_ORDER = [
  'Começando',
  'Templates',
  'Interatividade',
  'Servidor',
  'Qualidade',
  'Referência'
];

let cache = null;

function parseFrontMatter(source) {
  const match = /^---\n([\s\S]*?)\n---\n?/.exec(source);
  if (!match) return { data: {}, body: source };

  const data = {};
  for (const line of match[1].split('\n')) {
    const index = line.indexOf(':');
    if (index === -1) continue;
    const key = line.slice(0, index).trim();
    const value = line.slice(index + 1).trim().replace(/^["']|["']$/g, '');
    if (key) data[key] = value;
  }

  return { data, body: source.slice(match[0].length) };
}

function slugFromFile(file) {
  return file.replace(/\.md$/, '').replace(/^\d+[-_]/, '');
}

function orderFromFile(file) {
  const match = /^(\d+)/.exec(file);
  return match ? Number(match[1]) : 999;
}

async function readDoc(dir, file) {
  const full = path.join(dir, file);
  const [source, stats] = await Promise.all([
    fs.readFile(full, 'utf8'),
    fs.stat(full)
  ]);

  const { data, body } = parseFrontMatter(source);
  const { html, headings, plain } = renderMarkdown(body);
  const safeBody = safeHtml(html);
  const firstHeading = headings.find((heading) => heading.level === 1);

  return {
    file,
    mtimeMs: stats.mtimeMs,
    slug: slugFromFile(file),
    title: data.title ?? firstHeading?.text ?? slugFromFile(file),
    section: data.section ?? 'Referência',
    description: data.description ?? '',
    order: Number(data.order ?? orderFromFile(file)),
    html: safeBody,
    headings,
    toc: headings.filter((heading) => heading.level === 2 || heading.level === 3),
    plain
  };
}

/**
 * @param {string} docsDir
 * @returns {Promise<{docs: Array, bySlug: Map<string, object>, sections: Array, searchIndex: Array}>}
 */
export async function loadDocs(docsDir) {
  const files = (await fs.readdir(docsDir))
    .filter((file) => file.endsWith('.md'))
    .sort();

  const stats = await Promise.all(files.map((file) => fs.stat(path.join(docsDir, file))));
  const signature = files.map((file, index) => `${file}:${stats[index].mtimeMs}:${stats[index].size}`).join('|');

  if (cache && cache.signature === signature) return cache.data;

  const docs = await Promise.all(files.map((file) => readDoc(docsDir, file)));

  docs.sort((a, b) => {
    const sectionDelta =
      SECTION_ORDER.indexOf(a.section) - SECTION_ORDER.indexOf(b.section);
    if (sectionDelta !== 0) return sectionDelta;
    return a.order - b.order || a.title.localeCompare(b.title, 'pt-BR');
  });

  const bySlug = new Map(docs.map((doc) => [doc.slug, doc]));

  for (let index = 0; index < docs.length; index += 1) {
    docs[index].prev = index > 0 ? { slug: docs[index - 1].slug, title: docs[index - 1].title } : null;
    docs[index].next =
      index < docs.length - 1 ? { slug: docs[index + 1].slug, title: docs[index + 1].title } : null;
  }

  const sections = [];
  for (const doc of docs) {
    let section = sections.find((entry) => entry.name === doc.section);
    if (!section) {
      section = { name: doc.section, docs: [] };
      sections.push(section);
    }
    section.docs.push({ slug: doc.slug, title: doc.title });
  }

  sections.sort((a, b) => SECTION_ORDER.indexOf(a.name) - SECTION_ORDER.indexOf(b.name));

  // The whole page is indexed: long guides would otherwise be unsearchable
  // after the first few thousand characters.
  const searchIndex = docs.map((doc) => ({
    slug: doc.slug,
    title: doc.title,
    section: doc.section,
    description: doc.description,
    text: doc.plain
  }));

  const data = { docs, bySlug, sections, searchIndex };
  cache = { signature, data };
  return data;
}

export function clearDocsCache() {
  cache = null;
}

export { SECTION_ORDER };
