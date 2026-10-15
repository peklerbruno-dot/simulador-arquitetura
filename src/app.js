// =====================================================================
// SIMULADOR 3D DE INTERIORES — aplicação
// =====================================================================
// Seções (procure pelo número):
//   1. Configuração                 7. Colisões
//   2. Documento e histórico        8. Seleção e arraste
//   3. Geometria da planta          8b. Desenhar a planta
//   4. Cena 3D                      9. Painéis e barra
//   5. Paredes, aberturas e pisos  10. Projetos e arquivos
//   6. Móveis                      11. Extensões futuras · 12. Início
// Dados: PLANTA_VAZIA, PLANTA_EXEMPLO, CENARIOS_* e LOCAIS (planta.js) e
// CATALOGO (catalogo.js).
// =====================================================================
(() => {
'use strict';
const T = window.THREE;
const $ = (s) => document.querySelector(s);

// =====================================================================
// 1. CONFIGURAÇÃO
// =====================================================================
// As chaves do aparelho começam com 'simarq:' (o navegador divide o
// armazenamento por site; outro simulador no mesmo endereço não interfere).
const CFG = {
  grade: 5,                 // encaixe de móveis e paredes (cm)
  prefixo: 'simarq:',
  alturaCorte: 110,         // altura das paredes no modo "cortar paredes"
  tolColisao: 0.5,          // sobreposição mínima (cm) para contar como colisão
  corSel: 0x2f80ed,
  corColisao: 0xe5484d,
};

const PISOS = {
  madeira:     { nome: 'Madeira' },
  ceramica:    { nome: 'Cerâmica 30×30' },
  porcelanato: { nome: 'Porcelanato 60×60' },
  cimento:     { nome: 'Cimento queimado' },
};

const TIPOS_ABERTURA = { janela: 'Janela', porta: 'Porta', correr: 'Porta de correr' };

// =====================================================================
// 2. DOCUMENTO E HISTÓRICO
// =====================================================================
// O "documento" é um projeto: a planta (compartilhada pelos cenários, as
// abas de opções), os cenários com seus móveis e os móveis importados.
const clonar = (o) => JSON.parse(JSON.stringify(o));
let seq = 0;
const novoId = (p) => `${p}-${Date.now().toString(36)}${(seq++).toString(36)}`;

let doc = null;
let sel = null; // { tipo: 'movel' | 'parede' | 'ambiente', id }

function defCatalogo(tipo) {
  return CATALOGO.find((c) => c.tipo === tipo) || (doc?.catalogoExtra || []).find((c) => c.tipo === tipo);
}
const cen = () => doc.cenarios[doc.ativo];
const movel = (id) => cen().moveis.find((m) => m.id === id);
const parede = (id) => doc.planta.paredes.find((w) => w.id === id);
const ambiente = (id) => doc.planta.ambientes.find((a) => a.id === id);

function prepararMovel(m) {
  const def = defCatalogo(m.tipo) || { dim: { l: 50, p: 50, a: 50 }, cores: {}, nome: m.tipo };
  m.id = m.id || novoId('m');
  m.rot = (((m.rot || 0) % 360) + 360) % 360;
  m.l ??= def.dim.l; m.p ??= def.dim.p; m.a ??= def.dim.a;
  m.cores = Object.assign({}, def.cores, m.cores);
  m.nome ??= def.nome;
  m.espelhado = !!m.espelhado;
  if (def.variantes) m.variante ??= def.variantes[0].id;
  if (def.acabamentos) m.acab ??= def.acabamentos[0];
  m.y ??= varianteDe(def, m)?.elev ?? def.elev ?? 0;
  m.aberto ??= def.aberto ?? 0;
  return m;
}

function prepararDoc(d) {
  d.versao = 2;
  d.id ||= novoId('prj');
  d.nome ||= 'Projeto sem nome';
  d.ativo = Math.min(Math.max(0, d.ativo | 0), d.cenarios.length - 1);
  d.catalogoExtra ||= [];
  const pl = d.planta;
  pl.alturaParede ||= 270;
  pl.pontosEletricos ||= [];
  pl.ambientes ||= [];
  pl.contorno ||= [];
  pl.local ||= clonar(LOCAIS[0]);
  pl.orientacao ??= 270;
  pl.fundo ??= null;
  delete pl.revisao; delete pl.areaConstrutora; delete d.originaisVistos;
  for (const w of pl.paredes) w.id ||= novoId('p');
  for (const a of pl.aberturas) a.id ||= novoId('ab');
  for (const a of pl.ambientes) a.id ||= novoId('a');
  for (const c of d.cenarios) {
    c.id ||= novoId('c');
    c.zonas ||= [];
    for (const z of c.zonas) z.id ||= novoId('z');
    for (const m of c.moveis) prepararMovel(m);
  }
  sincronizarAmbientes(pl);
  return d;
}

// Projeto novo: vazio (só a primeira aba) ou o exemplo de 1 quarto.
function novoDoc(nome, exemplo = false) {
  const antes = doc;
  doc = {
    nome, cliente: '', planta: clonar(exemplo ? PLANTA_EXEMPLO : PLANTA_VAZIA),
    cenarios: clonar(exemplo ? CENARIOS_EXEMPLO : CENARIOS_VAZIOS), ativo: 0, catalogoExtra: [],
  };
  const d = prepararDoc(doc);
  doc = antes;
  return d;
}

function docValido(d) {
  return d && d.planta && Array.isArray(d.planta.paredes) && Array.isArray(d.planta.aberturas) &&
    Array.isArray(d.cenarios) && d.cenarios.length > 0 && d.cenarios.every((c) => Array.isArray(c.moveis));
}

// Histórico: cada alteração guarda uma cópia do documento anterior.
const hist = { voltar: [], avancar: [] };
function registrar(estado = JSON.stringify(doc)) {
  hist.voltar.push(estado);
  if (hist.voltar.length > 200) hist.voltar.shift();
  hist.avancar.length = 0;
}
function alterar(fn) { registrar(); fn(); atualizarTudo(); }
function desfazer() {
  if (!hist.voltar.length) return;
  hist.avancar.push(JSON.stringify(doc));
  doc = JSON.parse(hist.voltar.pop());
  validarSelecao(); atualizarTudo();
}
function refazer() {
  if (!hist.avancar.length) return;
  hist.voltar.push(JSON.stringify(doc));
  doc = JSON.parse(hist.avancar.pop());
  validarSelecao(); atualizarTudo();
}
function validarSelecao() {
  if (!sel) return;
  const existe = sel.tipo === 'movel' ? movel(sel.id) : sel.tipo === 'parede' ? parede(sel.id)
    : sel.tipo === 'zona' ? (cen().zonas || []).find((z) => z.id === sel.id) : ambiente(sel.id);
  if (!existe) sel = null;
  if (sel?.abertura && !doc.planta.aberturas.some((a) => a.id === sel.abertura)) delete sel.abertura;
}

// =====================================================================
// 3. GEOMETRIA DA PLANTA
// =====================================================================
const snap = (v) => Math.round(v / CFG.grade) * CFG.grade;
const horizontal = (w) => Math.abs(w.z1 - w.z2) < 0.5;
const comprimento = (w) => Math.hypot(w.x2 - w.x1, w.z2 - w.z1);

function areaSinal(pts) {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, z1] = pts[i], [x2, z2] = pts[(i + 1) % pts.length];
    s += x1 * z2 - x2 * z1;
  }
  return s / 2;
}

function dentro([x, z], pts) {
  let d = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, zi] = pts[i], [xj, zj] = pts[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) d = !d;
  }
  return d;
}

// Parede (de pé) que passa por baixo de uma aresta de ambiente/contorno.
function paredeNaAresta(a, b, planta) {
  const hz = Math.abs(a[1] - b[1]) < 0.5;
  const mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2;
  for (const w of planta.paredes) {
    if (w.demolida || horizontal(w) !== hz) continue;
    if (hz && Math.abs(w.z1 - mz) < 0.5 && mx > Math.min(w.x1, w.x2) - 0.5 && mx < Math.max(w.x1, w.x2) + 0.5) return w;
    if (!hz && Math.abs(w.x1 - mx) < 0.5 && mz > Math.min(w.z1, w.z2) - 0.5 && mz < Math.max(w.z1, w.z2) + 0.5) return w;
  }
  return null;
}

// Desloca um polígono ortogonal para dentro (ou para fora) em meia espessura
// da parede que existe sob cada aresta. É o que transforma "linha de centro"
// em "face interna" (área útil) ou "face externa" (área construída).
function deslocar(pts, planta, paraFora = false) {
  const n = pts.length;
  const normais = [], dists = [];
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    const dx = Math.sign(b[0] - a[0]), dz = Math.sign(b[1] - a[1]);
    let nx = -dz, nz = dx;
    const meio = [(a[0] + b[0]) / 2 + nx * 0.5, (a[1] + b[1]) / 2 + nz * 0.5];
    if (!dentro(meio, pts)) { nx = -nx; nz = -nz; }
    if (paraFora) { nx = -nx; nz = -nz; }
    normais.push([nx, nz]);
    const w = paredeNaAresta(a, b, planta);
    dists.push(w ? w.esp / 2 : 0);
  }
  return pts.map((p, i) => {
    let [x, z] = p;
    for (const e of [(i - 1 + n) % n, i]) {
      const a = pts[e], b = pts[(e + 1) % n];
      if (Math.abs(a[0] - b[0]) < 0.5) x = p[0] + normais[e][0] * dists[e]; // aresta vertical
      else z = p[1] + normais[e][1] * dists[e];                             // aresta horizontal
    }
    return [x, z];
  });
}

const poligonoUtil = (amb) => deslocar(amb.pontos, doc.planta);
const areaUtil = (amb) => Math.abs(areaSinal(poligonoUtil(amb))) / 1e4;
const areaConstruida = () => Math.abs(areaSinal(deslocar(doc.planta.contorno, doc.planta, true))) / 1e4;
// Dentro do projeto: no contorno externo ou, sem ele, no retângulo das paredes.
function naPlanta(x, z) {
  if (doc.planta.contorno.length) return dentro([x, z], doc.planta.contorno);
  const c = centroPlanta();
  return Math.abs(x - c.cx) <= c.w / 2 + 50 && Math.abs(z - c.cz) <= c.d / 2 + 50;
}

function limites(pts) {
  const xs = pts.map((p) => p[0]), zs = pts.map((p) => p[1]);
  return { x0: Math.min(...xs), x1: Math.max(...xs), z0: Math.min(...zs), z1: Math.max(...zs) };
}

function centroRotulo(pts) {
  let a = 0, cx = 0, cz = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, z1] = pts[i], [x2, z2] = pts[(i + 1) % pts.length];
    const f = x1 * z2 - x2 * z1;
    a += f; cx += (x1 + x2) * f; cz += (z1 + z2) * f;
  }
  const c = [cx / (3 * a), cz / (3 * a)];
  if (dentro(c, pts)) return c;
  const b = limites(pts); // polígono em L: procura um ponto interno numa grade
  let melhor = null, dist = Infinity;
  for (let i = 1; i < 10; i++) for (let j = 1; j < 10; j++) {
    const p = [b.x0 + ((b.x1 - b.x0) * i) / 10, b.z0 + ((b.z1 - b.z0) * j) / 10];
    const d = Math.hypot(p[0] - c[0], p[1] - c[1]);
    if (dentro(p, pts) && d < dist) { melhor = p; dist = d; }
  }
  return melhor || c;
}

// Folga até a face da parede perpendicular no início da parede (para mostrar
// o "afastamento do canto" das aberturas em vez da distância até o eixo).
function folgaInicio(w) {
  const hz = horizontal(w);
  for (const o of doc.planta.paredes) {
    if (o === w || o.demolida || horizontal(o) === hz) continue;
    const toca = hz
      ? Math.abs(o.x1 - w.x1) < 0.5 && w.z1 >= Math.min(o.z1, o.z2) - 0.5 && w.z1 <= Math.max(o.z1, o.z2) + 0.5
      : Math.abs(o.z1 - w.z1) < 0.5 && w.x1 >= Math.min(o.x1, o.x2) - 0.5 && w.x1 <= Math.max(o.x1, o.x2) + 0.5;
    if (toca) return o.esp / 2;
  }
  return 0;
}

// ESTICAR — a operação central de edição da planta (como o "stretch" do CAD).
// Move a linha eixo=c (x=c se eixo='x', z=c se eixo='z'), no trecho [a,b] da
// outra coordenada, em 'delta'. Paredes sobre a linha andam inteiras; paredes
// ligadas a elas esticam; vértices de ambientes e do contorno acompanham.
// Aberturas ficam no mesmo lugar do mundo.
function esticar(planta, eixo, c, a, b, delta) {
  const X = eixo === 'x' ? 0 : 1, Y = 1 - X;
  const pts = (w) => [[w.x1, w.z1], [w.x2, w.z2]];
  let lo = a, hi = b;
  for (const w of planta.paredes) {
    const [p, q] = pts(w);
    if (Math.abs(p[X] - c) < 0.5 && Math.abs(q[X] - c) < 0.5 &&
        Math.min(p[Y], q[Y]) <= b + 0.5 && Math.max(p[Y], q[Y]) >= a - 0.5) {
      lo = Math.min(lo, p[Y], q[Y]); hi = Math.max(hi, p[Y], q[Y]);
    }
  }
  const naLinha = (p) => Math.abs(p[X] - c) < 0.5 && p[Y] >= lo - 0.5 && p[Y] <= hi + 0.5;
  const k = X === 0 ? 'x' : 'z';
  for (const w of planta.paredes) {
    const [p, q] = pts(w);
    const m0 = naLinha(p), m1 = naLinha(q);
    if (m0) w[k + '1'] += delta;
    if (m1) w[k + '2'] += delta;
    const eixoParede = horizontal(w) ? 0 : 1;
    if (m0 && !m1 && eixoParede === X) {
      for (const ab of planta.aberturas) if (ab.parede === w.id) ab.pos -= delta;
    }
  }
  for (const amb of planta.ambientes) for (const p of amb.pontos) if (naLinha(p)) p[X] += delta;
  for (const p of planta.contorno) if (naLinha(p)) p[X] += delta;
  for (const pe of planta.pontosEletricos || []) if (pe.x != null && naLinha([pe.x, pe.z])) (X === 0 ? (pe.x += delta) : (pe.z += delta));
}

// Confere se a planta continua coerente depois de uma edição.
function problemaPlanta(planta, antes) {
  for (const w of planta.paredes) {
    if (Math.abs(w.x1 - w.x2) > 0.5 && Math.abs(w.z1 - w.z2) > 0.5) return `a parede "${w.nome}" ficaria torta`;
    if (w.x1 > w.x2 + 0.5 || w.z1 > w.z2 + 0.5 || comprimento(w) < 10) return `a parede "${w.nome}" ficaria curta demais`;
  }
  for (const ab of planta.aberturas) {
    const w = planta.paredes.find((p) => p.id === ab.parede);
    if (!w) continue;
    if (ab.pos < -0.5 || ab.pos + ab.largura > comprimento(w) + 0.5) return `a abertura "${TIPOS_ABERTURA[ab.tipo]} ${ab.largura}" sairia da parede`;
  }
  for (const amb of planta.ambientes) {
    const s = areaSinal(amb.pontos);
    const a0 = antes?.ambientes.find((a) => a.id === amb.id);
    const s0 = a0 ? areaSinal(a0.pontos) : s;
    if (Math.sign(s) !== Math.sign(s0) || Math.abs(s) < 1000) return `o ambiente "${amb.nome}" ficaria pequeno demais`;
  }
  return null;
}

// Tenta aplicar uma edição de planta; se ficar incoerente, desfaz e avisa.
// Depois de qualquer mudança nas paredes, os ambientes são refeitos.
function editarPlanta(fn) {
  const nova = clonar(doc.planta);
  fn(nova);
  const erro = problemaPlanta(nova, doc.planta);
  if (erro) { toast(`Não dá: ${erro}.`); renderPainel(); return false; }
  registrar();
  sincronizarAmbientes(nova);
  doc.planta = nova;
  atualizarTudo();
  return true;
}

// ---- ambientes a partir das paredes
// As linhas de centro das paredes formam um grafo plano: cada região
// fechada vira um ambiente (área automática). As paredes são cortadas nos
// cruzamentos e nos "tês" (com 0,5 cm de tolerância); pontas soltas não
// fecham nada e são ignoradas. Paredes derrubadas contam (a demolição é
// só uma simulação: os ambientes continuam os mesmos).
const chavePt = (x, z) => `${Math.round(x * 10)},${Math.round(z * 10)}`;
function regioesDaPlanta(planta) {
  const segs = planta.paredes.filter((w) => comprimento(w) > 0.5).map((w) => (horizontal(w)
    ? { h: true, c: w.z1, a: Math.min(w.x1, w.x2), b: Math.max(w.x1, w.x2) }
    : { h: false, c: w.x1, a: Math.min(w.z1, w.z2), b: Math.max(w.z1, w.z2) }));
  // pontos de corte de cada segmento (2 = cruzamento, que vence numa disputa)
  const cortes = segs.map((s) => new Map([[s.a, 1], [s.b, 1]]));
  for (let i = 0; i < segs.length; i++) for (let j = 0; j < segs.length; j++) {
    const s = segs[i], o = segs[j];
    if (i === j) continue;
    if (s.h === o.h) {
      if (Math.abs(s.c - o.c) < 0.5) for (const v of [o.a, o.b]) if (v > s.a && v < s.b) cortes[i].set(v, Math.max(1, cortes[i].get(v) || 0));
    } else if (o.c > s.a - 0.5 && o.c < s.b + 0.5 && s.c > o.a - 0.5 && s.c < o.b + 0.5) cortes[i].set(o.c, 2);
  }
  const vert = new Map();
  const v = (x, z) => { const k = chavePt(x, z); if (!vert.has(k)) vert.set(k, { k, x, z, viz: new Set() }); return vert.get(k); };
  segs.forEach((s, i) => {
    const cs = [];
    for (const [c, pr] of [...cortes[i]].sort((p, q) => p[0] - q[0])) {
      const u = cs[cs.length - 1];
      if (u && c - u[0] < 0.5) { if (pr > u[1]) cs[cs.length - 1] = [c, pr]; continue; }
      cs.push([c, pr]);
    }
    for (let t = 0; t + 1 < cs.length; t++) {
      const A = s.h ? v(cs[t][0], s.c) : v(s.c, cs[t][0]), B = s.h ? v(cs[t + 1][0], s.c) : v(s.c, cs[t + 1][0]);
      A.viz.add(B.k); B.viz.add(A.k);
    }
  });
  // pontas soltas não fecham regiões
  for (let mudou = true; mudou;) {
    mudou = false;
    for (const [k, p] of vert) {
      if (p.viz.size > 1) continue;
      for (const q of p.viz) vert.get(q).viz.delete(k);
      vert.delete(k); mudou = true;
    }
  }
  // percorre as faces: em cada vértice, segue pela aresta vizinha no giro
  for (const p of vert.values()) {
    p.ord = [...p.viz].sort((a, b) => {
      const A = vert.get(a), B = vert.get(b);
      return Math.atan2(A.z - p.z, A.x - p.x) - Math.atan2(B.z - p.z, B.x - p.x);
    });
  }
  const feitas = new Set(), internas = [], externas = [];
  for (const p of vert.values()) for (const q0 of p.ord) {
    if (feitas.has(`${p.k}>${q0}`)) continue;
    const pts = [];
    let a = p.k, b = q0;
    for (let n = 0; n < 10000 && !feitas.has(`${a}>${b}`); n++) {
      feitas.add(`${a}>${b}`);
      const A = vert.get(a);
      pts.push([A.x, A.z]);
      const B = vert.get(b), i = B.ord.indexOf(a);
      [a, b] = [b, B.ord[(i + 1) % B.ord.length]];
    }
    const lim = simplificarPoligono(pts);
    if (lim.length < 3) continue;
    // as regiões fechadas saem no sentido negativo; a de fora, no positivo
    if (areaSinal(lim) < 0) internas.push(lim.reverse()); else externas.push(lim);
  }
  return { internas, externas };
}
// tira os vértices no meio de um lado reto
function simplificarPoligono(pts) {
  let r = pts;
  for (let mudou = true; mudou && r.length > 3;) {
    mudou = false;
    for (let i = 0; i < r.length; i++) {
      const a = r[(i - 1 + r.length) % r.length], b = r[i], c = r[(i + 1) % r.length];
      if ((Math.abs(a[0] - b[0]) < 0.05 && Math.abs(b[0] - c[0]) < 0.05) || (Math.abs(a[1] - b[1]) < 0.05 && Math.abs(b[1] - c[1]) < 0.05)) {
        r = r.filter((_, k) => k !== i); mudou = true; break;
      }
    }
  }
  return r;
}

// Refaz os ambientes a partir das paredes. Cada ambiente existente fica com
// a região que contém o seu centro (nome e piso continuam); regiões novas
// viram "Ambiente N"; um ambiente cuja região abriu ou se juntou a outra
// (parede apagada) sai. O contorno externo vem junto.
function sincronizarAmbientes(planta) {
  const { internas, externas } = regioesDaPlanta(planta);
  const usados = new Set(), mapa = new Map();
  const antigos = planta.ambientes.filter((a) => a.pontos?.length >= 3)
    .map((a, ordem) => ({ a, ordem, area: Math.abs(areaSinal(a.pontos)) })).sort((p, q) => q.area - p.area);
  for (const { a, ordem } of antigos) {
    const s = centroRotulo(a.pontos);
    const i = internas.findIndex((f, k) => !usados.has(k) && dentro(s, f));
    if (i < 0) continue;
    usados.add(i);
    mapa.set(i, { ...a, pontos: internas[i], ordem });
  }
  const nomes = new Set(planta.ambientes.map((a) => a.nome));
  let n = 1;
  internas.forEach((f, i) => {
    if (usados.has(i)) return;
    while (nomes.has(`Ambiente ${n}`)) n++;
    nomes.add(`Ambiente ${n}`);
    mapa.set(i, { id: novoId('a'), nome: `Ambiente ${n}`, piso: 'porcelanato', pontos: f, ordem: 1e6 + i });
  });
  planta.ambientes = [...mapa.values()].sort((p, q) => p.ordem - q.ordem).map(({ ordem, ...a }) => a);
  planta.contorno = externas.sort((p, q) => Math.abs(areaSinal(q)) - Math.abs(areaSinal(p)))[0] || [];
}



// =====================================================================
// 4. CENA 3D
// =====================================================================
const palco = $('#palco');
// Celular/tablet: menos pixels, sombra menor e menos luzes (memória e bateria).
const LEVE = matchMedia('(pointer: coarse)').matches;
const renderer = new T.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, LEVE ? 1.5 : 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = T.PCFSoftShadowMap;
// a sombra só é refeita quando algo muda (e não a cada quadro)
renderer.shadowMap.autoUpdate = false;
const sujarSombra = () => { renderer.shadowMap.needsUpdate = true; };
renderer.outputColorSpace = T.SRGBColorSpace;
renderer.toneMapping = T.NeutralToneMapping; // cores fiéis às referências
renderer.toneMappingExposure = 1;
palco.prepend(renderer.domElement);

const cena = new T.Scene();
cena.background = new T.Color('#e9ebee');
const pmrem = new T.PMREMGenerator(renderer);
cena.environment = pmrem.fromScene(new T.RoomEnvironment(), 0.04).texture;
cena.environmentIntensity = 0.45;

// Luzes: céu + sol. A posição do sol vem da data e da hora (seção 4b).
const hemi = new T.HemisphereLight(0xffffff, 0xd8cbb8, 1.1);
cena.add(hemi);
const sol = new T.DirectionalLight(0xfff1dc, 2.4);
sol.castShadow = true;
sol.shadow.mapSize.set(LEVE ? 2048 : 4096, LEVE ? 2048 : 4096);
Object.assign(sol.shadow.camera, { left: -650, right: 650, top: 650, bottom: -650, near: 10, far: 3000 });
sol.shadow.bias = -0.0004;
sol.shadow.normalBias = 0.6;
cena.add(sol, sol.target);

// Câmeras: perspectiva (órbita) e vista de cima (ortográfica).
const camPersp = new T.PerspectiveCamera(42, 1, 5, 20000);
const camTopo = new T.OrthographicCamera(-1, 1, 1, -1, 1, 20000);
camTopo.up.set(0, 0, -1);
const ctlPersp = new T.OrbitControls(camPersp, renderer.domElement);
ctlPersp.enableDamping = true;
ctlPersp.maxPolarAngle = Math.PI / 2 - 0.04;
ctlPersp.minDistance = 80;
ctlPersp.maxDistance = 4000;
const ctlTopo = new T.OrbitControls(camTopo, renderer.domElement);
ctlTopo.enableRotate = false;
ctlTopo.screenSpacePanning = true;
ctlTopo.mouseButtons = { LEFT: T.MOUSE.PAN, MIDDLE: T.MOUSE.DOLLY, RIGHT: T.MOUSE.PAN };
ctlTopo.touches = { ONE: T.TOUCH.PAN, TWO: T.TOUCH.DOLLY_PAN };
ctlTopo.minZoom = 0.3; ctlTopo.maxZoom = 12;
ctlTopo.enabled = false;

const vista = { topo: false, corte: false, caminhar: false };
const camAtiva = () => (vista.topo ? camTopo : camPersp);
const ctlAtivo = () => (vista.topo ? ctlTopo : ctlPersp);

// Retângulo do projeto: o contorno; sem ele, as paredes soltas; sem
// paredes, a planta de fundo; sem nada, uma área de 6 × 5 m para começar.
function centroPlanta() {
  const pl = doc.planta;
  let pts = pl.contorno.length ? pl.contorno : pl.paredes.flatMap((w) => [[w.x1, w.z1], [w.x2, w.z2]]);
  if (!pts.length && pl.fundo) pts = cantosFundo(pl.fundo);
  if (!pts.length) return { cx: 300, cz: 250, w: 600, d: 500 };
  const b = limites(pts);
  return { cx: (b.x0 + b.x1) / 2, cz: (b.z0 + b.z1) / 2, w: Math.max(150, b.x1 - b.x0), d: Math.max(150, b.z1 - b.z0) };
}

function enquadrar() {
  const { cx, cz, w, d } = centroPlanta();
  const asp = palco.clientWidth / Math.max(1, palco.clientHeight);
  const k = asp < 1.3 ? (1.3 / asp) ** 0.6 : 1; // tela em pé: afasta a câmera para caber
  camPersp.position.set(cx + w * 0.55 * k, Math.max(w, d) * 1.25 * k, cz + d * 1.05 * k);
  ctlPersp.target.set(cx, 0, cz);
  const meia = Math.max(d / 2, w / 2 / asp) * 1.12;
  Object.assign(camTopo, { left: -meia * asp, right: meia * asp, top: meia, bottom: -meia, zoom: 1 });
  camTopo.position.set(cx, 3000, cz);
  ctlTopo.target.set(cx, 0, cz);
  camTopo.updateProjectionMatrix();
  aplicarSol();
  ctlPersp.update(); ctlTopo.update();
}

// ---- navegação: zoom por botão, toque duplo e enquadrar um cômodo ou móvel
let animCam = 0;
function moverCamera(alvo, pos, zoomTopo) {
  cancelAnimationFrame(animCam);
  const ctl = ctlAtivo(), cam = camAtiva();
  const a0 = ctl.target.clone(), p0 = cam.position.clone(), z0 = camTopo.zoom, t0 = performance.now();
  const passo = (agora) => {
    const k = ease((agora - t0) / 450);
    ctl.target.lerpVectors(a0, alvo, k);
    if (vista.topo) {
      camTopo.position.set(ctl.target.x, camTopo.position.y, ctl.target.z);
      if (zoomTopo) { camTopo.zoom = z0 + (zoomTopo - z0) * k; camTopo.updateProjectionMatrix(); }
    } else if (pos) cam.position.lerpVectors(p0, pos, k);
    ctl.update();
    if (k < 1) animCam = requestAnimationFrame(passo);
  };
  animCam = requestAnimationFrame(passo);
}
// aproxima (fator < 1) ou afasta (> 1), mantendo o ponto de interesse
function zoomEm(ponto, fator) {
  if (vista.caminhar) return;
  const alvo = new T.Vector3(ponto.x, 0, ponto.z);
  if (vista.topo) { moverCamera(alvo, null, Math.min(12, Math.max(0.4, camTopo.zoom / fator))); return; }
  const dir = camPersp.position.clone().sub(ctlPersp.target);
  const dist = Math.min(4000, Math.max(60, dir.length() * fator));
  moverCamera(alvo, alvo.clone().add(dir.normalize().multiplyScalar(dist)));
}
function zoomPasso(fator) { zoomEm(ctlAtivo().target, fator); }
// enquadra um retângulo da planta (cômodo ou móvel) na parte visível da tela
function focarRet(r, folga = 40) {
  if (vista.caminhar) alternarCaminhada();
  const w = r.x1 - r.x0 + folga * 2, d = r.z1 - r.z0 + folga * 2;
  const alvo = new T.Vector3((r.x0 + r.x1) / 2, 0, (r.z0 + r.z1) / 2);
  const asp = palco.clientWidth / Math.max(1, palco.clientHeight - deslocamentoVista());
  if (vista.topo) {
    const base = camTopo.top - camTopo.bottom, baseW = camTopo.right - camTopo.left;
    moverCamera(alvo, null, Math.min(12, Math.max(0.4, Math.min(base / d, baseW / w) * 0.9)));
    return;
  }
  const raio = Math.max(w / Math.min(asp, 1.6), d) * 0.62;
  const dist = raio / Math.tan(rad(camPersp.fov / 2));
  const dir = camPersp.position.clone().sub(ctlPersp.target).normalize();
  moverCamera(alvo, alvo.clone().add(dir.multiplyScalar(Math.max(140, dist))));
}
function focarAmbiente(a) {
  const xs = a.pontos.map((p) => p[0]), zs = a.pontos.map((p) => p[1]);
  focarRet({ x0: Math.min(...xs), x1: Math.max(...xs), z0: Math.min(...zs), z1: Math.max(...zs) }, 15);
}
// no celular, com a gaveta do móvel aberta, o centro da vista sobe para o que
// está acima dela (a cena não muda de tamanho)
function deslocamentoVista() {
  const p = $('#painel');
  return LEVE_TELA() && document.body.classList.contains('com-painel') && p ? p.offsetHeight : 0;
}
const LEVE_TELA = () => matchMedia('(max-width: 860px)').matches;
function aplicarDeslocamento() {
  const h = deslocamentoVista(), W = palco.clientWidth, H = Math.max(1, palco.clientHeight);
  for (const c of [camPersp, camTopo]) {
    if (h > 0) c.setViewOffset(W, H, 0, h / 2, W, H); else c.clearViewOffset();
  }
}

function redimensionar() {
  const w = palco.clientWidth, h = Math.max(1, palco.clientHeight);
  renderer.setSize(w, h, false);
  camPersp.aspect = w / h; camPersp.updateProjectionMatrix();
  const meia = (camTopo.top - camTopo.bottom) / 2;
  camTopo.left = -meia * (w / h); camTopo.right = meia * (w / h);
  camTopo.updateProjectionMatrix();
  aplicarDeslocamento();
}
new ResizeObserver(redimensionar).observe(palco);

// Pós-processamento: oclusão ambiente (GTAO) — as sombras de contato nos
// cantos, atrás dos móveis e sob o sofá, que dão peso de foto à cena.
// Só na vista 3D; no celular começa desligada (pesa no processador).
const qualidade = Object.assign({ ao: !matchMedia('(pointer: coarse)').matches },
  (() => { try { return JSON.parse(localStorage.getItem(`${CFG.prefixo}qualidade`)) || {}; } catch { return {}; } })());
// criado só quando a oclusão está ligada: as imagens intermediárias ocupam
// dezenas de MB, o que pesa no celular
let composer = null;
function criarComposer() {
  composer = new T.EffectComposer(renderer);
  composer.addPass(new T.RenderPass(cena, camPersp));
  const ao = new T.GTAOPass(cena, camPersp, 1, 1);
  ao.updateGtaoMaterial({ radius: 32, distanceExponent: 1.4, thickness: 18, scale: 1.15, samples: 16, distanceFallOff: 1 });
  ao.blendIntensity = 0.9;
  composer.addPass(ao);
  composer.addPass(new T.OutputPass());
  ajustarComposer();
}
function ajustarComposer() {
  if (!composer) return;
  composer.setPixelRatio(renderer.getPixelRatio());
  composer.setSize(palco.clientWidth, Math.max(1, palco.clientHeight));
}
new ResizeObserver(ajustarComposer).observe(palco);
function desenharQuadro() {
  if (qualidade.ao && !vista.topo) { if (!composer) criarComposer(); composer.render(); }
  else renderer.render(cena, camAtiva());
}

// Texturas feitas no próprio navegador (sem arquivos externos).
// FUTURO (texturas): trocar estas funções por imagens carregadas.
function texturaCanvas(tamCm, px, desenhar) {
  const c = document.createElement('canvas');
  c.width = c.height = px;
  desenhar(c.getContext('2d'), px);
  const t = new T.CanvasTexture(c);
  t.wrapS = t.wrapT = T.RepeatWrapping;
  t.repeat.set(1 / tamCm, 1 / tamCm);
  t.colorSpace = T.SRGBColorSpace;
  t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return t;
}
function aleatorio(seed) { return () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646; }

function texturaMadeira() {
  // 240 cm × 240 cm: réguas de 20 cm × 120 cm, em amarração
  return texturaCanvas(240, 1024, (g, px) => {
    const r = aleatorio(7), esc = px / 240, tons = ['#c29868', '#bd9263', '#c69d6d', '#ba8f60', '#c09566'];
    for (let col = 0; col < 12; col++) {
      const desloc = (col % 3) * 40;
      for (let k = -1; k < 3; k++) {
        const z0 = (k * 120 + desloc) * esc, x0 = col * 20 * esc;
        g.fillStyle = tons[Math.floor(r() * tons.length)];
        g.fillRect(x0, z0, 20 * esc, 120 * esc);
        g.globalAlpha = 0.13;
        for (let v = 0; v < 9; v++) {
          g.strokeStyle = r() > 0.5 ? '#7a5634' : '#e2c29a';
          g.lineWidth = 0.6 + r() * 1.2;
          const xx = x0 + r() * 20 * esc;
          g.beginPath(); g.moveTo(xx, z0);
          g.bezierCurveTo(xx + (r() - 0.5) * 6, z0 + 40 * esc, xx + (r() - 0.5) * 6, z0 + 80 * esc, xx + (r() - 0.5) * 4, z0 + 120 * esc);
          g.stroke();
        }
        g.globalAlpha = 0.45; g.fillStyle = '#6d4c2f';
        g.fillRect(x0, z0, 20 * esc, 1.2); g.fillRect(x0, z0, 1.2, 120 * esc);
        g.globalAlpha = 1;
      }
    }
  });
}
function texturaPiso(tamCm, placaCm, base, junta, variacao) {
  return texturaCanvas(tamCm, 1024, (g, px) => {
    const r = aleatorio(11), n = tamCm / placaCm, s = px / n;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      const c = new T.Color(base).offsetHSL(0, 0, (r() - 0.5) * variacao);
      g.fillStyle = `#${c.getHexString()}`; g.fillRect(i * s, j * s, s, s);
    }
    g.strokeStyle = junta; g.lineWidth = Math.max(2, px / 400);
    for (let i = 0; i <= n; i++) {
      g.beginPath(); g.moveTo(i * s, 0); g.lineTo(i * s, px); g.stroke();
      g.beginPath(); g.moveTo(0, i * s); g.lineTo(px, i * s); g.stroke();
    }
  });
}
function texturaCimento() {
  return texturaCanvas(300, 1024, (g, px) => {
    const r = aleatorio(5);
    g.fillStyle = '#b9b6b1'; g.fillRect(0, 0, px, px);
    for (let i = 0; i < 2600; i++) {
      g.globalAlpha = 0.05; g.fillStyle = r() > 0.5 ? '#8f8b85' : '#d6d3ce';
      const s = 6 + r() * 60; g.beginPath(); g.arc(r() * px, r() * px, s, 0, 7); g.fill();
    }
    g.globalAlpha = 1;
  });
}

const MAT = {
  janelaFantasma: new T.MeshBasicMaterial({ color: '#5aa9e6', transparent: true, opacity: 0.22, depthWrite: false }),
  janelaBorda: new T.LineBasicMaterial({ color: '#2f80ed' }),
  janelaFaixa: new T.MeshBasicMaterial({ color: '#2f80ed' }),
  parede: new T.MeshStandardMaterial({ color: '#efe9df', roughness: 0.93 }),
  paredeSel: new T.MeshStandardMaterial({ color: '#cfe0fb', roughness: 0.9, emissive: '#2f80ed', emissiveIntensity: 0.12 }),
  topo: new T.MeshStandardMaterial({ color: '#3f4349', roughness: 0.85 }),
  topoSel: new T.MeshStandardMaterial({ color: '#2f80ed', roughness: 0.6 }),
  laje: new T.MeshStandardMaterial({ color: '#cfcac2', roughness: 1 }),
  teto: new T.MeshStandardMaterial({ color: '#f7f6f3', roughness: 0.95, side: T.DoubleSide }),
  rodape: new T.MeshStandardMaterial({ color: '#f8f7f4', roughness: 0.45 }),
  chao: new T.MeshStandardMaterial({ color: '#e1ded8', roughness: 1 }),
  esquadria: new T.MeshStandardMaterial({ color: '#f1f1ef', roughness: 0.4, metalness: 0.2 }),
  aluminio: new T.MeshStandardMaterial({ color: '#4c5157', roughness: 0.35, metalness: 0.6 }),
  vidro: new T.MeshPhysicalMaterial({ color: '#d6ecf2', roughness: 0.05, transparent: true, opacity: 0.22, depthWrite: false }),
  peitoril: new T.MeshStandardMaterial({ color: '#e4e0d8', roughness: 0.45 }),
  batente: new T.MeshStandardMaterial({ color: '#f5f3ef', roughness: 0.5 }),
  folha: new T.MeshStandardMaterial({ color: '#efebe4', roughness: 0.45 }),
  macaneta: new T.MeshStandardMaterial({ color: '#b8bcc2', roughness: 0.25, metalness: 0.85 }),
  arco: new T.LineBasicMaterial({ color: '#8f959c' }),
  demolida: new T.LineDashedMaterial({ color: '#d0453b', dashSize: 8, gapSize: 6 }),
  demolidaFundo: new T.MeshBasicMaterial({ color: '#d0453b', transparent: true, opacity: 0.1, depthWrite: false }),
  piso: {
    madeira: new T.MeshStandardMaterial({ map: texturaMadeira(), roughness: 0.55 }),
    ceramica: new T.MeshStandardMaterial({ map: texturaPiso(120, 30, '#e7e5e0', '#c9c5be', 0.04), roughness: 0.35 }),
    porcelanato: new T.MeshStandardMaterial({ map: texturaPiso(240, 60, '#dcd6cc', '#bdb5a8', 0.03), roughness: 0.3 }),
    cimento: new T.MeshStandardMaterial({ map: texturaCimento(), roughness: 0.7 }),
  },
};

