/**
 * FLASH — build de deploy.
 *
 * Produz uma pasta autocontida (`deploy/`) pronta para copiar ao servidor:
 *
 *   - CSS compilado (Tailwind) e demais assets com hash no nome;
 *   - código da aplicação com imports do framework reescritos para `flash/...`;
 *   - o framework vendorizado em `node_modules/flash` (sem devtools);
 *   - dependências de produção copiadas (`express` e transitivas);
 *   - `package.json` de produção, `start.mjs` e manifesto com hashes.
 *
 * Nada é publicado: o comando apenas escreve arquivos. A pasta anterior só é
 * removida quando é reconhecidamente um deploy do FLASH (tem `flash-manifest.json`).
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import net from 'node:net';
import { fileURLToPath } from 'node:url';

import { ViewEngine } from '../view/engine.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const FRAMEWORK_ROOT = path.resolve(HERE, '..', '..');
export const FRAMEWORK_SRC = path.join(FRAMEWORK_ROOT, 'src');

export const MANIFEST_FILE = 'flash-manifest.json';

const HASHED_EXTENSIONS = new Set([
  '.css', '.svg', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.ico', '.woff', '.woff2'
]);
const SKIP_DIRS = new Set(['node_modules', '.git', 'deploy', '.cache', 'coverage']);
const COPY_SKIP = [/\.test\.js$/, /\.spec\.js$/, /\.map$/];
const RUNTIME_DEPS_SKIP = new Set(['tailwindcss', '@tailwindcss/cli', 'flash']);

/* ---------- utilidades ---------- */

async function pathExists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

/** Verdadeiro quando o diretório existe e está vazio (nada a preservar). */
async function isEmptyDir(target) {
  try {
    const entries = await fs.readdir(target);
    return entries.length === 0;
  } catch {
    return false;
  }
}

async function readJson(file) {
  return JSON.parse(await fs.readFile(file, 'utf8'));
}

function shortHash(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex').slice(0, 8);
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function toPosix(value) {
  return value.split(path.sep).join('/');
}

async function walk(dir, visit) {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      await walk(full, visit);
      continue;
    }
    await visit(full);
  }
}

async function copyFile(from, to, transform) {
  await fs.mkdir(path.dirname(to), { recursive: true });
  const source = await fs.readFile(from);
  const output = transform ? await transform(source, from) : source;
  await fs.writeFile(to, output);
  return { bytes: Buffer.byteLength(output) };
}

/* ---------- reescrita de imports ---------- */

