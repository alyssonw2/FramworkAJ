#!/usr/bin/env node
/**
 * `flash_deploy` — gera a pasta `deploy/` pronta para o servidor.
 *
 *   npm run flash_deploy
 *   node bin/flash-deploy.js --app examples/clients-app --out deploy
 *
 * Flags:
 *   --app <dir>          aplicação de origem        (padrão: examples/clients-app)
 *   --out <dir>          destino                    (padrão: deploy)
 *   --entry <arquivo>    ponto de entrada           (padrão: src/app.js)
 *   --no-css             não recompila Tailwind
 *   --no-bundle-deps     não copia node_modules
 *   --no-smoke           não sobe o app no fim
 *   --no-clean           falha se o destino existir
 *   --force              apaga destino não reconhecido
 *   --dry-run            só mostra o plano
 *   --json               saída em JSON
 *   --help / --version
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildDeploy, FRAMEWORK_ROOT, MANIFEST_FILE } from '../src/cli/deploy.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const HELP = `
  flash_deploy — build de produção do FLASH

  Uso
    npm run flash_deploy
    node bin/flash-deploy.js [opções]

  Opções
    --app <dir>         aplicação de origem        (padrão: examples/clients-app)
    --out <dir>         destino                    (padrão: deploy)
    --entry <arquivo>   ponto de entrada           (padrão: src/app.js)
    --no-css            não recompila o Tailwind
    --no-bundle-deps    não copia node_modules (use npm ci --omit=dev no servidor)
    --no-smoke          não sobe o app ao final
    --no-clean          falha se o destino já existir
    --force             apaga o destino mesmo sem ${MANIFEST_FILE}
    --dry-run           mostra o plano sem escrever nada
    --json              saída em JSON (para CI)
    --help, --version

  O que ele faz
    1. analisa os templates (views, componentes, diretivas)
    2. compila o CSS (Tailwind) com --minify
    3. copia a aplicação e reescreve imports do framework para flash/...
    4. vendoriza o framework em node_modules/flash (sem devtools)
    5. copia as dependências de produção
    6. aplica hash nos assets e atualiza as referências
    7. gera package.json, start.mjs e flash-manifest.json
    8. sobe o app em modo produção e faz uma requisição de verificação
`;

function parseArgs(argv) {
  const options = {};
  const flags = new Set();
  const value = (index, name) => {
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) throw new Error(`--${name} precisa de um valor`);
    return next;
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    switch (arg) {
      case '--app': options.appDir = value(i, 'app'); i += 1; break;
      case '--out': options.outDir = value(i, 'out'); i += 1; break;
      case '--entry': options.entry = value(i, 'entry'); i += 1; break;
      case '--no-css': options.css = false; break;
      case '--no-bundle-deps': options.bundleDeps = false; break;
      case '--no-smoke': options.smoke = false; break;
      case '--no-clean': options.clean = false; break;
      case '--force': options.force = true; break;
      case '--dry-run': options.dryRun = true; break;
      case '--json': flags.add('json'); break;
      case '--help':
      case '-h': flags.add('help'); break;
      case '--version':
      case '-v': flags.add('version'); break;
      default:
        throw new Error(`opção desconhecida: ${arg}`);
    }
  }

  return { options, flags };
}

function color(code, text) {
  if (!process.stdout.isTTY || process.env.NO_COLOR) return text;
  return `\u001b[${code}m${text}\u001b[0m`;
}

const ICONS = {
  analyze: '⌕',
  prepare: '▸',
  app: '⌂',
  css: '✦',
  assets: '#',
  framework: '◆',
  deps: '↧',
  manifest: '☰',
  smoke: '✓'
};

function relative(target) {
  const rel = path.relative(process.cwd(), target);
  return rel === '' ? '.' : rel;
}

async function main() {
  let parsed;
  try {
    parsed = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(color('31', `✖ ${error.message}`));
    console.error(HELP);
    process.exit(2);
  }

  const { options, flags } = parsed;

  if (flags.has('help')) {
    console.log(HELP);
    return;
  }

  if (flags.has('version')) {
    const { readFile } = await import('node:fs/promises');
    const pkg = JSON.parse(await readFile(path.join(FRAMEWORK_ROOT, 'package.json'), 'utf8'));
    console.log(`flash_deploy ${pkg.version}`);
    return;
  }

  const json = flags.has('json');
  const started = Date.now();

  const log = json
    ? undefined
    : (step, message) => {
        const icon = ICONS[step] ?? '•';
        console.log(`${color('90', icon)} ${color('36', step.padEnd(9))} ${message}`);
      };

  if (!json) {
    console.log('');
    console.log(color('1', '  flash_deploy'));
    console.log(color('90', '  ─────────────────────────────────────────────'));
  }

  let result;
  try {
    result = await buildDeploy({ ...options, log });
  } catch (error) {
    if (json) {
      console.log(JSON.stringify({ ok: false, error: error.message }, null, 2));
    } else {
      console.error('');
      console.error(color('31', `  ✖ ${error.message}`));
      console.error('');
    }
    process.exit(1);
  }

  const elapsed = ((Date.now() - started) / 1000).toFixed(1);

  if (json) {
    console.log(JSON.stringify({ ok: true, elapsedMs: Date.now() - started, ...result }, null, 2));
    return;
  }

  const { manifest } = result;

  console.log(color('90', '  ─────────────────────────────────────────────'));
  console.log(`  ${color('32', 'pronto')}  ${color('1', relative(result.outDir))}  ${color('90', `(${elapsed}s)`)}`);
  console.log('');
  console.log(`  views         ${manifest.analysis.views}`);
  console.log(`  componentes   ${manifest.analysis.components}`);
  console.log(`  diretivas     ${manifest.analysis.directives.join(', ') || '—'}`);
  console.log(`  arquivos      ${manifest.totals.files}`);
  console.log(`  tamanho       ${(manifest.totals.bytes / 1024).toFixed(0)} kB`);
  console.log(`  assets        ${Object.values(manifest.assets).length ? Object.values(manifest.assets).join(', ') : '—'}`);

  if (result.smoke?.checks?.length) {
    console.log('');
    console.log(color('90', '  verificação de produção'));
    for (const check of result.smoke.checks) {
      const mark = check.ok ? color('32', '✓') : color('31', '✖');
      console.log(`  ${mark} ${check.name.padEnd(22)} ${color('90', check.detail)}`);
    }
  }

  if (result.smoke?.notices?.length) {
    for (const notice of result.smoke.notices) {
      console.log(color('33', `  ! ${notice}`));
    }
  }

  if (result.warnings.length) {
    console.log('');
    console.log(color('33', '  avisos'));
    for (const warning of result.warnings) {
      console.log(color('33', `  • ${warning}`));
    }
  }

  console.log('');
  console.log(color('90', '  para rodar no servidor:'));
  console.log(color('90', `    cd ${relative(result.outDir)} && node start.mjs`));
  console.log('');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