// Pintura: cada parede pode ter sua cor (painel da parede).
const cacheParede = new Map();
function matParede(cor) {
  if (!cor) return MAT.parede;
  if (!cacheParede.has(cor)) cacheParede.set(cor, new T.MeshStandardMaterial({ color: cor, roughness: 0.93 }));
  return cacheParede.get(cor);
}

// =====================================================================
// 4b. SOL POR DATA E HORA
// =====================================================================
// Posição do sol pelo algoritmo simplificado da NOAA (erro < 1°), para a
// latitude/longitude de doc.planta.local. Data e hora não entram no
// histórico: ficam guardadas à parte, só neste navegador.
const CHAVE_LUZ = `${CFG.prefixo}luz`;
const rad = (g) => (g * Math.PI) / 180, grau = (r) => (r * 180) / Math.PI;
const hojeISO = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const luz = Object.assign({ data: hojeISO(), hora: 8 }, (() => { try { return JSON.parse(localStorage.getItem(CHAVE_LUZ)) || {}; } catch { return {}; } })());

function posicaoSol(dataISO, hora, { lat, lon, fuso }) {
  const [a, m, d] = dataISO.split('-').map(Number);
  const n = (Date.UTC(a, m - 1, d) + (hora - fuso) * 3600e3) / 864e5 + 2440587.5 - 2451545.0;
  const L = 280.46 + 0.9856474 * n, g = rad(357.528 + 0.9856003 * n);
  const lamb = rad(L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g));
  const eps = rad(23.439 - 4e-7 * n);
  const ra = Math.atan2(Math.cos(eps) * Math.sin(lamb), Math.cos(lamb));
  const dec = Math.asin(Math.sin(eps) * Math.sin(lamb));
  const H = rad((18.697374558 + 24.06570982441908 * n) * 15 + lon) - ra, f = rad(lat);
  const elev = Math.asin(Math.sin(f) * Math.sin(dec) + Math.cos(f) * Math.cos(dec) * Math.cos(H));
  const az = Math.atan2(-Math.sin(H), Math.tan(dec) * Math.cos(f) - Math.sin(f) * Math.cos(H));
  return { elev: grau(elev), az: (grau(az) + 360) % 360 }; // az: a partir do norte, sentido horário
}

// Direção na planta (x, z) de um azimute. A parede esquerda olha para -x;
// 'orientacao' diz a que azimute isso corresponde.
function direcaoPlanta(az) {
  const t = rad(az - doc.planta.orientacao);
  return [-Math.cos(t), -Math.sin(t)];
}

function nascerPor(dataISO) {
  let nascer = null, por = null, antes = posicaoSol(dataISO, 0, doc.planta.local).elev;
  for (let min = 5; min <= 1440; min += 5) {
    const e = posicaoSol(dataISO, min / 60, doc.planta.local).elev;
    if (antes < 0 && e >= 0 && nascer == null) nascer = min / 60;
    if (antes >= 0 && e < 0) por = min / 60;
    antes = e;
  }
  return { nascer, por };
}

const PONTOS = ['N', 'NE', 'L', 'SE', 'S', 'SO', 'O', 'NO'];
const pontoCardeal = (az) => PONTOS[Math.round(az / 45) % 8];
const horaTxt = (h) => `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.round((h % 1) * 60)).padStart(2, '0')}`.replace(/:60$/, ':59');
const suave = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

const CEU_DIA = new T.Color('#e9ebee'), CEU_NOITE = new T.Color('#2a303b');
const SOL_BAIXO = new T.Color('#ffb070'), SOL_ALTO = new T.Color('#fff4e4');
function aplicarSol() {
  if (!doc) return;
  const { cx, cz, w, d } = centroPlanta();
  // a área de sombra acompanha o tamanho do projeto (casa grande, sombra inteira)
  const meia = Math.max(w, d) * 0.75 + 150;
  if (Math.abs(sol.shadow.camera.right - meia) > 1) {
    Object.assign(sol.shadow.camera, { left: -meia, right: meia, top: meia, bottom: -meia, far: 3000 + meia });
    sol.shadow.camera.updateProjectionMatrix();
  }
  const { elev, az } = posicaoSol(luz.data, luz.hora, doc.planta.local);
  const [dx, dz] = direcaoPlanta(az);
  const e = rad(Math.max(elev, 2)), dist = 1500;
  sol.target.position.set(cx, 0, cz);
  sol.position.set(cx + dx * Math.cos(e) * dist, Math.sin(e) * dist, cz + dz * Math.cos(e) * dist);
  const dia = suave(-2, 6, elev);                  // 0 à noite, 1 de dia
  sol.intensity = 2.8 * suave(-0.5, 8, elev); // à noite fica em 0 (sumir recompilaria tudo)
  sol.color.copy(SOL_BAIXO).lerp(SOL_ALTO, suave(3, 35, elev));
  hemi.intensity = 0.25 + 0.9 * dia;
  cena.environmentIntensity = 0.1 + 0.35 * dia;
  if (cena.background?.isColor) cena.background.copy(CEU_NOITE).lerp(CEU_DIA, dia);
  // luminárias: acendem quando escurece
  const noite = 1 - suave(-4, 10, elev);
  for (const l of luzesMoveis) l.intensity = l.userData.base * noite;
  for (const mt of matsLuz) mt.emissiveIntensity = 0.05 + 1.4 * noite;
  sujarSombra();
  return { elev, az };
}

// Bússola: seta do norte girando conforme a câmera.
const bussola = document.querySelector('#bussola');
function posicionarBussola() {
  const { cx, cz } = centroPlanta();
  const [nx, nz] = direcaoPlanta(0);
  const a = new T.Vector3(cx, 0, cz).project(camAtiva()), b = new T.Vector3(cx + nx * 100, 0, cz + nz * 100).project(camAtiva());
  const ang = Math.atan2(b.x - a.x, (b.y - a.y) * (palco.clientHeight / palco.clientWidth));
  bussola.querySelector('svg').style.transform = `rotate(${grau(ang)}deg)`;
  const letra = bussola.querySelector('b');
  letra.style.left = `${20 + Math.sin(ang) * 27}px`;
  letra.style.top = `${20 - Math.cos(ang) * 27}px`;
}

// =====================================================================
// 4c. FOTO REALISTA (traçado de raios)
// =====================================================================
// Em vez de desenhar em tempo real, simula o caminho da luz: rebate nas
// paredes, passa pelas janelas e cortinas, reflete no piso e nos metais.
// A imagem começa granulada e limpa a cada passada (amostra). Mexer na
// câmera recomeça. Usa a câmera atual: na órbita é uma maquete sem teto;
// caminhando, é a foto de dentro do projeto, com teto.
const foto = { ativa: false, pt: null, meta: 300, ceu: null, cam: new T.Matrix4(), ultimaUI: 0 };
const ehToque = matchMedia('(pointer: coarse)').matches;

function texturaCeu() {
  // céu simples em equiretangular: horizonte claro, zênite azul, chão escuro
  const w = 256, h = 128, d = new Float32Array(w * h * 4);
  for (let j = 0; j < h; j++) {
    const alt = (j / (h - 1)) * 2 - 1; // -1 = para baixo, 1 = para cima
    let c;
    if (alt >= 0) { const t = Math.pow(alt, 0.45); c = [1.05 - 0.5 * t, 1.07 - 0.32 * t, 1.1 - 0.08 * t]; }
    else c = [0.46, 0.44, 0.4];
    for (let i = 0; i < w; i++) d.set([...c, 1], (j * w + i) * 4);
  }
  const t = new T.DataTexture(d, w, h, T.RGBAFormat, T.FloatType);
  t.mapping = T.EquirectangularReflectionMapping;
  t.magFilter = t.minFilter = T.LinearFilter;
  t.needsUpdate = true;
  return t;
}

function luzDaFoto() {
  const { elev } = aplicarSol();
  const dia = suave(-2, 6, elev);
  cena.environmentIntensity = 0.04 + 1.15 * dia;
  cena.backgroundIntensity = cena.environmentIntensity;
}

// Cópia da cena só com o que aparece na foto: um material por objeto
// (o traçado de raios embaralha objetos com vários materiais), sem
// marcações, linhas e camadas de seleção.
function montarCenaFoto() {
  const c = new T.Scene();
  c.environment = foto.ceu;
  c.background = foto.ceu;
  c.environmentIntensity = cena.environmentIntensity;
  c.backgroundIntensity = cena.backgroundIntensity;
  const visivel = (o) => { for (let x = o; x; x = x.parent) if (!x.visible) return false; return true; };
  cena.updateMatrixWorld(true);
  cena.traverse((o) => {
    if (!visivel(o)) return;
    if (o.isMesh) {
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      if (mats.some((m) => m.isMeshBasicMaterial)) return;
      let geo = o.geometry;
      if (Array.isArray(o.material)) { geo = geo.clone(); geo.clearGroups(); foto.descartar.push(geo); }
      const m = new T.Mesh(geo, mats[0]);
      m.matrixAutoUpdate = false;
      m.matrix.copy(o.matrixWorld);
      m.matrixWorld.copy(o.matrixWorld);
      c.add(m);
    } else if (o.isPointLight && o.intensity > 0.01) {
      const l = new T.PointLight(o.color, o.intensity, o.distance, o.decay);
      l.position.setFromMatrixPosition(o.matrixWorld);
      c.add(l);
    }
  });
  if (sol.visible && sol.intensity > 0.01) {
    const s2 = new T.DirectionalLight(sol.color, sol.intensity);
    s2.position.copy(sol.position);
    s2.target.position.copy(sol.target.position);
    c.add(s2, s2.target);
  }
  c.updateMatrixWorld(true);
  return c;
}

// Passo 1: escolher onde e quando. Passo 2: revelar (a câmera fica parada,
// atrás de uma prévia desfocada, para nada recomeçar sem querer).
// Passo 3: a foto pronta aparece como imagem, com luz e Salvar.
const HORAS_FOTO = [['Manhã', 8], ['Meio-dia', 12], ['Fim de tarde', 17], ['Noite', 20]];
const escolhaFoto = { onde: null, hora: null };

function abrirFoto() {
  if (foto.ativa) fecharFoto();
  const vistas = vistasVisita();
  const daqui = vista.caminhar ? 'Daqui' : 'Vista atual (maquete)';
  if (!escolhaFoto.onde || (escolhaFoto.onde !== daqui && !vistas.some((v) => v.nome === escolhaFoto.onde))) {
    escolhaFoto.onde = vista.caminhar ? daqui : (vistas.find((v) => v.nome === vistaAtual) || vistas[0])?.nome ?? daqui;
  }
  escolhaFoto.hora ??= luz.hora;
  const desenhar = () => {
    const onde = $('#fotoOnde'), quando = $('#fotoQuando');
    onde.textContent = ''; quando.textContent = '';
    for (const n of [daqui, ...vistas.map((v) => v.nome)]) {
      onde.append(botao(n, () => { escolhaFoto.onde = n; desenhar(); }, { class: escolhaFoto.onde === n ? 'ativo' : '' }));
    }
    const horas = HORAS_FOTO.some(([, h]) => h === luz.hora) ? HORAS_FOTO : [[`Agora ${horaTxt(luz.hora)}`, luz.hora], ...HORAS_FOTO];
    for (const [n, h] of horas) {
      quando.append(botao(n, () => { escolhaFoto.hora = h; desenhar(); }, { class: escolhaFoto.hora === h ? 'ativo' : '' }));
    }
  };
  desenhar();
  $('#fotoMenu').hidden = false;
}

function fotografar() {
  $('#fotoMenu').hidden = true;
  const v = vistasVisita().find((x) => x.nome === escolhaFoto.onde);
  if (vista.topo) alternarVista();
  if (sel) selecionar(null);
  if (v) {
    cancelAnimationFrame(animarVista.id);
    if (!vista.caminhar) alternarCaminhada();
    Object.assign(andar, { x: v.x, z: v.z, yaw: v.yaw, pitch: v.pitch });
    aplicarCameraAndar();
    vistaAtual = v.nome;
  }
  luz.hora = escolhaFoto.hora;
  try { localStorage.setItem(CHAVE_LUZ, JSON.stringify(luz)); } catch { /* ok */ }
  aplicarSol();
  // prévia: o quadro normal, desfocado atrás do aviso de progresso; também
  // serve de guia para limpar o granulado no fim (bordas e cores nítidas)
  grpSel.visible = grpZonas.visible = false;
  desenharQuadro();
  foto.guia = lerCanvas();
  $('#fotoPrevia').src = renderer.domElement.toDataURL('image/jpeg', 0.7);
  foto.antes = { env: cena.environment, bg: cena.background, envI: cena.environmentIntensity };
  foto.ceu ??= texturaCeu();
  cena.environment = foto.ceu;
  cena.background = foto.ceu;
  hemi.visible = false;              // o céu faz esse papel no traçado de raios
  grpSel.visible = grpZonas.visible = false;
  luzDaFoto();
  if (!foto.pt) {
    foto.pt = new T.WebGLPathTracer(renderer);
    Object.assign(foto.pt, { minSamples: 0, renderDelay: 0, fadeDuration: 0, bounces: 6, filterGlossyFactor: 0.5 });
    foto.pt.tiles.set(2, 2);
  }
  foto.pt.renderScale = ehToque ? 0.6 : 1;
  foto.meta = ehToque ? 140 : 260;
  // interior pede mais exposição que a maquete vista de fora
  renderer.toneMappingExposure = vista.caminhar ? 2.6 : 1.1;
  foto.ativa = true;
  foto.pronta = false;
  document.body.classList.add('modo-foto');
  $('#fotoPronta').hidden = true;
  $('#fotoRevelando').hidden = false;
  $('#fotoBarra').style.width = '0';
  $('#fotoStatus').textContent = 'Preparando a cena… (pode travar alguns segundos)';
  $('#fotoJa').disabled = true;
  // deixa o aviso aparecer antes do trabalho pesado (montar a cena para os raios)
  setTimeout(() => {
    if (!foto.ativa) return;
    camAtiva().updateMatrixWorld();
    foto.descartar = [];
    foto.cena = montarCenaFoto();
    foto.pt.setScene(foto.cena, camPersp);
    foto.t0 = performance.now();
    foto.t1 = 0;
  }, 80);
}

function quadroFoto() {
  if (!foto.t0 || foto.pronta) return;
  const n = foto.pt.samples;
  if (n < foto.meta) foto.pt.renderSample();
  else { terminarFoto(); return; }
  const agora = performance.now();
  if (n >= 1 && !foto.t1) foto.t1 = agora; // a primeira passada inclui compilar os shaders
  if (agora - foto.ultimaUI > 300) {
    foto.ultimaUI = agora;
    $('#fotoBarra').style.width = `${Math.min(1, n / foto.meta) * 100}%`;
    $('#fotoJa').disabled = n < 8;
    if (n < 1) { $('#fotoStatus').textContent = 'Preparando a luz…'; return; }
    const ritmo = (agora - foto.t1) / Math.max(1, n - 1);
    const falta = Math.max(1, Math.round(((foto.meta - n) * ritmo) / 1000));
    $('#fotoStatus').textContent = n < 4 ? 'Calculando a luz…' : `${Math.round((n / foto.meta) * 100)}% · faltam ~${falta < 60 ? `${falta} s` : `${Math.ceil(falta / 60)} min`}`;
  }
}

// lê o canvas do 3D (logo depois de desenhar, no mesmo instante)
function lerCanvas(w, h) {
  const src = renderer.domElement;
  w ??= src.width; h ??= src.height;
  const c = Object.assign(document.createElement('canvas'), { width: w, height: h });
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(src, 0, 0, w, h);
  return g.getImageData(0, 0, w, h);
}

// Tira o granulado: média dos vizinhos que, na imagem normal (guia), têm a
// mesma cor, ou seja, são da mesma superfície. Assim as bordas continuam
// nítidas. Com poucas passadas, o raio é maior.
function limparGranulado(img, guia, raio) {
  const { width: W, height: H, data: a } = img, b = guia.data, out = new Uint8ClampedArray(a.length);
  const passo = raio > 3 ? 2 : 1, offs = [];
  for (let dy = -raio; dy <= raio; dy += passo) for (let dx = -raio; dx <= raio; dx += passo) {
    offs.push(dx, dy, Math.exp(-(dx * dx + dy * dy) / (2 * (raio / 1.6) ** 2)));
  }
  const tab = new Float32Array(1024); // peso pela diferença de cor da guia
  for (let i = 0; i < 1024; i++) tab[i] = Math.exp(-(i * 16) / (2 * 14 * 14));
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4, gr = b[i], gg = b[i + 1], gb = b[i + 2];
    let sr = 0, sg = 0, sb = 0, sw = 0;
    for (let k = 0; k < offs.length; k += 3) {
      const xx = x + offs[k], yy = y + offs[k + 1];
      if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
      const j = (yy * W + xx) * 4;
      const d = ((b[j] - gr) ** 2 + (b[j + 1] - gg) ** 2 + (b[j + 2] - gb) ** 2) >> 4;
      if (d >= 1024) continue;
      const w = offs[k + 2] * tab[d];
      sr += a[j] * w; sg += a[j + 1] * w; sb += a[j + 2] * w; sw += w;
    }
    out[i] = sr / sw; out[i + 1] = sg / sw; out[i + 2] = sb / sw; out[i + 3] = 255;
  }
  return new ImageData(out, W, H);
}

// mostra o resultado como imagem (é ela que se salva)
function mostrarFoto() {
  foto.pt.renderSample();
  let img = lerCanvas();
  const n = foto.pt.samples;
  const raio = n < 24 ? 8 : n < 80 ? 4 : n < 200 ? 3 : 2;
  if (foto.guia && foto.guia.width === img.width && foto.guia.height === img.height) img = limparGranulado(img, foto.guia, raio);
  const c = Object.assign(document.createElement('canvas'), { width: img.width, height: img.height });
  c.getContext('2d').putImageData(img, 0, 0);
  $('#fotoImg').src = c.toDataURL('image/jpeg', 0.92);
}

