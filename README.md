# Simulador de Interiores

Simulador 3D de interiores para projetos de arquitetura: desenhar a planta (ou desenhar por cima
do levantamento), arrumar os móveis, conferir os espaços e visitar em 3D, com sol por data e hora
e foto realista. **Abra `simulador.html`.** Funciona sem internet e sem servidor: tudo está
embutido no próprio arquivo.

## Onde abrir

- **No PC, sem nada:** baixe `simulador.html` e dê duplo clique.
- **Como site:** `https://peklerbruno-dot.github.io/simulador-arquitetura/`
- **Como app:** aberto pelo site, o Chrome ou o Edge mostram **Instalar** na barra de endereço
  (no iPhone: Compartilhar → Adicionar à Tela de Início). Abre em janela própria e funciona sem
  internet depois da primeira visita (`sw.js` guarda a última versão).

## Projetos

Um projeto por cliente. O nome do projeto, no alto à esquerda, abre a lista: **novo em branco**,
**novo a partir do exemplo**, abrir, **renomear** (com o nome do cliente), **duplicar**,
**exportar** e **apagar**. Cada projeto tem as suas **abas de opções** (Opção A, Opção B…; `+`
duplica a aba atual, clique duplo renomeia).

Tudo fica salvo sozinho no aparelho (no navegador). A imagem de fundo e os modelos `.glb` ficam
no IndexedDB. **Exportar** gera um `.json` com tudo dentro (planta, opções, móveis, fundo e
modelos); **Importar** abre esse arquivo como um projeto novo — é assim que se leva um projeto
para outro aparelho ou se guarda uma cópia.

## Quatro modos

A barra de baixo troca o modo (teclas `1` a `4`):

- **📐 Planta:** desenhar paredes, portas e janelas, vista de cima (detalhes abaixo).
- **🛋 Arrumar:** catálogo com miniaturas, arrastar, girar e editar móveis; alças azuis mudam o
  tamanho, a alça redonda gira; **Alinhar** e **encostar** sozinho nas paredes e móveis.
- **✅ Conferir:** vista de cima com as áreas de uso pintadas (verde, amarelo, vermelho) e um
  relatório: espaço livre na frente de cada móvel, lugares em cada mesa, giro das portas. Mostra
  também as áreas de cada ambiente e a luz do sol.
- **👁 Visitar:** só a casa. Os botões levam a câmera a cada ambiente na altura dos olhos;
  **Maquete** e **Planta** voltam para a visão geral; **☀** muda a hora do sol.

Ferramentas da tela (coluna à direita): Andar, Planta (vista de cima), Cortar paredes, 📷 Foto
realista, 📐 Medir (régua), ▶ Usar (simulação de uso: portas, armários, gavetas e cadeiras
abrindo e fechando juntos, com as medidas do que avança e do que sobra) e Inteiro.

## Desenhar a planta (modo Planta)

Barra de ferramentas embaixo: **Selecionar · Parede · Porta · Janela · Correr · Apagar**
(teclas `V`, `P`, `O`, `J`, `E`).

- **Parede:** toque no início e em cada canto. Os trechos são sempre horizontais ou verticais
  (ortogonal). O ponto **encaixa** nas pontas e na linha das paredes existentes (verde = ponta,
  laranja = parede, vermelho = alinhado com outra ponta) e na grade de 5 cm. Para uma medida
  exata, digite o número (no PC basta começar a digitar) e Enter, ou use as setas ← ↑ ↓ →.
  Tocar no primeiro ponto fecha o contorno; Esc ou **Concluir** termina; ↶ desfaz o último trecho.
  A espessura das paredes novas e o pé-direito ficam na lateral.
- **Porta, janela, correr:** toque numa parede (a porta abre para o lado tocado). O painel da
  parede abre para ajustar largura, altura, peitoril, lado e dobradiça.
- **Selecionar:** toque numa parede para editar; arraste-a para mover (paredes e ambientes
  ligados acompanham), arraste as **pontas** brancas para mudar o comprimento, arraste uma porta
  ou janela ao longo da parede. Delete apaga a parede (ou a abertura) selecionada.
