import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildDeploy,
  rewriteFrameworkImports,
  smokeTest,
  FRAMEWORK_ROOT,
  FRAMEWORK_SRC,
  MANIFEST_FILE
} from '../src/cli/deploy.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.join(FRAMEWORK_ROOT, 'examples', 'clients-app');

async function tempDir(label) {
  return fs.mkdtemp(path.join(os.tmpdir(), `flash-${label}-`));
}

async function exists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

/* ---------- reescrita de imports ---------- */

test('imports do framework viram especificadores flash/...', () => {
  const file = path.join(APP, 'src', 'app.js');
  const source = [
    "import { createFlash } from '../../../src/index.js';",
    "import { session } from '../../../src/adapters/session.js';",
    "import { componentsDir } from '../../../src/paths.js';",
    "import express from 'express';",
    "import { registerAuthRoutes } from './routes/auth.routes.js';"
  ].join('\n');

  const { code, rewritten } = rewriteFrameworkImports(source, file);

  assert.equal(rewritten, 3);
  assert.match(code, /from 'flash\/index\.js'/);
  assert.match(code, /from 'flash\/adapters\/session\.js'/);
  assert.match(code, /from 'flash\/paths\.js'/);
  assert.match(code, /from 'express'/);
  assert.match(code, /from '\.\/routes\/auth\.routes\.js'/);
});

test('imports fora do framework e imports dinâmicos', () => {
  const file = path.join(APP, 'src', 'app.js');

  const { code, rewritten } = rewriteFrameworkImports(
    "const mod = await import('../../shared/x.js');\nexport { a } from './local.js';",
    file
  );

  assert.equal(rewritten, 0);
  assert.equal(code.includes('flash/'), false);
});

/* ---------- build ---------- */

test('buildDeploy gera um pacote autocontido e verificável', async (t) => {
  const out = await tempDir('deploy');
  t.after(() => fs.rm(out, { recursive: true, force: true }));

  const result = await buildDeploy({
    appDir: APP,
    outDir: out,
    css: false,
    bundleDeps: false,
    smoke: false
  });

  // estrutura
  for (const entry of ['package.json', 'start.mjs', 'README.md', MANIFEST_FILE, 'src', 'public', 'node_modules/flash']) {
    assert.ok(await exists(path.join(out, entry)), `faltou ${entry}`);
  }

  // a fonte do CSS não vai para o servidor
  assert.equal(await exists(path.join(out, 'src', 'styles')), false);

  // imports reescritos
  const app = await fs.readFile(path.join(out, 'src', 'app.js'), 'utf8');
  assert.match(app, /from 'flash\/index\.js'/);
  assert.match(app, /from 'flash\/paths\.js'/);
  assert.equal(app.includes('../../../src/'), false);

  // framework vendorizado sem o painel de desenvolvimento
  assert.ok(await exists(path.join(out, 'node_modules', 'flash', 'src', 'index.js')));
  assert.ok(await exists(path.join(out, 'node_modules', 'flash', 'src', 'dev', 'devtools.js')));
  assert.equal(await exists(path.join(out, 'node_modules', 'flash', 'src', 'dev', 'panel.js')), false);

  // start.mjs força produção
  const start = await fs.readFile(path.join(out, 'start.mjs'), 'utf8');
  assert.match(start, /NODE_ENV = 'production'/);
  assert.match(start, /import\('\.\/src\/app\.js'\)/);

  // package.json de produção
  const pkg = JSON.parse(await fs.readFile(path.join(out, 'package.json'), 'utf8'));
  assert.equal(pkg.type, 'module');
  assert.equal(pkg.main, 'src/app.js');
  assert.equal(pkg.scripts.start, 'node start.mjs');
  assert.equal(pkg.scripts['start:raw'], undefined, 'não deve permitir subir sem NODE_ENV');

  assert.ok(result.manifest.analysis.views > 0);
  assert.ok(result.manifest.analysis.directives.includes('f-submit'));
  assert.ok(result.manifest.analysis.componentTags.includes('ui:button'));
});

test('assets recebem hash e as referências são atualizadas', async (t) => {
  const out = await tempDir('assets');
  t.after(() => fs.rm(out, { recursive: true, force: true }));

  const result = await buildDeploy({
    appDir: APP,
    outDir: out,
    css: false,
    bundleDeps: false,
    smoke: false
  });

  const mapping = result.manifest.assets;
  const entries = Object.entries(mapping);
  assert.ok(entries.length > 0, 'nenhum asset com hash');

  const [original, hashed] = entries[0];
  assert.match(hashed, /\/app\.[a-z0-9]{8}\.css$/);
  assert.equal(original, '/assets/app.css');
  assert.equal(await exists(path.join(out, 'public', path.basename(original))), false);
  assert.ok(await exists(path.join(out, 'public', path.basename(hashed))));

  const layout = await fs.readFile(path.join(out, 'src', 'views', 'layouts', 'app.html'), 'utf8');
  assert.ok(layout.includes(hashed), 'layout não aponta para o asset com hash');
  assert.equal(layout.includes(original), false);
});