// exposição automática: ajusta até o brilho médio ficar agradável
function autoExposicao() {
  for (let k = 0; k < 3; k++) {
    foto.pt.renderSample();
    const d = lerCanvas(48, 48).data;
    let soma = 0;
    for (let i = 0; i < d.length; i += 4) soma += (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255;
    const media = soma / (d.length / 4);
    const f = Math.min(3, Math.max(0.5, (0.46 / Math.max(media, 0.02)) ** 1.5));
    if (Math.abs(f - 1) < 0.08) break;
    renderer.toneMappingExposure = Math.min(8, Math.max(0.3, renderer.toneMappingExposure * f));
  }
}

function terminarFoto() {
  if (!foto.ativa || !foto.t0 || foto.pronta) return;
  foto.pronta = true;
  $('#fotoStatus').textContent = 'Finalizando…';
  setTimeout(() => {
    autoExposicao();
    mostrarFoto();
    $('#fotoRevelando').hidden = true;
    $('#fotoPronta').hidden = false;
  }, 30);
}

function luzFoto(fator) {
  if (!foto.pronta) return;
  renderer.toneMappingExposure = Math.min(6, Math.max(0.3, renderer.toneMappingExposure * fator));
  mostrarFoto();
}

function fecharFoto() {
  $('#fotoMenu').hidden = true;
  if (!foto.ativa) return;
  foto.ativa = false;
  foto.pronta = false;
  foto.t0 = 0;
  for (const g of foto.descartar || []) g.dispose();
  foto.descartar = [];
  foto.cena = null;
  foto.guia = null;
  document.body.classList.remove('modo-foto');
  $('#fotoRevelando').hidden = true;
  $('#fotoPronta').hidden = true;
  $('#fotoImg').removeAttribute('src');
  cena.environment = foto.antes.env;
  cena.background = foto.antes.bg;
  hemi.visible = true;
  grpSel.visible = grpZonas.visible = true;
  renderer.toneMappingExposure = 1;
  aplicarSol();
  ctlPersp.enabled = !vista.caminhar && !vista.topo;
  atualizarBotoes();
  renderVistas();
}

async function salvarFoto() {
  const src = $('#fotoImg').src;
  if (!src) return;
  const nome = `${slug(doc.nome)}-${slug(escolhaFoto.onde || cen().nome)}-${horaTxt(luz.hora).replace(':', 'h')}.jpg`;
  const blob = await (await fetch(src)).blob();
  // no celular, "Compartilhar" tem "Salvar imagem" (vai para as Fotos)
  const arquivo = new File([blob], nome, { type: 'image/jpeg' });
  if (ehToque && navigator.canShare?.({ files: [arquivo] })) {
    try { await navigator.share({ files: [arquivo] }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  baixar(blob, nome);
}

// =====================================================================
// 5. PAREDES, ABERTURAS E PISOS
// =====================================================================
const grpPlanta = new T.Group();
const grpMoveis = new T.Group();
const grpSel = new T.Group();
cena.add(grpPlanta, grpMoveis, grpSel);

function limpar(grp) {
  grp.traverse((o) => { if (o.geometry && !o.userData.compartilhado) o.geometry.dispose(); });
  grp.clear();
}

function caixa(l, a, p, mat, x, y, z, info) {
  const m = new T.Mesh(new T.BoxGeometry(l, a, p), mat);
  m.position.set(x, y, z);
  m.castShadow = mat !== MAT.vidro;
  m.receiveShadow = true;
  if (info) m.userData = info;
  return m;
}

function construirPlanta() {
  sujarSombra();
  limpar(grpPlanta);
  portasGiro.clear();
  const pl = doc.planta;
  const H = pl.alturaParede;
  const Hc = vista.corte && !vista.caminhar ? Math.min(H, CFG.alturaCorte) : H;

  // chão externo e laje sob as paredes
  const { cx, cz } = centroPlanta();
  const chao = new T.Mesh(new T.PlaneGeometry(12000, 12000), MAT.chao);
  chao.rotation.x = -Math.PI / 2; chao.position.set(cx, -2, cz);
  grpPlanta.add(chao);
  if (pl.contorno.length) grpPlanta.add(malhaPoligono(deslocar(pl.contorno, pl, true), MAT.laje, -0.4));

  for (const amb of pl.ambientes) {
    const m = malhaPoligono(poligonoUtil(amb), amb.vazio ? MAT.laje : MAT.piso[amb.piso] || MAT.piso.madeira, amb.vazio ? -0.2 : 0);
    m.userData = { tipo: 'ambiente', id: amb.id };
    grpPlanta.add(m);
  }
  for (const w of pl.paredes) grpPlanta.add(w.demolida ? paredeDemolida(w) : construirParede(w, pl, H, Hc));
  if (vista.caminhar && pl.contorno.length) { // teto, para a luz entrar só pelas janelas
    const teto = malhaPoligono(deslocar(pl.contorno, pl, true), MAT.teto, H);
    teto.castShadow = true;
    grpPlanta.add(teto);
  }
  for (const f of EXTENSOES.aposPlanta) f(grpPlanta, pl);
  montarRotulos();
}

function malhaPoligono(pts, mat, y) {
  const s = new T.Shape(pts.map(([x, z]) => new T.Vector2(x, -z)));
  const g = new T.ShapeGeometry(s);
  g.rotateX(-Math.PI / 2);
  const m = new T.Mesh(g, mat);
  m.position.y = y;
  m.receiveShadow = true;
  return m;
}

// Cada parede vira um grupo no sistema local: u ao longo da parede
// (0 = início), v atravessando a espessura, y para cima.
function grupoParede(w) {
  const g = new T.Group();
  g.position.set(w.x1, 0, w.z1);
  g.rotation.y = horizontal(w) ? 0 : -Math.PI / 2;
  return g;
}

function construirParede(w, pl, H, Hc) {
  const g = grupoParede(w);
  const selec = sel?.tipo === 'parede' && sel.id === w.id;
  const info = { tipo: 'parede', id: w.id };
  const lado = selec ? MAT.paredeSel : matParede(w.cor);
  const L = comprimento(w), e = w.esp;
  const peca = (u0, u1, y0, y1) => {
    y1 = Math.min(y1, Hc);
    if (u1 - u0 < 0.1 || y1 - y0 < 0.1) return;
    const topo = y1 >= Hc - 0.1 ? (selec ? MAT.topoSel : MAT.topo) : lado;
    const m = new T.Mesh(new T.BoxGeometry(u1 - u0, y1 - y0, e), [lado, lado, topo, lado, lado, lado]);
    m.position.set((u0 + u1) / 2, (y0 + y1) / 2, 0);
    m.castShadow = m.receiveShadow = true;
    m.userData = info;
    g.add(m);
    if (y0 === 0 && Hc > 8) { // rodapé
      const r = new T.Mesh(new T.BoxGeometry(u1 - u0, 7, e + 1.6), MAT.rodape);
      r.position.set((u0 + u1) / 2, 3.5, 0);
      r.receiveShadow = true;
      r.userData = info;
      g.add(r);
    }
  };
  const aberturas = pl.aberturas.filter((a) => a.parede === w.id).sort((a, b) => a.pos - b.pos);
  let u = -e / 2;
  for (const ab of aberturas) {
    peca(u, ab.pos, 0, H);
    if (ab.tipo === 'janela') peca(ab.pos, ab.pos + ab.largura, 0, ab.peitoril);
    const topoVao = ab.tipo === 'janela' ? ab.peitoril + ab.altura : ab.altura;
    peca(ab.pos, ab.pos + ab.largura, topoVao, H);
    construirAbertura(g, ab, w, Hc, { tipo: 'parede', id: w.id, abertura: ab.id });
    u = ab.pos + ab.largura;
  }
  peca(u, L + e / 2, 0, H);
  return g;
}

// Folhas das portas (para abrir e fechar na simulação de uso).
// 1 = aberta (como no desenho da planta), 0 = fechada.
const portasGiro = new Map();
const estadoPortas = new Map();
function porta(id, k) {
  estadoPortas.set(id, k);
  const p = portasGiro.get(id);
  if (p) p.piv.rotation.y = (1 - k) * p.fechada;
}

function construirAbertura(g, ab, w, Hc, info) {
  const e = w.esp, u0 = ab.pos, L = ab.largura;
  const add = (l, a, p, mat, x, y, z) => {
    const y0 = y - a / 2, y1 = Math.min(y + a / 2, Hc);
    if (y1 - y0 < 0.1) return;
    g.add(caixa(l, y1 - y0, p, mat, x, (y0 + y1) / 2, z, info));
  };
  if (ab.tipo === 'janela') {
    const y0 = ab.peitoril, h = ab.altura, pf = 5;
    add(L + 6, 3, e + 6, MAT.peitoril, u0 + L / 2, y0 - 1.5, 0);
    add(pf, h, 7, MAT.esquadria, u0 + pf / 2, y0 + h / 2, 0);
    add(pf, h, 7, MAT.esquadria, u0 + L - pf / 2, y0 + h / 2, 0);
    add(L, pf, 7, MAT.esquadria, u0 + L / 2, y0 + h - pf / 2, 0);
    add(L, pf, 7, MAT.esquadria, u0 + L / 2, y0 + pf / 2, 0);
    add(4, h - 2 * pf, 5, MAT.esquadria, u0 + L / 2, y0 + h / 2, 0);
    add(L / 2 - pf, h - 2 * pf, 0.8, MAT.vidro, u0 + L / 4 + pf / 4, y0 + h / 2, -1.5);
    add(L / 2 - pf, h - 2 * pf, 0.8, MAT.vidro, u0 + (3 * L) / 4 - pf / 4, y0 + h / 2, 1.5);
    // paredes cortadas ou vista de cima: a janela aparece como vidro azul na
    // altura real e numa faixa azul no topo da parede (como na planta baixa)
    if (Hc < y0 + h || vista.topo) {
      const fant = new T.Mesh(new T.BoxGeometry(L, h, e + 2), MAT.janelaFantasma);
      fant.position.set(u0 + L / 2, y0 + h / 2, 0);
      fant.userData = info;
      g.add(fant);
      const borda = new T.LineSegments(new T.EdgesGeometry(fant.geometry), MAT.janelaBorda);
      borda.position.copy(fant.position);
      g.add(borda);
      const faixa = new T.Mesh(new T.BoxGeometry(L, 1.2, e + 1), MAT.janelaFaixa);
      faixa.position.set(u0 + L / 2, Math.min(Hc, vista.topo ? 9999 : Hc) + 0.7, 0);
      faixa.userData = info;
      g.add(faixa);
    }
  } else if (ab.tipo === 'porta') {
    const h = ab.altura, bt = 3, lado = ab.lado === -1 ? -1 : 1;
    add(bt, h, e + 2, MAT.batente, u0 + bt / 2, h / 2, 0);
    add(bt, h, e + 2, MAT.batente, u0 + L - bt / 2, h / 2, 0);
    add(L, bt, e + 2, MAT.batente, u0 + L / 2, h - bt / 2, 0);
    // folha aberta a 90°, encostada na face da parede do lado em que abre
    const R = L - 2 * bt, noInicio = ab.dobradica !== 'fim';
    const uh = noInicio ? u0 + bt : u0 + L - bt, sU = noInicio ? 1 : -1, v0 = (lado * e) / 2;
    const hf = h - bt - 1;
    // a folha gira em torno da dobradiça: aberta (padrão) ou fechada no vão
    const piv = new T.Group();
    piv.position.set(uh, 0, v0);
    g.add(piv);
    const yf1 = Math.min(hf + 0.5, Hc);
    if (yf1 > 1) piv.add(caixa(3.5, yf1 - 0.5, R, MAT.folha, sU * 1.75, (yf1 + 0.5) / 2, (lado * R) / 2, info));
    if (Hc > 105) {
      const mc = new T.Mesh(new T.CylinderGeometry(1, 1, 12, 10), MAT.macaneta);
      mc.rotation.z = Math.PI / 2;
      mc.position.set(sU * 1.75, 105, lado * (R - 6));
      piv.add(mc);
    }
    portasGiro.set(ab.id, { piv, fechada: sU * lado * (Math.PI / 2) });
    piv.rotation.y = (1 - (estadoPortas.get(ab.id) ?? 1)) * sU * lado * (Math.PI / 2);
    const arco = [];
    for (let i = 0; i <= 24; i++) {
      const t = (i / 24) * (Math.PI / 2);
      arco.push(new T.Vector3(uh + sU * R * Math.cos(t), 0.4, v0 + lado * R * Math.sin(t)));
    }
    g.add(new T.Line(new T.BufferGeometry().setFromPoints(arco), MAT.arco));
  } else if (ab.tipo === 'correr') {
    const h = ab.altura, pf = 5, meio = L / 2;
    add(L, 1, e, MAT.aluminio, u0 + L / 2, 0.5, 0);
    add(pf, h, e, MAT.aluminio, u0 + pf / 2, h / 2, 0);
    add(pf, h, e, MAT.aluminio, u0 + L - pf / 2, h / 2, 0);
    add(L, pf, e, MAT.aluminio, u0 + L / 2, h - pf / 2, 0);
    for (const [ini, v] of [[u0 + pf, -2], [u0 + meio - 3, 2]]) {
      const lf = meio - pf + 3, hf = h - 2 * pf;
      add(4, hf, 3, MAT.aluminio, ini + 2, pf + hf / 2, v);
      add(4, hf, 3, MAT.aluminio, ini + lf - 2, pf + hf / 2, v);
      add(lf, 4, 3, MAT.aluminio, ini + lf / 2, pf + 2, v);
      add(lf, 4, 3, MAT.aluminio, ini + lf / 2, pf + hf - 2, v);
      add(lf - 8, hf - 8, 0.8, MAT.vidro, ini + lf / 2, pf + hf / 2, v);
    }
  }
}

// Parede derrubada: só um contorno tracejado no piso, clicável.
function paredeDemolida(w) {
  const g = grupoParede(w);
  const L = comprimento(w), e = w.esp, info = { tipo: 'parede', id: w.id };
  const fundo = new T.Mesh(new T.PlaneGeometry(L + e, e), MAT.demolidaFundo);
  fundo.rotation.x = -Math.PI / 2; fundo.position.set(L / 2, 0.3, 0); fundo.userData = info;
  const pts = [[-e / 2, -e / 2], [L + e / 2, -e / 2], [L + e / 2, e / 2], [-e / 2, e / 2], [-e / 2, -e / 2]]
    .map(([u, v]) => new T.Vector3(u, 0.5, v));
  const linha = new T.Line(new T.BufferGeometry().setFromPoints(pts), MAT.demolida);
  linha.computeLineDistances();
  g.add(fundo, linha);
  return g;
}

// Rótulos de área sobre cada ambiente (HTML sobre o canvas).
const camadaRotulos = $('#rotulos');
let rotulos = [];
function montarRotulos() {
  camadaRotulos.textContent = '';
  rotulos = doc.planta.ambientes.map((amb) => {
    const util = poligonoUtil(amb);
    const [x, z] = centroRotulo(util);
    const div = document.createElement('div');
    div.className = 'rotulo' + (sel?.tipo === 'ambiente' && sel.id === amb.id ? ' ativo' : '');
    div.innerHTML = `<b></b><span></span>`;
    const area = amb.vazio ? 'vazio' : m2(areaUtil(amb));
    div.querySelector('b').textContent = amb.nome;
    div.querySelector('span').textContent = area;
    camadaRotulos.append(div);
    return { div, pos: new T.Vector3(x, 1, z), id: amb.id, nome: amb.nome, area };
  });
  // janelas: etiqueta azul junto de cada uma, com largura × altura
  const { cx, cz } = centroPlanta();
  for (const ab of doc.planta.aberturas.filter((a) => a.tipo === 'janela')) {
    const w = parede(ab.parede);
    if (!w || w.demolida) continue;
    const u = ab.pos + ab.largura / 2, hz = horizontal(w);
    let x = hz ? w.x1 + u : w.x1, z = hz ? w.z1 : w.z1 + u;
    if (hz) z += Math.sign(cz - z) * 30; else x += Math.sign(cx - x) * 30; // para dentro
    const div = document.createElement('div');
    div.className = 'rotulo janela';
    div.textContent = `Janela ${fmt(ab.largura)} × ${fmt(ab.altura)}`;
    camadaRotulos.append(div);
    rotulos.push({ div, pos: new T.Vector3(x, ab.peitoril + ab.altura / 2, z) });
  }
}
function posicionar(lista) {
  const w = palco.clientWidth, h = palco.clientHeight, v = new T.Vector3();
  for (const r of lista) {
    v.copy(r.pos).project(camAtiva());
    const vis = !vista.caminhar && v.z < 1 && Math.abs(v.x) < 1.2 && Math.abs(v.y) < 1.2;
    r.el ??= r.div;
    r.el.style.display = vis ? '' : 'none';
    r.el.style.transform = `translate(${((v.x + 1) / 2) * w}px, ${((1 - v.y) / 2) * h}px)${r.canto ? '' : ' translate(-50%, -50%)'}`;
  }
}
const posicionarRotulos = () => posicionar(rotulos);

// =====================================================================
// 6. MÓVEIS
// =====================================================================
// Cada móvel do catálogo é montado a partir de formas (caixa, cilindro,
// esfera, torno). Peças com 'mov' se mexem conforme m.aberto (0 a 1):
// portas giram, gavetas deslizam, persianas enrolam. As peças fixas são
// fundidas por material para o celular desenhar menos objetos.
const objMovel = new Map();   // id do móvel → THREE.Group
const modelos = new Map();    // id do modelo .glb → { cena, tam, centro, base }
let luzesMoveis = [];         // luminárias acesas à noite

// ---- texturas de detalhe (cinza, tingidas pela cor da peça)
function texturaDetalhe(tileCm, px, desenhar) {
  const c = document.createElement('canvas');
  c.width = c.height = px;
  const g = c.getContext('2d');
  desenhar(g, px, aleatorio(px + tileCm));
  const t = new T.CanvasTexture(c);
  t.wrapS = t.wrapT = T.RepeatWrapping;
  t.repeat.set(100 / tileCm, 100 / tileCm); // as coordenadas de textura das peças são em metros
  t.colorSpace = T.SRGBColorSpace;
  t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return t;
}
const GERADORES = {
  madeira: () => texturaDetalhe(70, 512, (g, px, r) => {
    g.fillStyle = '#d9d9d9'; g.fillRect(0, 0, px, px);
    for (let k = 0; k < 140; k++) {
      const y = r() * px, esc = r() > 0.5;
      g.strokeStyle = esc ? `rgba(70,50,30,${0.05 + r() * 0.12})` : `rgba(255,255,255,${0.04 + r() * 0.08})`;
      g.lineWidth = 0.6 + r() * 2.4;
      g.beginPath(); g.moveTo(0, y);
      for (let x = 0; x <= px; x += 32) g.lineTo(x, y + Math.sin(x / 90 + k) * (2 + r() * 3));
      g.stroke();
    }
  }),
  tecido: () => texturaDetalhe(4, 128, (g, px, r) => {
    for (let y = 0; y < px; y += 2) for (let x = 0; x < px; x += 2) {
      const v = 205 + (((x + y) / 2) % 2 ? 22 : 0) + r() * 18;
      g.fillStyle = `rgb(${v},${v},${v})`; g.fillRect(x, y, 2, 2);
    }
  }),
  boucle: () => texturaDetalhe(9, 256, (g, px, r) => {
    g.fillStyle = '#d0d0d0'; g.fillRect(0, 0, px, px);
    for (let k = 0; k < 2600; k++) {
      const v = 170 + r() * 85; g.fillStyle = `rgb(${v},${v},${v})`;
      g.beginPath(); g.arc(r() * px, r() * px, 1.5 + r() * 3.5, 0, 7); g.fill();
    }
  }),
  couro: () => texturaDetalhe(30, 256, (g, px, r) => {
    g.fillStyle = '#d6d6d6'; g.fillRect(0, 0, px, px);
    for (let k = 0; k < 5000; k++) { const v = 185 + r() * 60; g.fillStyle = `rgba(${v},${v},${v},.5)`; g.fillRect(r() * px, r() * px, 1.5, 1.5); }
  }),
  marmore: () => texturaDetalhe(110, 512, (g, px, r) => {
    g.fillStyle = '#f2f2f2'; g.fillRect(0, 0, px, px);
    for (let k = 0; k < 16; k++) {
      g.strokeStyle = `rgba(110,110,115,${0.08 + r() * 0.25})`; g.lineWidth = 0.6 + r() * 2.5;
      g.beginPath(); let x = r() * px, y = 0; g.moveTo(x, y);
      while (y < px) { x += (r() - 0.45) * 40; y += 20 + r() * 30; g.lineTo(x, y); }
      g.stroke();
    }
  }),
  granito: () => texturaDetalhe(40, 256, (g, px, r) => {
    g.fillStyle = '#9a9a9a'; g.fillRect(0, 0, px, px);
    for (let k = 0; k < 7000; k++) { const v = r() * 255; g.fillStyle = `rgb(${v},${v},${v})`; g.fillRect(r() * px, r() * px, 1 + r() * 2, 1 + r() * 2); }
  }),
  palha: () => texturaDetalhe(6, 128, (g, px) => {
    g.fillStyle = '#cfcfcf'; g.fillRect(0, 0, px, px);
    g.strokeStyle = '#8f8f8f'; g.lineWidth = 3;
    for (let k = -px; k < px * 2; k += 16) {
      g.beginPath(); g.moveTo(k, 0); g.lineTo(k + px, px); g.stroke();
      g.beginPath(); g.moveTo(k, px); g.lineTo(k + px, 0); g.stroke();
    }
  }),
  azulejo: () => texturaDetalhe(30, 512, (g, px, r) => {
    const h = px / 4, w = px / 2;
    for (let lin = 0; lin < 4; lin++) for (let col = -1; col < 3; col++) {
      const v = 228 + r() * 20; g.fillStyle = `rgb(${v},${v},${v})`;
      g.fillRect(col * w + (lin % 2) * w / 2, lin * h, w, h);
    }
    g.strokeStyle = '#a8a39b'; g.lineWidth = 4;
    for (let lin = 0; lin <= 4; lin++) { g.beginPath(); g.moveTo(0, lin * h); g.lineTo(px, lin * h); g.stroke(); }
    for (let lin = 0; lin < 4; lin++) for (let col = 0; col <= 2; col++) {
      const x = col * w + (lin % 2) * w / 2; g.beginPath(); g.moveTo(x, lin * h); g.lineTo(x, lin * h + h); g.stroke();
    }
  }),
  // ---- revestimentos e tecidos estampados
  granilite: () => texturaDetalhe(40, 512, (g, px, r) => {
    g.fillStyle = '#f1efea'; g.fillRect(0, 0, px, px);
    const tons = ['#8d8a85', '#2f2f31', '#b9b4aa', '#d7d2c8', '#6f6b66', '#c9b9a0'];
    for (let k = 0; k < 2600; k++) {
      g.fillStyle = tons[Math.floor(r() * tons.length)];
      const s = 1 + r() * (r() > 0.9 ? 6 : 2.5);
      g.beginPath(); g.ellipse(r() * px, r() * px, s, s * (0.5 + r() * 0.6), r() * 3, 0, 7); g.fill();
    }
  }),
  azulejo_grade: () => texturaDetalhe(30, 512, (g, px) => {
    const n = 3, s = px / n; // 3 × 3 peças de 10 cm
    g.fillStyle = '#b5b0a8'; g.fillRect(0, 0, px, px);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { g.fillStyle = (i + j) % 2 ? '#f7f6f2' : '#f4f3ef'; g.fillRect(i * s + 3, j * s + 3, s - 6, s - 6); }
  }),
  xadrez: () => texturaDetalhe(4, 128, (g, px) => { // gingham (vichy)
    g.fillStyle = '#f2f2f2'; g.fillRect(0, 0, px, px);
    g.fillStyle = 'rgba(40,40,40,.55)'; g.fillRect(0, 0, px / 2, px); g.fillRect(0, 0, px, px / 2);
  }),
  canelado: () => texturaDetalhe(6, 128, (g, px) => { // estofado com gomos verticais
    const grad = g.createLinearGradient(0, 0, px, 0);
    grad.addColorStop(0, '#9a9a9a'); grad.addColorStop(0.5, '#f0f0f0'); grad.addColorStop(1, '#9a9a9a');
    g.fillStyle = grad; g.fillRect(0, 0, px, px);
  }),
  tweed: () => texturaDetalhe(5, 128, (g, px, r) => {
    for (let y = 0; y < px; y += 2) for (let x = 0; x < px; x += 2) {
      const t = r(); g.fillStyle = t > 0.7 ? '#f0f0f0' : t > 0.35 ? '#a8a8a8' : '#5c5c5c'; g.fillRect(x, y, 2, 2);
    }
  }),
  papel: () => texturaDetalhe(12, 128, (g, px) => {
    g.fillStyle = '#f2f2f2'; g.fillRect(0, 0, px, px);
    g.strokeStyle = 'rgba(120,120,120,.35)'; g.lineWidth = 3;
    for (let y = 8; y < px; y += 21) { g.beginPath(); g.moveTo(0, y); g.lineTo(px, y); g.stroke(); }
  }),
};
const TEX = {};
const tex = (nome) => (TEX[nome] ??= GERADORES[nome]());

// Acabamentos: como cada material reage à luz.
const ACAB = {
  padrao:   { roughness: 0.7 },
  tecido:   { roughness: 0.95, tex: 'tecido', bump: 0.5 },
  linho:    { roughness: 0.93, tex: 'tecido', bump: 0.9 },
  veludo:   { fisico: true, roughness: 0.8, sheen: 1, sheenRoughness: 0.3, tex: 'tecido', bump: 0.1 },
  boucle:   { roughness: 1, tex: 'boucle', bump: 2 },
  couro:    { roughness: 0.45, tex: 'couro', bump: 0.4 },
  blackout: { roughness: 0.95, tex: 'tecido', bump: 0.3 },
  voil:     { roughness: 0.9, transparent: true, opacity: 0.5, depthWrite: false, sombra: false, lados: 2 },
  madeira:  { roughness: 0.55, tex: 'madeira', bump: 0.12 },
  palha:    { roughness: 0.8, tex: 'palha', bump: 1.2 },
  laca:     { roughness: 0.28 },
  metal:    { roughness: 0.3, metalness: 0.8 },
  espelho:  { roughness: 0.02, metalness: 1 },
  vidro:    { fisico: true, roughness: 0.04, transparent: true, opacity: 0.25, depthWrite: false, sombra: false },
  tela:     { roughness: 0.12, metalness: 0.3 },
  pedra:    { roughness: 0.35, tex: 'granito' },
  marmore:  { roughness: 0.18, tex: 'marmore' },
  ceramica: { roughness: 0.16 },
  azulejo:  { roughness: 0.22, tex: 'azulejo' },
  planta:   { roughness: 0.55, lados: 2 },
  luz:      { roughness: 0.6, luz: true, lados: 2 },
  granilite: { roughness: 0.28, tex: 'granilite' },
  azulejo_grade: { roughness: 0.18, tex: 'azulejo_grade' },
  xadrez:   { roughness: 0.92, tex: 'xadrez', bump: 0.15 },
  canelado: { roughness: 0.92, tex: 'canelado', bump: 3 },
  tweed:    { roughness: 0.95, tex: 'tweed', bump: 0.8 },
  papel:    { roughness: 0.85, tex: 'papel', luz: true, lados: 2 },
};
const NOMES_ACAB = {
  linho: 'Linho', tecido: 'Tecido liso', veludo: 'Veludo', boucle: 'Bouclê', couro: 'Couro', blackout: 'Blackout',
  voil: 'Voil (translúcido)', madeira: 'Madeira', laca: 'Laca', palha: 'Palhinha', marmore: 'Mármore', pedra: 'Granito', metal: 'Metal',
  granilite: 'Granilite', azulejo_grade: 'Azulejo 10×10', xadrez: 'Xadrez vichy',
  canelado: 'Canelado', tweed: 'Tweed', azulejo: 'Azulejo metrô',
};
const cacheMat = new Map();
const matsLuz = new Set();
function material(cor, acab = 'padrao') {
  const k = `${cor}|${acab}`;
  if (cacheMat.has(k)) return cacheMat.get(k);
  const a = ACAB[acab] || ACAB.padrao;
  const props = { color: cor, roughness: a.roughness, metalness: a.metalness || 0 };
  if (a.tex) { props.map = tex(a.tex); if (a.bump) { props.bumpMap = tex(a.tex); props.bumpScale = a.bump; } }
  if (a.transparent) Object.assign(props, { transparent: true, opacity: a.opacity, depthWrite: a.depthWrite });
  if (a.lados === 2) props.side = T.DoubleSide;
  if (a.sheen) Object.assign(props, { sheen: a.sheen, sheenRoughness: a.sheenRoughness, sheenColor: new T.Color(cor).lerp(new T.Color('#ffffff'), 0.35) });
  if (a.luz) Object.assign(props, { emissive: new T.Color('#ffd49a'), emissiveIntensity: 0 });
  const mat = a.fisico ? new T.MeshPhysicalMaterial(props) : new T.MeshStandardMaterial(props);
  mat.userData.sombra = a.sombra !== false;
  if (a.luz) matsLuz.add(mat);
  cacheMat.set(k, mat);
  return mat;
}

// ---- expressões do catálogo: números ou fórmulas com L, P, A (medidas do
// móvel), i (índice de repetição) e funções matemáticas básicas.
const NOMES_EXPR = ['L', 'P', 'A', 'i', 'min', 'max', 'abs', 'floor', 'ceil', 'round', 'sin', 'cos', 'sqrt', 'PI'];
const VALORES_EXPR = [Math.min, Math.max, Math.abs, Math.floor, Math.ceil, Math.round, Math.sin, Math.cos, Math.sqrt, Math.PI];
const cacheExpr = new Map();
function avaliar(v, L, P, A, i = 0) {
  if (typeof v === 'number') return v;
  if (v == null || v === '') return 0;
  let f = cacheExpr.get(v);
  if (!f) {
    const nomes = String(v).match(/[A-Za-z_]+/g) || [];
    if (nomes.some((n) => !NOMES_EXPR.includes(n)) || /[^\w\s.,+\-*/()<>=?:!&|%]/.test(v)) throw new Error(`Expressão inválida no catálogo: ${v}`);
    f = new Function(...NOMES_EXPR, `return (${v});`);
    cacheExpr.set(v, f);
  }
  return f(L, P, A, i, ...VALORES_EXPR);
}

// ---- variantes (formatos), acabamentos e áreas de uso
const varianteDe = (def, m) => (def?.variantes ? def.variantes.find((v) => v.id === m.variante) || def.variantes[0] : null);
const partesDe = (def, m) => varianteDe(def, m)?.partes || def?.partes || [];
const usoDe = (def, m) => varianteDe(def, m)?.uso ?? def?.uso ?? [];
const luzDe = (def, m) => varianteDe(def, m)?.luz ?? def?.luz ?? null;
const acaoDe = (def, m) => varianteDe(def, m)?.acao ?? def?.acao ?? 'Abrir';
const temMov = (def, m) => partesDe(def, m).some((p) => p.mov);

function pegada(m) {
  const gira = m.rot % 180 !== 0;
  const w = gira ? m.p : m.l, d = gira ? m.l : m.p;
  const pg = { x0: m.x - w / 2, x1: m.x + w / 2, z0: m.z - d / 2, z1: m.z + d / 2, w, d, y0: m.y || 0, y1: (m.y || 0) + m.a };
  // recorte (ex.: canto da pedra da pia por onde passa a porta): fica de fora
  const rc = varianteDe(defCatalogo(m.tipo), m)?.recorte;
  if (rc) pg.furos = [retanguloPlanta(m, ...['x0', 'x1', 'z0', 'z1'].map((k) => avaliar(rc[k], m.l, m.p, m.a)))];
  return pg;
}
// Encostar sozinho: perto (até 12 cm) de uma parede ou de outro móvel, o
// móvel encosta nele. Segure Alt (no PC) para soltar livre.
const ENCOSTO = 12;
function encostar(m) {
  const pg = pegada(m), d1 = defCatalogo(m.tipo) || {};
  const alvos = [
    ...doc.planta.paredes.filter((w) => !w.demolida).map((w) => ({ ...caixaParede(w), nome: 'parede' })),
    ...cen().moveis.filter((o) => {
      const d2 = defCatalogo(o.tipo) || {};
      if (o.id === m.id || d2.colide === false || ignoraPar(d1, d2)) return false;
      const po = pegada(o);
      return po.y0 < pg.y1 && po.y1 > pg.y0;
    }).map((o) => ({ ...pegada(o), nome: o.nome.toLowerCase() })),
  ];
  let bx = null, bz = null, qx = '', qz = '';
  for (const r of alvos) {
    if (Math.min(pg.z1, r.z1) - Math.max(pg.z0, r.z0) > 1) {
      for (const d of [r.x1 - pg.x0, r.x0 - pg.x1]) if (Math.abs(d) <= ENCOSTO && (bx === null || Math.abs(d) < Math.abs(bx))) { bx = d; qx = r.nome; }
    }
    if (Math.min(pg.x1, r.x1) - Math.max(pg.x0, r.x0) > 1) {
      for (const d of [r.z1 - pg.z0, r.z0 - pg.z1]) if (Math.abs(d) <= ENCOSTO && (bz === null || Math.abs(d) < Math.abs(bz))) { bz = d; qz = r.nome; }
    }
  }
  if (bx !== null) m.x += bx;
  if (bz !== null) m.z += bz;
  return [bx !== null && qx, bz !== null && qz].filter(Boolean);
}
function encaixar(m) {
  const pg = pegada(m);
  m.x = snap(pg.x0) + pg.w / 2;
  m.z = snap(pg.z0) + pg.d / 2;
}
// Do sistema do móvel (x para a direita, z para a frente) para a planta.
function paraPlanta(m, x, z) {
  if (m.espelhado) x = -x;
  const t = rad(-m.rot);
  return [m.x + x * Math.cos(t) + z * Math.sin(t), m.z - x * Math.sin(t) + z * Math.cos(t)];
}
function retanguloPlanta(m, x0, x1, z0, z1) {
  const a = paraPlanta(m, x0, z0), b = paraPlanta(m, x1, z1);
  return { x0: Math.min(a[0], b[0]), x1: Math.max(a[0], b[0]), z0: Math.min(a[1], b[1]), z1: Math.max(a[1], b[1]) };
}
// Pegada usada nas colisões: aberto, inclui portas e gavetas para fora.
function pegadaColisao(m) {
  const pg = pegada(m), def = defCatalogo(m.tipo);
  if (!(m.aberto > 0.02 && temMov(def, m))) return pg;
  const obj = objMovel.get(m.id);
  if (!obj) return pg;
  obj.updateMatrixWorld(true);
  const b = new T.Box3().setFromObject(obj);
  // sobras pequenas (tecido, puxador) não contam: só o que abre de verdade
  const ext = (aberto, fechado, sinal) => ((aberto - fechado) * sinal > 3 ? aberto : fechado);
  return { ...pg, x0: ext(b.min.x, pg.x0, -1), x1: ext(b.max.x, pg.x1, 1), z0: ext(b.min.z, pg.z0, -1), z1: ext(b.max.z, pg.z1, 1) };
}
function zonasUso(m) {
  const def = defCatalogo(m.tipo), { l: L, p: P, a: A } = m;
  return usoDe(def, m).map((u) => ({
    nome: u.nome || 'Área de uso',
    ...retanguloPlanta(m, avaliar(u.x0, L, P, A), avaliar(u.x1, L, P, A), avaliar(u.z0, L, P, A), avaliar(u.z1, L, P, A)),
  }));
}

// Coordenadas de textura em metros, projetadas pela direção de cada face.
function uvMetros(geo) {
  if (!geo.attributes.normal) geo.computeVertexNormals();
  const pos = geo.attributes.position, nor = geo.attributes.normal, uv = new Float32Array(pos.count * 2);
  for (let k = 0; k < pos.count; k++) {
    const ax = Math.abs(nor.getX(k)), ay = Math.abs(nor.getY(k)), az = Math.abs(nor.getZ(k));
    const x = pos.getX(k), y = pos.getY(k), z = pos.getZ(k);
    const [u, v] = ax >= ay && ax >= az ? [z, y] : ay >= az ? [x, z] : [x, y];
    uv[k * 2] = u / 100; uv[k * 2 + 1] = v / 100;
  }
  geo.setAttribute('uv', new T.BufferAttribute(uv, 2));
}

function criarParte(pt, m, def, i) {
  const { l: L, p: P, a: A } = m;
  const v = (k, pad = 0) => (pt[k] == null ? pad : avaliar(pt[k], L, P, A, i));
  if (pt.se != null && !v('se')) return null;
  let cor = Array.isArray(pt.cor) ? pt.cor[i % pt.cor.length] : pt.cor;
  cor = !cor || cor === 'principal' ? m.cores.principal : cor === 'secundaria' ? (m.cores.secundaria || '#888888') : cor;
  const acab = pt.acab === '@' ? (m.acab || def.acabamentos?.[0] || 'tecido') : pt.acab;
  const mat = material(cor, acab);
  let geo, y = v('y');
  if (pt.f === 'caixa') {
    const l = v('l'), a = v('a'), p = v('p');
    if (l <= 0 || a <= 0 || p <= 0) return null;
    const r = Math.min(v('r'), l / 2 - 0.01, a / 2 - 0.01, p / 2 - 0.01);
    geo = r > 0.2 ? new T.RoundedBoxGeometry(l, a, p, 3, r) : new T.BoxGeometry(l, a, p);
    y += a / 2;
  } else if (pt.f === 'cil') {
    const a = v('a');
    if (a <= 0) return null;
    if (pt.l != null) { // elíptico: largura l e profundidade p
      const l = v('l'), p = v('p', l);
      if (l <= 0 || p <= 0) return null;
      geo = new T.CylinderGeometry(0.5 * v('k', 1), 0.5, a, 40);
      geo.scale(l, 1, p);
    } else {
      const raio = v('raio'), raio2 = pt.raio2 == null ? raio : v('raio2');
      if (raio <= 0 && raio2 <= 0) return null;
      geo = new T.CylinderGeometry(raio2, raio, a, 24);
    }
    if (pt.eixo === 'x') geo.rotateZ(-Math.PI / 2);
    else if (pt.eixo === 'z') geo.rotateX(Math.PI / 2);
    else y += a / 2;
  } else if (pt.f === 'esfera') {
    const raio = v('raio');
    if (raio <= 0) return null;
    geo = new T.SphereGeometry(raio, 20, 14);
    geo.scale(v('ex', 1), v('ey', 1), v('ez', 1));
    y += raio * v('ey', 1);
  } else if (pt.f === 'torno') {
    const pts = pt.pts.map(([r, h]) => new T.Vector2(Math.max(0.01, avaliar(r, L, P, A, i)), avaliar(h, L, P, A, i)));
    geo = new T.LatheGeometry(pts, 28);
  } else return null;
  uvMetros(geo);
  const pos = new T.Vector3(v('x'), y, v('z'));
  const rot = new T.Euler(rad(v('rx')), rad(v('ry')), rad(v('rz')));
  let mov = null;
  if (pt.mov) {
    const mv = pt.mov, e = (k, pad = 0) => (mv[k] == null ? pad : avaliar(mv[k], L, P, A, i));
    mov = {
      pivo: new T.Vector3(e('px', pos.x), e('py', pos.y), e('pz', pos.z)),
      eixo: mv.eixo || 'y', ang: rad(e('gira')),
      desl: mv.desliza ? new T.Vector3(...mv.desliza.map((d) => avaliar(d, L, P, A, i))) : null,
      esc: mv.escala ? mv.escala.map((d) => avaliar(d, L, P, A, i)) : null,
    };
  }
  return { geo, mat, pos, rot, mov };
}

function aplicarAbertura(g, k) {
  sujarSombra();
  for (const a of g.userData.anim || []) {
    a.g.rotation.set(0, 0, 0);
    if (a.ang) a.g.rotation[a.eixo] = a.ang * k;
    a.g.position.copy(a.pivo);
    if (a.desl) a.g.position.addScaledVector(a.desl, k);
    if (a.esc) a.g.scale.set(1 + (a.esc[0] - 1) * k, 1 + (a.esc[1] - 1) * k, 1 + (a.esc[2] - 1) * k);
  }
}

function construirMovel(m) {
  const def = defCatalogo(m.tipo);
  const g = new T.Group();
  const interno = new T.Group();
  g.add(interno);
  const anim = [];
  if (def?.modelo) {
    const mod = modelos.get(def.modelo);
    if (mod) {
      const c = mod.cena.clone(true);
      c.position.set(-mod.centro.x, -mod.base, -mod.centro.z);
      const env = new T.Group();
      env.scale.set(m.l / mod.tam.x, m.a / mod.tam.y, m.p / mod.tam.z);
      env.add(c);
      c.traverse((o) => { if (o.isMesh) { o.castShadow = o.receiveShadow = true; o.userData.compartilhado = true; } });
      interno.add(env);
    } else {
      interno.add(caixa(m.l, m.a, m.p, material('#c8ccd2'), 0, m.a / 2, 0)); // modelo ainda carregando
    }
  } else if (def) {
    const fixas = new Map(); // material → geometrias já posicionadas
    for (const pt of partesDe(def, m)) {
      let n = 1;
      try { if (pt.n != null) n = Math.max(0, Math.min(300, Math.floor(avaliar(pt.n, m.l, m.p, m.a)))); } catch (err) { console.warn(err); }
      for (let i = 0; i < n; i++) {
        let r;
        try { r = criarParte(pt, m, def, i); } catch (err) { console.warn(err); }
        if (!r) continue;
        if (r.mov) {
          const mesh = new T.Mesh(r.geo, r.mat);
          mesh.castShadow = r.mat.userData.sombra; mesh.receiveShadow = true;
          mesh.position.copy(r.pos).sub(r.mov.pivo);
          mesh.rotation.copy(r.rot);
          const piv = new T.Group();
          piv.add(mesh);
          interno.add(piv);
          anim.push({ g: piv, ...r.mov });
        } else {
          r.geo.applyMatrix4(new T.Matrix4().compose(r.pos, new T.Quaternion().setFromEuler(r.rot), new T.Vector3(1, 1, 1)));
          if (!fixas.has(r.mat)) fixas.set(r.mat, []);
          fixas.get(r.mat).push(r.geo);
        }
      }
    }
    for (const [mat, geos0] of fixas) {
      // juntar exige todas indexadas ou todas não indexadas
      const misto = geos0.some((gg) => gg.index) && geos0.some((gg) => !gg.index);
      const geos = misto ? geos0.map((gg) => { if (!gg.index) return gg; const n = gg.toNonIndexed(); gg.dispose(); return n; }) : geos0;
      const unida = geos.length > 1 ? T.mergeGeometries(geos, false) : geos[0];
      const lista = unida ? [unida] : geos;
      if (unida && unida !== geos[0]) for (const gg of geos) gg.dispose();
      for (const geo of lista) {
        const mesh = new T.Mesh(geo, mat);
        mesh.castShadow = mat.userData.sombra; mesh.receiveShadow = true;
        interno.add(mesh);
      }
    }
    const lz = luzDe(def, m);
    if (lz) {
      const luzP = new T.PointLight(lz.cor || '#ffd49a', 0, 520, 1);
      luzP.position.set(avaliar(lz.x, m.l, m.p, m.a), avaliar(lz.y, m.l, m.p, m.a), avaliar(lz.z, m.l, m.p, m.a));
      luzP.userData.base = lz.intensidade ?? 90;
      interno.add(luzP);
    }
  } else {
    interno.add(caixa(m.l, m.a, m.p, material('#e5484d'), 0, m.a / 2, 0));
  }
  interno.scale.x = m.espelhado ? -1 : 1;
  g.position.set(m.x, m.y || 0, m.z);
  g.rotation.y = (-m.rot * Math.PI) / 180;
  g.userData.anim = anim;
  aplicarAbertura(g, m.aberto || 0);
  g.traverse((o) => { o.userData.tipo ??= 'movel'; o.userData.id ??= m.id; });
  return g;
}

function construirMoveis() {
  sujarSombra();
  limpar(grpMoveis);
  objMovel.clear();
  for (const m of cen().moveis) {
    const g = construirMovel(m);
    grpMoveis.add(g);
    objMovel.set(m.id, g);
  }
  aplicarVisibilidadeTopo();
  luzesMoveis = [];
  grpMoveis.traverse((o) => { if (o.isPointLight) luzesMoveis.push(o); });
  luzesMoveis.slice(LEVE ? 3 : 8).forEach((l) => { l.visible = false; }); // cada luz pesa em todos os pixels
  aplicarSol();
  for (const f of EXTENSOES.aposMoveis) f(grpMoveis, cen());
}

// Na vista de cima (planta baixa), o que fica no alto — pendentes,
// prateleiras, armários aéreos — some para mostrar o que está embaixo.
function aplicarVisibilidadeTopo() {
  sujarSombra();
  const cortado = (vista.topo || (vista.corte && !vista.caminhar)) && !(typeof cinema !== 'undefined' && cinema.modo);
  for (const m of cen().moveis) {
    const obj = objMovel.get(m.id);
    if (obj) obj.visible = !(vista.topo && (m.y || 0) >= 140) && !(cortado && (m.tipo === 'cortina' || m.tipo === 'persiana'))
      && !(modo === 'desenhar' && !desenho.moveis);
  }
}

// Abre/fecha com animação (portas, gavetas, sofá retrátil, persianas…).
let animando = null;
function alternarAbertura(m) {
  const alvo = (m.aberto || 0) > 0.5 ? 0 : 1;
  const de = m.aberto || 0, t0 = performance.now(), dur = 650;
  registrar();
  cancelAnimationFrame(animando);
  const passo = (agora) => {
    const t = Math.min(1, (agora - t0) / dur), k = t * t * (3 - 2 * t);
    m.aberto = de + (alvo - de) * k;
    const obj = objMovel.get(m.id);
    if (obj) aplicarAbertura(obj, m.aberto);
    if (t < 1) animando = requestAnimationFrame(passo);
    else { m.aberto = alvo; atualizarTudo(); }
  };
  animando = requestAnimationFrame(passo);
}

// =====================================================================
// 7. COLISÕES, ÁREAS DE USO E PORTAS
// =====================================================================
// Três verificações: móveis que se sobrepõem (inclusive com portas e
// gavetas abertas), áreas de uso bloqueadas (o espaço para puxar a
// cadeira, abrir o guarda-roupa, sentar no sofá) e móveis no caminho do
// abrir das portas.
let colisoes = { porMovel: new Map(), lista: [], usoBloq: new Set(), portasBloq: new Set() };

function sobrepoe(a, b) {
  return Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) > CFG.tolColisao &&
         Math.min(a.z1, b.z1) - Math.max(a.z0, b.z0) > CFG.tolColisao;
}
const sobrepoeAltura = (a, b) => Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0) > CFG.tolColisao;
function caixaParede(w) {
  const e = w.esp / 2;
  return { x0: Math.min(w.x1, w.x2) - e, x1: Math.max(w.x1, w.x2) + e, z0: Math.min(w.z1, w.z2) - e, z1: Math.max(w.z1, w.z2) + e, y0: 0, y1: 9999 };
}
const ignoraPar = (a, b) => (a.ignora || []).includes(b.grupo) || (b.ignora || []).includes(a.grupo);

// Nome de uma porta pelos ambientes dos dois lados ("porta Quarto / Estar";
// com um lado para fora, "porta de entrada").
function nomePorta(ab) {
  const w = parede(ab.parede);
  if (!w) return 'porta';
  const hz = horizontal(w), u = ab.pos + ab.largura / 2, d = w.esp / 2 + 15;
  const x = hz ? w.x1 + u : w.x1, z = hz ? w.z1 : w.z1 + u;
  const lados = [-1, 1].map((s) => doc.planta.ambientes.find((a) => dentro(hz ? [x, z + s * d] : [x + s * d, z], a.pontos))?.nome);
  if (lados.filter(Boolean).length === 1) return 'porta de entrada';
  return lados[0] ? `porta ${lados.join(' / ')}` : `porta ${fmt(ab.largura)}`;
}

// Giro de cada porta: dobradiça, raio e os dois sentidos do quarto de círculo.
function girosPortas() {
  const pl = doc.planta, lista = [];
  for (const ab of pl.aberturas) {
    if (ab.tipo !== 'porta') continue;
    const w = pl.paredes.find((p) => p.id === ab.parede);
    if (!w || w.demolida) continue;
    const hz = horizontal(w), u = hz ? [1, 0] : [0, 1], vv = hz ? [0, 1] : [-1, 0];
    const noInicio = ab.dobradica !== 'fim', lado = ab.lado === -1 ? -1 : 1;
    const uh = noInicio ? ab.pos + 3 : ab.pos + ab.largura - 3, v0 = (lado * w.esp) / 2;
    lista.push({
      ab, nome: nomePorta(ab), R: ab.largura - 6,
      c: [w.x1 + u[0] * uh + vv[0] * v0, w.z1 + u[1] * uh + vv[1] * v0],
      du: [u[0] * (noInicio ? 1 : -1), u[1] * (noInicio ? 1 : -1)], dv: [vv[0] * lado, vv[1] * lado],
    });
  }
  return lista;
}
function bloqueiaGiro(pg, giro) {
  for (let ri = 1; ri <= 5; ri++) for (let ti = 0; ti <= 6; ti++) {
    const r = (giro.R * ri) / 5.2, t = (Math.PI / 2) * (0.04 + (ti / 6) * 0.92);
    if (r * Math.sin(t) < 5) continue; // folha praticamente fechada, no plano da parede
    const x = giro.c[0] + giro.du[0] * r * Math.cos(t) + giro.dv[0] * r * Math.sin(t);
    const z = giro.c[1] + giro.du[1] * r * Math.cos(t) + giro.dv[1] * r * Math.sin(t);
    if (pg.furos?.some((f) => x > f.x0 - 0.5 && x < f.x1 + 0.5 && z > f.z0 - 0.5 && z < f.z1 + 0.5)) continue;
    if (x > pg.x0 + 0.5 && x < pg.x1 - 0.5 && z > pg.z0 + 0.5 && z < pg.z1 - 0.5) return true;
  }
  return false;
}

function verificarColisoes() {
  const porMovel = new Map(), lista = [], usoBloq = new Set(), portasBloq = new Set();
  const marcar = (id, txt) => { if (!porMovel.has(id)) porMovel.set(id, []); porMovel.get(id).push(txt); };
  const itens = cen().moveis.map((m) => ({ m, def: defCatalogo(m.tipo) || {}, pg: pegadaColisao(m) }))
    .filter((it) => it.def.colide !== false);
  const paredes = doc.planta.paredes.filter((w) => !w.demolida).map((w) => ({ w, cx: caixaParede(w) }));
  for (let i = 0; i < itens.length; i++) {
    const A = itens[i];
    for (let j = i + 1; j < itens.length; j++) {
      const B = itens[j];
      if (ignoraPar(A.def, B.def) || !sobrepoe(A.pg, B.pg) || !sobrepoeAltura(A.pg, B.pg)) continue;
      marcar(A.m.id, B.m.nome); marcar(B.m.id, A.m.nome);
      lista.push({ ids: [A.m.id, B.m.id], txt: `${A.m.nome} × ${B.m.nome}` });
    }
    for (const { w, cx } of paredes) {
      if (!sobrepoe(A.pg, cx)) continue;
      marcar(A.m.id, `parede ${w.nome}`);
      lista.push({ ids: [A.m.id], txt: `${A.m.nome} × parede ${w.nome}` });
    }
    // área de uso: o que estiver no chão (até 1 m de altura) atrapalha
    zonasUso(A.m).forEach((z, k) => {
      const quem = [
        ...itens.filter((B) => B !== A && !ignoraPar(A.def, B.def) && B.pg.y0 < 60 && sobrepoe(z, B.pg)).map((B) => B.m.nome),
        ...paredes.filter(({ cx }) => sobrepoe(z, cx)).map(({ w }) => `parede ${w.nome}`),
      ];
      if (!quem.length) return;
      usoBloq.add(`${A.m.id}#${k}`);
      const txtMovel = `${z.nome.toLowerCase()} bloqueada por ${quem.join(', ')}`;
      marcar(A.m.id, txtMovel);
      lista.push({ ids: [A.m.id], txt: `${A.m.nome}: ${z.nome.toLowerCase()} bloqueada`, tipo: 'uso', zona: `${A.m.id}#${k}`, txtMovel });
    });
  }
  for (const giro of girosPortas()) {
    for (const B of itens) {
      if (B.pg.y0 >= 60 || !bloqueiaGiro(B.pg, giro)) continue;
      portasBloq.add(giro.ab.id);
      marcar(B.m.id, `no caminho da ${giro.nome}`);
      lista.push({ ids: [B.m.id], txt: `${B.m.nome} bloqueia a ${giro.nome}`, tipo: 'porta' });
    }
  }
  colisoes = { porMovel, lista, usoBloq, portasBloq };
  conferir();
  // espaço só apertado (70% do ideal ou mais) fica amarelo, não é conflito
  for (const c of lista.filter((x) => x.zona && statusZona.get(x.zona) === 'atencao')) {
    usoBloq.delete(c.zona);
    const t = (porMovel.get(c.ids[0]) || []).filter((x) => x !== c.txtMovel);
    if (t.length) porMovel.set(c.ids[0], t); else porMovel.delete(c.ids[0]);
  }
  colisoes.lista = lista.filter((x) => !(x.zona && statusZona.get(x.zona) === 'atencao'));
  renderAvisos();
}

// ---- cotas: distância livre do móvel selecionado até o obstáculo mais
// próximo em cada direção (parede ou outro móvel na mesma altura).
function calcularCotas(m) {
  const pg = pegada(m), obst = [];
  for (const w of doc.planta.paredes) if (!w.demolida) obst.push(caixaParede(w));
  for (const o of cen().moveis) {
    if (o.id === m.id || defCatalogo(o.tipo)?.colide === false) continue;
    const po = pegada(o);
    if (sobrepoeAltura(po, pg)) obst.push(po);
  }
  const cotas = [];
  const dirs = [['x', 1], ['x', -1], ['z', 1], ['z', -1]];
  for (const [eixo, s] of dirs) {
    const [a0, a1, b0, b1] = eixo === 'x' ? ['x0', 'x1', 'z0', 'z1'] : ['z0', 'z1', 'x0', 'x1'];
    const borda = s > 0 ? pg[a1] : pg[a0];
    let melhor = Infinity;
    for (const o of obst) {
      if (Math.min(o[b1], pg[b1]) - Math.max(o[b0], pg[b0]) <= 1) continue; // não está na frente
      const d = s > 0 ? o[a0] - borda : borda - o[a1];
      if (d > -0.5 && d < melhor) melhor = Math.max(0, d);
    }
    if (!Number.isFinite(melhor) || melhor > 800) continue;
    const meio = (pg[b0] + pg[b1]) / 2;
    const p1 = eixo === 'x' ? [borda, meio] : [meio, borda];
    const p2 = eixo === 'x' ? [borda + s * melhor, meio] : [meio, borda + s * melhor];
    cotas.push({ eixo, s, dist: melhor, p1, p2 });
  }
  return cotas;
}

// =====================================================================
// 8. SELEÇÃO E ARRASTE
// =====================================================================
const matSel = new T.MeshBasicMaterial({ color: CFG.corSel, transparent: true, opacity: 0.16, depthWrite: false });
const matCol = new T.MeshBasicMaterial({ color: CFG.corColisao, transparent: true, opacity: 0.28, depthWrite: false });
const matUso = new T.MeshBasicMaterial({ color: '#27ae60', transparent: true, opacity: 0.16, depthWrite: false });
const matUsoBloq = new T.MeshBasicMaterial({ color: CFG.corColisao, transparent: true, opacity: 0.26, depthWrite: false });
const matPorta = new T.MeshBasicMaterial({ color: '#f2994a', transparent: true, opacity: 0.16, depthWrite: false });
const linhaSel = new T.LineBasicMaterial({ color: CFG.corSel });
const linhaCol = new T.LineBasicMaterial({ color: CFG.corColisao });
const linhaUso = new T.LineDashedMaterial({ color: '#1e8449', dashSize: 6, gapSize: 4 });
const linhaCota = new T.LineBasicMaterial({ color: '#1d2530' });
const matUsoAtencao = new T.MeshBasicMaterial({ color: '#f2b84b', transparent: true, opacity: 0.28, depthWrite: false });
const linhaAtencao = new T.LineDashedMaterial({ color: '#c48a12', dashSize: 6, gapSize: 4 });
let statusZona = new Map();

// O que aparece sobre a planta (painel "Mostrar").
const camadas = Object.assign({ uso: false, cantos: false, cotas: true },
  (() => { try { return JSON.parse(localStorage.getItem(`${CFG.prefixo}camadas`)) || {}; } catch { return {}; } })());
const guardarCamadas = () => { try { localStorage.setItem(`${CFG.prefixo}camadas`, JSON.stringify(camadas)); } catch { /* ok */ } };

function contornoTracejado(pts, mat, y) {
  const l = new T.Line(new T.BufferGeometry().setFromPoints([...pts, pts[0]].map(([x, z]) => new T.Vector3(x, y, z))), mat);
  l.computeLineDistances();
  return l;
}
const retPts = (r) => [[r.x0, r.z0], [r.x1, r.z0], [r.x1, r.z1], [r.x0, r.z1]];

function desenharSelecao() {
  limpar(grpSel);
  const marca = (m, fundo, linha) => {
    const pg = pegada(m);
    const q = new T.Mesh(new T.PlaneGeometry(pg.w, pg.d), fundo);
    q.rotation.x = -Math.PI / 2; q.position.set(m.x, 0.7, m.z);
    grpSel.add(q);
    const obj = objMovel.get(m.id);
    if (obj) grpSel.add(new T.Box3Helper(new T.Box3().setFromObject(obj), linha.color));
  };
  if (!vista.caminhar && modo === 'arrumar') for (const id of colisoes.porMovel.keys()) { const m = movel(id); if (m) marca(m, matCol, linhaCol); }
  const selM = sel?.tipo === 'movel' ? movel(sel.id) : null;
  if (selM) marca(selM, matSel, linhaSel);
  for (const id of selExtra) { const o = movel(id); if (o) marca(o, matSel, linhaSel); }
  desenharAlcas(selExtra.length ? null : selM);
  if (vista.caminhar || modo === 'visitar') return;
  // áreas de uso: de todos (camada ligada ou modo Conferir) ou só do móvel selecionado
  const todas = camadas.uso || modo === 'conferir';
  for (const m of cen().moveis) {
    if (!todas && m !== selM) continue;
    zonasUso(m).forEach((z, k) => {
      const st = modo === 'conferir' || statusZona.get(`${m.id}#${k}`) === 'atencao' ? statusZona.get(`${m.id}#${k}`) : (colisoes.usoBloq.has(`${m.id}#${k}`) ? 'problema' : 'ok');
      const fundo = st === 'problema' ? matUsoBloq : st === 'atencao' ? matUsoAtencao : matUso;
      grpSel.add(malhaPoligono(retPts(z), fundo, 0.5));
      grpSel.add(contornoTracejado(retPts(z), st === 'problema' ? linhaCol : st === 'atencao' ? linhaAtencao : linhaUso, 0.6));
    });
  }
  // giro das portas: todas com a camada ligada; bloqueadas sempre
  for (const giro of girosPortas()) {
    const bloq = colisoes.portasBloq.has(giro.ab.id);
    if (!camadas.uso && !bloq) continue;
    const pts = [giro.c];
    for (let k = 0; k <= 16; k++) {
      const t = (k / 16) * (Math.PI / 2);
      pts.push([giro.c[0] + (giro.du[0] * Math.cos(t) + giro.dv[0] * Math.sin(t)) * giro.R,
                giro.c[1] + (giro.du[1] * Math.cos(t) + giro.dv[1] * Math.sin(t)) * giro.R]);
    }
    grpSel.add(malhaPoligono(pts, bloq ? matUsoBloq : matPorta, 0.45));
  }
  desenharCotas(selM);
}

// ---- cotas (linhas + rótulos clicáveis para digitar a distância)
const camadaCotas = $('#cotas');
let cotasTela = [];
function desenharCotas(m) {
  camadaCotas.textContent = '';
  cotasTela = [];
  if (!m || !(camadas.cotas || modo === 'conferir') || vista.caminhar) return;
  const y = (m.y || 0) + 1.5;
  for (const c of calcularCotas(m)) {
    const [x1, z1] = c.p1, [x2, z2] = c.p2;
    const pts = [new T.Vector3(x1, y, z1), new T.Vector3(x2, y, z2)];
    const per = c.eixo === 'x' ? [0, 6] : [6, 0]; // tracinhos nas pontas
    for (const [x, z] of [c.p1, c.p2]) pts.push(new T.Vector3(x - per[0], y, z - per[1]), new T.Vector3(x + per[0], y, z + per[1]));
    grpSel.add(new T.LineSegments(new T.BufferGeometry().setFromPoints([pts[0], pts[1], pts[2], pts[3], pts[4], pts[5]]), linhaCota));
    const bt = el('button', { type: 'button', class: 'cota', title: 'Clique para digitar a distância' }, `${fmt(c.dist)}`);
    bt.addEventListener('pointerdown', (e) => e.stopPropagation());
    bt.addEventListener('click', () => editarCota(bt, m, c));
    camadaCotas.append(bt);
    cotasTela.push({ el: bt, pos: new T.Vector3((x1 + x2) / 2, y, (z1 + z2) / 2) });
  }
}
function editarCota(bt, m, c) {
  const inp = el('input', { type: 'text', inputmode: 'decimal', value: fmt(c.dist), class: 'cota-campo' });
  bt.replaceWith(inp);
  const item = cotasTela.find((t) => t.el === bt);
  if (item) item.el = inp;
  inp.focus(); inp.select();
  let feito = false;
  const aplicar = () => {
    if (feito) return; feito = true;
    const v = numero(inp.value);
    if (!Number.isFinite(v) || v < 0 || Math.abs(v - c.dist) < 0.05) { desenharSelecao(); return; }
    const delta = (c.dist - v) * c.s;
    alterar(() => { if (c.eixo === 'x') m.x += delta; else m.z += delta; });
  };
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') aplicar(); if (e.key === 'Escape') { feito = true; desenharSelecao(); } });
  inp.addEventListener('blur', aplicar);
}

// ---- cantos: zonas de função (home office, jantar, TV…) desenhadas no piso
const FUNCOES = {
  office:     { nome: 'Home office', cor: '#2f80ed' },
  estar:      { nome: 'TV / estar', cor: '#9b51e0' },
  jantar:     { nome: 'Jantar', cor: '#f2994a' },
  dormir:     { nome: 'Dormir', cor: '#27ae60' },
  cozinha:    { nome: 'Cozinha', cor: '#eb5757' },
  banho:      { nome: 'Banho', cor: '#2d9cdb' },
  leitura:    { nome: 'Leitura', cor: '#bb6bd9' },
  circulacao: { nome: 'Circulação', cor: '#828282' },
  servico:    { nome: 'Serviço', cor: '#a0785a' },
  outro:      { nome: 'Outro', cor: '#4f4f4f' },
};
const grpZonas = new T.Group();
cena.add(grpZonas);
let rotulosZonas = [];
const zona = (id) => (cen().zonas || []).find((z) => z.id === id);
const retZona = (z) => ({ x0: z.x - z.l / 2, x1: z.x + z.l / 2, z0: z.z - z.p / 2, z1: z.z + z.p / 2 });

function construirZonas() {
  limpar(grpZonas);
  rotulosZonas.forEach((r) => r.div.remove());
  rotulosZonas = [];
  if (!camadas.cantos || vista.caminhar || modo === 'visitar' || modo === 'desenhar') return;
  for (const z of cen().zonas || []) {
    const f = FUNCOES[z.funcao] || FUNCOES.outro, ativo = sel?.tipo === 'zona' && sel.id === z.id;
    const r = retZona(z);
    const fundo = malhaPoligono(retPts(r), new T.MeshBasicMaterial({ color: f.cor, transparent: true, opacity: ativo ? 0.2 : 0.09, depthWrite: false }), 0.35);
    fundo.userData = { tipo: 'zona', id: z.id };
    grpZonas.add(fundo, contornoTracejado(retPts(r), new T.LineDashedMaterial({ color: f.cor, dashSize: ativo ? 14 : 9, gapSize: 6 }), 0.4));
    const div = el('div', { class: 'rotulo-zona' + (ativo ? ' ativo' : ''), style: `--cor:${f.cor}` }, z.nome || f.nome);
    camadaRotulos.append(div);
    rotulosZonas.push({ div, canto: true, pos: new T.Vector3(r.x0 + 4, 1, r.z0 + 4) });
  }
}
function moveisNaZona(z) {
  const r = retZona(z);
  return cen().moveis.filter((m) => m.x > r.x0 && m.x < r.x1 && m.z > r.z0 && m.z < r.z1);
}
function novaZona() {
  const rc = tela.getBoundingClientRect();
  let p = pontoNoPiso({ clientX: rc.left + rc.width / 2, clientY: rc.top + rc.height / 2 });
  if (!p || !naPlanta(p.x, p.z)) { const c = centroPlanta(); p = { x: c.cx, z: c.cz }; }
  const z = { id: novoId('z'), funcao: 'outro', x: snap(p.x), z: snap(p.z), l: 150, p: 150 };
  camadas.cantos = true; guardarCamadas();
  alterar(() => { (cen().zonas ||= []).push(z); });
  selecionar({ tipo: 'zona', id: z.id });
}

// ---- caminhar pelo projeto (câmera na altura dos olhos)
const andar = { yaw: Math.PI / 2, pitch: -0.12, x: 380, z: 395, orbita: null, anim: 0 };
function aplicarCameraAndar() {
  camPersp.position.set(andar.x, 160, andar.z);
  camPersp.rotation.set(andar.pitch, andar.yaw, 0, 'YXZ');
}
function alternarCaminhada() {
  vista.caminhar = !vista.caminhar;
  if (vista.caminhar) {
    if (vista.topo) { vista.topo = false; ctlTopo.enabled = false; }
    andar.orbita = { pos: camPersp.position.clone(), alvo: ctlPersp.target.clone() };
    ctlPersp.enabled = false;
    camPersp.fov = 70; camPersp.updateProjectionMatrix();
    aplicarCameraAndar();
    sel = null;
    renderPainel();
    toast('Os móveis ficam travados. Arraste para olhar em volta; toque para andar até lá. W/A/S/D também andam.');
  } else {
    camPersp.fov = 42; camPersp.updateProjectionMatrix();
    if (andar.orbita) { camPersp.position.copy(andar.orbita.pos); ctlPersp.target.copy(andar.orbita.alvo); }
    ctlPersp.enabled = true; ctlPersp.update();
  }
  document.body.classList.toggle('caminhando', vista.caminhar);
  aplicarVisibilidadeTopo();
  construirPlanta(); construirZonas(); desenharSelecao(); atualizarBotoes();
}
function andarPara(x, z) {
  const de = { x: andar.x, z: andar.z }, t0 = performance.now(), dur = Math.min(900, 250 + Math.hypot(x - de.x, z - de.z) * 2.5);
  cancelAnimationFrame(andar.anim);
  const passo = (agora) => {
    const t = Math.min(1, (agora - t0) / dur), k = t * t * (3 - 2 * t);
    andar.x = de.x + (x - de.x) * k; andar.z = de.z + (z - de.z) * k;
    aplicarCameraAndar();
    if (t < 1) andar.anim = requestAnimationFrame(passo);
  };
  andar.anim = requestAnimationFrame(passo);
}
function passoAndar(frente, lado) {
  const s = Math.sin(andar.yaw), c = Math.cos(andar.yaw);
  const x = andar.x - s * frente + c * lado, z = andar.z - c * frente - s * lado;
  if (naPlanta(x, z)) { andar.x = x; andar.z = z; aplicarCameraAndar(); }
}

// ---- alças: as setas do móvel selecionado mudam largura, profundidade e
// altura arrastando (o lado oposto fica parado; de 1 em 1 cm)
const grpAlcas = new T.Group();
grpAlcas.renderOrder = 10;
cena.add(grpAlcas);
let texAlca = null;
function texturaAlca() {
  if (texAlca) return texAlca;
  const c = Object.assign(document.createElement('canvas'), { width: 128, height: 128 }), g = c.getContext('2d');
  g.beginPath(); g.arc(64, 64, 58, 0, Math.PI * 2); g.fillStyle = '#ffffff'; g.fill();
  g.lineWidth = 8; g.strokeStyle = '#2f80ed'; g.stroke();
  g.fillStyle = '#2f80ed'; g.strokeStyle = '#2f80ed'; g.lineWidth = 9; g.lineCap = 'round';
  g.beginPath(); g.moveTo(34, 64); g.lineTo(94, 64); g.stroke();
  for (const sx of [-1, 1]) { g.beginPath(); g.moveTo(64 + sx * 42, 64); g.lineTo(64 + sx * 24, 48); g.lineTo(64 + sx * 24, 80); g.closePath(); g.fill(); }
  texAlca = new T.CanvasTexture(c);
  texAlca.colorSpace = T.SRGBColorSpace;
  return texAlca;
}
let texGira = null;
function texturaGira() {
  if (texGira) return texGira;
  const c = Object.assign(document.createElement('canvas'), { width: 128, height: 128 }), g = c.getContext('2d');
  g.beginPath(); g.arc(64, 64, 58, 0, Math.PI * 2); g.fillStyle = '#2f80ed'; g.fill();
  g.strokeStyle = '#ffffff'; g.fillStyle = '#ffffff'; g.lineWidth = 9; g.lineCap = 'round';
  g.beginPath(); g.arc(64, 64, 30, -Math.PI * 0.35, Math.PI * 1.25); g.stroke();
  const a = -Math.PI * 0.35, x = 64 + Math.cos(a) * 30, y = 64 + Math.sin(a) * 30;
  g.beginPath(); g.moveTo(x + 14, y - 2); g.lineTo(x - 6, y - 14); g.lineTo(x - 4, y + 10); g.closePath(); g.fill();
  texGira = new T.CanvasTexture(c);
  texGira.colorSpace = T.SRGBColorSpace;
  return texGira;
}
const NOME_DIM = { l: 'Largura', p: 'Profundidade', a: 'Altura' };
const dimDoEixo = (m, eixo) => (eixo === 'y' ? 'a' : (m.rot % 180 === 0) === (eixo === 'x') ? 'l' : 'p');
function desenharAlcas(m) {
  limpar(grpAlcas);
  if (!m || modo !== 'arrumar' || vista.caminhar || cinema.modo || foto.ativa) return;
  const pg = pegada(m), y0 = (m.y || 0) + 2, off = 16;
  // fora do centro do lado, para não cair sobre as cotas de distância
  const dz = Math.min(pg.d * 0.3, 40), dx = Math.min(pg.w * 0.3, 40);
  const pos = { 'x-1': [pg.x0 - off, y0, m.z + dz], 'x1': [pg.x1 + off, y0, m.z + dz], 'z-1': [m.x + dx, y0, pg.z0 - off], 'z1': [m.x + dx, y0, pg.z1 + off], 'y1': [m.x, (m.y || 0) + m.a + 20, m.z] };
  pos.r1 = [pg.x0 - off * 0.8, y0, pg.z0 - off * 0.8]; // girar: no canto
  for (const [chave, [x, y, z]] of Object.entries(pos)) {
    const eixo = chave[0], sinal = chave.endsWith('-1') ? -1 : 1;
    const mt = new T.SpriteMaterial({ map: eixo === 'r' ? texturaGira() : texturaAlca(), depthTest: false, transparent: true });
    const sp = new T.Sprite(mt);
    sp.position.set(x, y, z);
    sp.scale.set(0.075, 0.075, 1);
    sp.renderOrder = 10;
    sp.userData = { tipo: 'alca', id: m.id, eixo, s: sinal, eixoV: new T.Vector3(eixo === 'x' ? 1 : 0, eixo === 'y' ? 1 : 0, eixo === 'z' ? 1 : 0) };
    grpAlcas.add(sp);
  }
  atualizarAlcas();
}
// gira a seta de cada alça para apontar ao longo do seu eixo na tela
function atualizarAlcas() {
  if (!grpAlcas.children.length) return;
  const cam = camAtiva(), W = palco.clientWidth, H = Math.max(1, palco.clientHeight), a = new T.Vector3(), b = new T.Vector3();
  const px = LEVE ? 46 : 36; // tamanho na tela, igual em qualquer zoom
  for (const sp of grpAlcas.children) {
    a.copy(sp.position).project(cam); b.copy(sp.position).addScaledVector(sp.userData.eixoV, 20).project(cam);
    sp.material.rotation = sp.userData.eixo === 'r' ? 0 : Math.atan2((b.y - a.y) * H, (b.x - a.x) * W);
    const porPx = vista.topo ? (camTopo.top - camTopo.bottom) / camTopo.zoom / H
      : (2 * cam.position.distanceTo(sp.position) * Math.tan(rad(camPersp.fov / 2))) / H;
    const k = px * porPx;
    sp.scale.set(k, k, 1);
    sp.visible = !(vista.topo && sp.userData.eixo === 'y'); // altura não se puxa na planta
  }
}
function reconstruirMovel(m) {
  const velho = objMovel.get(m.id);
  if (velho) { grpMoveis.remove(velho); limpar(velho); }
  const g = construirMovel(m);
  grpMoveis.add(g);
  objMovel.set(m.id, g);
  sujarSombra();
}
function iniciarAlca(e, alvo) {
  const m = movel(alvo.id);
  if (!m) return;
  const plano = new T.Plane();
  if (alvo.eixo === 'y') {
    const n = camAtiva().getWorldDirection(new T.Vector3()); n.y = 0;
    if (n.lengthSq() < 1e-6) n.set(0, 0, 1);
    plano.setFromNormalAndCoplanarPoint(n.normalize(), new T.Vector3(m.x, 0, m.z));
  } else plano.set(new T.Vector3(0, 1, 0), -((m.y || 0) + 2));
  raioDe(e);
  const inicio = ray.ray.intersectPlane(plano, new T.Vector3());
  if (!inicio) return;
  ctlAtivo().enabled = false;
  Object.assign(arr, { alca: alvo, plano, inicio, estado: JSON.stringify(doc), m0: { l: m.l, p: m.p, a: m.a, x: m.x, z: m.z, rot: m.rot } });
  renderer.domElement.setPointerCapture(e.pointerId);
  if (alvo.eixo === 'r') { arr.ang0 = Math.atan2(inicio.z - m.z, inicio.x - m.x); dica('Girar: arraste em volta do móvel (de 90 em 90°)'); return; }
  dica(`${NOME_DIM[dimDoEixo(m, alvo.eixo)]}: ${fmt(m[dimDoEixo(m, alvo.eixo)])} cm — arraste`);
}
function moverAlca(e) {
  if (!arr.movido) return;
  const m = movel(arr.alca.id);
  raioDe(e);
  const p = m && ray.ray.intersectPlane(arr.plano, new T.Vector3());
  if (!p) return;
  if (arr.alca.eixo === 'r') { // gira de 90 em 90°, em volta do centro
    let d = Math.atan2(p.z - m.z, p.x - m.x) - arr.ang0;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    const rot = (((arr.m0.rot + Math.round(grau(d) / 90) * 90) % 360) + 360) % 360;
    if (rot === m.rot) return;
    m.rot = rot;
    reconstruirMovel(m);
    verificarColisoes();
    desenharSelecao();
    dica(`Girado ${(((rot - arr.m0.rot) % 360) + 360) % 360}°`);
    return;
  }
  const { eixo, s: sinal } = arr.alca, dim = dimDoEixo(m, eixo);
  const delta = (p[eixo] - arr.inicio[eixo]) * (eixo === 'y' ? 1 : sinal);
  const novo = Math.round(Math.max(10, Math.min(800, arr.m0[dim] + delta)));
  if (novo === m[dim]) return;
  m[dim] = novo;
  if (eixo !== 'y') m[eixo] = arr.m0[eixo] + (sinal * (novo - arr.m0[dim])) / 2;
  reconstruirMovel(m);
  verificarColisoes();
  desenharSelecao();
  dica(`${NOME_DIM[dim]}: ${fmt(novo)} cm (era ${fmt(arr.m0[dim])})`);
}
function soltarAlca(g) {
  ctlAtivo().enabled = !vista.caminhar;
  dica('');
  if (g.movido) { registrar(g.estado); atualizarTudo(); }
}

let selExtra = [], escolhendoOutro = false; // outros móveis selecionados (para alinhar)
function adicionarSelecao(id) {
  if (sel?.tipo !== 'movel' || id === sel.id) return;
  selExtra = selExtra.includes(id) ? selExtra.filter((x) => x !== id) : [...selExtra, id];
  desenharSelecao();
  renderPainel();
}
function alinhar(como) {
  const ref = pegada(movel(sel.id));
  alterar(() => {
    for (const id of selExtra) {
      const o = movel(id), po = pegada(o);
      if (como === 'x0') o.x += ref.x0 - po.x0;
      else if (como === 'xc') o.x += (ref.x0 + ref.x1) / 2 - (po.x0 + po.x1) / 2;
      else if (como === 'x1') o.x += ref.x1 - po.x1;
      else if (como === 'z0') o.z += ref.z0 - po.z0;
      else if (como === 'zc') o.z += (ref.z0 + ref.z1) / 2 - (po.z0 + po.z1) / 2;
      else if (como === 'z1') o.z += ref.z1 - po.z1;
    }
  });
}
// ---- régua: toque em dois pontos para medir (encaixa nas bordas de paredes e móveis)
const grpRegua = new T.Group();
grpRegua.renderOrder = 9;
cena.add(grpRegua);
const regua = { ativa: false, a: null, medidas: [] };
let reguaTela = [];
const matRegua = new T.LineBasicMaterial({ color: '#e5484d', depthTest: false });
const matPontoRegua = new T.MeshBasicMaterial({ color: '#e5484d', depthTest: false });
function alternarRegua(ligar = !regua.ativa) {
  if (ligar && vista.caminhar) alternarCaminhada();
  regua.ativa = ligar;
  regua.a = null;
  if (!ligar) regua.medidas = [];
  document.body.classList.toggle('regua', ligar);
  $('#reguaBarra').hidden = !ligar;
  desenharRegua();
  atualizarBotoes();
}
function pontoRegua(e) {
  raioDe(e);
  const hit = ray.intersectObjects([grpMoveis, grpPlanta], true).find((h) => h.object.userData.tipo);
  const p = hit ? hit.point : pontoNoPiso(e);
  if (!p) return;
  let x = p.x, z = p.z;
  // encaixa nas bordas próximas (até 6 cm)
  const bordas = [...doc.planta.paredes.filter((w) => !w.demolida).map(caixaParede), ...cen().moveis.map(pegada)];
  const perto = (v, lista) => { let b = v, d = 6; for (const c of lista) if (Math.abs(c - v) < d) { d = Math.abs(c - v); b = c; } return b; };
  x = perto(x, bordas.flatMap((r) => [r.x0, r.x1]));
  z = perto(z, bordas.flatMap((r) => [r.z0, r.z1]));
  if (!regua.a) { regua.a = [x, z]; desenharRegua(); dica('Agora toque no segundo ponto'); return; }
  // quase reta: endireita
  const [ax, az] = regua.a;
  if (Math.abs(x - ax) < Math.abs(z - az) * 0.14) x = ax;
  if (Math.abs(z - az) < Math.abs(x - ax) * 0.14) z = az;
  regua.medidas.push([regua.a, [x, z]]);
  regua.a = null;
  dica('');
  desenharRegua();
}
function desenharRegua() {
  limpar(grpRegua);
  const caixa = $('#reguaRotulos');
  caixa.textContent = '';
  reguaTela = [];
  const y = 4;
  const ponto = ([x, z]) => { const m = new T.Mesh(new T.SphereGeometry(2.2, 10, 8), matPontoRegua); m.position.set(x, y, z); m.renderOrder = 9; grpRegua.add(m); };
  if (regua.a) ponto(regua.a);
  for (const [a, b] of regua.medidas) {
    ponto(a); ponto(b);
    const l = new T.Line(new T.BufferGeometry().setFromPoints([new T.Vector3(a[0], y, a[1]), new T.Vector3(b[0], y, b[1])]), matRegua);
    l.renderOrder = 9;
    grpRegua.add(l);
    const dx = Math.abs(b[0] - a[0]), dz = Math.abs(b[1] - a[1]), d = Math.hypot(dx, dz);
    const txt = dx > 1 && dz > 1 ? `${fmt(Math.round(d))} cm (↔ ${fmt(Math.round(dx))} · ↕ ${fmt(Math.round(dz))})` : `${fmt(Math.round(d))} cm`;
    const r = el('div', { class: 'regua-rot' }, txt);
    caixa.append(r);
    reguaTela.push({ el: r, pos: new T.Vector3((a[0] + b[0]) / 2, y, (a[1] + b[1]) / 2) });
  }
}

function selecionar(s) {
  sel = s;
  selExtra = [];
  escolhendoOutro = false;
  construirPlanta();
  construirZonas();
  desenharSelecao();
  renderPainel();
  renderAreas();
  renderCantos();
}

const ray = new T.Raycaster();
const planoPiso = new T.Plane(new T.Vector3(0, 1, 0), 0);
function raioDe(e) {
  const r = renderer.domElement.getBoundingClientRect();
  cena.updateMatrixWorld();
  camAtiva().updateMatrixWorld();
  ray.setFromCamera(new T.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camAtiva());
}
function alvoEm(e) {
  raioDe(e);
  if (grpAlcas.children.length) {
    const h = ray.intersectObjects(grpAlcas.children.filter((o) => o.visible), false)[0];
    if (h) return { ...h.object.userData };
  }
  // no modo Planta só a planta responde (os móveis ficam de fora)
  for (const h of ray.intersectObjects(modo === 'desenhar' ? [grpPlanta] : [grpMoveis, grpZonas, grpPlanta], true)) {
    const u = h.object.userData;
    if (u.tipo) return { tipo: u.tipo, id: u.id, abertura: u.abertura };
  }
  return null;
}
function pontoNoPiso(e) {
  raioDe(e);
  return ray.ray.intersectPlane(planoPiso, new T.Vector3());
}

const toques = new Map();
let arr = null; // gesto em andamento
let ultimoToque = null;

function aoPressionar(e) {
  toques.set(e.pointerId, true);
  if (foto.ativa || cinema.modo === 'uso') {
    if (vista.caminhar && toques.size === 1) {
      arr = { id: e.pointerId, x: e.clientX, y: e.clientY, alvo: null, movido: false, olhar: true, yaw0: andar.yaw, pitch0: andar.pitch };
      renderer.domElement.setPointerCapture(e.pointerId);
    }
    return;
  }
  if (toques.size > 1) { if (arr?.arrastavel) cancelarArraste(); arr = null; return; }
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  if (regua.ativa) { arr = { id: e.pointerId, x: e.clientX, y: e.clientY, alvo: null, movido: false }; return; }
  const alvo = alvoEm(e);
  arr = { id: e.pointerId, x: e.clientX, y: e.clientY, alvo, movido: false };
  const jaSel = (tipo) => alvo?.tipo === tipo && sel?.tipo === tipo && sel.id === alvo.id;
  const paredeSel = jaSel('parede') && !parede(alvo.id)?.demolida;
  // caminhando, nada se mexe: arrastar só olha em volta
  // só se arrasta o que JÁ está selecionado: o primeiro toque seleciona, e
  // arrastar fora dele gira a câmera (nada se mexe sem querer)
  if (modo === 'arrumar' && !vista.caminhar && alvo?.tipo === 'alca') { iniciarAlca(e, alvo); return; }
  // modo Planta: outras ferramentas agem ao soltar (arrastar move a vista);
  // com Selecionar, arrastam-se as pontas da parede e as portas/janelas
  const selecionando = modo === 'desenhar' && desenho.ferramenta === 'selecionar';
  if (selecionando) {
    const fim = pontaPerto(e), ab = paredeSel && alvo.abertura && doc.planta.aberturas.find((a) => a.id === alvo.abertura);
    const extra = fim ? { ponta: { id: sel.id, fim }, planta0: clonar(doc.planta), delta: null } : null;
    if (!extra && ab) {
      const w = parede(ab.parede), p = pontoNoPiso(e);
      if (p) Object.assign(arr, { abertura: { id: ab.id, parede: w.id, pega: (horizontal(w) ? p.x - w.x1 : p.z - w.z1) - ab.pos } });
    }
    if (extra || arr.abertura) {
      ctlAtivo().enabled = false;
      Object.assign(arr, { arrastavel: true, estado: JSON.stringify(doc) }, extra);
      renderer.domElement.setPointerCapture(e.pointerId);
      return;
    }
  }
  if (!vista.caminhar && ((modo === 'arrumar' && (jaSel('movel') || paredeSel || jaSel('zona'))) || (selecionando && paredeSel))) {
    const inicio = pontoNoPiso(e);
    if (!inicio) return;
    ctlAtivo().enabled = false;
    Object.assign(arr, { arrastavel: true, estado: JSON.stringify(doc), inicio });
    if (alvo.tipo === 'movel') {
      const m = movel(alvo.id);
      Object.assign(arr, { x0: m.x, z0: m.z });
      if (sel?.id !== m.id) selecionar({ tipo: 'movel', id: m.id });
    } else if (alvo.tipo === 'zona') {
      const z = zona(alvo.id);
      Object.assign(arr, { x0: z.x, z0: z.z });
    } else {
      arr.planta0 = clonar(doc.planta);
      arr.delta = 0;
    }
    renderer.domElement.setPointerCapture(e.pointerId);
  } else if (vista.caminhar) {
    Object.assign(arr, { olhar: true, yaw0: andar.yaw, pitch0: andar.pitch });
    renderer.domElement.setPointerCapture(e.pointerId);
  }
}

function aoMover(e) {
  if (modo === 'desenhar' && !arr?.arrastavel) pairarDesenho(e);
  if (!arr || e.pointerId !== arr.id) return;
  if (!arr.movido && Math.hypot(e.clientX - arr.x, e.clientY - arr.y) > (e.pointerType === 'touch' ? 10 : 4)) arr.movido = true;
  if (arr.alca) { moverAlca(e); return; }
  if (arr.olhar && arr.movido) {
    andar.yaw = arr.yaw0 + (e.clientX - arr.x) * 0.0045;
    andar.pitch = Math.max(-1.2, Math.min(1.2, arr.pitch0 + (e.clientY - arr.y) * 0.0045));
    aplicarCameraAndar();
    return;
  }
  if (!arr.arrastavel || !arr.movido) return;
  if (arr.ponta) { moverPonta(e); return; }
  if (arr.abertura) { moverAberturaArrastada(e); return; }
  const p = pontoNoPiso(e);
  if (!p) return;
  if (arr.alvo.tipo === 'movel') {
    const m = movel(arr.alvo.id);
    m.x = arr.x0 + (p.x - arr.inicio.x);
    m.z = arr.z0 + (p.z - arr.inicio.z);
    encaixar(m);
    const encostou = e.altKey ? [] : encostar(m);
    dica(encostou.length ? `Encostado: ${[...new Set(encostou)].join(' e ')}` : '');
    objMovel.get(m.id)?.position.set(m.x, m.y || 0, m.z);
    verificarColisoes();
    desenharSelecao();
    renderPainelPosicao();
  } else if (arr.alvo.tipo === 'zona') {
    const z = zona(arr.alvo.id);
    z.x = snap(arr.x0 + (p.x - arr.inicio.x) - z.l / 2) + z.l / 2;
    z.z = snap(arr.z0 + (p.z - arr.inicio.z) - z.p / 2) + z.p / 2;
    construirZonas();
  } else {
    const w0 = arr.planta0.paredes.find((w) => w.id === arr.alvo.id);
    const hz = horizontal(w0);
    const d = snap(hz ? p.z - arr.inicio.z : p.x - arr.inicio.x);
    if (d === arr.delta) return;
    const nova = clonar(arr.planta0);
    if (hz) esticar(nova, 'z', w0.z1, w0.x1, w0.x2, d);
    else esticar(nova, 'x', w0.x1, w0.z1, w0.z2, d);
    if (problemaPlanta(nova, arr.planta0)) return;
    arr.delta = d;
    sincronizarAmbientes(nova);
    doc.planta = nova;
    construirPlanta();
    verificarColisoes();
    desenharSelecao();
    desenharOverlay();
    renderAreas();
    dica(`${d > 0 ? '+' : ''}${d} cm`);
  }
}

function aoSoltar(e) {
  toques.delete(e.pointerId);
  if (!arr || e.pointerId !== arr.id) return;
  const g = arr;
  arr = null;
  if (g.alca) { soltarAlca(g); return; }
  if (g.arrastavel) {
    ctlAtivo().enabled = !vista.caminhar;
    if (g.movido) { registrar(g.estado); atualizarTudo(); }
    dica('');
    return;
  }
  if (g.olhar && (g.movido || foto.ativa)) return;
  if (g.movido) return; // foi órbita/arraste de câmera
  const a = g.alvo;
  if (regua.ativa && !vista.caminhar) { pontoRegua(e); return; }
  if (modo === 'desenhar' && cliqueDesenho(e)) return;
  // toque duplo (fora do caminhar): aproxima naquele ponto
  const agora = performance.now();
  if (!vista.caminhar && ultimoToque && agora - ultimoToque.t < 320 && Math.hypot(e.clientX - ultimoToque.x, e.clientY - ultimoToque.y) < 30) {
    ultimoToque = null;
    raioDe(e);
    const hit = ray.intersectObjects([grpMoveis, grpPlanta], true)[0];
    const p = hit ? hit.point : pontoNoPiso(e);
    if (p) zoomEm(p, 0.55);
    return;
  }
  ultimoToque = { t: agora, x: e.clientX, y: e.clientY };
  if (modo === 'visitar' && !vista.caminhar) return; // visitando: tocar não seleciona nada
  if (vista.caminhar) { // toque: anda até o ponto (ou até perto do móvel/parede tocado)
    raioDe(e);
    const hit = ray.intersectObjects([grpMoveis, grpPlanta], true).find((h) => h.object.userData.tipo);
    let p = hit ? hit.point.clone() : pontoNoPiso(e);
    if (p && hit && hit.point.y > 3) {
      const dx = p.x - andar.x, dz = p.z - andar.z, d = Math.hypot(dx, dz);
      const parar = Math.max(0, d - 55);
      p = { x: andar.x + (dx / (d || 1)) * parar, z: andar.z + (dz / (d || 1)) * parar };
    }
    if (p && naPlanta(p.x, p.z)) andarPara(p.x, p.z);
    return;
  }
  if (!a) selecionar(null);
  else if (a.tipo === 'movel' && modo === 'arrumar' && sel?.tipo === 'movel' && (e.shiftKey || escolhendoOutro)) { escolhendoOutro = false; adicionarSelecao(a.id); }
  else if (a.tipo === 'movel') selecionar({ tipo: 'movel', id: a.id });
  else if (a.tipo === 'parede') selecionar({ tipo: 'parede', id: a.id, abertura: a.abertura });
  else if (a.tipo === 'ambiente') selecionar({ tipo: 'ambiente', id: a.id });
  else if (a.tipo === 'zona') selecionar({ tipo: 'zona', id: a.id });
}

function cancelarArraste() {
  if (!arr) return;
  ctlAtivo().enabled = !vista.caminhar;
  doc = JSON.parse(arr.estado);
  arr = null;
  atualizarTudo();
}

const tela = renderer.domElement;
tela.addEventListener('pointerdown', aoPressionar, { capture: true });
tela.addEventListener('pointermove', aoMover);
tela.addEventListener('pointerup', aoSoltar);
tela.addEventListener('pointercancel', aoSoltar);
tela.addEventListener('contextmenu', (e) => e.preventDefault());

// ---- ações sobre móveis
function adicionarMovel(tipo) {
  const def = defCatalogo(tipo);
  if (!def) return;
  // coloca no ponto do piso que está no centro da tela (ou no maior ambiente)
  const r = tela.getBoundingClientRect();
  let p = vista.caminhar
    ? { x: andar.x - Math.sin(andar.yaw) * 120, z: andar.z - Math.cos(andar.yaw) * 120 }
    : pontoNoPiso({ clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 });
  if (!p || !naPlanta(p.x, p.z)) {
    const maior = [...doc.planta.ambientes].sort((a, b) => areaUtil(b) - areaUtil(a))[0];
    const c = centroPlanta();
    const [x, z] = maior ? centroRotulo(poligonoUtil(maior)) : [c.cx, c.cz];
    p = { x, z };
  }
  const m = prepararMovel({ tipo, x: p.x, z: p.z, rot: 0 });
  encaixar(m);
  alterar(() => cen().moveis.push(m));
  selecionar({ tipo: 'movel', id: m.id });
}
function girar(sentido = 1) {
  const m = sel?.tipo === 'movel' && movel(sel.id);
  if (m) alterar(() => { m.rot = (m.rot + 90 * sentido + 360) % 360; });
}
function removerSelecionado() {
  if (sel?.tipo !== 'movel') return;
  const id = sel.id;
  alterar(() => { cen().moveis = cen().moveis.filter((m) => m.id !== id); });
  selecionar(null);
}
function duplicarSelecionado() {
  const m = sel?.tipo === 'movel' && movel(sel.id);
  if (!m) return;
  const c = { ...clonar(m), id: novoId('m'), x: m.x + 20, z: m.z + 20 };
  encaixar(c);
  alterar(() => cen().moveis.push(c));
  selecionar({ tipo: 'movel', id: c.id });
}
// move pelas setas da tela: "para cima" é o que sobe na tela, em qualquer vista
function empurrarTela(dir, passo = CFG.grade) {
  const cam = camAtiva(), c = ctlAtivo().target.clone();
  const tela = { cima: [0, 1], baixo: [0, -1], esq: [-1, 0], dir: [1, 0] }[dir];
  const p0 = c.clone().project(cam);
  let melhor = null, nota = -Infinity;
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const p1 = c.clone().add(new T.Vector3(dx * 100, 0, dz * 100)).project(cam);
    const v = [(p1.x - p0.x) * palco.clientWidth, (p1.y - p0.y) * palco.clientHeight], n = Math.hypot(...v) || 1;
    const d = (v[0] * tela[0] + v[1] * tela[1]) / n;
    if (d > nota) { nota = d; melhor = [dx, dz]; }
  }
  empurrar(melhor[0] * passo, melhor[1] * passo);
}
function empurrar(dx, dz) {
  const m = sel?.tipo === 'movel' && movel(sel.id);
  if (m) alterar(() => { m.x += dx; m.z += dz; });
}

// ---- teclado
const MODOS_TECLA = { 1: 'desenhar', 2: 'arrumar', 3: 'conferir', 4: 'visitar' };
const FERRAMENTAS_TECLA = { v: 'selecionar', p: 'parede', o: 'porta', j: 'janela', e: 'apagar' };
document.addEventListener('keydown', (e) => {
  if (e.target.closest('input, textarea, select, dialog')) return;
  const ctrl = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
  if (foto.ativa || !$('#fotoMenu').hidden) { if (k === 'escape') fecharFoto(); return; }
  if (cinema.modo) {
    if (k === 'escape') pararCinema();
    else if (k === ' ') { e.preventDefault(); alternarPausaCinema(); }
    if (!vista.caminhar) return;
  }
  // modo Planta: medida digitada, concluir, apagar e desfazer trechos
  if (modo === 'desenhar' && !e.altKey) {
    if (!ctrl && /^[0-9]$/.test(k) && desenho.pontos.length && $('#medidaTrecho')) { $('#medidaTrecho').focus(); return; }
    if (k === 'escape' || (k === 'enter' && desenho.pontos.length)) {
      if (desenho.pontos.length) concluirParedes();
      else if (desenho.ferramenta !== 'selecionar') setFerramenta('selecionar');
      else selecionar(null);
      return;
    }
    if ((k === 'delete' || k === 'backspace') && sel?.tipo === 'parede') {
      e.preventDefault();
      if (sel.abertura) apagarAbertura(sel.abertura); else apagarParede(sel.id);
      return;
    }
    if (ctrl && k === 'z' && !e.shiftKey && desenho.pontos.length) { e.preventDefault(); desfazerDesenho(); return; }
    if (!ctrl && FERRAMENTAS_TECLA[k]) { setFerramenta(FERRAMENTAS_TECLA[k]); return; }
  }
  if (!ctrl && !e.altKey && MODOS_TECLA[k]) { setModo(MODOS_TECLA[k]); return; }
  if (!ctrl && k === 'f') { abrirFoto(); return; }
  if (!ctrl && k === 'm') { alternarRegua(); return; }
  if (k === 'escape' && regua.ativa) { alternarRegua(false); return; }
  if (!ctrl && (k === '+' || k === '=')) { zoomPasso(0.7); return; }
  if (!ctrl && (k === '-' || k === '_')) { zoomPasso(1.45); return; }
  const edita = ['delete', 'backspace', 'r'].includes(k) || (ctrl && k === 'd') || (k.startsWith('arrow') && !vista.caminhar);
  if (modo !== 'arrumar' && edita) return;
  if (ctrl && k === 'z' && !e.shiftKey) { e.preventDefault(); desfazer(); }
  else if (ctrl && (k === 'y' || (k === 'z' && e.shiftKey))) { e.preventDefault(); refazer(); }
  else if (ctrl && k === 'd') { e.preventDefault(); duplicarSelecionado(); }
  else if (ctrl) return;
  else if (k === 'delete' || k === 'backspace') { e.preventDefault(); removerSelecionado(); }
  else if (vista.caminhar && ['w', 's', 'a', 'd'].includes(k)) {
    passoAndar(k === 'w' ? 30 : k === 's' ? -30 : 0, k === 'd' ? 30 : k === 'a' ? -30 : 0);
  }
  else if (vista.caminhar && k.startsWith('arrow') && sel?.tipo !== 'movel') {
    e.preventDefault();
    if (k === 'arrowup' || k === 'arrowdown') passoAndar(k === 'arrowup' ? 30 : -30, 0);
    else { andar.yaw += k === 'arrowleft' ? 0.15 : -0.15; aplicarCameraAndar(); }
  }
  else if (k === 'r') girar(e.shiftKey ? -1 : 1);
  else if (k === 't') alternarVista();
  else if (k === 'c') alternarCaminhada();
  else if (k === 'escape') selecionar(null);
  else if (k.startsWith('arrow')) {
    e.preventDefault();
    const s = e.shiftKey ? 25 : CFG.grade;
    empurrar(k === 'arrowleft' ? -s : k === 'arrowright' ? s : 0, k === 'arrowup' ? -s : k === 'arrowdown' ? s : 0);
  }
});

// =====================================================================
// 8b. DESENHAR A PLANTA — paredes, portas, janelas e planta de fundo
// =====================================================================
// No modo Planta a vista fica de cima e os móveis se escondem.
//  - Parede: toque no início e em cada canto (sempre na horizontal ou na
//    vertical); cada trecho vira uma parede na hora. O ponto encaixa nas
//    pontas e na linha das paredes existentes, no alinhamento de outras
//    pontas e na grade de 5 cm. Digite a medida para um trecho exato.
//    Esc, Concluir ou tocar no primeiro ponto terminam.
//  - Porta, janela, porta de correr: toque numa parede.
//  - Apagar: toque numa parede, porta ou janela.
//  - Selecionar: toque numa parede; arraste-a, arraste as pontas (muda o
//    comprimento) ou arraste uma porta/janela ao longo dela.
// Os ambientes aparecem sozinhos quando uma região se fecha (seção 3).
const PREF_DESENHO = `${CFG.prefixo}desenho`;
const desenho = Object.assign({ esp: 15, encaixe: true, cotas: true, moveis: false },
  (() => { try { return JSON.parse(localStorage.getItem(PREF_DESENHO)) || {}; } catch { return {}; } })(),
  { ferramenta: 'selecionar', pontos: [], cursor: null, calib: null, mover: null, zoom: 0 });
const guardarDesenho = () => {
  try { localStorage.setItem(PREF_DESENHO, JSON.stringify({ esp: desenho.esp, encaixe: desenho.encaixe, cotas: desenho.cotas, moveis: desenho.moveis })); } catch { /* ok */ }
};
const FERRAMENTAS = {
  selecionar: { nome: 'Selecionar', icone: '↖', dica: 'Toque numa parede ou ambiente para editar. Arraste a parede selecionada, as pontas dela ou uma porta/janela.' },
  parede: { nome: 'Parede', icone: '▭', dica: 'Toque no início e em cada canto. Digite a medida para um trecho exato.' },
  porta: { nome: 'Porta', icone: '◜', dica: 'Toque numa parede, do lado para onde a porta abre.' },
  janela: { nome: 'Janela', icone: '▤', dica: 'Toque numa parede para pôr a janela.' },
  correr: { nome: 'Correr', icone: '⇆', dica: 'Toque numa parede para pôr a porta de correr.' },
  apagar: { nome: 'Apagar', icone: '⌫', dica: 'Toque numa parede, porta ou janela para apagar.' },
  calibrar: { nome: 'Calibrar', icone: '📏', dica: 'Toque nas duas pontas de uma medida conhecida do desenho de fundo.' },
  moverFundo: { nome: 'Mover fundo', icone: '✥', dica: 'Toque num ponto do desenho de fundo e depois onde ele deve ficar.' },
};
const PADRAO_ABERTURA = {
  porta: { largura: 80, altura: 210, dobradica: 'inicio', lado: 1 },
  janela: { largura: 120, altura: 120, peitoril: 100 },
  correr: { largura: 160, altura: 210 },
};

const grpDesenho = new T.Group();
grpDesenho.renderOrder = 12;
cena.add(grpDesenho);
const semProfundidade = { depthTest: false, depthWrite: false, transparent: true };
const MAT_D = {
  previa: new T.MeshBasicMaterial({ color: '#2f80ed', opacity: 0.4, ...semProfundidade }),
  apagar: new T.MeshBasicMaterial({ color: '#e5484d', opacity: 0.45, ...semProfundidade }),
  abertura: new T.MeshBasicMaterial({ color: '#f2994a', opacity: 0.7, ...semProfundidade }),
  ponta: new T.MeshBasicMaterial({ color: '#ffffff', ...semProfundidade }),
  pontaBorda: new T.MeshBasicMaterial({ color: '#2f80ed', ...semProfundidade }),
  guia: new T.LineDashedMaterial({ color: '#e5484d', dashSize: 6, gapSize: 5, ...semProfundidade }),
  linha: new T.LineBasicMaterial({ color: '#2f80ed', ...semProfundidade }),
  calib: new T.LineBasicMaterial({ color: '#e5484d', ...semProfundidade }),
  ponto: {
    vertice: new T.MeshBasicMaterial({ color: '#27ae60', ...semProfundidade }),
    parede: new T.MeshBasicMaterial({ color: '#f2994a', ...semProfundidade }),
    alinhado: new T.MeshBasicMaterial({ color: '#e5484d', ...semProfundidade }),
    grade: new T.MeshBasicMaterial({ color: '#2f80ed', ...semProfundidade }),
    livre: new T.MeshBasicMaterial({ color: '#6b7480', ...semProfundidade }),
  },
};
const NOME_ENCAIXE = { vertice: 'na ponta', parede: 'na parede', alinhado: 'alinhado', grade: '', livre: '' };
// cm por pixel da tela, na vista de cima
const cmPorPx = () => (camTopo.top - camTopo.bottom) / camTopo.zoom / Math.max(1, palco.clientHeight);

function setFerramenta(f) {
  if (desenho.pontos.length) concluirParedes();
  desenho.ferramenta = f;
  desenho.calib = null; desenho.mover = null; desenho.cursor = null;
  document.body.dataset.ferramenta = f;
  dica(modo === 'desenhar' ? FERRAMENTAS[f].dica : '');
  renderBarraDesenho();
  desenharOverlay();
}

// ---- encaixe
const pontasParedes = () => doc.planta.paredes.flatMap((w) => [[w.x1, w.z1], [w.x2, w.z2]]);
// parede mais perto de um ponto (na linha de centro, dentro do comprimento)
function paredePerto(x, z, tol) {
  let melhor = null;
  for (const w of doc.planta.paredes) {
    const hz = horizontal(w);
    const [a0, a1] = hz ? [w.x1, w.x2] : [w.z1, w.z2], u = hz ? x : z, d = Math.abs(hz ? z - w.z1 : x - w.x1);
    if (u < a0 - 0.5 || u > a1 + 0.5 || d > w.esp / 2 + tol) continue;
    if (!melhor || d < melhor.d) melhor = { w, d, u: u - a0 };
  }
  return melhor;
}
// O ponto da parede que está sendo desenhada: ortogonal a partir da
// âncora (último ponto); encaixa em pontas, paredes, alinhamentos e grade.
function encaixarPonto(p, ancora) {
  const tol = (ehToque ? 22 : 12) * cmPorPx();
  const vs = pontasParedes();
  const grade = (v) => (desenho.encaixe ? snap(v) : Math.round(v));
  if (!ancora) {
    let v = null, dv = tol;
    for (const q of vs) { const d = Math.hypot(q[0] - p.x, q[1] - p.z); if (d < dv) { v = q; dv = d; } }
    if (v) return { x: v[0], z: v[1], tipo: 'vertice' };
    const pw = paredePerto(p.x, p.z, tol);
    if (pw) {
      const hz = horizontal(pw.w), u = grade(pw.u) + (hz ? pw.w.x1 : pw.w.z1);
      return hz ? { x: u, z: pw.w.z1, tipo: 'parede' } : { x: pw.w.x1, z: u, tipo: 'parede' };
    }
    // alinhado com alguma ponta (x ou z), senão a grade
    const r = { x: grade(p.x), z: grade(p.z), tipo: 'grade', guias: [] };
    const ax = vs.filter((q) => Math.abs(q[0] - p.x) < tol).sort((a, b) => Math.abs(a[0] - p.x) - Math.abs(b[0] - p.x))[0];
    const az = vs.filter((q) => Math.abs(q[1] - p.z) < tol).sort((a, b) => Math.abs(a[1] - p.z) - Math.abs(b[1] - p.z))[0];
    if (ax) { r.x = ax[0]; r.tipo = 'alinhado'; r.guias.push(ax); }
    if (az) { r.z = az[1]; r.tipo = 'alinhado'; r.guias.push(az); }
    return r;
  }
  // ortogonal: anda só em x ou só em z a partir da âncora
  const eixo = Math.abs(p.x - ancora[0]) >= Math.abs(p.z - ancora[1]) ? 'x' : 'z';
  const fixo = eixo === 'x' ? ancora[1] : ancora[0], livre = eixo === 'x' ? p.x : p.z;
  const cands = [];
  for (const q of vs) {
    const c = eixo === 'x' ? q[0] : q[1], mesmaLinha = Math.abs((eixo === 'x' ? q[1] : q[0]) - fixo) < 0.5;
    cands.push({ v: c, tipo: mesmaLinha ? 'vertice' : 'alinhado', guia: mesmaLinha ? null : q, pr: mesmaLinha ? 0 : 2 });
  }
  for (const w of doc.planta.paredes) { // parede atravessada: a ponta encosta nela (um "tê")
    if (horizontal(w) === (eixo === 'x')) continue;
    const [a0, a1] = eixo === 'x' ? [w.z1, w.z2] : [w.x1, w.x2];
    if (fixo >= a0 - 0.5 && fixo <= a1 + 0.5) cands.push({ v: eixo === 'x' ? w.x1 : w.z1, tipo: 'parede', pr: 1 });
  }
  if (desenho.primeiro && desenho.pontos.length > 1) {
    const q = desenho.pontos[0], c = eixo === 'x' ? q[0] : q[1];
    cands.push({ v: c, tipo: Math.abs((eixo === 'x' ? q[1] : q[0]) - fixo) < 0.5 ? 'vertice' : 'alinhado', guia: q, pr: 0 });
  }
  const perto = cands.filter((c) => Math.abs(c.v - livre) < tol && Math.abs(c.v - (eixo === 'x' ? ancora[0] : ancora[1])) > 0.5)
    .sort((a, b) => a.pr - b.pr || Math.abs(a.v - livre) - Math.abs(b.v - livre))[0];
  // a grade conta a partir da âncora (trechos com medida redonda)
  const base = eixo === 'x' ? ancora[0] : ancora[1];
  const v = perto ? perto.v : base + grade(livre - base);
  const r = eixo === 'x' ? { x: v, z: fixo } : { x: fixo, z: v };
  return { ...r, tipo: perto ? perto.tipo : 'grade', guias: perto?.guia ? [perto.guia] : [], eixo };
}

// ---- criar e apagar
// Paredes na mesma linha que se tocam (e têm a mesma espessura) viram uma só.
function juntarColineares(planta, w) {
  for (let mudou = true; mudou;) {
    mudou = false;
    for (const o of planta.paredes) {
      if (o === w || o.esp !== w.esp || !!o.demolida !== !!w.demolida || horizontal(o) !== horizontal(w)) continue;
      const hz = horizontal(w);
      if (Math.abs(hz ? o.z1 - w.z1 : o.x1 - w.x1) > 0.5) continue;
      const [a0, a1] = hz ? [w.x1, w.x2] : [w.z1, w.z2], [b0, b1] = hz ? [o.x1, o.x2] : [o.z1, o.z2];
      if (b0 > a1 + 0.5 || a0 > b1 + 0.5) continue;
      // a parede que já existia (o) fica, com nome e cor; a nova (w) entra nela
      const ini = Math.min(a0, b0), fim = Math.max(a1, b1);
      for (const ab of planta.aberturas) {
        if (ab.parede === o.id) ab.pos += b0 - ini;
        else if (ab.parede === w.id) { ab.parede = o.id; ab.pos += a0 - ini; }
      }
      if (hz) { o.x1 = ini; o.x2 = fim; } else { o.z1 = ini; o.z2 = fim; }
      planta.paredes = planta.paredes.filter((p) => p !== w);
      w = o; mudou = true; break;
    }
  }
  return w;
}
function adicionarParede(a, b) {
  if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 10) { toast('Trecho curto demais (mínimo 10 cm).'); return false; }
  const nomes = new Set(doc.planta.paredes.map((w) => w.nome));
  let n = doc.planta.paredes.length + 1;
  while (nomes.has(`Parede ${n}`)) n++;
  const w = { id: novoId('p'), nome: `Parede ${n}`, x1: Math.min(a[0], b[0]), z1: Math.min(a[1], b[1]), x2: Math.max(a[0], b[0]), z2: Math.max(a[1], b[1]), esp: desenho.esp };
  registrar();
  doc.planta.paredes.push(w);
  juntarColineares(doc.planta, w);
  sincronizarAmbientes(doc.planta);
  atualizarTudo();
  return true;
}
function colocarPonto(p) {
  const pts = desenho.pontos;
  if (!pts.length) { pts.push([p.x, p.z]); desenho.primeiro = true; renderBarraDesenho(); desenharOverlay(); return; }
  const a = pts[pts.length - 1];
  if (Math.hypot(p.x - a[0], p.z - a[1]) < 0.5) return;
  if (!adicionarParede(a, [p.x, p.z])) return;
  const fechou = pts.length > 1 && Math.hypot(p.x - pts[0][0], p.z - pts[0][1]) < 0.5;
  pts.push([p.x, p.z]);
  if (fechou) { concluirParedes(); toast('Contorno fechado.'); return; }
  renderBarraDesenho(); desenharOverlay();
}
function concluirParedes() {
  desenho.pontos = [];
  desenho.primeiro = false;
  renderBarraDesenho(); desenharOverlay();
}
// medida digitada: o próximo canto fica a essa distância, na direção do
// cursor (ou da seta escolhida)
function trechoComMedida(cm, dir) {
  const a = desenho.pontos[desenho.pontos.length - 1];
  if (!a || !(cm >= 10)) { toast('Digite uma medida de pelo menos 10 cm.'); return; }
  if (!dir) {
    const c = desenho.cursor;
    if (!c || (Math.abs(c.x - a[0]) < 0.5 && Math.abs(c.z - a[1]) < 0.5)) { toast('Escolha a direção com as setas.'); return; }
    dir = Math.abs(c.x - a[0]) >= Math.abs(c.z - a[1]) ? [Math.sign(c.x - a[0]), 0] : [0, Math.sign(c.z - a[1])];
  }
  colocarPonto({ x: a[0] + dir[0] * cm, z: a[1] + dir[1] * cm });
}
function apagarParede(id) {
  alterar(() => {
    doc.planta.paredes = doc.planta.paredes.filter((w) => w.id !== id);
    doc.planta.aberturas = doc.planta.aberturas.filter((a) => a.parede !== id);
    sincronizarAmbientes(doc.planta);
  });
}
function apagarAbertura(id) {
  alterar(() => { doc.planta.aberturas = doc.planta.aberturas.filter((a) => a.id !== id); });
}
// posição livre mais perto de 'pos' para uma abertura de largura 'larg'
function posicaoLivre(w, pos, larg, ignorar) {
  const L = comprimento(w);
  if (larg > L) return null;
  const ocupados = doc.planta.aberturas.filter((a) => a.parede === w.id && a.id !== ignorar).map((a) => [a.pos - 5, a.pos + a.largura + 5]);
  for (let passo = 0; passo < 400; passo++) {
    const cand = Math.round(pos + (passo % 2 ? 1 : -1) * Math.ceil(passo / 2) * 5);
    if (cand < 0 || cand + larg > L) continue;
    if (!ocupados.some(([a, b]) => cand < b && a < cand + larg)) return cand;
  }
  return null;
}
function inserirAbertura(w, p, tipo) {
  const padrao = PADRAO_ABERTURA[tipo], hz = horizontal(w);
  const u = (hz ? p.x - w.x1 : p.z - w.z1) - padrao.largura / 2;
  const pos = posicaoLivre(w, Math.max(0, snap(u)), padrao.largura);
  if (pos == null) { toast('Não há espaço livre nesta parede para essa abertura.'); return; }
  const ab = { id: novoId('ab'), tipo, parede: w.id, pos, ...padrao };
  // a porta abre para o lado tocado
  if (tipo === 'porta') ab.lado = (hz ? p.z - w.z1 : w.x1 - p.x) < 0 ? -1 : 1;
  alterar(() => doc.planta.aberturas.push(ab));
  selecionar({ tipo: 'parede', id: w.id, abertura: ab.id });
}

