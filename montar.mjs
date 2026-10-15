// Monta o arquivo único simulador.html a partir de src/ e vendor/.
// Uso: node montar.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const raiz = dirname(fileURLToPath(import.meta.url));
const ler = (p) => readFileSync(join(raiz, p), 'utf8');
// pdf.js só é usado ao abrir um PDF de fundo: vai comprimido (gzip + base64)
const comprimido = (p) => gzipSync(readFileSync(join(raiz, p)), { level: 9 }).toString('base64');

const blocos = {
  THREE: ler('vendor/three-pacote.min.js'),
  CATALOGO: ler('src/catalogo.js'),
  PLANTA: ler('src/planta.js'),
  APP: ler('src/app.js'),
  PDFJS: comprimido('vendor/pdfjs/pdf.min.js'),
  PDFJS_WORKER: comprimido('vendor/pdfjs/pdf.worker.min.js'),
};

let html = ler('src/pagina.html');
for (const [nome, js] of Object.entries(blocos)) {
  if (/<\/script/i.test(js)) throw new Error(`O bloco ${nome} contém "</script", o que quebraria a página.`);
  const marca = `/*@${nome}@*/`;
  if (!html.includes(marca)) throw new Error(`Marca ${marca} não encontrada em src/pagina.html`);
  html = html.replace(marca, () => `\n${js}\n`);
}

const destino = join(raiz, 'simulador.html');
writeFileSync(destino, html);
console.log(`simulador.html montado (${(html.length / 1024).toFixed(0)} KB)`);
