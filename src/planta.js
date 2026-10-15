// =====================================================================
// PLANTAS INICIAIS — só dados, sem lógica
// =====================================================================
// Unidade: centímetro. Vista de cima: x cresce para a direita, z cresce
// para baixo.
//
// PAREDES: linha de centro de (x1,z1) até (x2,z2), sempre na horizontal
// ou na vertical, do menor para o maior valor. 'esp' = espessura.
// 'derrubavel' = pode ser ocultada no painel "Demolição".
//
// ABERTURAS: 'parede' = id da parede; 'pos' = distância do início da
// parede (x1,z1) até a borda da abertura. Janela: 'peitoril' = altura do
// piso até a base. Porta: 'dobradica' ('inicio' | 'fim') e 'lado'
// (1 | -1, para que lado a folha abre).
//
// AMBIENTES: polígono pela linha de centro das paredes. São refeitos a
// partir das paredes sempre que a planta muda (área automática); a área
// útil desconta meia espessura de cada parede na borda.
//
// FUNDO: imagem do levantamento (guardada à parte, no aparelho), com
// posição do canto (x, z), escala (cm por pixel), giro e opacidade.
// =====================================================================

// Locais para calcular o sol por data e hora (capitais; dá para digitar
// latitude e longitude no painel "Luz do sol").
const LOCAIS = [
  { nome: 'São Paulo, SP', lat: -23.55, lon: -46.63, fuso: -3 },
  { nome: 'Rio de Janeiro, RJ', lat: -22.91, lon: -43.17, fuso: -3 },
  { nome: 'Belo Horizonte, MG', lat: -19.92, lon: -43.94, fuso: -3 },
  { nome: 'Brasília, DF', lat: -15.79, lon: -47.88, fuso: -3 },
  { nome: 'Curitiba, PR', lat: -25.43, lon: -49.27, fuso: -3 },
  { nome: 'Porto Alegre, RS', lat: -30.03, lon: -51.23, fuso: -3 },
  { nome: 'Florianópolis, SC', lat: -27.6, lon: -48.55, fuso: -3 },
  { nome: 'Salvador, BA', lat: -12.97, lon: -38.5, fuso: -3 },
  { nome: 'Recife, PE', lat: -8.05, lon: -34.88, fuso: -3 },
  { nome: 'Fortaleza, CE', lat: -3.73, lon: -38.52, fuso: -3 },
  { nome: 'Goiânia, GO', lat: -16.68, lon: -49.25, fuso: -3 },
  { nome: 'Manaus, AM', lat: -3.12, lon: -60.02, fuso: -4 },
  { nome: 'Belém, PA', lat: -1.46, lon: -48.5, fuso: -3 },
];

// 'orientacao' = para onde olha a face esquerda da planta (-x), em graus a
// partir do norte (0 = N, 90 = L, 180 = S, 270 = O). 270 = norte para cima.
const PLANTA_VAZIA = {
  alturaParede: 270,
  local: LOCAIS[0],
  orientacao: 270,
  paredes: [],
  aberturas: [],
  ambientes: [],
  contorno: [],
  pontosEletricos: [],
  fundo: null,
};

// ---------------------------------------------------------------------
// EXEMPLO: apartamento de 1 quarto (9,00 × 6,00 m pelos eixos)
// ---------------------------------------------------------------------
const PLANTA_EXEMPLO = {
  ...PLANTA_VAZIA,
  paredes: [
    { id: 'p-topo',  nome: 'Fachada (janelas)', x1: 0,   z1: 0,   x2: 900, z2: 0,   esp: 15 },
    { id: 'p-dir',   nome: 'Lateral direita',   x1: 900, z1: 0,   x2: 900, z2: 600, esp: 15 },
    { id: 'p-baixo', nome: 'Fundos (entrada)',  x1: 0,   z1: 600, x2: 900, z2: 600, esp: 15 },
    { id: 'p-esq',   nome: 'Lateral esquerda',  x1: 0,   z1: 0,   x2: 0,   z2: 600, esp: 15 },
    { id: 'p-sala',  nome: 'Sala / quarto e banheiro', x1: 560, z1: 0, x2: 560, z2: 600, esp: 10 },
    { id: 'p-banho', nome: 'Quarto / banheiro', x1: 560, z1: 370, x2: 900, z2: 370, esp: 10, derrubavel: true },
  ],
  aberturas: [
    { id: 'jan-sala',   tipo: 'janela', parede: 'p-topo', pos: 150, largura: 200, altura: 120, peitoril: 100 },
    { id: 'jan-quarto', tipo: 'janela', parede: 'p-topo', pos: 650, largura: 150, altura: 120, peitoril: 100 },
    { id: 'jan-banho',  tipo: 'janela', parede: 'p-dir',  pos: 440, largura: 60,  altura: 50,  peitoril: 160 },
    { id: 'porta-entrada', tipo: 'porta', parede: 'p-baixo', pos: 400, largura: 90, altura: 210, dobradica: 'fim', lado: -1 },
    { id: 'porta-quarto',  tipo: 'porta', parede: 'p-sala',  pos: 260, largura: 80, altura: 210, dobradica: 'fim', lado: -1 },
    { id: 'porta-banho',   tipo: 'porta', parede: 'p-sala',  pos: 450, largura: 70, altura: 210, dobradica: 'inicio', lado: -1 },
  ],
  ambientes: [
    { id: 'a-sala',   nome: 'Estar / cozinha', piso: 'porcelanato', pontos: [[0, 0], [560, 0], [560, 600], [0, 600]] },
    { id: 'a-quarto', nome: 'Quarto',   piso: 'madeira',  pontos: [[560, 0], [900, 0], [900, 370], [560, 370]] },
    { id: 'a-banho',  nome: 'Banheiro', piso: 'ceramica', pontos: [[560, 370], [900, 370], [900, 600], [560, 600]] },
  ],
  contorno: [[0, 0], [900, 0], [900, 600], [0, 600]],
};