test('o manifesto descreve arquivos, hashes e totais', async (t) => {
  const out = await tempDir('manifest');
  t.after(() => fs.rm(out, { recursive: true, force: true }));

  await buildDeploy({ appDir: APP, outDir: out, css: false, bundleDeps: false, smoke: false });

  const manifest = JSON.parse(await fs.readFile(path.join(out, MANIFEST_FILE), 'utf8'));

  assert.equal(manifest.tool, 'flash_deploy');
  assert.equal(manifest.environment, 'production');
  assert.ok(manifest.flash.version);
  assert.ok(manifest.app.name.endsWith('-deploy'));

  assert.ok(manifest.files.length > 0);
  const appFile = manifest.files.find((file) => file.path === 'src/app.js');
  assert.ok(appFile, 'manifesto sem src/app.js');
  assert.match(appFile.sha256, /^[a-f0-9]{64}$/);
  assert.ok(appFile.bytes > 0);

  assert.ok(manifest.totals.allFiles >= manifest.totals.files);
  assert.ok(manifest.totals.allBytes > 0);
});

test('--dry-run não escreve nada', async (t) => {
  const out = await tempDir('dry');
  t.after(() => fs.rm(out, { recursive: true, force: true }));
  await fs.rm(out, { recursive: true, force: true });

  const result = await buildDeploy({
    appDir: APP,
    outDir: out,
    dryRun: true,
    smoke: false
  });

  assert.equal(result.dryRun, true);
  assert.equal(await exists(out), false, 'dry-run criou a pasta');
  assert.ok(result.steps.some((step) => step.step === 'analyze'));
});

test('recusa apagar pasta que não é um deploy do FLASH', async (t) => {
  const out = await tempDir('guard');
  t.after(() => fs.rm(out, { recursive: true, force: true }));

  const precious = path.join(out, 'importante.txt');
  await fs.writeFile(precious, 'não apague');

  await assert.rejects(
    () => buildDeploy({ appDir: APP, outDir: out, css: false, bundleDeps: false, smoke: false }),
    /não parece um deploy do FLASH/
  );

  assert.equal(await fs.readFile(precious, 'utf8'), 'não apague', 'apagou dados do usuário');
});

test('--force substitui pasta não reconhecida', async (t) => {
  const out = await tempDir('force');
  t.after(() => fs.rm(out, { recursive: true, force: true }));

  await fs.writeFile(path.join(out, 'antigo.txt'), 'x');

  await buildDeploy({ appDir: APP, outDir: out, css: false, bundleDeps: false, smoke: false, force: true });

  assert.equal(await exists(path.join(out, 'antigo.txt')), false);
  assert.ok(await exists(path.join(out, MANIFEST_FILE)));
});

test('sobrescreve um deploy anterior sem exigir --force', async (t) => {
  const out = await tempDir('rerun');
  t.after(() => fs.rm(out, { recursive: true, force: true }));

  await buildDeploy({ appDir: APP, outDir: out, css: false, bundleDeps: false, smoke: false });
  const second = await buildDeploy({ appDir: APP, outDir: out, css: false, bundleDeps: false, smoke: false });

  assert.ok(second.manifest.files.length > 0);
  assert.equal(await exists(path.join(out, MANIFEST_FILE)), true);
});

test('avisa sobre configuração insegura no código da aplicação', async (t) => {
  const out = await tempDir('lint');
  const app = await tempDir('app-src');
  t.after(async () => {
    await fs.rm(out, { recursive: true, force: true });
    await fs.rm(app, { recursive: true, force: true });
  });

  await fs.mkdir(path.join(app, 'src', 'views'), { recursive: true });
  await fs.writeFile(path.join(app, 'src', 'views', 'index.html'), '<p>ok</p>');
  await fs.writeFile(
    path.join(app, 'src', 'app.js'),
    "import { createFlash } from '../../src/index.js';\n" +
      "const flash = createFlash({ dev: true });\n" +
      "flash.use(session({ secure: false, secret: 'literal' }));\n"
  );
  await fs.writeFile(path.join(app, 'package.json'), JSON.stringify({ name: 'app-teste', type: 'module' }));

  const result = await buildDeploy({
    appDir: app,
    outDir: out,
    css: false,
    bundleDeps: false,
    smoke: false
  });

  const warnings = result.warnings.join('\n');
  assert.match(warnings, /dev: true/);
  assert.match(warnings, /secure: false/);
  assert.match(warnings, /SESSION_SECRET/);
});