// ---- planta de fundo: imagem ou PDF do levantamento, sob o desenho
// A imagem fica no aparelho (IndexedDB); na planta ficam só a posição do
// canto, a escala (cm por pixel), o giro e a opacidade.
const fundoTela = { id: null, tex: null, malha: null };
function cantosFundo(f) {
  const W = f.w * f.escala, H = f.h * f.escala, g = rad(f.giro || 0), c = Math.cos(g), s = Math.sin(g);
  return [[0, 0], [W, 0], [W, H], [0, H]].map(([u, v]) => [f.x + u * c - v * s, f.z + u * s + v * c]);
}
async function texturaFundo(id) {
  if (fundoTela.id === id && fundoTela.tex) return fundoTela.tex;
  const blob = await idb.ler('fundos', id).catch(() => null);
  if (!blob) return null;
  // como imagem comum (e não ImageBitmap), para o WebGL virar na vertical como nas outras texturas
  const url = URL.createObjectURL(blob);
  const img = await new Promise((ok, erro) => { const i = new Image(); i.onload = () => ok(i); i.onerror = erro; i.src = url; });
  URL.revokeObjectURL(url);
  const tex = new T.Texture(img);
  tex.colorSpace = T.SRGBColorSpace;
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  tex.needsUpdate = true;
  fundoTela.tex?.dispose();
  Object.assign(fundoTela, { id, tex });
  return tex;
}
let pedidoFundo = 0;
async function construirFundo() {
  const f = doc.planta.fundo, pedido = ++pedidoFundo;
  if (fundoTela.malha) { cena.remove(fundoTela.malha); fundoTela.malha.geometry.dispose(); fundoTela.malha.material.dispose(); fundoTela.malha = null; }
  if (!f || !f.visivel || modo !== 'desenhar') return;
  const tex = await texturaFundo(f.id);
  if (!tex || pedido !== pedidoFundo || doc.planta.fundo !== f) return;
  const W = f.w * f.escala, H = f.h * f.escala, g = rad(f.giro || 0);
  const geo = new T.PlaneGeometry(W, H);
  geo.rotateX(-Math.PI / 2);
  const malha = new T.Mesh(geo, new T.MeshBasicMaterial({ map: tex, transparent: true, opacity: f.opacidade ?? 0.6, depthWrite: false, toneMapped: false }));
  malha.rotation.y = -g;
  malha.position.set(f.x + (W / 2) * Math.cos(g) - (H / 2) * Math.sin(g), 0.6, f.z + (W / 2) * Math.sin(g) + (H / 2) * Math.cos(g));
  malha.renderOrder = 1;
  fundoTela.malha = malha;
  cena.add(malha);
}