// ---------------------------------------------------------------------
// MÓVEIS — x,z = centro do móvel; rot = 0/90/180/270; y = altura do chão
// rot 0: frente para baixo (+z) · 90: para a esquerda · 180: para cima · 270: para a direita
// l = largura, p = profundidade, a = altura (cm) · espelhado = lado invertido (chaise, cuba)
// variante = formato (ver o catálogo) · aberto = 0 fechado … 1 aberto
// ---------------------------------------------------------------------
const MOVEIS_EXEMPLO = [
  // estar
  { tipo: 'rack_tv', nome: 'Rack', x: 27.5, z: 140, rot: 270, l: 180, p: 40, a: 50 },
  { tipo: 'tv_parede', nome: 'TV', x: 10.5, z: 140, rot: 270, y: 95, l: 123, p: 6, a: 71 },
  { tipo: 'sofa', nome: 'Sofá', x: 352.5, z: 140, rot: 90, l: 210, p: 90, a: 85 },
  { tipo: 'mesa_centro', nome: 'Mesa de centro', x: 200, z: 140, rot: 90, l: 90, p: 60, a: 40 },
  { tipo: 'tapete', nome: 'Tapete', x: 220, z: 140, rot: 90, l: 240, p: 300, a: 1 },
  { tipo: 'cortina', nome: 'Cortina da sala', x: 250, z: 14, rot: 0, l: 260, p: 10, a: 250, aberto: 0.8 },
  // jantar
  { tipo: 'mesa_jantar', nome: 'Mesa de jantar', x: 250, z: 450, rot: 0, l: 140, p: 80, a: 76 },
  { tipo: 'cadeira', nome: 'Cadeira de jantar', x: 215, z: 395, rot: 180 },
  { tipo: 'cadeira', nome: 'Cadeira de jantar', x: 285, z: 395, rot: 180 },
  { tipo: 'cadeira', nome: 'Cadeira de jantar', x: 215, z: 505, rot: 0 },
  { tipo: 'cadeira', nome: 'Cadeira de jantar', x: 285, z: 505, rot: 0 },
  // cozinha (na parede esquerda)
  { tipo: 'bancada_cozinha', nome: 'Bancada da cozinha', x: 37.5, z: 465, rot: 270, l: 240, p: 60, a: 90 },
  { tipo: 'armario_aereo', nome: 'Armário aéreo', x: 25, z: 465, rot: 270, y: 150, l: 240, p: 35, a: 70 },
  { tipo: 'geladeira', nome: 'Geladeira', x: 42.5, z: 300, rot: 270, l: 70, p: 70, a: 185 },
  // quarto
  { tipo: 'cama_box', nome: 'Cama de casal', x: 793.5, z: 185, rot: 90, l: 158, p: 198, a: 60 },
  { tipo: 'criado_mudo', nome: 'Criado-mudo', x: 872.5, z: 80, rot: 90, l: 45, p: 40, a: 55 },
  { tipo: 'criado_mudo', nome: 'Criado-mudo', x: 872.5, z: 290, rot: 90, l: 45, p: 40, a: 55 },
  { tipo: 'guarda_roupa', nome: 'Guarda-roupa', x: 595, z: 125, rot: 270, l: 200, p: 60, a: 230 },
  { tipo: 'cortina', nome: 'Cortina do quarto', x: 725, z: 14, rot: 0, l: 190, p: 10, a: 250, aberto: 0.8 },
  // banheiro
  { tipo: 'lavatorio', nome: 'Lavatório', x: 640, z: 571, rot: 180, l: 80, p: 43, a: 85 },
  { tipo: 'vaso', nome: 'Vaso sanitário', x: 740, z: 562, rot: 180 },
  { tipo: 'box_banho', nome: 'Box', x: 847.5, z: 547.5, rot: 180, l: 90, p: 90, a: 200 },
  { tipo: 'chuveiro', nome: 'Chuveiro', x: 872.5, z: 547.5, rot: 90 },
];

// Abas de opções do exemplo: iguais, menos a mesa de jantar.
const CENARIOS_EXEMPLO = [
  { id: 'opcao-a', nome: 'Opção A', moveis: MOVEIS_EXEMPLO, zonas: [] },
  { id: 'opcao-b', nome: 'Opção B — mesa redonda', zonas: [],
    moveis: [...MOVEIS_EXEMPLO.filter((m) => m.tipo !== 'mesa_jantar' && m.tipo !== 'cadeira'),
      { tipo: 'mesa_redonda', nome: 'Mesa de jantar', variante: 'pe_central', x: 250, z: 450, rot: 0, l: 110, p: 110, a: 76 },
      { tipo: 'cadeira', nome: 'Cadeira de jantar', x: 250, z: 375, rot: 180 },
      { tipo: 'cadeira', nome: 'Cadeira de jantar', x: 250, z: 525, rot: 0 },
      { tipo: 'cadeira', nome: 'Cadeira de jantar', x: 175, z: 450, rot: 270 },
      { tipo: 'cadeira', nome: 'Cadeira de jantar', x: 325, z: 450, rot: 90 }],
  },
];

const CENARIOS_VAZIOS = [{ id: 'opcao-a', nome: 'Opção A', moveis: [], zonas: [] }];
