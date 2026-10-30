/**
 * FLASH docs — client behavior.
 *
 * Plain DOM code. No framework runtime is required for the documentation to
 * work: search and copy buttons are progressive enhancements.
 */

const THEME_KEY = 'flash-docs-theme';

/* ---------- theme ---------- */

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    /* storage might be blocked */
  }
}

function setupTheme() {
  let stored = null;
  try {
    stored = localStorage.getItem(THEME_KEY);
  } catch {
    stored = null;
  }

  const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)')?.matches ?? false;
  applyTheme(stored ?? (prefersDark ? 'dark' : 'light'));

  document.getElementById('theme-toggle')?.addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    applyTheme(next);
  });
}

/* ---------- mobile navigation ---------- */

function setupMenu() {
  const toggle = document.getElementById('menu-toggle');
  const sidebar = document.getElementById('sidebar');
  if (!toggle || !sidebar) return;

  toggle.addEventListener('click', () => {
    const open = sidebar.classList.toggle('is-open');
    toggle.setAttribute('aria-expanded', String(open));
  });

  sidebar.addEventListener('click', (event) => {
    if (event.target.closest('a') && window.innerWidth <= 860) {
      sidebar.classList.remove('is-open');
      toggle.setAttribute('aria-expanded', 'false');
    }
  });
}

/* ---------- copy code ---------- */

function setupCopyButtons() {
  for (const block of document.querySelectorAll('.code-block')) {
    if (block.querySelector('.copy-button')) continue;

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'copy-button';
    button.textContent = 'copiar';

    button.addEventListener('click', async () => {
      const code = block.querySelector('pre code')?.textContent ?? '';
      try {
        await navigator.clipboard.writeText(code);
        button.textContent = 'copiado';
        button.classList.add('is-done');
      } catch {
        button.textContent = 'falhou';
      }
      window.setTimeout(() => {
        button.textContent = 'copiar';
        button.classList.remove('is-done');
      }, 1600);
    });

    block.append(button);
  }
}

/* ---------- search ---------- */

function normalize(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function setupSearch() {
  const input = document.getElementById('search-input');
  const results = document.getElementById('search-results');
  if (!input || !results) return;

  let pages = null;
  let selected = -1;
  let items = [];

  const ensureIndex = async () => {
    if (pages) return pages;
    const response = await fetch('/api/search.json');
    if (!response.ok) throw new Error('Falha ao carregar o índice');
    const data = await response.json();
    pages = data.pages.map((page) => ({ ...page, haystack: normalize(`${page.title} ${page.section} ${page.text}`) }));
    return pages;
  };

  const close = () => {
    results.hidden = true;
    results.innerHTML = '';
    selected = -1;
    items = [];
  };

  const render = (matches) => {
    results.innerHTML = '';

    if (matches.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'search__empty';
      empty.textContent = 'Nenhum resultado.';
      results.append(empty);
      results.hidden = false;
      return;
    }

    matches.slice(0, 8).forEach((match, index) => {
      const link = document.createElement('a');
      link.className = 'search__item';
      link.href = `/docs/${match.slug}`;
      link.setAttribute('role', 'option');

      const title = document.createElement('strong');
      title.textContent = match.title;

      const meta = document.createElement('span');
      const snippet = match.text.slice(0, 110).trim();
      meta.textContent = `${match.section}${snippet ? ` — ${snippet}…` : ''}`;

      link.append(title, meta);
      if (index === 0) link.classList.add('is-selected');
      results.append(link);
    });

    items = [...results.querySelectorAll('.search__item')];
    selected = 0;
    results.hidden = false;
  };

  input.addEventListener('input', async () => {
    const term = normalize(input.value.trim());
    if (term.length < 2) return close();

    try {
      const index = await ensureIndex();
      const terms = term.split(/\s+/).filter(Boolean);
      const matches = index
        .map((page) => {
          const inTitle = normalize(page.title).includes(terms[0]) ? 40 : 0;
          const hits = terms.filter((part) => page.haystack.includes(part)).length;
          return { page, score: inTitle + hits * 10 };
        })
        .filter((entry) => entry.score > 0)
        .sort((a, b) => b.score - a.score)
        .map((entry) => entry.page);

      render(matches);
    } catch {
      close();
    }
  });

  input.addEventListener('keydown', (event) => {
    if (results.hidden) return;

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (items.length === 0) return;
      items[selected]?.classList.remove('is-selected');
      selected = (selected + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      items[selected].classList.add('is-selected');
      items[selected].scrollIntoView({ block: 'nearest' });
    }

    if (event.key === 'Enter' && items[selected]) {
      event.preventDefault();
      window.location.assign(items[selected].href);
    }

    if (event.key === 'Escape') close();
  });

  document.addEventListener('click', (event) => {
    if (!event.target.closest('.search')) close();
  });

  document.addEventListener('keydown', (event) => {
    const isShortcut = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k';
    if (isShortcut) {
      event.preventDefault();
      input.focus();
      input.select();
    }
  });
}

/* ---------- table of contents ---------- */

function setupToc() {
  const links = [...document.querySelectorAll('.toc__link')];
  if (links.length === 0) return;

  // Heading ids may start with a digit (`#1-fade...`), which is valid HTML but
  // not a valid CSS selector — resolve them with getElementById.
  const targets = links
    .map((link) => {
      const id = link.getAttribute('href').slice(1);
      return id ? document.getElementById(id) : null;
    })
    .filter(Boolean);

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const id = `#${entry.target.id}`;
        for (const link of links) link.classList.toggle('is-active', link.getAttribute('href') === id);
      }
    },
    { rootMargin: '-20% 0px -70% 0px', threshold: [0, 1] }
  );

  for (const target of targets) observer.observe(target);
}

/* ---------- smooth anchors ---------- */

function setupAnchors() {
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ?? false;
  if (reduced || !('scrollBehavior' in document.documentElement.style)) return;

  document.addEventListener('click', (event) => {
    const link = event.target.closest?.('a[href^="#"]');
    if (!link) return;

    const id = link.getAttribute('href').slice(1);
    const target = id ? document.getElementById(id) : document.body;
    if (!target) return;

    event.preventDefault();
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    history.replaceState(null, '', `#${id}`);
    target.setAttribute('tabindex', '-1');
    target.focus({ preventScroll: true });
  });
}

/* ---------- boot ---------- */

setupTheme();
setupMenu();
setupCopyButtons();
setupSearch();
setupToc();
setupAnchors();

document.addEventListener('flash:update', () => {
  setupCopyButtons();
  setupToc();
});