// pdf.js vai embutido (comprimido) no próprio arquivo e só é carregado na
// primeira vez que se abre um PDF; roda na página, sem worker separado.
let pdfjsPronto = null;
function carregarPdfjs() {
  pdfjsPronto ??= (async () => {
    for (const id of ['pdfjsWorkerZ', 'pdfjsZ']) {
      const bytes = Uint8Array.from(atob($(`#${id}`).textContent.trim()), (c) => c.charCodeAt(0));
      const txt = await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
      const url = URL.createObjectURL(new Blob([txt], { type: 'text/javascript' }));
      await new Promise((ok, erro) => document.head.append(el('script', { src: url, onload: ok, onerror: erro })));
    }
    return window.pdfjsLib;
  })().catch((err) => { pdfjsPronto = null; throw err; });
  return pdfjsPronto;
}
const paraBlob = (canvas, tipo = 'image/jpeg', q = 0.9) => new Promise((ok) => canvas.toBlob(ok, tipo, q));
async function lerPDF(arquivo) {
  dica('Abrindo o PDF…');
  const pdfjsLib = await carregarPdfjs();
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(await arquivo.arrayBuffer()) }).promise;
  let n = 1;
  if (pdf.numPages > 1) {
    const r = await pedirCampos('Página do PDF', [{ nome: 'pagina', rotulo: `Qual página (1 a ${pdf.numPages})?`, valor: 1, tipo: 'numero' }]);
    if (!r) { dica(''); return null; }
    n = Math.min(pdf.numPages, Math.max(1, Math.round(r.pagina) || 1));
  }
  dica('Desenhando a página…');
  const pagina = await pdf.getPage(n), vp1 = pagina.getViewport({ scale: 1 });
  const max = Math.min(renderer.capabilities.maxTextureSize, ehToque ? 3072 : 4096);
  const k = Math.min(max / vp1.width, max / vp1.height, 8), vp = pagina.getViewport({ scale: k });
  const c = Object.assign(document.createElement('canvas'), { width: Math.floor(vp.width), height: Math.floor(vp.height) });
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, c.width, c.height);
  await pagina.render({ canvasContext: g, viewport: vp }).promise;
  pdf.destroy();
  dica('');
  // 1 ponto do PDF = 1/72 polegada = 2,54/72 cm no papel
  return { blob: await paraBlob(c), w: c.width, h: c.height, cmPapel: 2.54 / 72 / k, nome: `${arquivo.name} (p. ${n})` };
}
async function lerImagem(arquivo) {
  const img = await createImageBitmap(arquivo);
  // imagens enormes são reduzidas ao tamanho máximo de textura
  const max = Math.min(renderer.capabilities.maxTextureSize, ehToque ? 4096 : 8192), k = Math.min(1, max / Math.max(img.width, img.height));
  if (k === 1) return { blob: arquivo, w: img.width, h: img.height, nome: arquivo.name };
  const c = Object.assign(document.createElement('canvas'), { width: Math.round(img.width * k), height: Math.round(img.height * k) });
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return { blob: await paraBlob(c), w: c.width, h: c.height, nome: arquivo.name };
}
async function carregarFundo(arquivo) {
  try {
    const pdf = /pdf$/i.test(arquivo.type) || /\.pdf$/i.test(arquivo.name);
    const r = pdf ? await lerPDF(arquivo) : await lerImagem(arquivo);
    if (!r) return;
    const id = novoId('fundo');
    await idb.gravar('fundos', id, r.blob);
    const b = doc.planta.paredes.length ? centroPlanta() : null;
    // PDF: começa em 1:50; imagem: com 10 m de largura. Depois, calibrar.
    const escala = r.cmPapel ? r.cmPapel * 50 : 1000 / r.w;
    const f = { id, nome: r.nome, w: r.w, h: r.h, escala, cmPapel: r.cmPapel || null, giro: 0, opacidade: 0.6, visivel: true,
      x: b ? b.cx - b.w / 2 : 0, z: b ? b.cz - b.d / 2 : 0 };
    const antigo = doc.planta.fundo;
    alterar(() => { doc.planta.fundo = f; });
    if (antigo) apagarImagemFundoSeSolta(antigo.id);
    if (!doc.planta.paredes.length) enquadrar();
    setFerramenta('calibrar');
    toast(pdf ? 'PDF carregado em 1:50. Confira a escala: toque nas duas pontas de uma medida conhecida.' : 'Imagem carregada. Agora calibre: toque nas duas pontas de uma medida conhecida.');
  } catch (err) {
    console.error(err);
    dica('');
    toast('Não consegui abrir esse arquivo. Use uma imagem (JPG, PNG) ou um PDF.');
  }
}
// apaga a imagem do aparelho se nenhum projeto (nem o histórico) a usa
function apagarImagemFundoSeSolta(id) {
  if (JSON.stringify(doc).includes(id) || hist.voltar.some((s) => s.includes(id))) return;
  if (listaProjetos().some((p) => p.id !== doc.id && (localStorage.getItem(chaveProjeto(p.id)) || '').includes(id))) return;
  idb.apagar('fundos', id).catch(() => {});
}
function cliqueCalibrar(p) {
  const f = doc.planta.fundo;
  if (!f) { setFerramenta('selecionar'); return; }
  if (!desenho.calib) { desenho.calib = [p.x, p.z]; dica('Agora toque na outra ponta da medida.'); desenharOverlay(); return; }
  const [ax, az] = desenho.calib, d = Math.hypot(p.x - ax, p.z - az);
  desenho.calib = [ax, az, p.x, p.z];
  desenharOverlay();
  if (d < 1) { desenho.calib = null; return; }
  pedirCampos('Calibrar a escala', [{ nome: 'real', rotulo: `Medida real entre os dois pontos (hoje ${fmt(Math.round(d))} cm)`, valor: Math.round(d), tipo: 'numero', sufixo: 'cm' }]).then((r) => {
    desenho.calib = null;
    if (r && r.real > 0) {
      const k = r.real / d;
      alterar(() => { Object.assign(doc.planta.fundo, { escala: f.escala * k, x: ax + (f.x - ax) * k, z: az + (f.z - az) * k }); });
      if (!doc.planta.paredes.length) enquadrar(); // ainda sem paredes: mostra o desenho inteiro na nova escala
      toast(`Escala ajustada${f.cmPapel ? ` (1:${fmt(Math.round((f.escala * k) / f.cmPapel))})` : ''}.`);
    }
    setFerramenta('selecionar');
  });
}
function cliqueMoverFundo(p, e) {
  if (!doc.planta.fundo) { setFerramenta('selecionar'); return; }
  if (!desenho.mover) { desenho.mover = [p.x, p.z]; dica('Agora toque onde esse ponto deve ficar (encaixa nas pontas das paredes).'); desenharOverlay(); return; }
  const alvo = encaixarPonto(p, null), [ax, az] = desenho.mover;
  alterar(() => { doc.planta.fundo.x += alvo.x - ax; doc.planta.fundo.z += alvo.z - az; });
  desenho.mover = null;
  setFerramenta('selecionar');
}

// ---- toques no modo Planta
function pontoDesenho(e) {
  const p = pontoNoPiso(e);
  return p ? { x: p.x, z: p.z } : null;
}
function pairarDesenho(e) {
  if (e.pointerType === 'touch') return;
  const p = pontoDesenho(e);
  if (!p) return;
  const f = desenho.ferramenta;
  desenho.cursor = f === 'parede' ? encaixarPonto(p, desenho.pontos[desenho.pontos.length - 1]) : p;
  desenharOverlay();
}
function cliqueDesenho(e) {
  const p = pontoDesenho(e);
  if (!p) return false;
  if (e.pointerType === 'touch') setTimeout(() => { if (desenho.ferramenta !== 'parede') { desenho.cursor = null; desenharOverlay(); } });
  const f = desenho.ferramenta;
  if (f === 'parede') {
    const q = encaixarPonto(p, desenho.pontos[desenho.pontos.length - 1]);
    desenho.cursor = q;
    colocarPonto(q);
    return true;
  }
  if (f === 'calibrar') { cliqueCalibrar(p); return true; }
  if (f === 'moverFundo') { cliqueMoverFundo(p, e); return true; }
  if (f in PADRAO_ABERTURA) {
    const pw = paredePerto(p.x, p.z, (ehToque ? 18 : 8) * cmPorPx());
    if (!pw) { toast('Toque em cima de uma parede.'); return true; }
    inserirAbertura(pw.w, p, f);
    return true;
  }
  if (f === 'apagar') {
    const a = alvoEm(e);
    if (a?.tipo === 'parede' && a.abertura) apagarAbertura(a.abertura);
    else if (a?.tipo === 'parede') apagarParede(a.id);
    else toast('Toque numa parede, porta ou janela.');
    return true;
  }
  return false; // selecionar: segue o clique normal
}
// ponta da parede selecionada perto do toque (para arrastar)
function pontaPerto(e) {
  if (sel?.tipo !== 'parede') return null;
  const w = parede(sel.id);
  if (!w) return null;
  const r = renderer.domElement.getBoundingClientRect(), v = new T.Vector3();
  const tol = ehToque ? 26 : 14;
  for (const fim of [1, 2]) {
    v.set(w[`x${fim}`], doc.planta.alturaParede, w[`z${fim}`]).project(camAtiva());
    const sx = r.left + ((v.x + 1) / 2) * r.width, sy = r.top + ((1 - v.y) / 2) * r.height;
    if (Math.hypot(sx - e.clientX, sy - e.clientY) < tol) return fim;
  }
  return null;
}
function moverPonta(e) {
  const w0 = arr.planta0.paredes.find((w) => w.id === arr.ponta.id), fim = arr.ponta.fim;
  const p = pontoDesenho(e);
  if (!w0 || !p) return;
  const hz = horizontal(w0), outra = fim === 1 ? [w0.x2, w0.z2] : [w0.x1, w0.z1];
  const q = encaixarPonto(hz ? { x: p.x, z: w0.z1 } : { x: w0.x1, z: p.z }, outra);
  const c0 = hz ? w0[`x${fim}`] : w0[`z${fim}`], c1 = hz ? q.x : q.z, d = c1 - c0;
  if (d === arr.delta) return;
  const nova = clonar(arr.planta0);
  // só esta parede muda de comprimento (as que estão na mesma linha ficam)
  const w = nova.paredes.find((p) => p.id === w0.id);
  w[`${hz ? 'x' : 'z'}${fim}`] = c1;
  // as aberturas contam a partir do início: puxar o início desloca a conta
  if (fim === 1) for (const ab of nova.aberturas) if (ab.parede === w.id) ab.pos -= d;
  if (problemaPlanta(nova, arr.planta0)) return;
  arr.delta = d;
  sincronizarAmbientes(nova);
  doc.planta = nova;
  construirPlanta(); desenharSelecao(); renderAreas();
  desenho.cursor = q;
  desenharOverlay();
  dica(`Comprimento: ${fmt(comprimento(parede(w0.id)))} cm`);
}
function moverAberturaArrastada(e) {
  const p = pontoDesenho(e);
  const w = parede(arr.abertura.parede), ab = doc.planta.aberturas.find((a) => a.id === arr.abertura.id);
  if (!p || !w || !ab) return;
  const hz = horizontal(w), u = (hz ? p.x - w.x1 : p.z - w.z1) - arr.abertura.pega;
  const pos = Math.max(0, Math.min(comprimento(w) - ab.largura, snap(u)));
  if (pos === ab.pos || posicaoLivre(w, pos, ab.largura, ab.id) !== pos) return;
  ab.pos = pos;
  construirPlanta();
  dica(`Do início da parede: ${fmt(pos - folgaInicio(w))} cm`);
}

// ---- desenho sobre a planta: prévia da parede, encaixe, pontas, cotas
const camadaDesenho = $('#rotulosDesenho');
let rotulosDesenho = [];
function rotuloDesenho(txt, x, z, classe = '') {
  const d = el('div', { class: `cota-parede ${classe}` }, txt);
  camadaDesenho.append(d);
  rotulosDesenho.push({ el: d, pos: new T.Vector3(x, doc.planta.alturaParede + 2, z) });
}
function retanguloMalha(x0, z0, x1, z1, mat, y) {
  const m = new T.Mesh(new T.PlaneGeometry(Math.max(0.5, Math.abs(x1 - x0)), Math.max(0.5, Math.abs(z1 - z0))), mat);
  m.rotation.x = -Math.PI / 2;
  m.position.set((x0 + x1) / 2, y, (z0 + z1) / 2);
  m.renderOrder = 12;
  grpDesenho.add(m);
  return m;
}
function desenharOverlay() {
  limpar(grpDesenho);
  camadaDesenho.textContent = '';
  rotulosDesenho = [];
  if (modo !== 'desenhar' || !doc) return;
  desenho.zoom = camTopo.zoom;
  const y = doc.planta.alturaParede + 3, px = cmPorPx(), f = desenho.ferramenta;
  const marca = (x, z, mat, tam = 5) => {
    const m = new T.Mesh(new T.CircleGeometry(tam * px, 20), mat);
    m.rotation.x = -Math.PI / 2; m.position.set(x, y + 1, z); m.renderOrder = 13;
    grpDesenho.add(m);
  };
  // cotas: comprimento de cada parede (pelo eixo), do lado de fora
  if (desenho.cotas) {
    const { cx, cz } = centroPlanta();
    for (const w of doc.planta.paredes) {
      const hz = horizontal(w), mx = (w.x1 + w.x2) / 2, mz = (w.z1 + w.z2) / 2, off = w.esp / 2 + 11 * px;
      rotuloDesenho(fmt(comprimento(w)), hz ? mx : mx + Math.sign(mx - cx || 1) * off, hz ? mz + Math.sign(mz - cz || 1) * off : mz, hz ? '' : 'vertical');
    }
  }
  // parede selecionada: pontas para arrastar
  if (sel?.tipo === 'parede' && f === 'selecionar') {
    const w = parede(sel.id);
    if (w) for (const [x, z] of [[w.x1, w.z1], [w.x2, w.z2]]) { marca(x, z, MAT_D.pontaBorda, 8); marca(x, z, MAT_D.ponta, 5.5); }
  }
  // cadeia de paredes em andamento + prévia até o cursor
  const pts = desenho.pontos, c = desenho.cursor;
  if (f === 'parede') {
    for (const q of pts) marca(q[0], q[1], MAT_D.ponto.vertice, 4);
    if (c) {
      const a = pts[pts.length - 1];
      if (a && (Math.abs(c.x - a[0]) > 0.5 || Math.abs(c.z - a[1]) > 0.5)) {
        const e = desenho.esp / 2, hz = Math.abs(c.z - a[1]) < 0.5;
        retanguloMalha(Math.min(a[0], c.x) - (hz ? 0 : e), Math.min(a[1], c.z) - (hz ? e : 0), Math.max(a[0], c.x) + (hz ? 0 : e), Math.max(a[1], c.z) + (hz ? e : 0), MAT_D.previa, y);
        const comp = Math.hypot(c.x - a[0], c.z - a[1]);
        rotuloDesenho(`${fmt(comp)} cm`, (a[0] + c.x) / 2 + (hz ? 0 : 16 * px), (a[1] + c.z) / 2 - (hz ? 16 * px : 0), 'ativa');
        const campo = $('#medidaTrecho');
        if (campo && document.activeElement !== campo) campo.placeholder = fmt(comp);
      }
      for (const g of c.guias || []) {
        const l = new T.Line(new T.BufferGeometry().setFromPoints([new T.Vector3(g[0], y, g[1]), new T.Vector3(c.x, y, c.z)]), MAT_D.guia);
        l.computeLineDistances(); l.renderOrder = 13; grpDesenho.add(l);
      }
      marca(c.x, c.z, MAT_D.ponto[c.tipo] || MAT_D.ponto.livre, c.tipo === 'grade' || c.tipo === 'livre' ? 3.5 : 5.5);
      if (NOME_ENCAIXE[c.tipo]) rotuloDesenho(NOME_ENCAIXE[c.tipo], c.x + 14 * px, c.z + 14 * px, 'encaixe');
    }
  }
  // portas e janelas: prévia na parede sob o cursor
  if (f in PADRAO_ABERTURA && c) {
    const pw = paredePerto(c.x, c.z, 8 * px);
    if (pw) {
      const w = pw.w, hz = horizontal(w), larg = PADRAO_ABERTURA[f].largura, L = comprimento(w);
      const u = Math.max(0, Math.min(L - larg, snap(pw.u - larg / 2))), e = w.esp / 2 + 2;
      if (hz) retanguloMalha(w.x1 + u, w.z1 - e, w.x1 + u + larg, w.z1 + e, MAT_D.abertura, y);
      else retanguloMalha(w.x1 - e, w.z1 + u, w.x1 + e, w.z1 + u + larg, MAT_D.abertura, y);
    }
  }
  if (f === 'apagar' && c) {
    const pw = paredePerto(c.x, c.z, 8 * px);
    if (pw) { const w = pw.w, e = w.esp / 2 + 1; retanguloMalha(w.x1 - e, w.z1 - e, w.x2 + e, w.z2 + e, MAT_D.apagar, y); }
  }
  // calibrar e mover o fundo
  const linha = (a, b, mat) => { const l = new T.Line(new T.BufferGeometry().setFromPoints([new T.Vector3(a[0], y, a[1]), new T.Vector3(b[0], y, b[1])]), mat); l.renderOrder = 13; grpDesenho.add(l); };
  if (f === 'calibrar' && desenho.calib) {
    const [ax, az, bx, bz] = desenho.calib;
    marca(ax, az, MAT_D.ponto.alinhado, 4.5);
    const b = bx != null ? [bx, bz] : c ? [c.x, c.z] : null;
    if (b) { linha([ax, az], b, MAT_D.calib); marca(b[0], b[1], MAT_D.ponto.alinhado, 4.5); rotuloDesenho(`${fmt(Math.round(Math.hypot(b[0] - ax, b[1] - az)))} cm`, (ax + b[0]) / 2, (az + b[1]) / 2 - 14 * px, 'ativa'); }
  }
  if (f === 'moverFundo' && desenho.mover) {
    marca(desenho.mover[0], desenho.mover[1], MAT_D.ponto.alinhado, 4.5);
    if (c) { const q = encaixarPonto(c, null); linha(desenho.mover, [q.x, q.z], MAT_D.calib); marca(q.x, q.z, MAT_D.ponto[q.tipo] || MAT_D.ponto.livre, 4.5); }
  }
  posicionar(rotulosDesenho);
}

