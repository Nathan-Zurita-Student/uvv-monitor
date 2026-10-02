// Empacota o bot (src/gas/entry.ts e dependências) em apps-script/Bot.gs para o Apps Script.
// Uso: npm run build:gas            → gera o arquivo
//      npm run build:gas -- --check → falha se o arquivo estiver desatualizado
import { readFileSync, writeFileSync } from 'node:fs';
import { build } from 'esbuild';

const output = new URL('../apps-script/Bot.gs', import.meta.url);
const result = await build({
  entryPoints: [new URL('../src/gas/entry.ts', import.meta.url).pathname.replace(/^\/(\w:)/, '$1')],
  bundle: true,
  write: false,
  format: 'iife',
  globalName: 'UVVBot',
  platform: 'neutral',
  mainFields: ['module', 'main'],
  // O Apps Script roda V8, mas sem garantia dos recursos mais novos.
  target: 'es2019',
  charset: 'utf8',
  legalComments: 'none',
  // Minificado por completo: o arquivo é colado no editor do Apps Script a cada publicação.
  minify: true,
});

const code = `// Gerado por "npm run build:gas" a partir de src/gas/entry.ts. Não edite à mão.\n${result.outputFiles[0].text}`;

if (process.argv.includes('--check')) {
  let current = '';
  try {
    current = readFileSync(output, 'utf8').replace(/\r\n/g, '\n');
  } catch {
    current = '';
  }
  if (current !== code) {
    console.error('apps-script/Bot.gs está desatualizado. Rode "npm run build:gas".');
    process.exit(1);
  }
  console.log('apps-script/Bot.gs está atualizado.');
} else {
  writeFileSync(output, code, 'utf8');
  console.log(`apps-script/Bot.gs gerado (${(code.length / 1024).toFixed(1)} KB).`);
}