const IMPORT_SPECIFIER = /(\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(['"])([^'"]+)\2/g;

/**
 * Reescreve imports relativos que apontam para dentro de `src/` do framework
 * para especificadores de pacote (`flash/...`).
 *
 * `import { createFlash } from '../../../src/index.js'` → `'flash/index.js'`
 *
 * É o que permite que o mesmo código rode do repositório e de
 * `node_modules/flash` dentro do deploy.
 *
 * @param {string} source
 * @param {string} filePath
 * @returns {{ code: string, rewritten: number }}
 */
export function rewriteFrameworkImports(source, filePath) {
  let rewritten = 0;

  const code = source.replace(IMPORT_SPECIFIER, (match, prefix, quote, specifier) => {
    if (!specifier.startsWith('.')) return match;

    const resolved = path.resolve(path.dirname(filePath), specifier);
    const relative = path.relative(FRAMEWORK_SRC, resolved);

    if (relative.startsWith('..') || path.isAbsolute(relative)) return match;

    rewritten += 1;
    return `${prefix}${quote}flash/${toPosix(relative)}${quote}`;
  });

  return { code, rewritten };
}

/* ---------- descoberta ---------- */

async function findApp(appDir) {
  const candidates = ['src/app.js', 'app.js', 'src/server.js', 'server.js', 'index.js'];

  for (const candidate of candidates) {
    const full = path.join(appDir, candidate);
    if (await pathExists(full)) return full;
  }

  throw new Error(
    `Não encontrei o ponto de entrada em "${appDir}". ` +
      `Esperava um de: ${candidates.join(', ')}. Use --entry <arquivo>.`
  );
}

/** Procura `name` em `<projeto>/node_modules` para cada raiz informada. */
async function resolveDependency(name, projectRoots) {
  for (const root of projectRoots) {
    const candidate = path.join(root, 'node_modules', name);
    if (await pathExists(path.join(candidate, 'package.json'))) return candidate;
  }
  return null;
}

/** Coleta a árvore de dependências de produção a partir de um conjunto de nomes. */
async function collectDependencyTree(names, searchDirs, seen = new Map()) {
  for (const name of names) {
    if (seen.has(name)) continue;

    const location = await resolveDependency(name, searchDirs);
    if (!location) continue;

    const pkg = await readJson(path.join(location, 'package.json'));
    seen.set(name, { location, version: pkg.version ?? '0.0.0' });

    const children = Object.keys(pkg.dependencies ?? {});
    if (children.length) await collectDependencyTree(children, searchDirs, seen);
  }

  return seen;
}

/* ---------- css ---------- */

async function buildCss({ appDir, deployDir, log }) {
  const input = path.join(appDir, 'src', 'styles', 'tailwind.css');
  if (!(await pathExists(input))) {
    log('css', 'sem src/styles/tailwind.css — usando o CSS já presente em public/');
    return { built: false };
  }

  const cli = await resolveDependency('@tailwindcss/cli', [FRAMEWORK_ROOT, appDir]);
  const bin = cli ? path.join(cli, 'dist', 'index.mjs') : null;

  if (!bin || !(await pathExists(bin))) {
    throw new Error(
      'O app usa Tailwind (src/styles/tailwind.css), mas @tailwindcss/cli não foi encontrado.\n' +
        'Instale com: npm install -D tailwindcss @tailwindcss/cli\n' +
        'Ou rode o deploy com --no-css para reutilizar o CSS já compilado em public/.'
    );
  }

  const output = path.join(deployDir, 'public', 'app.css');
  await fs.mkdir(path.dirname(output), { recursive: true });

  try {
    await runNode([bin, '-i', input, '-o', output, '--minify'], { cwd: appDir, label: 'tailwind' });
  } catch (error) {
    if (/Can't resolve 'tailwindcss'/.test(error.message)) {
      throw new Error(
        `O Tailwind não conseguiu resolver o pacote "tailwindcss" a partir de ${path.dirname(input)}.\n` +
          'Instale as dependências de build na aplicação:\n' +
          '  npm install -D tailwindcss @tailwindcss/cli\n' +
          'Ou rode o deploy com --no-css para reutilizar o CSS já compilado em public/.'
      );
    }
    throw error;
  }

  const bytes = (await fs.stat(output)).size;
  log('css', `compilado com Tailwind (${(bytes / 1024).toFixed(1)} kB)`);
  return { built: true, bytes };
}

function runNode(args, { cwd, label }) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';

    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${label} falhou (exit ${code}):\n${stderr.trim()}`));
    });
  });
}

/* ---------- assets ---------- */

/**
 * Renomeia assets com hash de conteúdo e devolve o mapa
 * `{ '/assets/app.css': '/assets/app.a1b2c3d4.css' }`.
 */
async function hashAssets(publicDir) {
  const mapping = new Map();
  if (!(await pathExists(publicDir))) return mapping;

  const files = [];
  await walk(publicDir, async (file) => files.push(file));

  for (const file of files) {
    const extension = path.extname(file).toLowerCase();
    if (!HASHED_EXTENSIONS.has(extension)) continue;

    const relative = toPosix(path.relative(publicDir, file));
    const buffer = await fs.readFile(file);
    const suffix = `.${shortHash(buffer)}`;
    const hashedRelative = relative.slice(0, -extension.length) + suffix + extension;

    await fs.rename(file, path.join(publicDir, hashedRelative));
    mapping.set(`/assets/${relative}`, `/assets/${hashedRelative}`);
  }

  return mapping;
}

/** Reescreve referências a assets em views, componentes e JS público. */
async function rewriteAssetReferences(dir, mapping) {
  if (mapping.size === 0) return 0;

  let touched = 0;
  const files = [];
  await walk(dir, async (file) => {
    if (/\.(html|js|mjs|css)$/.test(file)) files.push(file);
  });

  for (const file of files) {
    const original = await fs.readFile(file, 'utf8');
    let next = original;

    for (const [from, to] of mapping) {
      if (next.includes(from)) next = next.split(from).join(to);
    }

    if (next !== original) {
      await fs.writeFile(file, next);
      touched += 1;
    }
  }

  return touched;
}

/* ---------- segurança ---------- */

async function lintAppSources(dir) {
  const warnings = [];

  const files = [];
  await walk(dir, async (file) => {
    if (file.endsWith('.js') || file.endsWith('.mjs')) files.push(file);
  });

  for (const file of files) {
    const code = await fs.readFile(file, 'utf8');
    const relative = path.relative(dir, file);

    if (/\bdev\s*:\s*true\b/.test(code)) {
      warnings.push(`${relative}: usa \`dev: true\` fixo — em produção use \`dev: false\` ou NODE_ENV.`);
    }
    if (/\bsecure\s*:\s*false\b/.test(code)) {
      warnings.push(`${relative}: cookie de sessão com \`secure: false\` — ative atrás de HTTPS.`);
    }
    if (/\bsession\s*\(\s*\{/.test(code) && !/process\.env\.SESSION_SECRET/.test(code)) {
      warnings.push(`${relative}: sessão sem \`process.env.SESSION_SECRET\`.`);
    }
  }

  return warnings;
}

/* ---------- verificação ---------- */

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

/**
 * Sobe o deploy recém-gerado, verifica que ele está realmente em modo produção
 * e derruba o processo.
 *
 * Checa: resposta na raiz, ausência dos endpoints de devtools, ausência do
 * script do painel no HTML, asset com hash acessível e headers de segurança.
 */
export async function smokeTest(deployDir, { timeoutMs = 15_000 } = {}) {
  const port = await freePort();

  const child = spawn(process.execPath, [path.join(deployDir, 'start.mjs')], {
    cwd: deployDir,
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', NODE_ENV: 'production' },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let output = '';
  const exit = new Promise((resolve) => child.once('exit', (code) => resolve(code ?? 0)));

  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`o deploy não respondeu em ${timeoutMs}ms`)), timeoutMs);

    const onData = (chunk) => {
      output += chunk;
      if (/http:\/\//.test(output)) {
        clearTimeout(timer);
        resolve();
      }
    };

    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`o processo saiu antes de responder (exit ${code}):\n${output.trim()}`));
    });
  });

  try {
    await ready;

    const base = `http://127.0.0.1:${port}`;
    const checks = [];

    const root = await fetch(`${base}/`, { redirect: 'manual' });
    if (root.status >= 500) {
      throw new Error(`a requisição de verificação respondeu ${root.status}`);
    }
    checks.push({ name: 'raiz responde', ok: true, detail: String(root.status) });

    const devtools = await fetch(`${base}/__flash/dev/stats.json`, { redirect: 'manual' });
    const devtoolsOff = devtools.status === 404;
    checks.push({ name: 'devtools desligado', ok: devtoolsOff, detail: String(devtools.status) });

    const notices = [];
    const manifest = await readJson(path.join(deployDir, MANIFEST_FILE));
    const hashedAsset = Object.values(manifest.assets ?? {})[0];

    if (hashedAsset) {
      const asset = await fetch(`${base}${hashedAsset}`, { redirect: 'manual' });
      checks.push({ name: 'asset com hash', ok: asset.status === 200, detail: hashedAsset });

      const cache = asset.headers.get('cache-control') ?? '';
      const longLived = /immutable/.test(cache) || /max-age=(3[0-9]{6,}|[1-9][0-9]{7,})/.test(cache);
      if (!longLived) {
        notices.push(
          `asset com hash servido com "${cache || 'sem Cache-Control'}" — use ` +
            '`flash.assets(dir, { prefix: "/assets", immutable: true })` para cache longo.'
        );
      }
    }

    const home = await fetch(`${base}/`, { redirect: 'manual' });
    const html = await home.text();
    const noPanel = !html.includes('__flash/dev/panel.js');
    checks.push({ name: 'sem painel no HTML', ok: noPanel, detail: noPanel ? 'ok' : 'script encontrado' });

    const csp = root.headers.get('content-security-policy');
    checks.push({ name: 'CSP ativa', ok: Boolean(csp), detail: csp ? 'presente' : 'ausente' });

    const failed = checks.filter((check) => !check.ok);
    if (failed.length) {
      throw new Error(
        `verificação de produção falhou: ${failed.map((check) => check.name).join(', ')}`
      );
    }

    return { status: root.status, port, checks, notices };
  } finally {
    child.kill('SIGTERM');
    await Promise.race([exit, new Promise((resolve) => setTimeout(resolve, 3000))]);
    if (child.exitCode === null) child.kill('SIGKILL');
  }
}