// ---- barra de ferramentas do modo Planta
function renderBarraDesenho() {
  const box = $('#barraDesenho');
  if (!box) return;
  box.textContent = '';
  if (modo !== 'desenhar') return;
  const f = desenho.ferramenta;
  const linha = el('div', { class: 'ferr-linha' });
  for (const k of ['selecionar', 'parede', 'porta', 'janela', 'correr', 'apagar']) {
    linha.append(el('button', { type: 'button', class: k === f ? 'ativo' : '', 'data-ferramenta': k, title: FERRAMENTAS[k].dica, onclick: () => setFerramenta(k) },
      el('span', { 'aria-hidden': 'true' }, FERRAMENTAS[k].icone), el('small', {}, FERRAMENTAS[k].nome)));
  }
  box.append(linha);
  if (f === 'parede' && desenho.pontos.length) {
    const campo = el('input', { id: 'medidaTrecho', type: 'text', inputmode: 'decimal', placeholder: 'medida', 'aria-label': 'Medida do trecho em cm' });
    const usar = (dir) => { const v = numero(campo.value); campo.value = ''; trechoComMedida(v, dir); };
    campo.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); usar(null); }
      if (e.key === 'Escape') { campo.blur(); concluirParedes(); }
    });
    box.append(el('div', { class: 'ferr-medida' },
      el('label', {}, campo, el('em', {}, 'cm')),
      ...[['←', [-1, 0]], ['↑', [0, -1]], ['↓', [0, 1]], ['→', [1, 0]]].map(([t, d]) => botao(t, () => usar(d), { class: 'seta', title: 'Trecho com a medida digitada nesta direção' })),
      botao('↶', desfazerDesenho, { title: 'Desfazer o último trecho' }),
      botao('Concluir', concluirParedes, { class: 'acao-sec' })));
  } else if (f === 'calibrar' || f === 'moverFundo') {
    box.append(el('div', { class: 'ferr-medida' }, el('span', {}, FERRAMENTAS[f].dica), botao('Cancelar', () => setFerramenta('selecionar'))));
  }
  // a dica fica logo acima da barra
  palco.style.setProperty('--barra-desenho', `${box.offsetHeight}px`);
}
function desfazerDesenho() {
  const pts = desenho.pontos;
  if (pts.length > 1) { desfazer(); pts.pop(); renderBarraDesenho(); desenharOverlay(); return true; }
  if (pts.length === 1) { concluirParedes(); return true; }
  return false;
}

// ---- painel lateral do modo Planta: opções e planta de fundo
function renderOpcoesDesenho() {
  const box = $('#opcoesDesenho');
  if (!box) return;
  box.textContent = '';
  const chave = (k, nome) => el('label', { class: 'interruptor' },
    el('input', { type: 'checkbox', checked: !!desenho[k], onchange: (e) => {
      desenho[k] = e.target.checked; guardarDesenho();
      if (k === 'moveis') aplicarVisibilidadeTopo();
      desenharOverlay();
    } }), el('span', {}, nome));
  anexar(box,
    el('div', { class: 'grade2' },
      campoNum('Espessura nova', desenho.esp, (v) => { desenho.esp = v; guardarDesenho(); }, { min: 3, max: 60 }),
      campoNum('Pé-direito', doc.planta.alturaParede, (v) => alterar(() => { doc.planta.alturaParede = v; }), { min: 200, max: 600 })),
    chave('encaixe', 'Encaixar na grade de 5 cm'),
    chave('cotas', 'Mostrar o comprimento das paredes'),
    chave('moveis', 'Mostrar os móveis'),
    el('p', { class: 'nota' }, 'As paredes são sempre horizontais ou verticais. Os ambientes e as áreas aparecem sozinhos quando uma região se fecha.'));
}
function renderFundo() {
  const box = $('#fundo');
  if (!box) return;
  box.textContent = '';
  const f = doc.planta.fundo;
  const carregar = botao(f ? 'Trocar imagem ou PDF…' : 'Carregar imagem ou PDF…', () => $('#arqFundo').click(), { class: f ? '' : 'acao' });
  if (!f) {
    anexar(box, carregar, el('p', { class: 'nota' }, 'Use a planta do levantamento (foto, digitalização ou PDF) para desenhar as paredes por cima.'));
    return;
  }
  const mudar = (fn) => alterar(() => fn(doc.planta.fundo));
  const opac = el('input', { type: 'range', min: 0.1, max: 1, step: 0.05, value: String(f.opacidade ?? 0.6) });
  let estado = null;
  opac.addEventListener('input', () => {
    estado ??= JSON.stringify(doc);
    f.opacidade = +opac.value;
    if (fundoTela.malha) fundoTela.malha.material.opacity = f.opacidade;
  });
  opac.addEventListener('change', () => { if (estado) registrar(estado); estado = null; salvarAuto(); });
  const escalaPapel = f.cmPapel ? Math.round(f.escala / f.cmPapel) : null;
  anexar(box,
    el('div', { class: 'fundo-nome' }, el('b', {}, f.nome || 'Planta de fundo'), el('small', {}, `${fmt(Math.round(f.w * f.escala))} × ${fmt(Math.round(f.h * f.escala))} cm`)),
    el('div', { class: 'linha-botoes' },
      botao('📏 Calibrar', () => setFerramenta('calibrar'), { class: desenho.ferramenta === 'calibrar' ? 'ligado' : '' }),
      botao('✥ Mover', () => setFerramenta('moverFundo'), { class: desenho.ferramenta === 'moverFundo' ? 'ligado' : '' })),
    el('label', { class: 'faixa-hora' }, el('span', {}, 'Opacidade'), el('b', {}, ''), opac),
    el('div', { class: 'grade2', style: 'margin-top:8px' },
      campoNum('Giro', f.giro || 0, (v) => mudar((ff) => {
        // gira em volta do centro da imagem
        const [c0x, c0z] = [cantosFundo(ff)[0], cantosFundo(ff)[2]].reduce((s, q) => [s[0] + q[0] / 2, s[1] + q[1] / 2], [0, 0]);
        ff.giro = v;
        const [c1x, c1z] = [cantosFundo(ff)[0], cantosFundo(ff)[2]].reduce((s, q) => [s[0] + q[0] / 2, s[1] + q[1] / 2], [0, 0]);
        ff.x += c0x - c1x; ff.z += c0z - c1z;
      }), { min: -360, max: 360, sufixo: '°' }),
      escalaPapel ? campoNum('Escala 1:', escalaPapel, (v) => mudar((ff) => { ff.escala = ff.cmPapel * v; }), { min: 1, max: 10000, sufixo: '' })
        : campoNum('Largura real', Math.round(f.w * f.escala), (v) => mudar((ff) => { ff.escala = v / ff.w; }), { min: 10, max: 100000 })),
    el('label', { class: 'interruptor' },
      el('input', { type: 'checkbox', checked: f.visivel !== false, onchange: (e) => mudar((ff) => { ff.visivel = e.target.checked; }) }),
      el('span', {}, 'Mostrar o fundo')),
    el('div', { class: 'linha-botoes' }, carregar,
      botao('Remover', () => {
        if (!confirm('Remover a planta de fundo? Dá para desfazer.')) return;
        alterar(() => { doc.planta.fundo = null; });
      }, { class: 'perigo' })),
    el('p', { class: 'nota' }, 'Calibrar: toque nas duas pontas de uma medida conhecida e digite a medida real. Mover: toque num ponto do desenho e depois onde ele deve ficar.'));
}
$('#arqFundo').onchange = (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) carregarFundo(f); };

// =====================================================================
// 9. PAINÉIS E BARRA
// =====================================================================
const fmt = (n) => (Math.round(n * 10) / 10).toLocaleString('pt-BR');
const m2 = (v) => `${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} m²`;
const numero = (s) => parseFloat(String(s).replace(',', '.'));

function el(tag, attrs = {}, ...filhos) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'class') e.className = v;
    else if (k in e && typeof v !== 'string') e[k] = v;
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const f of filhos.flat()) if (f != null && f !== false) e.append(f.nodeType ? f : document.createTextNode(f));
  return e;
}

function campoNum(rotulo, valor, aoMudar, { min = 1, max = 2000, sufixo = 'cm', chave } = {}) {
  const inp = el('input', { type: 'text', inputmode: 'decimal', value: fmt(valor), 'data-chave': chave });
  inp.addEventListener('change', () => {
    const v = numero(inp.value);
    if (!Number.isFinite(v) || v < min || v > max) {
      toast(`Use um valor entre ${fmt(min)} e ${fmt(max)}.`);
      inp.value = fmt(valor);
      return;
    }
    aoMudar(v);
  });
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') inp.blur(); });
  inp.addEventListener('focus', () => inp.select());
  return el('label', { class: 'campo' }, el('span', {}, rotulo), inp, el('em', {}, sufixo));
}
function campoTexto(rotulo, valor, aoMudar) {
  const inp = el('input', { type: 'text', value: valor });
  inp.addEventListener('change', () => { const v = inp.value.trim(); if (v) aoMudar(v); });
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') inp.blur(); });
  return el('label', { class: 'campo largo' }, el('span', {}, rotulo), inp);
}
function campoCor(rotulo, valor, aoMudar) {
  const inp = el('input', { type: 'color', value: valor });
  let estado = null;
  inp.addEventListener('input', () => {             // prévia ao vivo
    estado ??= JSON.stringify(doc);
    aoMudar(inp.value, false);
  });
  inp.addEventListener('change', () => {            // grava no histórico
    if (estado) registrar(estado);
    estado = null;
    aoMudar(inp.value, true);
  });
  return el('label', { class: 'campo cor' }, el('span', {}, rotulo), inp);
}
const anexar = (pai, ...filhos) => pai.append(...filhos.flat().filter((f) => f != null && f !== false));
const botao = (txt, acao, extra = {}) => el('button', { type: 'button', onclick: acao, ...extra }, txt);
const secao = (titulo, ...filhos) => el('section', { class: 'bloco' }, el('h3', {}, titulo), ...filhos);

// ---- abas de cenário
function renderAbas() {
  const nav = $('#abas');
  nav.textContent = '';
  doc.cenarios.forEach((c, i) => {
    const b = el('button', {
      type: 'button', class: 'aba' + (i === doc.ativo ? ' ativa' : ''), title: 'Clique duplo para renomear',
      onclick: () => { if (i !== doc.ativo) { doc.ativo = i; if (sel?.tipo === 'movel') sel = null; atualizarTudo(); } },
      ondblclick: () => {
        const n = prompt('Nome do cenário:', c.nome);
        if (n && n.trim()) alterar(() => { c.nome = n.trim(); });
      },
    }, c.nome);
    if (doc.cenarios.length > 1 && i === doc.ativo) {
      b.append(el('span', {
        class: 'fechar', title: 'Excluir cenário',
        onclick: (e) => {
          e.stopPropagation();
          if (confirm(`Excluir o cenário "${c.nome}"? Dá para desfazer.`)) {
            alterar(() => { doc.cenarios.splice(i, 1); doc.ativo = Math.max(0, i - 1); });
            sel = null; atualizarTudo();
          }
        },
      }, '×'));
    }
    nav.append(b);
  });
  nav.append(botao('+', () => {
    const c = clonar(cen());
    c.id = novoId('c'); c.nome = `${c.nome} (cópia)`;
    for (const m of c.moveis) m.id = novoId('m');
    alterar(() => { doc.cenarios.push(c); doc.ativo = doc.cenarios.length - 1; });
    sel = null; atualizarTudo();
  }, { class: 'aba nova', title: 'Duplicar este cenário' }));
}

// ---- barra lateral: áreas, demolição e catálogo
function renderAreas() {
  const box = $('#areas');
  box.textContent = '';
  if (!doc.planta.ambientes.length) {
    box.append(el('p', { class: 'nota' }, doc.planta.paredes.length
      ? 'Nenhuma região fechada ainda. Feche as paredes em volta de um espaço e o ambiente aparece, com a área.'
      : 'Desenhe as paredes no modo Planta: cada região fechada vira um ambiente, com a área calculada.'));
    return;
  }
  let total = 0;
  const tab = el('table', { class: 'tab-areas' });
  for (const amb of doc.planta.ambientes) {
    const a = areaUtil(amb);
    if (!amb.vazio) total += a;
    tab.append(el('tr', {
      class: (sel?.tipo === 'ambiente' && sel.id === amb.id ? 'ativo' : '') + (amb.vazio ? ' vazio' : ''),
      onclick: () => selecionar({ tipo: 'ambiente', id: amb.id }),
    }, el('td', {}, amb.nome), el('td', {}, amb.vazio ? 'vazio' : m2(a))));
  }
  tab.append(el('tr', { class: 'soma' }, el('td', {}, 'Área útil (soma)'), el('td', {}, m2(total))));
  box.append(tab, el('div', { class: 'comparativo' },
    el('div', {}, el('span', {}, 'Construída (com paredes)'), el('b', {}, m2(areaConstruida()))),
    el('div', {}, el('span', {}, 'Paredes e vazios'), el('b', {}, m2(Math.max(0, areaConstruida() - total))))));
  for (const r of rotulos) {
    const amb = r.id && ambiente(r.id);
    if (amb) r.div.querySelector('span').textContent = amb.vazio ? 'vazio' : m2(areaUtil(amb));
  }
}

let animacao = null;
function renderLuz() {
  const box = $('#luz');
  box.textContent = '';
  const info = aplicarSol();
  const { nascer, por } = nascerPor(luz.data);
  const guardar = () => { try { localStorage.setItem(CHAVE_LUZ, JSON.stringify(luz)); } catch { /* ok */ } };
  const hora = el('input', { type: 'range', min: 4, max: 20, step: 0.25, value: String(luz.hora) });
  const rotHora = el('b', {}, horaTxt(luz.hora));
  const txt = el('p', { class: 'nota' });
  const descrever = ({ elev, az }) => {
    txt.textContent = elev <= 0
      ? 'Sol abaixo do horizonte.'
      : `Sol a ${Math.round(elev)}° de altura, vindo do ${pontoCardeal(az)} (azimute ${Math.round(az)}°).`;
  };
  descrever(info);
  hora.addEventListener('input', () => {
    luz.hora = +hora.value; rotHora.textContent = horaTxt(luz.hora);
    descrever(aplicarSol()); guardar();
  });
  const data = el('input', { type: 'date', value: luz.data, onchange: (e) => { if (e.target.value) { luz.data = e.target.value; guardar(); renderLuz(); } } });
  // local do projeto: uma capital da lista ou latitude/longitude digitadas
  const loc = doc.planta.local;
  const daLista = LOCAIS.findIndex((l) => l.nome === loc.nome && l.lat === loc.lat && l.lon === loc.lon);
  const local = el('select', { onchange: (e) => {
    if (e.target.value === 'outro') { alterar(() => { doc.planta.local = { ...clonar(loc), nome: 'Outro local' }; }); return; }
    alterar(() => { doc.planta.local = clonar(LOCAIS[+e.target.value]); });
  } }, ...LOCAIS.map((l, i) => el('option', { value: i, selected: i === daLista }, l.nome)),
  el('option', { value: 'outro', selected: daLista < 0 }, 'Outro local (latitude e longitude)'));
  const mudarLocal = (k) => (v) => alterar(() => { doc.planta.local = { ...clonar(doc.planta.local), nome: 'Outro local', [k]: v }; });
  const coords = daLista < 0 ? el('div', { class: 'grade3', style: 'margin-top:8px' },
    campoNum('Latitude', loc.lat, mudarLocal('lat'), { min: -90, max: 90, sufixo: '°' }),
    campoNum('Longitude', loc.lon, mudarLocal('lon'), { min: -180, max: 180, sufixo: '°' }),
    campoNum('Fuso (UTC)', loc.fuso, mudarLocal('fuso'), { min: -12, max: 14, sufixo: 'h' })) : null;
  // norte da planta: ângulo na tela, de cima e no sentido do relógio
  // (orientacao = para onde olha a face esquerda da planta)
  const norteTela = ((270 - doc.planta.orientacao) % 360 + 360) % 360;
  const orient = campoNum('Norte da planta', norteTela, (v) => alterar(() => { doc.planta.orientacao = ((270 - v) % 360 + 360) % 360; }), { min: -360, max: 360, sufixo: '°' });
  const animar = botao(animacao ? '■ Parar' : '▶ Passar o dia', () => {
    if (animacao) { clearInterval(animacao); animacao = null; renderLuz(); return; }
    luz.hora = Math.floor((nascer ?? 6) * 4) / 4;
    animacao = setInterval(() => {
      luz.hora += 0.25;
      if (luz.hora > (por ?? 18) + 0.25) { clearInterval(animacao); animacao = null; luz.hora = por ?? 18; guardar(); renderLuz(); return; }
      hora.value = String(luz.hora); rotHora.textContent = horaTxt(luz.hora); descrever(aplicarSol());
    }, 180);
    renderLuz();
  });
  anexar(box,
    el('label', { class: 'campo largo' }, el('span', {}, 'Local (para o sol)'), local),
    coords,
    el('div', { class: 'grade2', style: 'margin-top:8px' },
      el('label', { class: 'campo largo' }, el('span', {}, 'Data'), data),
      orient),
    el('p', { class: 'nota' }, 'Norte da planta: 0° = para cima, 90° = para a direita (a bússola no canto mostra).'),
    el('label', { class: 'faixa-hora' }, el('span', {}, 'Hora'), rotHora, hora),
    txt,
    el('div', { class: 'linha-botoes' }, animar,
      botao('Manhã', () => { luz.hora = 8; guardar(); renderLuz(); }),
      botao('Tarde', () => { luz.hora = 15; guardar(); renderLuz(); })),
    nascer != null ? el('p', { class: 'nota' }, `Nascer ${horaTxt(nascer)} · pôr ${horaTxt(por)} (hora local, UTC${loc.fuso >= 0 ? '+' : '−'}${Math.abs(loc.fuso)})`) : null,
  );
}

function renderDemolicao() {
  const box = $('#demolicao');
  box.textContent = '';
  const ws = doc.planta.paredes.filter((w) => w.derrubavel);
  if (!ws.length) { box.append(el('p', { class: 'nota' }, 'Nenhuma parede marcada. Selecione uma parede e marque "Pode ser derrubada".')); return; }
  for (const w of ws) {
    box.append(el('label', { class: 'interruptor' },
      el('input', { type: 'checkbox', checked: !!w.demolida, onchange: (e) => alterar(() => { parede(w.id).demolida = e.target.checked; }) }),
      el('span', {}, w.nome), el('em', {}, w.demolida ? 'derrubada' : 'de pé')));
  }
}

let filtroCatalogo = '';
function renderCatalogo() {
  const box = $('#catalogo');
  box.textContent = '';
  const todos = [...CATALOGO, ...doc.catalogoExtra];
  const f = filtroCatalogo.toLowerCase();
  const cats = [...new Set(todos.map((c) => c.cat || 'Outros'))];
  for (const cat of cats) {
    const itens = todos.filter((c) => (c.cat || 'Outros') === cat && (!f || c.nome.toLowerCase().includes(f) || cat.toLowerCase().includes(f)));
    if (!itens.length) continue;
    box.append(el('h4', {}, cat));
    for (const c of itens) {
      const mini = el('span', { class: 'mini', 'data-tipo': c.tipo }, miniaturas.has(c.tipo) ? '' : '…');
      if (miniaturas.has(c.tipo)) mini.style.backgroundImage = `url(${miniaturas.get(c.tipo)})`;
      box.append(el('button', { type: 'button', class: 'cartao-cat', onclick: () => adicionarMovel(c.tipo), title: 'Adicionar ao cenário' },
        mini, el('b', {}, c.nome), el('em', {}, `${c.dim.l} × ${c.dim.p} cm`)));
    }
  }
  if (modo === 'arrumar') gerarMiniaturas();
}

// Miniaturas do catálogo: cada móvel é desenhado uma vez num renderizador
// pequeno à parte e vira imagem. Feito aos poucos para não travar a tela.
const miniaturas = new Map();
let mini = null;
function gerarMiniaturas() {
  const falta = [...CATALOGO, ...doc.catalogoExtra].filter((c) => !miniaturas.has(c.tipo) && !c.modelo);
  if (!falta.length || mini?.ocupado) return;
  if (!mini) {
    const r = new T.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    r.setSize(160, 160, false);
    r.outputColorSpace = T.SRGBColorSpace;
    r.toneMapping = T.NeutralToneMapping;
    const c = new T.Scene();
    c.add(new T.HemisphereLight(0xffffff, 0xcfc4b4, 2.2));
    const d = new T.DirectionalLight(0xffffff, 2.2); d.position.set(1, 2, 1.5); c.add(d);
    mini = { r, c, cam: new T.PerspectiveCamera(30, 1, 1, 5000), ocupado: false };
  }
  mini.ocupado = true;
  const passo = () => {
    const def = falta.shift();
    if (!def) { mini.r.dispose(); mini.r.forceContextLoss(); mini = null; return; }
    try {
      const m = prepararMovel({ tipo: def.tipo, x: 0, z: 0, rot: 0 });
      m.aberto = 0;
      const g = construirMovel(m);
      mini.c.add(g);
      const b = new T.Box3().setFromObject(g), tam = b.getSize(new T.Vector3()), cen0 = b.getCenter(new T.Vector3());
      const raio = Math.max(tam.x, tam.y, tam.z) * 0.62 + 4;
      const dist = raio / Math.sin(rad(15));
      mini.cam.position.copy(cen0).add(new T.Vector3(0.62, 0.55, 1).normalize().multiplyScalar(dist));
      mini.cam.near = dist / 20; mini.cam.far = dist * 4; mini.cam.updateProjectionMatrix();
      mini.cam.lookAt(cen0);
      mini.r.render(mini.c, mini.cam);
      const url = mini.r.domElement.toDataURL('image/png');
      miniaturas.set(def.tipo, url);
      mini.c.remove(g); limpar(g);
      const alvo = document.querySelector(`#catalogo .mini[data-tipo="${def.tipo}"]`);
      if (alvo) { alvo.style.backgroundImage = `url(${url})`; alvo.textContent = ''; }
    } catch (err) { console.warn(err); miniaturas.set(def.tipo, ''); }
    setTimeout(passo, 30);
  };
  setTimeout(passo, 60);
}

// ---- painel da seleção
let painelExpandido = false;
function renderPainel() {
  const p = $('#painel');
  const rolagem = p.scrollTop;
  p.textContent = '';
  document.body.classList.toggle('com-painel', !!sel);
  p.classList.toggle('expandido', painelExpandido);
  requestAnimationFrame(aplicarDeslocamento);
  if (!sel) return;
  // no celular: puxador da gaveta (baixa por padrão, para mexer no móvel vendo a cena)
  p.append(botao(painelExpandido ? 'menos opções' : 'mais opções', () => {
    painelExpandido = !painelExpandido; renderPainel();
  }, { class: 'puxador' }));
  requestAnimationFrame(() => { p.scrollTop = rolagem; });
  const cab = (titulo, sub) => el('header', {}, el('div', {}, el('small', {}, sub), el('h2', {}, titulo)),
    botao('×', () => selecionar(null), { class: 'fechar', title: 'Fechar (Esc)' }));
  if (sel.tipo === 'movel') painelMovel(p, cab);
  else if (sel.tipo === 'parede') painelParede(p, cab);
  else if (sel.tipo === 'ambiente') painelAmbiente(p, cab);
  else if (sel.tipo === 'zona') painelZona(p, cab);
}

const mais = (titulo, aberto, ...filhos) => el('details', { class: 'mais', open: aberto }, el('summary', {}, titulo), el('div', { class: 'conteudo' }, ...filhos));
const botaoRapido = (icone, rotulo, acao, extra = {}) => el('button', { type: 'button', onclick: acao, title: rotulo, ...extra }, icone, el('small', {}, rotulo));

function painelMovel(p, cab) {
  const m = movel(sel.id);
  if (!m) return;
  if (modo === 'conferir') { painelConferirMovel(p, cab, m); return; }
  const def = defCatalogo(m.tipo) || { nome: m.tipo };
  const pg = pegada(m), vr = varianteDe(def, m);
  const col = colisoes.porMovel.get(m.id);
  const rotCores = def.rotulosCores || ['Principal', 'Secundária'];
  const [acaoAbrir, acaoFechar] = acaoDe(def, m) instanceof Array ? acaoDe(def, m) : [acaoDe(def, m), 'Fechar'];
  const aberto = (m.aberto || 0) > 0.5;
  const NOME_DIR = { 'x1': 'Livre à direita', 'x-1': 'Livre à esquerda', 'z1': 'Livre abaixo', 'z-1': 'Livre acima' };
  const zonas = zonasUso(m);
  const outros = selExtra.map(movel).filter(Boolean);
  anexar(p,
    cab(m.nome, vr ? `${def.nome} · ${vr.nome}` : def.nome),
    outros.length ? secao(`Alinhar ${outros.length === 1 ? outros[0].nome : `${outros.length} móveis`} com este`,
      el('div', { class: 'alinhar' }, ...[['⇤', 'Esquerdas', 'x0'], ['↔', 'Centros', 'xc'], ['⇥', 'Direitas', 'x1'], ['⤒', 'Topos', 'z0'], ['↕', 'Meios', 'zc'], ['⤓', 'Bases', 'z1']]
        .map(([i, t, c]) => botao(`${i} ${t}`, () => alinhar(c)))),
      el('p', { class: 'nota' }, 'Lados como na vista de cima (Planta). Toque fora para soltar a seleção.')) : null,
    el('div', { class: 'status ' + (col ? 'alerta' : 'ok') }, col ? `⚠ ${[...new Set(col)].join('; ')}` : '✓ Cabe e dá para usar'),
    el('div', { class: 'acoes-rapidas' },
      botaoRapido('↻', 'Girar', () => girar(1)),
      botaoRapido('⇋', 'Espelhar', () => alterar(() => { m.espelhado = !m.espelhado; })),
      temMov(def, m) ? botaoRapido(aberto ? '■' : '▶', aberto ? acaoFechar : acaoAbrir, () => alternarAbertura(m)) : null,
      botaoRapido('⧉', 'Duplicar', duplicarSelecionado),
      botaoRapido('🔍', 'Focar', () => focarRet(pegada(m), 60)),
      botaoRapido('⊞', escolhendoOutro ? 'Toque no outro' : 'Alinhar', () => {
        escolhendoOutro = !escolhendoOutro; renderPainel();
        if (escolhendoOutro) toast('Toque no outro móvel (ou em vários) para alinhar com este.');
      }, { class: escolhendoOutro ? 'ativo' : '' }),
      botaoRapido('🗑', 'Remover', removerSelecionado, { class: 'perigo' })),
    el('div', { class: 'mover' }, el('small', {}, 'Mover 5 cm'),
      ...[['←', 'esq'], ['↑', 'cima'], ['↓', 'baixo'], ['→', 'dir']].map(([t, d]) => botao(t, () => empurrarTela(d), { title: `Mover para ${d === 'esq' ? 'a esquerda' : d === 'dir' ? 'a direita' : d} da tela` }))),
    el('p', { class: 'nota', style: 'margin:0 0 8px' }, `${fmt(m.l)} × ${fmt(m.p)} × ${fmt(m.a)} cm · arraste as setas azuis para mudar o tamanho; arraste o móvel para mover`),
    def.variantes?.length > 1 ? secao('Formato',
      el('div', { class: 'opcoes' }, ...def.variantes.map((v) => botao(v.nome, () => trocarVariante(m, def, v), { class: v === vr ? 'ativo' : '' })))) : null,
    def.acabamentos ? secao('Material',
      el('div', { class: 'opcoes' }, ...def.acabamentos.map((a) => botao(NOMES_ACAB[a] || a, () => alterar(() => { m.acab = a; }), { class: (m.acab || def.acabamentos[0]) === a ? 'ativo' : '' })))) : null,
    mais('Cores', false,
      el('div', { class: 'grade2' },
        campoCor(rotCores[0], m.cores.principal, (v, fim) => { m.cores.principal = v; aplicarMudancaMovel(m, fim); }),
        campoCor(rotCores[1], m.cores.secundaria || '#888888', (v, fim) => { m.cores.secundaria = v; aplicarMudancaMovel(m, fim); }))),
    mais('Medidas', false,
      el('div', { class: 'grade3' },
        campoNum('Largura', m.l, (v) => alterar(() => { m.l = v; })),
        campoNum('Profund.', m.p, (v) => alterar(() => { m.p = v; })),
        campoNum('Altura', m.a, (v) => alterar(() => { m.a = v; }))),
      el('div', { class: 'grade2', style: 'margin-top:8px' },
        campoNum('Altura do chão', m.y || 0, (v) => alterar(() => { m.y = v; }), { min: 0, max: 300 })),
      botao('Voltar às medidas do catálogo', () => alterar(() => Object.assign(m, vr?.dim || def.dim || {})), { class: 'link' })),
    mais('Distâncias e posição', false,
      el('div', { class: 'grade2' },
        ...calcularCotas(m).map((c) => campoNum(NOME_DIR[c.eixo + c.s], c.dist, (v) => alterar(() => {
          const d = (c.dist - v) * c.s; if (c.eixo === 'x') m.x += d; else m.z += d;
        }), { min: 0, max: 2000 })),
        campoNum('X (canto)', pg.x0, (v) => alterar(() => { m.x = v + pg.w / 2; }), { min: -500, max: 3000, chave: 'x' }),
        campoNum('Z (canto)', pg.z0, (v) => alterar(() => { m.z = v + pg.d / 2; }), { min: -500, max: 3000, chave: 'z' })),
      el('p', { class: 'nota' }, 'Digite a distância livre que você quer até a parede ou o móvel mais próximo.')),
    zonas.length ? mais('Área de uso', false,
      ...zonas.map((z, k) => el('div', { class: 'linha-uso ' + (colisoes.usoBloq.has(`${m.id}#${k}`) ? 'alerta' : 'ok') },
        el('span', {}, z.nome), el('b', {}, `${fmt(z.x1 - z.x0)} × ${fmt(z.z1 - z.z0)} cm`)))) : null,
    el('p', { class: 'nota' }, 'Com o móvel selecionado, arraste-o para mudar de lugar (encaixe de 5 cm). Toque duplo aproxima.'),
  );
}
function trocarVariante(m, def, v) {
  alterar(() => {
    m.variante = v.id;
    const costas = paraPlanta(m, 0, -m.p / 2); // as costas ficam onde estavam (encostadas na parede)
    // mantém a largura escolhida se o novo formato for de tamanho parecido
    if (v.dim) Object.assign(m, { l: Math.abs(v.dim.l - m.l) <= m.l * 0.25 ? m.l : v.dim.l, p: v.dim.p, a: v.dim.a });
    if (v.elev != null) m.y = v.elev;
    m.aberto = def.aberto ?? 0;
    const novas = paraPlanta(m, 0, -m.p / 2);
    m.x += costas[0] - novas[0]; m.z += costas[1] - novas[1];
    afastarDasParedes(m);
  });
}
// Se o novo formato ficou maior e entrou na parede, empurra o móvel para fora.
function afastarDasParedes(m) {
  for (let k = 0; k < 4; k++) {
    const pg = pegada(m);
    const w = doc.planta.paredes.find((pw) => {
      if (pw.demolida) return false;
      const c = caixaParede(pw);
      return Math.min(pg.x1, c.x1) - Math.max(pg.x0, c.x0) > 0.5 && Math.min(pg.z1, c.z1) - Math.max(pg.z0, c.z0) > 0.5;
    });
    if (!w) return;
    const c = caixaParede(w);
    const ox = Math.min(pg.x1, c.x1) - Math.max(pg.x0, c.x0), oz = Math.min(pg.z1, c.z1) - Math.max(pg.z0, c.z0);
    if (ox < oz) m.x += m.x < (c.x0 + c.x1) / 2 ? -ox : ox;
    else m.z += m.z < (c.z0 + c.z1) / 2 ? -oz : oz;
  }
}

function painelZona(p, cab) {
  const z = zona(sel.id);
  if (!z) return;
  const f = FUNCOES[z.funcao] || FUNCOES.outro, r = retZona(z);
  const ms = moveisNaZona(z);
  const area = (z.l * z.p) / 1e4;
  const ocup = cen().moveis.filter((m) => defCatalogo(m.tipo)?.colide !== false && (m.y || 0) < 100).reduce((soma, m) => {
    const pg = pegada(m);
    const dx = Math.min(pg.x1, r.x1) - Math.max(pg.x0, r.x0), dz = Math.min(pg.z1, r.z1) - Math.max(pg.z0, r.z0);
    return soma + (dx > 0 && dz > 0 ? dx * dz : 0);
  }, 0) / 1e4;
  const mudar = (fn) => alterar(() => fn(zona(z.id)));
  anexar(p,
    cab(z.nome || f.nome, 'Canto'),
    el('div', { class: 'area-grande', style: `color:${f.cor}` }, m2(area),
      el('small', {}, `${fmt((ocup / area) * 100)}% ocupado por móveis · ${m2(Math.max(0, area - ocup))} livres`)),
    secao('Função',
      el('div', { class: 'opcoes' }, ...Object.entries(FUNCOES).map(([k, fn]) =>
        botao(fn.nome, () => mudar((zz) => { zz.funcao = k; }), { class: z.funcao === k ? 'ativo' : '', style: `--cor:${fn.cor}` }))),
      campoTexto('Nome (opcional)', z.nome || '', (v) => mudar((zz) => { zz.nome = v; }))),
    secao('Medidas',
      el('div', { class: 'grade2' },
        campoNum('Largura', z.l, (v) => mudar((zz) => { zz.x += (v - zz.l) / 2; zz.l = v; }), { min: 20 }),
        campoNum('Profund.', z.p, (v) => mudar((zz) => { zz.z += (v - zz.p) / 2; zz.p = v; }), { min: 20 }),
        campoNum('X (canto)', r.x0, (v) => mudar((zz) => { zz.x = v + zz.l / 2; }), { min: -500, max: 3000 }),
        campoNum('Z (canto)', r.z0, (v) => mudar((zz) => { zz.z = v + zz.p / 2; }), { min: -500, max: 3000 }))),
    secao(`Móveis neste canto (${ms.length})`,
      ms.length ? el('div', { class: 'lista-moveis' }, ...ms.map((m) => el('button', { type: 'button', onclick: () => selecionar({ tipo: 'movel', id: m.id }) },
        el('span', {}, m.nome), el('em', {}, `${fmt(m.l)} × ${fmt(m.p)} × ${fmt(m.a)}`))))
        : el('p', { class: 'nota' }, 'Nenhum móvel com o centro dentro deste canto.')),
    el('div', { class: 'linha-botoes fim' },
      botao('Remover canto', () => { alterar(() => { cen().zonas = cen().zonas.filter((x) => x.id !== z.id); }); selecionar(null); }, { class: 'perigo' })),
    el('p', { class: 'nota' }, 'Com o canto selecionado, arraste-o no piso para mudar de lugar.'),
  );
}

function renderCantos() {
  const box = $('#cantos');
  if (!box) return;
  box.textContent = '';
  for (const z of cen().zonas || []) {
    const f = FUNCOES[z.funcao] || FUNCOES.outro;
    box.append(el('button', { type: 'button', class: 'item-canto' + (sel?.tipo === 'zona' && sel.id === z.id ? ' ativo' : ''),
      onclick: () => { if (!camadas.cantos) { camadas.cantos = true; guardarCamadas(); renderMostrar(); } selecionar({ tipo: 'zona', id: z.id }); } },
    el('i', { style: `background:${f.cor}` }), el('span', {}, z.nome || f.nome), el('em', {}, m2((z.l * z.p) / 1e4))));
  }
  box.append(botao('+ Marcar canto', novaZona, { class: 'link' }));
}

function renderMostrar() {
  const box = $('#mostrar');
  box.textContent = '';
  const opcoes = [['uso', 'Áreas de uso e giro das portas'], ['cantos', 'Cantos (funções)'], ['cotas', 'Cotas do móvel selecionado']];
  for (const [k, nome] of opcoes) {
    box.append(el('label', { class: 'interruptor' },
      el('input', { type: 'checkbox', checked: !!camadas[k], onchange: (e) => {
        camadas[k] = e.target.checked; guardarCamadas();
        if (k === 'cantos' && !camadas.cantos && sel?.tipo === 'zona') sel = null;
        construirZonas(); desenharSelecao(); renderPainel();
      } }), el('span', {}, nome)));
  }
}

function aplicarMudancaMovel(m, fim) {
  if (fim) { atualizarTudo(); return; }
  const velho = objMovel.get(m.id);
  const novo = construirMovel(m);
  grpMoveis.remove(velho); limpar(velho);
  grpMoveis.add(novo); objMovel.set(m.id, novo);
}
function renderPainelPosicao() {
  const m = sel?.tipo === 'movel' && movel(sel.id);
  if (!m) return;
  const pg = pegada(m);
  const x = $('#painel [data-chave="x"]'), z = $('#painel [data-chave="z"]');
  if (x) x.value = fmt(pg.x0);
  if (z) z.value = fmt(pg.z0);
}