- **Apagar:** toque numa parede, porta ou janela.
- **Ambientes:** cada região fechada pelas paredes vira um ambiente sozinho, com a **área útil**
  (por dentro das paredes) calculada. Toque no piso para dar nome e escolher o piso; marque
  **Vazio** para shafts e poços (não entram na soma). Apagar uma parede junta os ambientes;
  dividir com uma parede nova cria outro.
- **Áreas:** útil por ambiente, soma e construída (pelo contorno externo, com as paredes).

### Planta de fundo (levantamento)

Na lateral do modo Planta: **Carregar imagem ou PDF** (foto, digitalização, JPG/PNG ou PDF; de
um PDF com várias páginas, escolhe-se a página).

1. **Calibrar:** toque nas duas pontas de uma medida conhecida do desenho e digite a medida real.
   Um PDF já entra em 1:50 e mostra a escala (1:N) para ajustar direto.
2. **Mover:** toque num ponto do desenho e depois onde ele deve ficar (encaixa nas pontas das
   paredes).
3. Ajuste a **opacidade** e o **giro** (para levantamentos tortos) e desenhe as paredes por cima.

O fundo aparece só no modo Planta.

## Luz do sol

Em Conferir → Luz do sol: **local** (capitais, ou latitude, longitude e fuso), **norte da
planta** (0° = para cima, 90° = para a direita; a bússola mostra), data e hora, e ▶ Passar o dia.

## Como usar

| Ação | Como |
| --- | --- |
| Girar a câmera | arrastar no espaço vazio (dedo único no celular) |
| Deslocar a vista | botão direito, ou dois dedos |
| Zoom | roda do mouse, pinça, ＋/－ ou toque duplo |
| Desfazer / refazer | `Ctrl+Z` / `Ctrl+Shift+Z` (ou ↶ ↷ na tela) |
| Mover móvel | selecionar e arrastar (encaixe de 5 cm); setas = 5 cm, Shift+setas = 25 cm |
| Girar móvel | `R` (Shift+R ao contrário) ou alça redonda |
| Foto realista | `F` ou 📷: escolha o ambiente e a hora; em 1 a 3 minutos a foto aparece |
| Caminhar | `C` ou 🚶; W/A/S/D andam |
| Régua | `M` ou 📐: toque em dois pontos |
| Imagem | ⋯ Mais → Salvar imagem (PNG da vista, com as áreas) |
| Modelo 3D | ⋯ Mais → Importar modelo 3D (`.glb`, com a escala em cm) |

## Organização

```
simulador.html      ← o arquivo final (gerado; é este que se abre)
src/planta.js       ← DADOS: projeto vazio, exemplo de 1 quarto e capitais (sol)
src/catalogo.js     ← DADOS: catálogo de móveis (formas, formatos, movimentos, áreas de uso)
src/app.js          ← aplicação, em seções numeradas (1. Configuração … 12. Início)
src/pagina.html     ← estilo e interface
vendor/             ← three.js r170 e pdf.js 3.11 (ver vendor/LEIA-ME.txt)
montar.mjs          ← junta tudo em simulador.html
index.html, sw.js, app/  ← só para o site: redireciona, guarda offline, manifesto e ícones
```

Depois de editar algo em `src/`, rode `node montar.mjs` para regenerar o `simulador.html`.

Cada item do catálogo é uma lista de caixas, cilindros e esferas cujas medidas podem ser
fórmulas com `L`, `P` e `A` (largura, profundidade e altura). A explicação está no topo de
`src/catalogo.js`.

## Limites conhecidos

- Paredes só na horizontal ou na vertical (não há paredes inclinadas).
- Paredes soltas dentro de um ambiente (um pilar, um armário de alvenaria) não descontam a área.
- Modelos `.glb` com compressão Draco ou KTX2 não abrem; exporte sem compressão.
- Os projetos ficam no navegador de cada aparelho: limpar os dados do site apaga-os. Exporte os
  importantes.