/* ---------- deploy ---------- */

/**
 * @param {{
 *   appDir?: string,
 *   outDir?: string,
 *   entry?: string,
 *   clean?: boolean,
 *   force?: boolean,
 *   css?: boolean,
 *   bundleDeps?: boolean,
 *   smoke?: boolean,
 *   dryRun?: boolean,
 *   log?: (step: string, message: string) => void
 * }} [options]
 */
export async function buildDeploy(options = {}) {
  const appDir = path.resolve(options.appDir ?? path.join(FRAMEWORK_ROOT, 'examples', 'clients-app'));
  const outDir = path.resolve(options.outDir ?? path.join(FRAMEWORK_ROOT, 'deploy'));
  const log = options.log ?? (() => {});
  const steps = [];
  const warnings = [];

  const run = (step, message) => {
    steps.push({ step, message });
    log(step, message);
  };

  /* 1. validação */
  const appPackagePath = path.join(appDir, 'package.json');
  const appPackage = (await pathExists(appPackagePath)) ? await readJson(appPackagePath) : {};
  const entry = options.entry ? path.resolve(appDir, options.entry) : await findApp(appDir);
  const viewsDir = path.join(appDir, 'src', 'views');

  if (!(await pathExists(viewsDir))) {
    throw new Error(`Não encontrei "${viewsDir}". O deploy espera views em src/views.`);
  }

  const frameworkPackage = await readJson(path.join(FRAMEWORK_ROOT, 'package.json'));

  /* 2. análise dos templates */
  const appComponents = path.join(appDir, 'src', 'components');
  const engine = new ViewEngine({
    views: viewsDir,
    components: [path.join(FRAMEWORK_SRC, 'ui'), appComponents],
    strict: false
  });
  const analysis = await engine.analyze();

  run(
    'analyze',
    `${analysis.templates.length} views, ${analysis.components.length} componentes, ${analysis.directives.length} diretivas`
  );

  /* 3. destino */
  if (await pathExists(outDir)) {
    const looksLikeOurDeploy = await pathExists(path.join(outDir, MANIFEST_FILE));
    const empty = await isEmptyDir(outDir);

    if (options.clean === false && !empty) {
      throw new Error(`"${outDir}" já existe. Use --clean para substituir ou escolha outra pasta.`);
    }
    if (!looksLikeOurDeploy && !empty && !options.force) {
      throw new Error(
        `"${outDir}" existe e não parece um deploy do FLASH (sem ${MANIFEST_FILE}).\n` +
          'Por segurança nada foi apagado. Use --force se tiver certeza.'
      );
    }

    if (!options.dryRun) {
      await fs.rm(outDir, { recursive: true, force: true });
      if (!empty) run('prepare', 'pasta anterior removida');
    }
  }

  if (options.dryRun) {
    run('prepare', `(dry-run) criaria ${path.relative(process.cwd(), outDir)}`);
    return {
      outDir,
      dryRun: true,
      steps,
      warnings,
      manifest: {
        app: {
          name: appPackage.name ?? path.basename(appDir),
          version: appPackage.version ?? '0.0.0'
        },
        analysis: {
          views: analysis.templates.length,
          components: analysis.components.length,
          directives: analysis.directives,
          componentTags: analysis.componentTags
        }
      }
    };
  }

  await fs.mkdir(outDir, { recursive: true });
  run('prepare', `destino ${path.relative(process.cwd(), outDir)}`);

  /* 4. código da aplicação */
  const copyReport = { files: 0, rewrittenImports: 0 };
  const appSrc = path.join(appDir, 'src');

  await walk(appSrc, async (file) => {
    const relative = path.relative(appDir, file);
    const posix = toPosix(relative);

    if (COPY_SKIP.some((pattern) => pattern.test(file))) return;
    if (posix.startsWith('src/styles/')) return; // fonte do CSS, não vai para o servidor

    const target = path.join(outDir, relative);

    if (file.endsWith('.js') || file.endsWith('.mjs')) {
      const source = await fs.readFile(file, 'utf8');
      const { code, rewritten } = rewriteFrameworkImports(source, file);
      await copyFile(file, target, () => code);
      copyReport.files += 1;
      copyReport.rewrittenImports += rewritten;
      return;
    }

    await copyFile(file, target);
    copyReport.files += 1;
  });

  run(
    'app',
    `${copyReport.files} arquivos, ${copyReport.rewrittenImports} imports do framework reescritos`
  );

  /* 5. assets públicos (com hash) */
  const publicDir = path.join(appDir, 'public');
  if (await pathExists(publicDir)) {
    await walk(publicDir, async (file) => {
      await copyFile(file, path.join(outDir, 'public', path.relative(publicDir, file)));
      copyReport.files += 1;
    });
  }

  if (options.css !== false) {
    await buildCss({ appDir, deployDir: outDir, log: run });
  } else {
    run('css', 'ignorado (--no-css): usando o CSS presente em public/');
  }

  const assetMap = await hashAssets(path.join(outDir, 'public'));
  const rewrittenRefs = await rewriteAssetReferences(path.join(outDir, 'src'), assetMap);
  run(
    'assets',
    `${assetMap.size} assets com hash, ${rewrittenRefs} arquivos com referências atualizadas`
  );

  /* 6. framework vendorizado */
  const flashPkg = {
    name: 'flash',
    version: frameworkPackage.version,
    description: frameworkPackage.description,
    type: 'module',
    license: frameworkPackage.license,
    engines: frameworkPackage.engines,
    main: './src/index.js',
    exports: {
      ...frameworkPackage.exports,
      './paths': './src/paths.js',
      './*': './src/*'
    },
    dependencies: frameworkPackage.dependencies
  };

  const flashOut = path.join(outDir, 'node_modules', 'flash');
  await fs.mkdir(flashOut, { recursive: true });
  await fs.writeFile(path.join(flashOut, 'package.json'), `${JSON.stringify(flashPkg, null, 2)}\n`);

  const vendored = { files: 0, skipped: [] };
  await walk(FRAMEWORK_SRC, async (file) => {
    const relative = path.relative(FRAMEWORK_SRC, file);
    const posix = toPosix(relative);

    // `src/index.js` exporta DevTools, então `dev/devtools.js` precisa existir —
    // mas o painel do navegador (~33 kB) fica de fora: em produção `dev: false`
    // não registra rota nem injeta script. O CLI de deploy também não é runtime.
    if (posix === 'dev/panel.js' || posix.startsWith('cli/')) {
      vendored.skipped.push(posix);
      return;
    }

    await copyFile(file, path.join(flashOut, 'src', relative));
    vendored.files += 1;
  });

  run(
    'framework',
    `flash@${flashPkg.version} vendorizado (${vendored.files} arquivos` +
      `${vendored.skipped.length ? `, sem ${vendored.skipped.join(', ')}` : ''})`
  );

  /* 7. dependências de produção */
  const bundled = [];
  if (options.bundleDeps !== false) {
    // Dependências do app + as do framework: um app dentro do monorepo pode não
    // declarar `express`, mas em produção ele precisa estar presente.
    const names = [
      ...new Set([
        ...Object.keys(frameworkPackage.dependencies ?? {}),
        ...Object.keys(appPackage.dependencies ?? {})
      ])
    ].filter((name) => !RUNTIME_DEPS_SKIP.has(name));
    const tree = await collectDependencyTree(names, [appDir, FRAMEWORK_ROOT]);

    for (const [name, info] of tree) {
      const target = path.join(outDir, 'node_modules', name);
      await fs.rm(target, { recursive: true, force: true });
      await fs.cp(info.location, target, { recursive: true });
      bundled.push({ name, version: info.version });
    }

    run('deps', bundled.length ? `${bundled.length} pacotes copiados` : 'nenhuma dependência externa');
  } else {
    run('deps', 'ignorado (--no-bundle-deps): rode `npm ci --omit=dev` no servidor');
  }

  /* 8. package.json, start.mjs e README */
  const entryRelative = toPosix(path.relative(appDir, entry));

  const directDependencies = Object.fromEntries(
    [...new Set([...Object.keys(frameworkPackage.dependencies ?? {}), ...Object.keys(appPackage.dependencies ?? {})])]
      .filter((name) => !RUNTIME_DEPS_SKIP.has(name))
      .map((name) => [name, bundled.find((item) => item.name === name)?.version ?? '*'])
  );

  const deployPackage = {
    name: `${appPackage.name ?? 'flash-app'}-deploy`,
    version: appPackage.version ?? '1.0.0',
    private: true,
    type: 'module',
    description: appPackage.description ?? 'Aplicação FLASH pronta para produção.',
    main: entryRelative,
    engines: { node: frameworkPackage.engines?.node ?? '>=20.0.0' },
    // Sem `start:raw`: rodar `node src/app.js` direto pularia NODE_ENV=production
    // e ligaria o modo dev sem o painel vendorizado.
    scripts: { start: 'node start.mjs' },
    dependencies: directDependencies
  };

  await fs.writeFile(path.join(outDir, 'package.json'), `${JSON.stringify(deployPackage, null, 2)}\n`);

  await fs.writeFile(
    path.join(outDir, 'start.mjs'),
    [
      '// Gerado por `flash_deploy`. Força produção antes de carregar a aplicação.',
      "process.env.NODE_ENV = 'production';",
      `await import('./${entryRelative}');`,
      ''
    ].join('\n')
  );

  await fs.writeFile(
    path.join(outDir, 'README.md'),
    [
      `# ${deployPackage.name}`,
      '',
      `Build de produção gerado por **flash_deploy** em ${new Date().toISOString()}.`,
      '',
      '## Rodar',
      '',
      '```bash',
      'node start.mjs            # NODE_ENV=production já definido',
      'PORT=8080 node start.mjs  # porta explícita',
      '```',
      '',
      '> Sempre inicie por `start.mjs`: ele define `NODE_ENV=production` antes de',
      '> carregar a aplicação. Rodar o arquivo da aplicação direto ativaria o modo',
      '> de desenvolvimento (painel de debug) em produção.',
      '',
      '',
      '## Variáveis de ambiente',
      '',
      '| Variável | Obrigatória | Observação |',
      '| --- | --- | --- |',
      '| `SESSION_SECRET` | sim | segredo forte e estável; sem ele as sessões caem a cada restart |',
      '| `PORT` / `HOST` | não | padrão definido pela aplicação |',
      '',
      '## Conteúdo',
      '',
      `- \`${entryRelative}\` — aplicação`,
      '- `node_modules/flash` — framework vendorizado (sem devtools)',
      '- `public/` — assets com hash de conteúdo',
      `- \`${MANIFEST_FILE}\` — versões, hashes e análise de templates`,
      '',
      '> Este diretório é autocontido: copie inteiro para o servidor.',
      ''
    ].join('\n')
  );

  /* 9. avisos de configuração */
  warnings.push(...(await lintAppSources(path.join(outDir, 'src'))));

  /* 10. manifesto */
  const files = [];
  await walk(outDir, async (file) => {
    const relative = toPosix(path.relative(outDir, file));
    if (relative === MANIFEST_FILE) return;
    const buffer = await fs.readFile(file);
    files.push({ path: relative, bytes: buffer.length, sha256: sha256(buffer) });
  });

  files.sort((a, b) => a.path.localeCompare(b.path));

  const modulesTotals = { files: 0, bytes: 0 };
  const modulesFiles = [];
  await (async function walkModules(dir) {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walkModules(full);
        continue;
      }
      const { size } = await fs.stat(full);
      modulesTotals.files += 1;
      modulesTotals.bytes += size;
      modulesFiles.push(toPosix(path.relative(outDir, full)));
    }
  })(path.join(outDir, 'node_modules'));

  const manifest = {
    tool: 'flash_deploy',
    flash: { version: frameworkPackage.version },
    app: { name: deployPackage.name, version: deployPackage.version, entry: entryRelative },
    builtAt: new Date().toISOString(),
    node: process.version,
    environment: 'production',
    analysis: {
      views: analysis.templates.length,
      components: analysis.components.length,
      directives: analysis.directives,
      componentTags: analysis.componentTags,
      needsRuntime: analysis.needsRuntime
    },
    assets: Object.fromEntries(assetMap),
    dependencies: {
      direct: directDependencies,
      bundled: bundled
    },
    totals: {
      files: files.length + 1,
      bytes: files.reduce((total, file) => total + file.bytes, 0),
      modulesFiles: modulesTotals.files,
      modulesBytes: modulesTotals.bytes,
      allFiles: files.length + modulesTotals.files + 1,
      allBytes: files.reduce((total, file) => total + file.bytes, 0) + modulesTotals.bytes
    },
    warnings,
    files
  };

  await fs.writeFile(path.join(outDir, MANIFEST_FILE), `${JSON.stringify(manifest, null, 2)}\n`);

  run(
    'manifest',
    `${manifest.totals.files} arquivos, ${(manifest.totals.bytes / 1024).toFixed(0)} kB`
  );

  /* 11. verificação */
  let smoke = null;
  if (options.smoke !== false) {
    smoke = await smokeTest(outDir);
    run('smoke', `app respondeu ${smoke.status} na porta ${smoke.port}`);
  } else {
    run('smoke', 'ignorado (--no-smoke)');
  }

  return { outDir, steps, warnings, manifest, smoke };
}