function painelParede(p, cab) {
  const w = parede(sel.id);
  if (!w) return;
  const hz = horizontal(w), L = comprimento(w);
  const eixo = hz ? 'z' : 'x', c = hz ? w.z1 : w.x1;
  const aberturas = doc.planta.aberturas.filter((a) => a.parede === w.id).sort((a, b) => a.pos - b.pos);
  const folga = folgaInicio(w);
  const reposicionar = (v) => editarPlanta((pl) => {
    if (hz) esticar(pl, 'z', c, w.x1, w.x2, v - c); else esticar(pl, 'x', c, w.z1, w.z2, v - c);
  });
  const novoComprimento = (v) => editarPlanta((pl) => {
    // move a ponta final; a parede ligada nessa ponta vai junto
    if (hz) esticar(pl, 'x', w.x2, w.z1, w.z1, v - L); else esticar(pl, 'z', w.z2, w.x1, w.x1, v - L);
  });
  const editarAb = (ab, fn) => editarPlanta((pl) => fn(pl.aberturas.find((a) => a.id === ab.id)));
  anexar(p, 
    cab(w.nome, `Parede ${hz ? 'horizontal' : 'vertical'} · ${w.esp} cm`),
    w.demolida ? el('div', { class: 'status alerta' }, 'Parede derrubada (simulação)') : null,
    secao('Nome', campoTexto('Nome', w.nome, (v) => alterar(() => { parede(w.id).nome = v; }))),
    secao('Pintura',
      el('div', { class: 'grade2' },
        campoCor('Cor', w.cor || '#efe9df', (v, fim) => { parede(w.id).cor = v; if (fim) atualizarTudo(); else construirPlanta(); })),
      w.cor ? botao('Voltar ao branco', () => alterar(() => { delete parede(w.id).cor; }), { class: 'link' }) : null),
    secao('Posição e tamanho',
      el('div', { class: 'grade2' },
        campoNum(`Eixo (${eixo})`, c, reposicionar, { min: -1000, max: 3000 }),
        campoNum('Comprimento', L, novoComprimento, { min: 10, max: 3000 }),
        campoNum('Espessura', w.esp, (v) => alterar(() => { parede(w.id).esp = v; }), { min: 3, max: 60 }),
        campoNum('Pé-direito', doc.planta.alturaParede, (v) => alterar(() => { doc.planta.alturaParede = v; }), { min: 200, max: 500 })),
      el('p', { class: 'nota' }, 'Com a parede selecionada, arraste-a para movê-la (encaixe 5 cm). Paredes, ambientes e aberturas ligados acompanham. Mudar o comprimento empurra a parede ligada na ponta final.')),
    secao('Demolição',
      el('label', { class: 'interruptor' },
        el('input', { type: 'checkbox', checked: !!w.derrubavel, onchange: (e) => alterar(() => { const x = parede(w.id); x.derrubavel = e.target.checked; if (!x.derrubavel) x.demolida = false; }) }),
        el('span', {}, 'Pode ser derrubada')),
      w.derrubavel ? botao(w.demolida ? 'Reconstruir parede' : 'Derrubar parede', () => alterar(() => { parede(w.id).demolida = !w.demolida; }), { class: w.demolida ? '' : 'perigo' }) : null),
    secao(`Aberturas (${aberturas.length})`,
      ...aberturas.map((ab) => el('div', { class: 'abertura' + (sel.abertura === ab.id ? ' ativa' : '') },
        el('div', { class: 'abertura-cab' }, el('b', {}, `${TIPOS_ABERTURA[ab.tipo]} ${fmt(ab.largura)}`),
          botao('Remover', () => apagarAbertura(ab.id), { class: 'link perigo' })),
        el('div', { class: 'grade2' },
          campoNum('Do canto', ab.pos - folga, (v) => editarAb(ab, (a) => { a.pos = v + folga; }), { min: -folga, max: 3000 }),
          campoNum('Largura', ab.largura, (v) => editarAb(ab, (a) => { a.largura = v; }), { min: 20, max: 1000 }),
          campoNum('Altura', ab.altura, (v) => editarAb(ab, (a) => { a.altura = v; }), { min: 20, max: 300 }),
          ab.tipo === 'janela' ? campoNum('Peitoril', ab.peitoril, (v) => editarAb(ab, (a) => { a.peitoril = v; }), { min: 0, max: 250 }) : null),
        ab.tipo === 'porta' ? el('div', { class: 'linha-botoes' },
          botao('Abrir para o outro lado', () => editarAb(ab, (a) => { a.lado = a.lado === -1 ? 1 : -1; })),
          botao('Trocar dobradiça', () => editarAb(ab, (a) => { a.dobradica = a.dobradica === 'fim' ? 'inicio' : 'fim'; }))) : null,
      )),
      el('div', { class: 'linha-botoes' },
        botao('+ Porta', () => novaAbertura(w, 'porta')),
        botao('+ Janela', () => novaAbertura(w, 'janela')),
        botao('+ Correr', () => novaAbertura(w, 'correr')))),
    el('div', { class: 'linha-botoes fim' },
      botao('🗑 Apagar parede', () => apagarParede(w.id), { class: 'perigo' })),
  );
  for (const ab of aberturas) {
    const outra = aberturas.find((o) => o !== ab && o.pos < ab.pos + ab.largura && ab.pos < o.pos + o.largura);
    if (outra) { anexar(p, el('div', { class: 'status alerta' }, `⚠ ${TIPOS_ABERTURA[ab.tipo]} e ${TIPOS_ABERTURA[outra.tipo]} se sobrepõem`)); break; }
  }
}

function novaAbertura(w, tipo) {
  const padrao = PADRAO_ABERTURA[tipo];
  const pos = posicaoLivre(w, snap(Math.max(0, comprimento(w) / 2 - padrao.largura / 2)), padrao.largura);
  if (pos == null) { toast('Não há espaço livre nesta parede para essa abertura.'); return; }
  const ab = { id: novoId('ab'), tipo, parede: w.id, pos, ...padrao };
  alterar(() => doc.planta.aberturas.push(ab));
  sel.abertura = ab.id; renderPainel();
}

function painelAmbiente(p, cab) {
  const amb = ambiente(sel.id);
  if (!amb) return;
  const util = poligonoUtil(amb), b = limites(util), bc = limites(amb.pontos);
  const larg = b.x1 - b.x0, prof = b.z1 - b.z0;
  const retangular = amb.pontos.length === 4;
  const faixa = (eixo, c) => { // trecho da borda do ambiente sobre a linha eixo=c
    const X = eixo === 'x' ? 0 : 1, Y = 1 - X;
    const ys = amb.pontos.filter((q) => Math.abs(q[X] - c) < 0.5).map((q) => q[Y]);
    return [Math.min(...ys), Math.max(...ys)];
  };
  anexar(p,
    cab(amb.nome, 'Ambiente'),
    el('div', { class: 'area-grande' }, amb.vazio ? 'Vazio' : m2(areaUtil(amb)),
      el('small', {}, amb.vazio ? `${m2(areaUtil(amb))}, fora da soma das áreas` : 'área útil (sem paredes), calculada pelas paredes')),
    secao('Nome e piso',
      campoTexto('Nome', amb.nome, (v) => alterar(() => { ambiente(amb.id).nome = v; })),
      el('label', { class: 'campo largo' }, el('span', {}, 'Piso'),
        el('select', { onchange: (e) => alterar(() => { ambiente(amb.id).piso = e.target.value; }) },
          ...Object.entries(PISOS).map(([k, v]) => el('option', { value: k, selected: amb.piso === k }, v.nome)))),
      el('label', { class: 'interruptor' },
        el('input', { type: 'checkbox', checked: !!amb.vazio, onchange: (e) => alterar(() => { ambiente(amb.id).vazio = e.target.checked; }) }),
        el('span', {}, 'Vazio (shaft, poço): não conta na área'))),
    secao('Medidas internas',
      el('div', { class: 'grade2' },
        campoNum('Largura', larg, (v) => editarPlanta((pl) => { const [a, bb] = faixa('x', bc.x1); esticar(pl, 'x', bc.x1, a, bb, v - larg); }), { min: 30, max: 3000 }),
        campoNum('Profund.', prof, (v) => editarPlanta((pl) => { const [a, bb] = faixa('z', bc.z1); esticar(pl, 'z', bc.z1, a, bb, v - prof); }), { min: 30, max: 3000 })),
      el('p', { class: 'nota' }, retangular
        ? 'Mudar a largura move a parede da direita; a profundidade move a parede de baixo. Para mover outra parede, clique nela.'
        : 'Ambiente em L: largura e profundidade movem a borda mais à direita e a mais abaixo. Para as outras bordas, clique na parede.')),
  );
}

let avisosAbertos = null;
function renderAvisos() {
  const box = $('#avisos');
  box.textContent = '';
  if (!colisoes.lista.length) { box.hidden = true; return; }
  box.hidden = false;
  const n = colisoes.lista.length, uso = colisoes.lista.filter((c) => c.tipo).length;
  avisosAbertos ??= !LEVE_TELA();
  box.classList.toggle('recolhido', !avisosAbertos);
  box.append(el('b', { onclick: () => { avisosAbertos = !avisosAbertos; renderAvisos(); }, title: 'Mostrar ou esconder a lista' },
    `⚠ ${n} ${n === 1 ? 'conflito' : 'conflitos'}${uso ? ` (${uso} de uso)` : ''} ${avisosAbertos ? '▾' : '▸'}`));
  for (const c of colisoes.lista.slice(0, 6)) {
    box.append(el('button', { type: 'button', onclick: () => selecionar({ tipo: 'movel', id: c.ids[0] }) }, c.txt));
  }
  if (colisoes.lista.length > 6) box.append(el('span', {}, `e mais ${colisoes.lista.length - 6}`));
}

let tDica;
function dica(txt) { const d = $('#dica'); d.textContent = txt; d.hidden = !txt; }
function toast(txt) {
  const t = $('#toast');
  t.textContent = txt; t.classList.add('visivel');
  clearTimeout(tDica); tDica = setTimeout(() => t.classList.remove('visivel'), 3200);
}

function atualizarBotoes() {
  $('#bDesfazer').disabled = !hist.voltar.length;
  $('#bRefazer').disabled = !hist.avancar.length;
  $('#bVista').classList.toggle('ligado', vista.topo);
  $('#bCorte').classList.toggle('ligado', vista.corte);
  $('#bCaminhar').classList.toggle('ligado', vista.caminhar);
  $('#bCaminhar').querySelector('.rot').textContent = vista.caminhar ? 'Sair' : 'Andar';
  $('#bFoto').classList.toggle('ligado', foto.ativa);
  $('#bUso').classList.toggle('ligado', cinema.modo === 'uso');
  $('#bRegua').classList.toggle('ligado', regua.ativa);
  $('#bVista').disabled = vista.caminhar;
  $('#bCorte').disabled = vista.caminhar;
}

function atualizarTudo() {
  if (doc.ativo >= doc.cenarios.length) doc.ativo = 0;
  validarSelecao();
  construirPlanta();
  construirMoveis();
  verificarColisoes();
  construirZonas();
  desenharSelecao();
  renderAbas();
  renderAreas();
  renderCantos();
  renderMostrar();
  renderRelatorio();
  renderVistas();
  renderLuz();
  renderDemolicao();
  renderCatalogo();
  renderOpcoesDesenho();
  renderFundo();
  renderBarraDesenho();
  renderProjetoAtual();
  renderPainel();
  construirFundo();
  desenharOverlay();
  atualizarBotoes();
  salvarAuto();
}

function alternarVista() {
  if (vista.caminhar || (modo === 'desenhar' && vista.topo)) return; // o modo Planta é sempre de cima
  vista.topo = !vista.topo;
  ctlPersp.enabled = !vista.topo;
  ctlTopo.enabled = vista.topo;
  construirPlanta(); // na planta, as janelas viram faixas azuis no topo da parede
  aplicarVisibilidadeTopo();
  atualizarBotoes();
}

$('#bDesfazer').onclick = desfazer;
$('#bRefazer').onclick = refazer;
$('#bVista').onclick = alternarVista;
$('#bCorte').onclick = () => { vista.corte = !vista.corte; construirPlanta(); aplicarVisibilidadeTopo(); atualizarBotoes(); };
$('#bEnquadrar').onclick = () => { if (vista.caminhar) alternarCaminhada(); enquadrar(); };
$('#bCaminhar').onclick = () => { if (!foto.ativa) alternarCaminhada(); };
function alternarPausaCinema() {
  cinema.pausa = !cinema.pausa;
  $('#usoPausa').textContent = cinema.pausa ? '▶' : '⏸';
}
$('#bRegua').onclick = () => alternarRegua();
$('#reguaLimpar').onclick = () => { regua.medidas = []; regua.a = null; desenharRegua(); };
$('#reguaFechar').onclick = () => alternarRegua(false);
$('#bZoomMais').onclick = () => zoomPasso(0.7);
$('#bZoomMenos').onclick = () => zoomPasso(1.45);
$('#bUso').onclick = () => { if (foto.ativa) return; cinema.modo === 'uso' ? pararCinema() : iniciarUso(); };
$('#usoPausa').onclick = alternarPausaCinema;
$('#usoFechar').onclick = pararCinema;
$('#usoMedidas').onclick = alternarMedidas;
$('#bFoto').onclick = () => (foto.ativa || !$('#fotoMenu').hidden ? fecharFoto() : abrirFoto());
$('#fotoMenuFechar').onclick = fecharFoto;
$('#fotoIr').onclick = fotografar;
$('#fotoJa').onclick = terminarFoto;
$('#fotoCancelar').onclick = fecharFoto;
$('#fotoFechar').onclick = fecharFoto;
$('#fotoOutra').onclick = () => { fecharFoto(); abrirFoto(); };
$('#fotoSalvar').onclick = salvarFoto;
$('#fotoClara').onclick = () => luzFoto(1.25);
$('#fotoEscura').onclick = () => luzFoto(0.8);
$('#bPNG').onclick = exportarPNG;
$('#bGaveta').onclick = () => {
  const aberta = document.body.classList.toggle('lateral-aberta');
  $('#bGaveta').textContent = aberta ? '✕ Fechar' : ROTULO_GAVETA[modo] || '';
};
const ROTULO_GAVETA = { desenhar: '☰ Planta e fundo', arrumar: '＋ Móveis', conferir: '📋 Relatório' };
$('#buscaCatalogo').addEventListener('input', (e) => { filtroCatalogo = e.target.value; renderCatalogo(); });

// =====================================================================
// 9b. MODOS — Planta · Arrumar · Conferir · Visitar
// =====================================================================
// Planta: desenhar paredes, portas e janelas (vista de cima). Arrumar:
// mover e trocar móveis. Conferir: relatório automático dos espaços
// (sentar, levantar, passar, abrir portas) com verde/amarelo/vermelho no
// piso. Visitar: passeio e fotos, nada se mexe.
const MODOS = ['desenhar', 'arrumar', 'conferir', 'visitar'];
let modo = (() => { try { return localStorage.getItem(`${CFG.prefixo}modo`) || 'visitar'; } catch { return 'visitar'; } })();
if (!MODOS.includes(modo)) modo = 'visitar';
let vistaAtual = null;

function setModo(novo, manterSel = false) {
  fecharFoto();
  pararCinema();
  if (regua.ativa && novo === 'visitar') alternarRegua(false);
  if (modo === 'desenhar' && novo !== 'desenhar') { concluirParedes(); desenho.ferramenta = 'selecionar'; dica(''); }
  modo = novo;
  try { localStorage.setItem(`${CFG.prefixo}modo`, modo); } catch { /* ok */ }
  aplicarClassesModo();
  $('#solVisita').hidden = true;
  if (!manterSel) sel = null;
  if (modo === 'visitar') { sel = null; if (vista.topo) alternarVista(); }
  if (modo !== 'visitar' && vista.caminhar) alternarCaminhada();
  if ((modo === 'conferir' || modo === 'desenhar') && !vista.topo) alternarVista();
  if (modo === 'desenhar') setFerramenta(doc.planta.paredes.length ? 'selecionar' : 'parede');
  aplicarVisibilidadeTopo();
  vistaAtual = null;
  atualizarTudo();
}
function aplicarClassesModo() {
  document.body.classList.remove(...MODOS.map((m) => `modo-${m}`), 'lateral-aberta');
  document.body.classList.add(`modo-${modo}`);
  for (const b of document.querySelectorAll('#modos button')) b.classList.toggle('ativo', b.dataset.modo === modo);
  $('#bGaveta').textContent = ROTULO_GAVETA[modo] || '';
}
for (const b of document.querySelectorAll('#modos button')) b.onclick = () => setModo(b.dataset.modo);

// ---- Visitar: atalhos dos cômodos, tirados dos ambientes do projeto. A
// câmera fica num canto, recuada 45 cm, olhando para o meio do ambiente.
function vistasVisita() {
  const nomes = new Set();
  return doc.planta.ambientes.filter((a) => !a.vazio && areaUtil(a) >= 1.5 && !nomes.has(a.nome) && nomes.add(a.nome)).map((a) => {
    const util = poligonoUtil(a), [cx, cz] = centroRotulo(util);
    let melhor = [cx, cz], dist = -1;
    for (const [x, z] of util) {
      const d = Math.hypot(x - cx, z - cz);
      if (d < 60) continue;
      const p = [x + ((cx - x) * 45) / d, z + ((cz - z) * 45) / d];
      if (d > dist && dentro(p, util)) { melhor = p; dist = d; }
    }
    return { nome: a.nome, x: melhor[0], z: melhor[1], yaw: Math.atan2(-(cx - melhor[0]), -(cz - melhor[1])), pitch: -0.16 };
  });
}
const animarVista = { id: 0 };
function irPara(v) {
  vistaAtual = v.nome;
  if (v.tipo === 'maquete') {
    if (vista.caminhar) alternarCaminhada();
    if (vista.topo) alternarVista();
    enquadrar();
  } else if (v.tipo === 'planta') {
    if (vista.caminhar) alternarCaminhada();
    if (!vista.topo) alternarVista();
  } else {
    if (vista.topo) alternarVista();
    if (!vista.caminhar) alternarCaminhada();
    const de = { x: andar.x, z: andar.z, yaw: andar.yaw, pitch: andar.pitch }, t0 = performance.now(), dur = 900;
    let dy = v.yaw - de.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy)); // o menor giro
    cancelAnimationFrame(animarVista.id);
    const passo = (agora) => {
      const t = Math.min(1, (agora - t0) / dur), k = t * t * (3 - 2 * t);
      andar.x = de.x + (v.x - de.x) * k; andar.z = de.z + (v.z - de.z) * k;
      andar.yaw = de.yaw + dy * k; andar.pitch = de.pitch + (v.pitch - de.pitch) * k;
      aplicarCameraAndar();
      if (t < 1) animarVista.id = requestAnimationFrame(passo);
    };
    animarVista.id = requestAnimationFrame(passo);
  }
  renderVistas();
}
function renderVistas() {
  const box = $('#vistas');
  box.textContent = '';
  if (modo !== 'visitar') {
    box.append(botao('Inteiro', () => enquadrar()));
    for (const a of doc.planta.ambientes) box.append(botao(a.nome, () => focarAmbiente(a)));
    return;
  }
  const lista = [...vistasVisita(), { nome: 'Maquete', tipo: 'maquete' }, { nome: 'Planta', tipo: 'planta' }];
  for (const v of lista) box.append(botao(v.nome, () => irPara(v), { class: vistaAtual === v.nome ? 'ativo' : '' }));
  box.append(botao(`☀ ${horaTxt(luz.hora)}`, () => { $('#solVisita').hidden = !$('#solVisita').hidden; atualizarSolVisita(); }, { class: 'sol' }));
}
function atualizarSolVisita() {
  $('#solVisitaHora').value = String(luz.hora);
  const { elev, az } = posicaoSol(luz.data, luz.hora, doc.planta.local);
  $('#solVisitaTxt').textContent = elev <= 0 ? `${horaTxt(luz.hora)} · noite` : `${horaTxt(luz.hora)} · sol a ${Math.round(elev)}°, do ${pontoCardeal(az)}`;
}
$('#solVisitaHora').addEventListener('input', (e) => {
  luz.hora = +e.target.value;
  try { localStorage.setItem(CHAVE_LUZ, JSON.stringify(luz)); } catch { /* ok */ }
  aplicarSol(); atualizarSolVisita();
  const b = document.querySelector('#vistas .sol'); if (b) b.textContent = `☀ ${horaTxt(luz.hora)}`;
});
$('#solVisitaFechar').onclick = () => { $('#solVisita').hidden = true; };
let diaVisita = 0;
$('#solVisitaDia').onclick = () => {
  if (diaVisita) { clearInterval(diaVisita); diaVisita = 0; $('#solVisitaDia').textContent = '▶ Passar o dia'; return; }
  const { nascer, por } = nascerPor(luz.data);
  luz.hora = Math.floor((nascer ?? 6) * 4) / 4;
  $('#solVisitaDia').textContent = '■ Parar';
  diaVisita = setInterval(() => {
    luz.hora += 0.25;
    if (luz.hora > (por ?? 18) + 0.5) { clearInterval(diaVisita); diaVisita = 0; $('#solVisitaDia').textContent = '▶ Passar o dia'; }
    $('#solVisitaHora').dispatchEvent(new Event('input'));
    $('#solVisitaHora').value = String(luz.hora);
  }, 160);
};

// ---- Conferir: relatório de espaços
const NIVEL = { ok: 0, atencao: 1, problema: 2 };
let relatorio = [];
const classificar = (livre, ideal) => (livre >= ideal - 0.5 ? 'ok' : livre >= ideal * 0.7 ? 'atencao' : 'problema');

function obstaculosPara(m, ignorar = true) {
  const def = defCatalogo(m.tipo) || {};
  const lista = doc.planta.paredes.filter((w) => !w.demolida).map((w) => ({ ...caixaParede(w), nome: `a parede ${w.nome.toLowerCase()}` }));
  for (const o of cen().moveis) {
    if (o.id === m.id) continue;
    const d2 = defCatalogo(o.tipo) || {};
    if (d2.colide === false || (ignorar && ignoraPar(def, d2))) continue;
    const pg = pegada(o);
    if (pg.y0 >= 60) continue;
    lista.push({ ...pg, nome: o.nome.toLowerCase(), id: o.id });
  }
  return lista;
}
function livreNaDirecao(ret, eixo, sentido, obst, max = 300) {
  const [a0, a1, b0, b1] = eixo === 'x' ? ['x0', 'x1', 'z0', 'z1'] : ['z0', 'z1', 'x0', 'x1'];
  const borda = sentido > 0 ? ret[a1] : ret[a0];
  let melhor = max, quem = null;
  for (const o of obst) {
    if (Math.min(o[b1], ret[b1]) - Math.max(o[b0], ret[b0]) <= 1) continue;
    const d = sentido > 0 ? o[a0] - borda : borda - o[a1];
    if (d > -0.5 && d < melhor) { melhor = Math.max(0, d); quem = o.nome; }
  }
  return { livre: melhor, quem };
}
function ambienteDoPonto(x, z) {
  return doc.planta.ambientes.find((a) => dentro([x, z], a.pontos))?.nome || 'Outros';
}

const livreZona = new Map();     // zona de uso → espaço livre medido
function conferir() {
  const itens = [], moveis = cen().moveis;
  statusZona = new Map();
  livreZona.clear();
  for (const m of moveis) {
    const def = defCatalogo(m.tipo) || {};
    if (def.colide === false) continue;
    const pg = pegada(m), amb = ambienteDoPonto(m.x, m.z);
    // 1. áreas de uso: espaço livre real × ideal
    zonasUso(m).forEach((z, k) => {
      let eixo, sentido, ideal;
      if (z.x0 >= pg.x1 - 1) [eixo, sentido, ideal] = ['x', 1, z.x1 - z.x0];
      else if (z.x1 <= pg.x0 + 1) [eixo, sentido, ideal] = ['x', -1, z.x1 - z.x0];
      else if (z.z0 >= pg.z1 - 1) [eixo, sentido, ideal] = ['z', 1, z.z1 - z.z0];
      else if (z.z1 <= pg.z0 + 1) [eixo, sentido, ideal] = ['z', -1, z.z1 - z.z0];
      let st, detalhe;
      if (eixo) {
        const base = eixo === 'x' ? { ...pg, z0: z.z0, z1: z.z1 } : { ...pg, x0: z.x0, x1: z.x1 };
        const { livre, quem } = livreNaDirecao(base, eixo, sentido, obstaculosPara(m), ideal * 2);
        st = classificar(livre, ideal);
        livreZona.set(`${m.id}#${k}`, { livre: Math.min(livre, ideal * 2), ideal, quem });
        detalhe = `${fmt(Math.min(livre, ideal * 2))} cm livres${st === 'ok' ? '' : ` · ideal ${fmt(ideal)}`}${quem && st !== 'ok' ? ` · até ${quem}` : ''}`;
      } else {
        st = colisoes.usoBloq.has(`${m.id}#${k}`) ? 'problema' : 'ok';
        detalhe = st === 'ok' ? 'livre' : 'há algo no caminho';
      }
      statusZona.set(`${m.id}#${k}`, st);
      itens.push({ amb, st, ids: [m.id], titulo: `${m.nome}: ${z.nome.toLowerCase()}`, detalhe });
    });
    // 2. mesas de refeição: lugares e espaço por pessoa
    if (m.tipo === 'mesa_jantar' || m.tipo === 'mesa_redonda') {
      const lados = { N: [], S: [], L: [], O: [] }, ids = [m.id];
      for (const c of moveis) {
        const dc = defCatalogo(c.tipo) || {};
        if (dc.grupo !== 'cadeira') continue;
        const pc = pegada(c);
        const dx = Math.max(pc.x0 - pg.x1, pg.x0 - pc.x1, 0), dz = Math.max(pc.z0 - pg.z1, pg.z0 - pc.z1, 0);
        if (Math.max(dx, dz) > (c.tipo === 'banco' ? 45 : 20)) continue;
        const rx = (c.x - m.x) / pg.w, rz = (c.z - m.z) / pg.d;
        const lado = Math.abs(rx) > Math.abs(rz) ? (rx > 0 ? 'L' : 'O') : (rz > 0 ? 'S' : 'N');
        const horiz = lado === 'N' || lado === 'S';
        let pessoas = 1;
        if (c.tipo === 'banco') {
          const sob = horiz ? Math.min(pc.x1, pg.x1) - Math.max(pc.x0, pg.x0) : Math.min(pc.z1, pg.z1) - Math.max(pc.z0, pg.z0);
          pessoas = Math.max(1, Math.floor((sob + 5) / 45));
        }
        lados[lado].push({ c, pessoas });
        ids.push(c.id);
      }
      let total = 0, menor = Infinity, cadeiras = 0;
      const partes = [];
      for (const [lado, lista] of Object.entries(lados)) {
        const n = lista.reduce((t, x) => t + x.pessoas, 0);
        if (!n) continue;
        const comp = lado === 'N' || lado === 'S' ? pg.w : pg.d;
        const cada = (m.tipo === 'mesa_redonda' ? comp * 0.9 : comp) / n;
        total += n; menor = Math.min(menor, cada);
        const banco = lista.find((x) => x.c.tipo === 'banco');
        if (banco) partes.push(`banco ${banco.pessoas} (${fmt(cada)} cm cada)`);
        cadeiras += lista.filter((x) => x.c.tipo !== 'banco').length;
      }
      if (cadeiras) partes.push(`${cadeiras} cadeira${cadeiras > 1 ? 's' : ''}`);
      if (m.tipo === 'mesa_redonda' && total) menor = (Math.PI * Math.min(m.l, m.p)) / total; // redonda: perímetro dividido
      const st = !total ? 'atencao' : menor >= 55 ? 'ok' : menor >= 45 ? 'atencao' : 'problema';
      itens.push({ amb, st, ids, titulo: `Mesa ${fmt(m.l)}×${fmt(m.p)}${m.tipo === 'mesa_redonda' ? ' redonda' : ''}: ${total} lugar${total === 1 ? '' : 'es'}`,
        detalhe: total ? `${partes.join(' + ')} · ${fmt(menor)} cm por pessoa${st === 'ok' ? ', confortável' : ' (ideal 60)'}` : 'sem cadeiras por perto' });
    }
  }
  itens.sort((a, b) => NIVEL[b.st] - NIVEL[a.st]);
  relatorio = itens;
}

function renderRelatorio() {
  const box = $('#relatorio');
  if (!box) return;
  box.textContent = '';
  const n = (st) => relatorio.filter((i) => i.st === st).length;
  box.append(el('div', { class: 'resumo-rel' },
    el('span', { class: 'ok' }, `✓ ${n('ok')} ok`), el('span', { class: 'atencao' }, `! ${n('atencao')} atenção`), el('span', { class: 'problema' }, `✕ ${n('problema')} problema`)));
  const ambs = [...new Set([...doc.planta.ambientes.map((a) => a.nome), 'Outros'])];
  const icone = { ok: '✓', atencao: '!', problema: '✕' };
  for (const amb of ambs) {
    const lista = relatorio.filter((i) => i.amb === amb);
    if (!lista.length) continue;
    box.append(el('div', { class: 'rel-amb' }, amb));
    for (const it of lista) {
      box.append(el('button', { type: 'button', class: `item-rel ${it.st}${sel?.tipo === 'movel' && it.ids.includes(sel.id) ? ' ativo' : ''}`,
        onclick: () => { document.body.classList.remove('lateral-aberta'); selecionar({ tipo: 'movel', id: it.ids[0] }); } },
      el('i', {}, icone[it.st]), el('b', {}, it.titulo), el('small', {}, it.detalhe)));
    }
  }
  box.append(el('p', { class: 'nota' }, 'Referências: 60 cm de mesa por pessoa; 75 cm atrás da cadeira para levantar; 50–60 cm nas laterais da cama; 90 cm no corredor da cozinha.'));
}

function painelConferirMovel(p, cab, m) {
  const itens = relatorio.filter((i) => i.ids.includes(m.id));
  const NOME_DIR = { 'x1': 'à direita', 'x-1': 'à esquerda', 'z1': 'abaixo', 'z-1': 'acima' };
  const icone = { ok: '✓', atencao: '!', problema: '✕' };
  anexar(p,
    cab(m.nome, `${fmt(m.l)} × ${fmt(m.p)} × ${fmt(m.a)} cm`),
    itens.length ? secao('Uso', ...itens.map((it) => el('div', { class: `item-rel ${it.st}` }, el('i', {}, icone[it.st]), el('b', {}, it.titulo), el('small', {}, it.detalhe))))
      : el('p', { class: 'nota' }, 'Este móvel não tem regra de uso para conferir.'),
    secao('Distâncias livres', el('div', { class: 'lista-moveis' },
      ...calcularCotas(m).map((c) => el('div', { class: 'linha-uso ok' }, el('span', {}, NOME_DIR[c.eixo + c.s]), el('b', {}, `${fmt(c.dist)} cm`))))),
    el('div', { class: 'linha-botoes fim' }, botao('✏️ Arrumar este móvel', () => { const id = m.id; setModo('arrumar', true); selecionar({ tipo: 'movel', id }); }, { class: 'acao' })),
  );
}

// =====================================================================
// 9c. A CASA EM USO — simulação de uso
// =====================================================================
// Só mexe no 3D (nada vai para o layout salvo). Ao terminar, a cena é
// reconstruída a partir do documento e tudo volta ao lugar.
// Tudo abre e fecha junto, em laço — portas, armários, geladeira, gavetas,
// TV giratória, sofá, cadeiras sendo puxadas, fogão aceso.
const dirFrente = (rot) => [-Math.sin(rad(rot)), Math.cos(rad(rot))]; // para onde o móvel olha
const objDe = (m) => objMovel.get(m.id);
const ease = (u) => { u = Math.min(1, Math.max(0, u)); return u * u * (3 - 2 * u); };
const nomeAcao = (def, m) => { const a = acaoDe(def, m); return Array.isArray(a) ? a : [a, a]; };

const cinema = { modo: null, pausa: false, vel: 1, t: 0, tarefas: [], antes: null, legenda: '' };

// ---- peças auxiliares: chamas do fogão e cadeira puxada
const matChama = new T.MeshBasicMaterial({ color: '#4da3ff', transparent: true, opacity: 0.85, depthWrite: false });
const matChamaMiolo = new T.MeshBasicMaterial({ color: '#bfe4ff', transparent: true, opacity: 0.9, depthWrite: false });
function chamas(m) {
  const obj = objDe(m);
  if (!obj) return null;
  if (obj.userData.chamas) return obj.userData.chamas;
  const g = new T.Group();
  for (const [dx, dz, r] of [[-14, -11, 6], [14, -11, 6], [-14, 11, 4.5], [14, 11, 4.5]]) {
    const q = new T.Group();
    q.position.set(m.l / 2 - 40 + dx, m.a + 1.6, dz);
    const n = Math.round(r * 2.2);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const c = new T.Mesh(new T.ConeGeometry(0.7, 2.6, 6), i % 2 ? matChama : matChamaMiolo);
      c.position.set(Math.cos(a) * r * 0.8, 1.3, Math.sin(a) * r * 0.8);
      q.add(c);
    }
    g.add(q);
  }
  g.visible = false;
  obj.children[0].add(g);
  obj.userData.chamas = g;
  return g;
}
function fogo(m, k, t) {
  const g = chamas(m);
  if (!g) return;
  g.visible = k > 0.02;
  g.children.forEach((q, i) => q.scale.set(1, Math.max(0.01, k * (0.85 + 0.25 * Math.sin(t * 23 + i * 1.7))), 1));
}
function puxarCadeira(m, cm) {
  const obj = objDe(m);
  if (!obj) return;
  const [fx, fz] = dirFrente(m.rot);
  obj.position.set(m.x - fx * cm, m.y || 0, m.z - fz * cm);
}
function abrirMovel(m, k) { const obj = objDe(m); if (obj) aplicarAbertura(obj, k); }

// ---- relógio da cena: tarefas com duração, que andam com o tempo da simulação
function durante(dur, fn = () => {}) {
  return new Promise((res, rej) => cinema.tarefas.push({ t0: cinema.t, dur: Math.max(0.001, dur), fn, res, rej }));
}
const esperar = (s) => durante(s);

function tickCinema(dt) {
  if (!cinema.modo) return;
  if (!cinema.pausa) cinema.t += Math.min(dt, 0.1) * cinema.vel;
  for (const tf of [...cinema.tarefas]) {
    const u = Math.min(1, (cinema.t - tf.t0) / tf.dur);
    tf.fn(u);
    if (u >= 1) { cinema.tarefas.splice(cinema.tarefas.indexOf(tf), 1); tf.res(); }
  }
  if (cinema.modo === 'uso') tickUso();
}

function iniciarCinema(modo) {
  pararCinema();
  if (regua.ativa) alternarRegua(false);
  fecharFoto();
  if (sel) selecionar(null);
  cinema.antes = { caminhar: vista.caminhar, topo: vista.topo, corte: vista.corte, hora: luz.hora,
    pos: camPersp.position.clone(), alvo: ctlPersp.target.clone(), fov: camPersp.fov };
  Object.assign(cinema, { modo, pausa: false, vel: 1, t: 0, tarefas: [] });
  document.body.classList.add('cinema', `cinema-${modo}`);
  grpSel.visible = grpZonas.visible = false;
}

function pararCinema() {
  if (!cinema.modo) return;
  const a = cinema.antes;
  for (const tf of cinema.tarefas) tf.rej(new Error('fim'));
  cinema.tarefas = [];
  cinema.modo = null;
  document.body.classList.remove('cinema', 'cinema-uso');
  $('#usoBarra').hidden = true;
  limparMedidas();
  estadoPortas.clear();
  luz.hora = a.hora;
  vista.corte = a.corte;
  grpSel.visible = grpZonas.visible = true;
  construirPlanta(); construirMoveis(); construirZonas(); desenharSelecao();
  atualizarBotoes(); renderVistas();
}

// ---------------------------------------------------------------------
// 1. SIMULAÇÃO DE USO: tudo abre e fecha junto, em laço
// ---------------------------------------------------------------------
const uso = { lista: [] };

function centroPorta(ab) {
  const w = parede(ab.parede), u = ab.pos + ab.largura / 2, lado = ab.lado === -1 ? -1 : 1;
  return horizontal(w) ? [w.x1 + u, w.z1 + lado * 30] : [w.x1 - lado * 30, w.z1 + u];
}

function acoesDeUso() {
  const lista = [];
  const ambs = doc.planta.ambientes;
  const rank = (x, z) => { const i = ambs.findIndex((am) => dentro([x, z], am.pontos)); return i < 0 ? ambs.length : i; };
  for (const ab of doc.planta.aberturas) {
    if (ab.tipo !== 'porta' || !portasGiro.has(ab.id)) continue;
    const [x, z] = centroPorta(ab);
    const nome = nomePorta(ab), ext = nome === 'porta de entrada';
    lista.push({ tipo: 'porta', ab, x, z, r: ext ? -1 : rank(x, z) - 0.5, nome: nome[0].toUpperCase() + nome.slice(1), acao: 'Abrir' });
  }
  for (const m of cen().moveis) {
    const def = defCatalogo(m.tipo) || {};
    const r = rank(m.x, m.z);
    if (temMov(def, m) && nomeAcao(def, m)[0] !== '—') {
      lista.push({ tipo: 'abrir', m, x: m.x, z: m.z, r, nome: m.nome, acao: nomeAcao(def, m)[(m.aberto || 0) > 0.5 ? 1 : 0] });
    }
    if (m.tipo === 'cadeira' || m.tipo === 'cadeira_escritorio') lista.push({ tipo: 'cadeira', m, x: m.x, z: m.z, r, nome: m.nome, acao: 'Puxar para sentar' });
    if (m.tipo === 'bancada_cozinha') lista.push({ tipo: 'fogo', m, x: m.x, z: m.z + 0.1, r, nome: 'Fogão (cooktop)', acao: 'Acender e apagar' });
  }
  return lista.sort((a, b) => a.r - b.r || a.z - b.z || a.x - b.x);
}

function aplicarAcao(a, k) {
  if (a.tipo === 'porta') porta(a.ab.id, k); // portas: fechadas → abertas
  else if (a.tipo === 'cadeira') puxarCadeira(a.m, 32 * k);
  else if (a.tipo === 'fogo') fogo(a.m, k, cinema.t);
  else { const b = a.m.aberto || 0; abrirMovel(a.m, b + (b > 0.5 ? -b : 1 - b) * k); }
}

function iniciarUso() {
  iniciarCinema('uso');
  if (!vista.caminhar && !vista.corte) { vista.corte = true; construirPlanta(); } // paredes baixas: dá para ver tudo
  uso.lista = acoesDeUso();
  montarMedidas();
  $('#usoMedidas').classList.toggle('ligado', medidas.ligadas);
  $('#usoBarra').hidden = false;
  atualizarBotoes();
}

// Tudo ao mesmo tempo, em laço (como um gif): abre, fica aberto, fecha, fica fechado.
const CICLO_USO = [['Abrindo tudo', 1.3], ['Tudo aberto', 1.2], ['Fechando tudo', 1.3], ['Tudo fechado', 0.9]];
function tickUso() {
  const total = CICLO_USO.reduce((t, [, d]) => t + d, 0);
  let t = cinema.t % total, fase = 0;
  while (t > CICLO_USO[fase][1]) { t -= CICLO_USO[fase][1]; fase++; }
  const u = t / CICLO_USO[fase][1];
  const k = [ease(u), 1, 1 - ease(u), 0][fase];
  for (const a of uso.lista) aplicarAcao(a, k);
  if (medidas.ligadas) for (const f of animMedidas) f(k);
  const txt = `${CICLO_USO[fase][0]} · ${uso.lista.length} itens`;
  if (txt !== cinema.legenda) { cinema.legenda = txt; $('#usoTxt').textContent = txt; }
}