test('erro claro quando o app usa Tailwind mas o CLI não está instalado', async (t) => {
  const out = await tempDir('nocss');
  const app = await tempDir('app-css');
  t.after(async () => {
    await fs.rm(out, { recursive: true, force: true });
    await fs.rm(app, { recursive: true, force: true });
  });

  await fs.mkdir(path.join(app, 'src', 'views'), { recursive: true });
  await fs.mkdir(path.join(app, 'src', 'styles'), { recursive: true });
  await fs.writeFile(path.join(app, 'src', 'views', 'index.html'), '<p>ok</p>');
  await fs.writeFile(path.join(app, 'src', 'app.js'), 'export const app = 1;');
  await fs.writeFile(path.join(app, 'src', 'styles', 'tailwind.css'), '@import "tailwindcss";');
  await fs.writeFile(path.join(app, 'package.json'), JSON.stringify({ name: 'x', type: 'module' }));

  // O app está fora da árvore do framework, então o CLI não é resolvido a partir
  // dele; o framework continua sendo encontrado — o teste valida a mensagem.
  const error = await buildDeploy({
    appDir: app,
    outDir: out,
    bundleDeps: false,
    smoke: false
  }).then(
    () => null,
    (reason) => reason
  );

  assert.ok(error, 'deveria falhar ao compilar o CSS');
  assert.match(error.message, /tailwindcss/);
  assert.match(error.message, /npm install -D tailwindcss/);
});

test('ponto de entrada ausente gera erro explícito', async (t) => {
  const out = await tempDir('noentry');
  const app = await tempDir('app-empty');
  t.after(async () => {
    await fs.rm(out, { recursive: true, force: true });
    await fs.rm(app, { recursive: true, force: true });
  });

  await fs.mkdir(path.join(app, 'src', 'views'), { recursive: true });
  await fs.writeFile(path.join(app, 'src', 'views', 'index.html'), '<p>ok</p>');

  await assert.rejects(
    () => buildDeploy({ appDir: app, outDir: out, css: false, bundleDeps: false, smoke: false }),
    /Não encontrei o ponto de entrada/
  );
});

test('sem src/views o deploy para antes de escrever', async (t) => {
  const out = await tempDir('noviews');
  const app = await tempDir('app-noviews');
  t.after(async () => {
    await fs.rm(out, { recursive: true, force: true });
    await fs.rm(app, { recursive: true, force: true });
  });

  await fs.mkdir(path.join(app, 'src'), { recursive: true });
  await fs.writeFile(path.join(app, 'src', 'app.js'), 'export const app = 1;');

  await assert.rejects(
    () => buildDeploy({ appDir: app, outDir: out, css: false, bundleDeps: false, smoke: false }),
    /src\/views/
  );
});

/* ---------- verificação de produção ---------- */

test('o deploy sobe em modo produção e responde', async (t) => {
  const out = await tempDir('smoke-src');
  await fs.rm(out, { recursive: true, force: true });
  t.after(() => fs.rm(out, { recursive: true, force: true }));

  await buildDeploy({ appDir: APP, outDir: out, css: false, bundleDeps: true, smoke: false });

  const smoke = await smokeTest(out);

  assert.ok(smoke.status < 500);
  const byName = Object.fromEntries(smoke.checks.map((check) => [check.name, check]));
  assert.equal(byName['devtools desligado'].ok, true);
  assert.equal(byName['sem painel no HTML'].ok, true);
  assert.equal(byName['CSP ativa'].ok, true);
});

test('o framework vendorizado não contém referência ao painel de dev', async (t) => {
  const out = await tempDir('nopanel');
  t.after(() => fs.rm(out, { recursive: true, force: true }));

  await buildDeploy({ appDir: APP, outDir: out, css: false, bundleDeps: false, smoke: false });

  const index = await fs.readFile(path.join(out, 'node_modules', 'flash', 'src', 'index.js'), 'utf8');
  assert.equal(index.includes('panel.js'), false);

  // `DevTools` continua exportado (é o que `dev: false` precisa para existir)
  assert.match(index, /DevTools/);

  // o arquivo do painel não existe e nada o importa (comentários podem citá-lo)
  const files = [];
  const walk = async (dir) => {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else files.push(full);
    }
  };
  await walk(path.join(out, 'node_modules', 'flash', 'src'));

  assert.equal(files.some((file) => file.endsWith('panel.js')), false, 'panel.js foi vendorizado');

  for (const file of files) {
    const content = await fs.readFile(file, 'utf8');
    assert.doesNotMatch(
      content,
      /(?:from|import)\s*\(?\s*['"][^'"]*panel\.js['"]/,
      `${path.relative(out, file)} importa o painel`
    );
  }

  // o CLI de deploy não vai para o servidor
  assert.equal(files.some((file) => file.includes(`${path.sep}cli${path.sep}`)), false, 'src/cli foi vendorizado');

  assert.ok(FRAMEWORK_SRC.startsWith(FRAMEWORK_ROOT));
  assert.ok(HERE.endsWith('test'));
});