// ---- medidas da simulação: quanto cada coisa avança ao abrir (o número
// cresce junto) e, com tudo aberto, quanto sobra até o obstáculo mais
// próximo; o giro das portas; e o espaço livre
// das áreas de uso (sentar, levantar, passar). Verde = folgado, amarelo =
// apertado, vermelho = não dá.
const grpMedidas = new T.Group();
cena.add(grpMedidas);
let medidasTela = [], animMedidas = [];
const medidas = { ligadas: true };
const COR_ST = { ok: '#27ae60', atencao: '#e0a020', problema: '#e5484d' };
const matPlano = (cor, op) => new T.MeshBasicMaterial({ color: cor, transparent: true, opacity: op, depthWrite: false, side: T.DoubleSide });
const MAT_MED = { abre: matPlano('#f2994a', 0.38), ok: matPlano(COR_ST.ok, 0.22), atencao: matPlano(COR_ST.atencao, 0.3), problema: matPlano(COR_ST.problema, 0.3) };
const LIN_MED = Object.fromEntries(Object.entries({ abre: '#c0661c', ...COR_ST }).map(([k, c]) => [k, new T.LineBasicMaterial({ color: c })]));
// para passar ou usar: 60 cm é folgado; de 35 a 60 dá, apertado; menos, não
const stFolga = (d) => (d >= 60 ? 'ok' : d >= 35 ? 'atencao' : 'problema');

function planoMedida(r, y, mat) {
  const m = new T.Mesh(new T.PlaneGeometry(1, 1), mat);
  m.rotation.x = -Math.PI / 2;
  m.renderOrder = 2;
  ajustarPlano(m, r, y);
  grpMedidas.add(m);
  return m;
}
function ajustarPlano(m, r, y) {
  m.scale.set(Math.max(0.01, r.x1 - r.x0), Math.max(0.01, r.z1 - r.z0), 1);
  m.position.set((r.x0 + r.x1) / 2, y, (r.z0 + r.z1) / 2);
}
function cotaMedida(p1, p2, y, st) {
  const [x1, z1] = p1, [x2, z2] = p2, horiz = Math.abs(z2 - z1) < Math.abs(x2 - x1);
  const t = horiz ? [0, 5] : [5, 0];
  const pts = [[x1, z1], [x2, z2], [x1 - t[0], z1 - t[1]], [x1 + t[0], z1 + t[1]], [x2 - t[0], z2 - t[1]], [x2 + t[0], z2 + t[1]]]
    .map(([x, z]) => new T.Vector3(x, y, z));
  const l = new T.LineSegments(new T.BufferGeometry().setFromPoints(pts), LIN_MED[st]);
  grpMedidas.add(l);
  return l;
}
function rotuloMedida(txt, x, y, z, st) {
  const d = el('div', { class: `medida ${st}` }, txt);
  $('#medidasUso').append(d);
  const r = { el: d, pos: new T.Vector3(x, y, z) };
  medidasTela.push(r);
  return r;
}
function limparMedidas() {
  for (const o of [...grpMedidas.children]) { o.geometry?.dispose(); grpMedidas.remove(o); }
  $('#medidasUso').textContent = '';
  medidasTela = []; animMedidas = [];
}

const LADOS = [['x', -1], ['x', 1], ['z', -1], ['z', 1]];
const bordaDe = (r, eixo, s) => r[`${eixo}${s > 0 ? 1 : 0}`];
// faixa que cresce de "de" até "ate" no eixo, com a largura do outro eixo
function faixa(r, eixo, de, ate) {
  const [a, b] = [Math.min(de, ate), Math.max(de, ate)];
  return eixo === 'x' ? { x0: a, x1: b, z0: r.z0, z1: r.z1 } : { x0: r.x0, x1: r.x1, z0: a, z1: b };
}

function montarMedidas() {
  limparMedidas();
  // 1. caixa de cada móvel com tudo aberto (e, para as checagens, cada folha
  // ou gaveta separada: a caixa geral marcaria cantos vazios como ocupados)
  const aberto = new Map(), partes = new Map();
  for (const a of uso.lista) {
    if (a.tipo !== 'abrir') continue;
    const obj = objDe(a.m);
    if (!obj) continue;
    const b0 = a.m.aberto || 0;
    aplicarAbertura(obj, b0 > 0.5 ? 0 : 1);
    obj.updateMatrixWorld(true);
    const bx = new T.Box3().setFromObject(obj);
    const pg = pegada(a.m);
    partes.set(a.m.id, [pg, ...obj.userData.anim.map((an) => {
      const b = new T.Box3().setFromObject(an.g);
      return { x0: b.min.x, x1: b.max.x, z0: b.min.z, z1: b.max.z, y0: b.min.y, y1: b.max.y };
    })]);
    aplicarAbertura(obj, b0);
    aberto.set(a.m.id, { ...pg, x0: Math.min(pg.x0, bx.min.x), x1: Math.max(pg.x1, bx.max.x), z0: Math.min(pg.z0, bx.min.z), z1: Math.max(pg.z1, bx.max.z) });
  }
  for (const a of uso.lista) {
    if (a.tipo !== 'cadeira') continue;
    const [fx, fz] = dirFrente(a.m.rot), pg = pegada(a.m);
    aberto.set(a.m.id, { ...pg, x0: pg.x0 - Math.max(0, fx) * 32, x1: pg.x1 - Math.min(0, fx) * 32, z0: pg.z0 - Math.max(0, fz) * 32, z1: pg.z1 - Math.min(0, fz) * 32 });
    partes.set(a.m.id, [aberto.get(a.m.id)]);
  }
  const paredes = doc.planta.paredes.filter((w) => !w.demolida).map((w) => ({ ...caixaParede(w), nome: 'parede' }));
  const obstaculos = (m, pg) => [
    ...paredes,
    ...cen().moveis.filter((o) => {
      if (o.id === m.id) return false;
      const d1 = defCatalogo(m.tipo) || {}, d2 = defCatalogo(o.tipo) || {};
      if (d2.colide === false || ignoraPar(d1, d2)) return false;
      const po = pegada(o);
      return po.y0 < pg.y1 && po.y1 > pg.y0; // na mesma altura
    }).flatMap((o) => (partes.get(o.id) || [pegada(o)]).map((r) => ({ ...r, nome: o.nome.toLowerCase() }))),
  ];

  // 2. o que abre: faixa laranja que cresce + "abre N cm"; com tudo aberto, "sobra N cm"
  for (const a of uso.lista) {
    if ((a.tipo !== 'abrir' && a.tipo !== 'cadeira') || ['cortina', 'persiana'].includes(a.m.tipo)) continue;
    const pg = pegada(a.m), ab = aberto.get(a.m.id);
    if (!ab) continue;
    const y = pg.y0 + (pg.y0 > 1 ? 1 : 0.8);
    // só a direção principal (para onde mais avança), para não poluir
    const lados = LADOS.map(([eixo, s]) => [eixo, s, (bordaDe(ab, eixo, s) - bordaDe(pg, eixo, s)) * s]).sort((p, q) => q[2] - p[2]).slice(0, 1);
    for (const [eixo, s, cresce] of lados) {
      if (cresce < 10) continue;
      const e0 = bordaDe(pg, eixo, s), lat = eixo === 'x' ? { z0: ab.z0, z1: ab.z1 } : { x0: ab.x0, x1: ab.x1 };
      const base = { ...pg, ...lat };
      const plano = planoMedida(faixa(base, eixo, e0, e0 + s * cresce), y, MAT_MED.abre);
      const centro = (k) => { const r = faixa(base, eixo, e0, e0 + s * cresce * k); return [(r.x0 + r.x1) / 2, (r.z0 + r.z1) / 2]; };
      const [cx, cz] = centro(1);
      const rot = rotuloMedida('', cx, y + 2, cz, 'abre');
      const verbo = a.tipo === 'cadeira' ? 'puxa' : 'abre';
      // quanto sobra até o próximo obstáculo, com tudo aberto (ou em que bate)
      const obst = obstaculos(a.m, pg), regiao = faixa(base, eixo, e0, e0 + s * cresce);
      const bate = obst.filter((o) => o.nome !== 'parede' && sobrepoe({ ...regiao, x0: regiao.x0 + 5, x1: regiao.x1 - 5, z0: regiao.z0 + 5, z1: regiao.z1 - 5 }, o));
      const { livre, quem } = livreNaDirecao({ ...ab, ...lat }, eixo, s, obst, 240);
      let sobra = null;
      if (bate.length) {
        const [bx, bz] = centro(0.75);
        const r2 = rotuloMedida(`bate: ${[...new Set(bate.map((o) => o.nome))].join(', ')}`, bx, y + 3, bz, 'problema');
        r2.pos.z += eixo === 'x' ? 9 : 0; r2.pos.x += eixo === 'z' ? 9 : 0;
        sobra = { linha: new T.Object3D(), r2 };
      } else if (livre < 240) {
        const st = stFolga(livre), e1 = bordaDe(ab, eixo, s), meio = eixo === 'x' ? (lat.z0 + lat.z1) / 2 : (lat.x0 + lat.x1) / 2;
        const p1 = eixo === 'x' ? [e1, meio] : [meio, e1], p2 = eixo === 'x' ? [e1 + s * livre, meio] : [meio, e1 + s * livre];
        const linha = cotaMedida(p1, p2, y + 0.5, st);
        const r2 = rotuloMedida(`sobra ${fmt(livre)} cm${quem && livre < 60 ? ` · ${quem}` : ''}`, (p1[0] + p2[0]) / 2, y + 2, (p1[1] + p2[1]) / 2, st);
        sobra = { linha, r2 };
      }
      animMedidas.push((k) => {
        ajustarPlano(plano, faixa(base, eixo, e0, e0 + s * cresce * Math.max(0.01, k)), y);
        const [x, z] = centro(Math.max(0.5, k));
        rot.pos.set(x, y + 2, z);
        const txt = `${verbo} ${fmt(Math.round(cresce * k))} cm`;
        if (rot.txt !== txt) { rot.txt = txt; rot.el.textContent = txt; }
        const op = k > 0.05 ? '1' : '0';
        if (rot.el.style.opacity !== op) rot.el.style.opacity = op;
        if (sobra) { sobra.linha.visible = k > 0.9; const o2 = k > 0.9 ? '1' : '0'; if (sobra.r2.el.style.opacity !== o2) sobra.r2.el.style.opacity = o2; }
      });
    }
  }

  // 3. portas: o giro da folha (raio = largura) e se bate em algo
  for (const g of girosPortas()) {
    if (!uso.lista.some((a) => a.tipo === 'porta' && a.ab.id === g.ab.id)) continue;
    // com os móveis fechados (o normal) e, à parte, se algum aberto atrapalha
    const noChao = cen().moveis.filter((m) => (defCatalogo(m.tipo) || {}).colide !== false && pegada(m).y0 < 60);
    const bate = noChao.filter((m) => bloqueiaGiro(pegada(m), g)).map((m) => m.nome.toLowerCase());
    const seAberto = noChao.filter((m) => partes.has(m.id) && !bate.includes(m.nome.toLowerCase())
      && partes.get(m.id).some((r) => (r.y0 ?? 0) < 60 && bloqueiaGiro(r, g))).map((m) => m.nome.toLowerCase());
    const st = bate.length ? 'problema' : seAberto.length ? 'atencao' : 'ok', n = 24;
    const pos = new Float32Array((n + 2) * 3), idx = [];
    for (let i = 1; i <= n; i++) idx.push(0, i, i + 1);
    const geo = new T.BufferGeometry();
    geo.setAttribute('position', new T.BufferAttribute(pos, 3));
    geo.setIndex(idx);
    const setor = new T.Mesh(geo, MAT_MED[st === 'ok' ? 'abre' : st]);
    setor.renderOrder = 2;
    grpMedidas.add(setor);
    const ponto = (t, r) => [g.c[0] + g.du[0] * r * Math.cos(t) + g.dv[0] * r * Math.sin(t), g.c[1] + g.du[1] * r * Math.cos(t) + g.dv[1] * r * Math.sin(t)];
    const [mx, mz] = ponto(Math.PI / 4, g.R * 0.62);
    const rot = rotuloMedida(`porta ${fmt(g.R)} cm · ${bate.length ? `bate: ${bate.join(', ')}` : seAberto.length ? `abre livre (só bate se ${seAberto.join(', ')} estiver aberto)` : 'abre livre'}`, mx, 3, mz, st);
    animMedidas.push((k) => {
      pos.set([g.c[0], 0.9, g.c[1]], 0);
      for (let i = 0; i <= n; i++) { const [x, z] = ponto((Math.PI / 2) * k * (i / n), g.R); pos.set([x, 0.9, z], (i + 1) * 3); }
      geo.attributes.position.needsUpdate = true;
      geo.computeBoundingSphere();
      rot.el.style.opacity = k > 0.6 ? 1 : 0;
    });
  }

  // 4. áreas de uso dos outros móveis (sentar, levantar, passar, lados da cama…)
  const comAcao = new Set(uso.lista.filter((a) => a.m).map((a) => a.m.id));
  for (const m of cen().moveis) {
    if (comAcao.has(m.id)) continue;
    zonasUso(m).forEach((z, k) => {
      const lz = livreZona.get(`${m.id}#${k}`), st = statusZona.get(`${m.id}#${k}`) || 'ok';
      planoMedida(z, 0.7, MAT_MED[st]);
      if (lz) rotuloMedida(`${z.nome.toLowerCase()} ${fmt(lz.livre)} cm`, (z.x0 + z.x1) / 2, 2, (z.z0 + z.z1) / 2, st);
    });
  }
  grpMedidas.visible = medidas.ligadas;
  $('#medidasUso').hidden = !medidas.ligadas;
}

function alternarMedidas() {
  medidas.ligadas = !medidas.ligadas;
  grpMedidas.visible = medidas.ligadas;
  $('#medidasUso').hidden = !medidas.ligadas;
  $('#usoMedidas').classList.toggle('ligado', medidas.ligadas);
}

// =====================================================================
// 10. PROJETOS E ARQUIVOS — salvar no aparelho, JSON, PNG e modelos .glb
// =====================================================================
// Cada projeto (um por cliente) fica salvo no aparelho numa chave própria;
// a lista guarda nome, cliente, área e data. Imagens de fundo e modelos
// .glb, que são grandes, ficam no IndexedDB. Exportar gera um .json com
// tudo dentro (planta, opções, móveis, fundo e modelos).
const CHAVE_LISTA = `${CFG.prefixo}projetos`, CHAVE_ULTIMO = `${CFG.prefixo}ultimo`;
const chaveProjeto = (id) => `${CFG.prefixo}projeto:${id}`;
function listaProjetos() { try { return JSON.parse(localStorage.getItem(CHAVE_LISTA)) || []; } catch { return []; } }
const guardarLista = (l) => localStorage.setItem(CHAVE_LISTA, JSON.stringify(l));
function resumoProjeto(d, alterado = Date.now()) {
  const area = d.planta.ambientes.filter((a) => !a.vazio).reduce((s, a) => s + Math.abs(areaSinal(deslocar(a.pontos, d.planta))) / 1e4, 0);
  return { id: d.id, nome: d.nome, cliente: d.cliente || '', alterado, ambientes: d.planta.ambientes.length, area, opcoes: d.cenarios.length };
}
// grava o projeto; a lista fica com o mais recente no alto
function gravarProjeto(d) {
  localStorage.setItem(chaveProjeto(d.id), JSON.stringify(d));
  guardarLista([resumoProjeto(d), ...listaProjetos().filter((p) => p.id !== d.id)]);
}
function lerProjeto(id) {
  try {
    const d = JSON.parse(localStorage.getItem(chaveProjeto(id)));
    return docValido(d) ? prepararDoc(d) : null;
  } catch { return null; }
}

let tSalvar, ultimoSalvo = '';
function salvarAuto() {
  clearTimeout(tSalvar);
  tSalvar = setTimeout(salvarAgora, 300);
}
function salvarAgora() {
  clearTimeout(tSalvar);
  if (!doc) return;
  const s = JSON.stringify(doc);
  if (s === ultimoSalvo) return; // só olhar não conta como alteração
  try {
    gravarProjeto(doc);
    ultimoSalvo = s;
    $('#salvo').textContent = `Salvo no aparelho às ${new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
  } catch (err) {
    $('#salvo').textContent = 'Não foi possível salvar no aparelho';
    toast('Não foi possível salvar: o espaço do navegador pode estar cheio. Exporte o projeto (.json).');
  }
}
addEventListener('pagehide', salvarAgora);
document.addEventListener('visibilitychange', () => { if (document.hidden) salvarAgora(); });

function baixar(blob, nome) {
  const a = el('a', { href: URL.createObjectURL(blob), download: nome });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
const slug = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w]+/g, '-').replace(/^-|-$/g, '').toLowerCase();
const dataTxt = (t) => new Date(t).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });

// IndexedDB: modelos .glb e imagens de fundo (grandes demais para o localStorage).
const idb = {
  abrir: () => new Promise((ok, erro) => {
    const r = indexedDB.open('simarq', 1);
    r.onupgradeneeded = () => { r.result.createObjectStore('modelos'); r.result.createObjectStore('fundos'); };
    r.onsuccess = () => ok(r.result);
    r.onerror = () => erro(r.error);
  }),
  async pedir(loja, modoT, fn) {
    const db = await idb.abrir();
    return new Promise((ok, erro) => {
      const t = db.transaction(loja, modoT), r = fn(t.objectStore(loja));
      t.oncomplete = () => ok(r?.result); t.onerror = () => erro(t.error);
    });
  },
  gravar: (loja, id, v) => idb.pedir(loja, 'readwrite', (s) => s.put(v, id)),
  ler: (loja, id) => idb.pedir(loja, 'readonly', (s) => s.get(id)),
  apagar: (loja, id) => idb.pedir(loja, 'readwrite', (s) => s.delete(id)),
  chaves: (loja) => idb.pedir(loja, 'readonly', (s) => s.getAllKeys()),
};
const paraBase64 = (buf) => {
  const b = new Uint8Array(buf); let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
  return btoa(s);
};
const deBase64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0)).buffer;

// Imagens e modelos que nenhum projeto usa mais saem do aparelho.
async function limparOrfaos() {
  try {
    const todos = listaProjetos().map((p) => localStorage.getItem(chaveProjeto(p.id)) || '').join('\n') + JSON.stringify(doc) + hist.voltar.join('');
    for (const loja of ['fundos', 'modelos']) {
      for (const id of await idb.chaves(loja)) if (!todos.includes(id)) await idb.apagar(loja, id);
    }
  } catch { /* sem IndexedDB: nada a limpar */ }
}

// ---- abrir, criar, duplicar, renomear, apagar
function abrirProjeto(id) {
  if (doc) salvarAgora();
  const d = lerProjeto(id);
  if (!d) { toast('Não consegui abrir esse projeto.'); return false; }
  pararCinema(); fecharFoto();
  if (regua.ativa) alternarRegua(false);
  if (vista.caminhar) alternarCaminhada();
  concluirParedes();
  doc = d; sel = null; selExtra = [];
  hist.voltar.length = 0; hist.avancar.length = 0;
  ultimoSalvo = JSON.stringify(doc);
  try { localStorage.setItem(CHAVE_ULTIMO, id); } catch { /* ok */ }
  fecharProjetos();
  setModo(doc.planta.paredes.length ? modo : 'desenhar');
  enquadrar();
  carregarModelosDoProjeto();
  return true;
}
async function criarProjeto(exemplo) {
  const r = await pedirCampos(exemplo ? 'Novo projeto a partir do exemplo' : 'Novo projeto em branco', [
    { nome: 'nome', rotulo: 'Nome do projeto', valor: exemplo ? 'Exemplo — apartamento de 1 quarto' : '' },
    { nome: 'cliente', rotulo: 'Cliente (opcional)', valor: '' }], 'Criar');
  if (!r) return;
  const d = novoDoc(r.nome || 'Projeto sem nome', exemplo);
  d.cliente = r.cliente;
  gravarProjeto(d);
  abrirProjeto(d.id);
  toast(exemplo ? 'Projeto criado a partir do exemplo.' : 'Projeto criado. Desenhe as paredes ou carregue a planta de fundo.');
}
async function duplicarProjeto(id) {
  if (id === doc.id) salvarAgora();
  const d = JSON.parse(localStorage.getItem(chaveProjeto(id)));
  d.id = novoId('prj');
  d.nome = `${d.nome} (cópia)`;
  if (d.planta.fundo) { // cada projeto com a sua imagem (apagar um não some com a do outro)
    const blob = await idb.ler('fundos', d.planta.fundo.id).catch(() => null);
    if (blob) { d.planta.fundo.id = novoId('fundo'); await idb.gravar('fundos', d.planta.fundo.id, blob); }
  }
  gravarProjeto(d);
  renderProjetos();
  toast(`Criado "${d.nome}".`);
}
async function renomearProjeto(id) {
  if (id === doc.id) salvarAgora();
  const d = JSON.parse(localStorage.getItem(chaveProjeto(id)));
  const r = await pedirCampos('Renomear projeto', [
    { nome: 'nome', rotulo: 'Nome do projeto', valor: d.nome }, { nome: 'cliente', rotulo: 'Cliente (opcional)', valor: d.cliente || '' }], 'Salvar');
  if (!r || !r.nome) return;
  if (id === doc.id) { doc.nome = r.nome; doc.cliente = r.cliente; salvarAgora(); renderProjetoAtual(); }
  else { d.nome = r.nome; d.cliente = r.cliente; localStorage.setItem(chaveProjeto(id), JSON.stringify(d)); guardarLista(listaProjetos().map((p) => (p.id === id ? { ...p, nome: r.nome, cliente: r.cliente } : p))); }
  renderProjetos();
}
function apagarProjeto(id) {
  const p = listaProjetos().find((x) => x.id === id);
  if (!p || !confirm(`Apagar o projeto "${p.nome}" deste aparelho? Não dá para desfazer (exporte antes se quiser guardar uma cópia).`)) return;
  localStorage.removeItem(chaveProjeto(id));
  guardarLista(listaProjetos().filter((x) => x.id !== id));
  if (id === doc.id) {
    ultimoSalvo = JSON.stringify(doc); // o projeto apagado não volta a ser salvo
    const outro = listaProjetos()[0];
    if (outro) abrirProjeto(outro.id);
    else { const d = novoDoc('Novo projeto'); gravarProjeto(d); abrirProjeto(d.id); }
  }
  limparOrfaos();
  renderProjetos();
}

// ---- exportar e importar (.json com tudo dentro)
async function exportarProjeto(id = doc.id) {
  if (id === doc.id) salvarAgora();
  const d = JSON.parse(localStorage.getItem(chaveProjeto(id)));
  const saida = { formato: 'simulador-interiores', versao: 2, exportado: new Date().toISOString(), projeto: d, modelos: {}, fundos: {} };
  for (const c of d.catalogoExtra || []) {
    if (!c.modelo) continue;
    try { const buf = modelos.get(c.modelo)?.buf || (await idb.ler('modelos', c.modelo)); if (buf) saida.modelos[c.modelo] = paraBase64(buf); } catch { /* segue sem o modelo */ }
  }
  if (d.planta.fundo) {
    try {
      const blob = await idb.ler('fundos', d.planta.fundo.id);
      if (blob) saida.fundos[d.planta.fundo.id] = { tipo: blob.type, dados: paraBase64(await blob.arrayBuffer()) };
    } catch { /* segue sem o fundo */ }
  }
  baixar(new Blob([JSON.stringify(saida)], { type: 'application/json' }), `${slug(d.nome) || 'projeto'}-${new Date().toISOString().slice(0, 10)}.json`);
}
async function importarProjeto(arquivo) {
  try {
    const j = JSON.parse(await arquivo.text());
    // aceita o formato exportado e também um layout solto (versão antiga)
    const d = j.formato === 'simulador-interiores' ? j.projeto : j;
    if (!docValido(d)) throw new Error('estrutura');
    for (const [id, b64] of Object.entries(j.modelos || {})) {
      const buf = deBase64(b64);
      try { await idb.gravar('modelos', id, buf); } catch { /* fica só na memória */ }
      await carregarModelo(id, buf);
    }
    for (const [id, f] of Object.entries(j.fundos || {})) await idb.gravar('fundos', id, new Blob([deBase64(f.dados)], { type: f.tipo || 'image/jpeg' }));
    if (!d.id || localStorage.getItem(chaveProjeto(d.id))) { d.id = novoId('prj'); if (d.nome) d.nome = `${d.nome} (importado)`; }
    d.nome ||= arquivo.name.replace(/\.json$/i, '');
    delete d.modelos;
    prepararDoc(d);
    gravarProjeto(d);
    abrirProjeto(d.id);
    toast(`Projeto "${d.nome}" importado.`);
  } catch (err) {
    console.error(err);
    toast('Arquivo inválido: não é um projeto deste simulador.');
  }
}

// ---- janela de projetos
function abrirProjetos() {
  salvarAgora();
  renderProjetos();
  if (!$('#dlgProjetos').open) $('#dlgProjetos').showModal();
}
function fecharProjetos() { if ($('#dlgProjetos').open) $('#dlgProjetos').close(); }
function renderProjetos() {
  const box = $('#listaProjetos');
  if (!box) return;
  box.textContent = '';
  for (const p of listaProjetos()) {
    const atual = p.id === doc?.id;
    box.append(el('div', { class: 'projeto' + (atual ? ' atual' : '') },
      el('button', { type: 'button', class: 'abrir', title: atual ? 'Projeto aberto' : 'Abrir', onclick: () => (atual ? fecharProjetos() : abrirProjeto(p.id)) },
        el('b', {}, p.nome, atual ? el('em', {}, ' · aberto') : null),
        el('small', {}, [p.cliente, `${p.ambientes} ${p.ambientes === 1 ? 'ambiente' : 'ambientes'} · ${m2(p.area || 0)}`, `${p.opcoes || 1} ${p.opcoes === 1 ? 'opção' : 'opções'}`, `alterado em ${dataTxt(p.alterado)}`].filter(Boolean).join(' · '))),
      el('div', { class: 'acoes-projeto' },
        botao('Renomear', () => renomearProjeto(p.id)),
        botao('Duplicar', () => duplicarProjeto(p.id)),
        botao('Exportar', () => exportarProjeto(p.id)),
        botao('Apagar', () => apagarProjeto(p.id), { class: 'perigo' }))));
  }
}
function renderProjetoAtual() {
  const b = $('#bProjeto .nome');
  if (b) b.textContent = doc.nome;
  document.title = `${doc.nome} · Simulador de Interiores`;
}

// Pequena janela com campos (nome, medida, página…). Devolve os valores ou null.
function pedirCampos(titulo, campos, ok = 'OK') {
  return new Promise((resolve) => {
    const dlg = $('#dlgCampos'), form = dlg.querySelector('form');
    form.textContent = '';
    const inputs = campos.map((c) => [c, el('input', { type: 'text', inputmode: c.tipo === 'numero' ? 'decimal' : 'text', value: c.tipo === 'numero' ? fmt(c.valor) : c.valor ?? '' })]);
    for (const [, inp] of inputs) inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); dlg.close('ok'); } });
    form.append(el('h3', {}, titulo),
      ...inputs.map(([c, inp]) => el('label', { class: `campo${c.sufixo ? '' : ' largo'}` }, el('span', {}, c.rotulo), inp, c.sufixo ? el('em', {}, c.sufixo) : null)),
      el('menu', {}, el('button', { value: 'cancel', formnovalidate: true }, 'Cancelar'), el('button', { value: 'ok', class: 'ok' }, ok)));
    dlg.onclose = () => resolve(dlg.returnValue === 'ok'
      ? Object.fromEntries(inputs.map(([c, inp]) => [c.nome, c.tipo === 'numero' ? numero(inp.value) : inp.value.trim()])) : null);
    dlg.returnValue = '';
    dlg.showModal();
    inputs[0][1].focus(); inputs[0][1].select();
  });
}

function exportarPNG() {
  if (foto.pronta) { salvarFoto(); return; }
  grpSel.visible = false;
  if (!foto.ativa) desenharQuadro(); // na foto realista, o canvas já tem a imagem
  const src = renderer.domElement;
  const c = document.createElement('canvas');
  c.width = src.width; c.height = src.height;
  const g = c.getContext('2d');
  g.drawImage(src, 0, 0);
  grpSel.visible = true;
  const k = src.width / palco.clientWidth, v = new T.Vector3();
  g.textAlign = 'center'; g.textBaseline = 'middle';
  for (const r of rotulos.filter((x) => x.nome)) {
    v.copy(r.pos).project(camAtiva());
    if (v.z >= 1) continue;
    const x = ((v.x + 1) / 2) * src.width, y = ((1 - v.y) / 2) * src.height;
    g.font = `600 ${13 * k}px system-ui, sans-serif`;
    const w = Math.max(g.measureText(r.nome).width, g.measureText(r.area).width) + 16 * k;
    g.fillStyle = 'rgba(255,255,255,.88)';
    g.beginPath(); g.roundRect(x - w / 2, y - 20 * k, w, 40 * k, 8 * k); g.fill();
    g.fillStyle = '#1d2530'; g.fillText(r.nome, x, y - 7 * k);
    g.font = `${12 * k}px system-ui, sans-serif`; g.fillStyle = '#4a5563'; g.fillText(r.area, x, y + 9 * k);
  }
  g.font = `${12 * k}px system-ui, sans-serif`; g.textAlign = 'left'; g.fillStyle = 'rgba(29,37,48,.75)';
  const [ano, mes, dia] = luz.data.split('-');
  const util = doc.planta.ambientes.filter((a) => !a.vazio).reduce((s, a) => s + areaUtil(a), 0);
  g.fillText(`${doc.nome} · ${cen().nome} · útil ${m2(util)} · sol de ${dia}/${mes}/${ano} às ${horaTxt(luz.hora)}`, 14 * k, src.height - 14 * k);
  c.toBlob((b) => baixar(b, `${slug(doc.nome)}-${slug(cen().nome)}.png`));
}

// ---- modelos .glb
const loader = new T.GLTFLoader();
function carregarModelo(id, buf) {
  return new Promise((ok, erro) => {
    loader.parse(buf.slice(0), '', (gltf) => {
      const cenaM = gltf.scene;
      const b = new T.Box3().setFromObject(cenaM);
      const tam = b.getSize(new T.Vector3()), centro = b.getCenter(new T.Vector3());
      const info = { cena: cenaM, tam, centro, base: b.min.y, buf };
      modelos.set(id, info);
      ok(info);
    }, (e) => erro(e));
  });
}
// modelos .glb do projeto guardados no aparelho
async function carregarModelosDoProjeto() {
  let algum = false;
  for (const c of doc.catalogoExtra) {
    if (!c.modelo || modelos.has(c.modelo)) continue;
    try { const buf = await idb.ler('modelos', c.modelo); if (buf) { await carregarModelo(c.modelo, buf); algum = true; } } catch { /* sem modelo */ }
  }
  if (algum) { construirMoveis(); desenharSelecao(); }
}

let glbPendente = null;
async function aoEscolherGLB(arquivo) {
  try {
    const buf = await arquivo.arrayBuffer();
    const id = novoId('glb');
    const info = await carregarModelo(id, buf);
    const maior = Math.max(info.tam.x, info.tam.y, info.tam.z);
    const escala = maior < 20 ? 100 : maior > 1000 ? 0.1 : 1; // metros, milímetros ou cm
    glbPendente = { id, info, buf };
    $('#glbNome').value = arquivo.name.replace(/\.(glb|gltf)$/i, '');
    $('#glbOriginal').textContent = `${fmt(info.tam.x)} × ${fmt(info.tam.z)} × ${fmt(info.tam.y)} (largura × profundidade × altura)`;
    $('#glbEscala').value = String(escala).replace('.', ',');
    atualizarPreviaGLB();
    $('#dlgGLB').showModal();
  } catch (err) {
    console.error(err);
    toast('Não consegui ler esse arquivo .glb (modelos com compressão Draco não são suportados).');
  }
}
function atualizarPreviaGLB() {
  if (!glbPendente) return;
  const e = numero($('#glbEscala').value) || 1, t = glbPendente.info.tam;
  $('#glbResultado').textContent = `${fmt(t.x * e)} × ${fmt(t.z * e)} × ${fmt(t.y * e)} cm`;
}
async function confirmarGLB() {
  const { id, info, buf } = glbPendente;
  const e = numero($('#glbEscala').value) || 1;
  const dim = { l: Math.max(1, Math.round(info.tam.x * e)), p: Math.max(1, Math.round(info.tam.z * e)), a: Math.max(1, Math.round(info.tam.y * e)) };
  const item = { tipo: id, nome: $('#glbNome').value.trim() || 'Modelo importado', cat: 'Importados', modelo: id, dim, cores: { principal: '#b8bcc2' } };
  glbPendente = null;
  alterar(() => doc.catalogoExtra.push(item));
  adicionarMovel(id);
  try { await idb.gravar('modelos', id, buf); } catch { toast('Aviso: o modelo não ficará salvo no aparelho; exporte o projeto para guardá-lo.'); }
}

$('#bProjeto').onclick = abrirProjetos;
$('#bProjetos').onclick = abrirProjetos;
$('#projetosFechar').onclick = fecharProjetos;
$('#novoEmBranco').onclick = () => criarProjeto(false);
$('#novoExemplo').onclick = () => criarProjeto(true);
$('#importarProjeto').onclick = () => $('#arqJSON').click();
$('#bSalvar').onclick = () => { salvarAgora(); toast('Projeto salvo neste aparelho.'); };
$('#bExportar').onclick = () => exportarProjeto();
$('#bImportar').onclick = () => $('#arqJSON').click();
$('#bGLB').onclick = () => $('#arqGLB').click();
$('#bGLB2').onclick = () => $('#arqGLB').click();
$('#arqJSON').onchange = (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) importarProjeto(f); };
$('#arqGLB').onchange = (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) aoEscolherGLB(f); };
$('#glbEscala').addEventListener('input', atualizarPreviaGLB);
$('#dlgGLB').addEventListener('close', () => { if ($('#dlgGLB').returnValue === 'ok' && glbPendente) confirmarGLB(); else glbPendente = null; });
// menu "Mais": abre como folha; qualquer escolha (ou tocar fora) fecha
const fecharMenu = () => { $('#menuMais').hidden = true; };
$('#bMais').onclick = () => { $('#menuMais').hidden = !$('#menuMais').hidden; };
$('#menuFechar').onclick = fecharMenu;
$('#menuMais').addEventListener('click', (e) => { if (e.target.id === 'menuMais' || e.target.closest('.folha-menu > button')) fecharMenu(); });

// =====================================================================
// 11. EXTENSÕES FUTURAS
// =====================================================================
// Pontos de encaixe para as próximas funções, sem mexer no resto:
//  - Cotas e medidas na tela: função em EXTENSOES.aposPlanta que desenha
//    linhas e textos a partir de doc.planta (recebe o grupo 3D da planta).
//  - Texturas: trocar as funções texturaMadeira/texturaPiso em MAT.piso,
//    ou acrescentar novos tipos em PISOS.
//  - Modo caminhada: uma terceira câmera ao lado de camPersp/camTopo,
//    ativada em alternarVista().
//  - Luz artificial à noite: somar PointLights em aplicarSol() quando o
//    sol estiver abaixo do horizonte (a partir de pontosEletricos).
//  - Tomadas e pontos de luz: doc.planta.pontosEletricos (já existe, vazio,
//    e já acompanha o "esticar" das paredes) + uma função em aposPlanta.
const EXTENSOES = { aposPlanta: [], aposMoveis: [] };

// =====================================================================
// 12. INÍCIO
// =====================================================================
// Abre o último projeto usado. Na primeira vez, cria o exemplo.
function carregarDoc() {
  let lista = listaProjetos(), id = null;
  try { id = localStorage.getItem(CHAVE_ULTIMO); } catch { /* ok */ }
  if (!lista.length) {
    const d = novoDoc('Exemplo — apartamento de 1 quarto', true);
    try { gravarProjeto(d); } catch { return d; } // sem armazenamento: trabalha só na memória
    lista = listaProjetos(); id = d.id;
  }
  const d = lerProjeto(lista.some((p) => p.id === id) ? id : lista[0].id)
    || lista.map((p) => lerProjeto(p.id)).find(Boolean) || novoDoc('Novo projeto');
  try { localStorage.setItem(CHAVE_ULTIMO, d.id); } catch { /* ok */ }
  return d;
}

doc = carregarDoc();
ultimoSalvo = JSON.stringify(doc);
redimensionar();
if (!doc.planta.paredes.length) modo = 'desenhar';
aplicarClassesModo();
if (modo === 'conferir' || modo === 'desenhar') { vista.topo = true; ctlPersp.enabled = false; ctlTopo.enabled = true; }
if (modo === 'desenhar') setFerramenta(doc.planta.paredes.length ? 'selecionar' : 'parede');
atualizarTudo();
enquadrar();
carregarModelosDoProjeto();
setTimeout(limparOrfaos, 4000);

let ultimoQuadro = performance.now();
renderer.setAnimationLoop(() => {
  const agora = performance.now(), dt = (agora - ultimoQuadro) / 1000;
  ultimoQuadro = agora;
  if (foto.ativa) { quadroFoto(); return; }
  if (cinema.modo || arr) sujarSombra(); // algo se mexendo: portas, móvel arrastado
  if (cinema.modo) tickCinema(dt);
  if (cinema.modo === 'uso' && medidas.ligadas) posicionar(medidasTela);
  if (!vista.caminhar) ctlAtivo().update();
  desenharQuadro();
  posicionarRotulos();
  posicionarBussola();
  atualizarAlcas();
  if (reguaTela.length) posicionar(reguaTela);
  posicionar(cotasTela);
  posicionar(rotulosZonas);
  if (modo === 'desenhar') { if (camTopo.zoom !== desenho.zoom) desenharOverlay(); else posicionar(rotulosDesenho); }
});

// acesso pelo console, útil para testes e ajustes finos
window.simulador = { get doc() { return doc; }, atualizarTudo, selecionar, esticar, areaUtil, areaConstruida, alternarVista, enquadrar, exportarPNG, CFG, camera: camAtiva,
  _grp: grpMoveis, olhar(px, py, pz, tx, ty, tz) { camPersp.position.set(px, py, pz); ctlPersp.target.set(tx, ty, tz); ctlPersp.update(); },
  alternarAbertura: (id) => alternarAbertura(movel(id)), alternarCaminhada, camadas, andar, aplicarCameraAndar, cinema, alvo: (x, y) => alvoEm({ clientX: x, clientY: y }), get sel() { return sel; },
  get modo() { return modo; }, setModo, setFerramenta, desenho, encaixarPonto, colocarPonto, concluirParedes, regioesDaPlanta, sincronizarAmbientes,
  listaProjetos, abrirProjeto, lerProjeto, salvarAgora, desfazer, refazer, cmPorPx, get fundoCarregado() { return !!fundoTela.malha; },
  // planta → pixel da tela (para os testes tocarem num ponto exato)
  naTela(x, z, y = 0) {
    const v = new T.Vector3(x, y, z).project(camAtiva()), r = renderer.domElement.getBoundingClientRect();
    return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
  } };
})();
