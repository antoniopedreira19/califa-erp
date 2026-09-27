# 108 — O botão Voltar: visível, igual em todas as telas, e leva à página anterior

**Data:** 2026-09-27
**Decidido por:** Tiago
**Migration:** nenhuma.

---

## 1. O problema

Três queixas de quem usa o sistema, trazidas pelo Tiago em 25/09/2026:

1. **O voltar era discreto demais.** Um link cinza de 12 px ("Voltar para
   projetos"), com 16 px de altura clicável; no zoom de 80% que a agência
   usa, o texto ficava com 9,6 px na tela.
2. **Às vezes ele não levava à tela anterior.** Todo voltar tinha destino
   fixo. O único que olhava a origem era o do job da produção (`?from=jobs`).
   O mapeamento de 25/09 achou 32 caminhos em que o destino fixo errava a
   origem — por exemplo, o job aberto pela visão agregada voltava para a
   lista de Jobs, e a recorrência aberta pela aba Recorrências voltava para
   a aba Títulos a Pagar.
3. **Em algumas telas ele nem existia**: Contas a Pagar, Fluxo de Caixa,
   os dois relatórios, Cadastros e Administração.

O mapeamento completo, com os casos numerados (I1–I32, P1–P9, S1–S8,
R1–R4), está no artifact "Botão Voltar do ERP"
(https://claude.ai/artifact/XX5WeVxd5E5Eu7p8VY93fD).

## 2. O desenho: A2

Três desenhos foram prototipados sobre as telas reais (projeto
TES-0002/26, JOB-0044 com a faixa, Contas a Pagar): **A** botão
contornado com o destino escrito, **B** seta quadrada ao lado do título,
**C** seta em círculo com texto. O Tiago escolheu o **A** e pediu versões
sem o destino escrito; das três (A1 só "Voltar", A2 "Voltar" + balão, A3 só
a seta), escolheu a **A2** em 27/09/2026.

- **Botão contornado**, o mesmo desenho de "Editar projeto" e "Importar":
  fundo branco, borda, 36 px de altura (32 px dentro da faixa do projeto),
  seta de 16 px e a palavra **"Voltar"**, 14 px seminegrito.
- **O destino fica num balão grafite** que aparece ao passar o mouse ou ao
  focar pelo teclado: "Voltar para Contas a Pagar", "Voltar para
  JOB-0044 · Teste 1". O mesmo texto é o nome acessível do link.
- **No mesmo lugar em todas as telas**: acima do título, ou como primeiro
  item da faixa do projeto (decisão 106).
- É um **link de verdade**: ctrl/cmd-clique e o botão do meio abrem o
  destino em outra aba.

Componente único: `components/voltar/botao-voltar.tsx` (`BotaoVoltar`, e o
hook `useVoltar` para quem precisa do mesmo destino com outra cara).

## 3. As regras (respostas do Tiago, 27/09/2026)

| # | Regra | De onde veio |
|---|---|---|
| 1 | **O voltar leva à página anterior.** Página é tela com endereço próprio. Abas, drawers, formulários, cards e pop-ups se fecham ou se trocam dentro da página — clicando fora, no X, em outra aba —, nunca pelo voltar. | D6 |
| 2 | **As abas da faixa do projeto não contam.** São abas da mesma sessão: o voltar as pula e leva para onde a pessoa estava antes de entrar no projeto. | D2 |
| 3 | **Se a página anterior é a Home, o voltar vai para o início do módulo** (Central Financeira, RH…), não para a Home. | D3 |
| 4 | **O Financeiro não manda para a Produção sem aviso.** A Conciliação e a fatura do cartão abrem o job do Financeiro. Do orçamento aberto a partir do job do Financeiro, o voltar traz de volta a ele. "Ver versão aprovada" e o "Projeto" da ficha (job sem projeto do financeiro) ganham o aviso de saída do módulo. | D4, decisão 021 |
| 5 | **O filtro dura enquanto a pessoa está na página** — abrindo PP, vendo a NF, aprovando. Ao ir para outra página, pode zerar. | D7 |
| 6 | **Sem página anterior** (link colado, aba nova do navegador), vale o destino fixo que a tela sempre teve — a "reserva". | padrão, sem objeção |

**Exceções que ficam como estão (D6, "não mexer agora"):** "Cadastrar
cartão" dos drawers de conta a pagar (abre em outra aba do navegador), o
formulário de cadastro novo com documento duplicado na página de
Clientes/Fornecedores, e a tela cheia da PP (o "Fechar" já faz o papel).

**Cadastro duplicado dentro de outro formulário (D5, opção a).** O
"Abrir cadastro existente" trocava de página e descartava o projeto ou a
PP que a pessoa preenchia. Agora, dentro do formulário:
- cliente **ativo** ganha o **"Usar este cadastro"**, que o escolhe no
  campo do projeto (o fornecedor já tinha);
- cadastro **inativo** (cliente ou fornecedor) fica **só com o aviso**,
  sem botão: "Reative-o em Clientes/Fornecedores para poder selecioná-lo".
  Quem cuida dos cadastros reativa. O Tiago não quis abrir outra aba.
Na página de Clientes/Fornecedores o link para o cadastro existente fica.

## 4. Como funciona

A regra está em `lib/voltar.ts` (testes em `lib/voltar.test.ts`:
`node --import tsx --test lib/voltar.test.ts`); o lado do navegador em
`components/voltar/`.

- **O rastro.** `RastroDeNavegacao`, no layout do app, anota cada URL
  (caminho + query) desta aba do navegador no `sessionStorage`. Mudar só a
  query (aba, filtro, versão, mês) **atualiza** a página atual em vez de
  somar uma nova: por isso o voltar devolve Contas a Pagar na aba em que a
  pessoa estava. A exceção é a Conciliação, em que `?conta=` troca a lista
  de contas pelo extrato — outra página.
- **O destino.** Anda o rastro para trás, pulando a mesma página e o mesmo
  grupo da faixa do projeto. A primeira página diferente é o destino, com
  a URL de quando a pessoa saiu dela. Se for a Home, ou se não houver
  nenhuma, vale a reserva.
- **As marcas.** Cada página pode dizer quem é, por caminho: a faixa do
  projeto registra o grupo (para o voltar pular as abas irmãs) e o nome do
  item aberto; a tela do projeto registra o próprio nome. É isso que o
  balão mostra; as outras telas usam o nome da rota.
- **Depois de voltar**, o rastro é cortado no destino, e o voltar seguinte
  continua para trás (agregada → orçamento → projeto → projetos).
- **O voltar do navegador** anda o cursor do rastro em vez de empilhar.
- **Redirecionamento não é página.** A rota antiga de versão do orçamento e
  "Jobs aguardando abertura" nunca entram no rastro; e página que durou
  menos de 1 s até a seguinte (redirecionada ao abrir) é trocada pela de
  destino. Sem isso o voltar do orçamento aberto pelo "Ver versão
  aprovada" mandava para a rota de versão, que devolvia ao mesmo orçamento.
- **F5 e o voltar do navegador** para dentro do ERP mantêm o rastro; aba
  nova, endereço digitado e login começam do zero.
- **Saída protegida.** Tela com alteração não salva segura o voltar e as
  abas da faixa e pergunta antes (`useProtegerSaida`): a visão agregada de
  Orçamentos (a mesma confirmação "Sair sem salvar?" do Cancelar) e a
  errata do job ("Sair sem registrar a errata?"). O `beforeunload` que
  elas tinham só pegava fechar a aba e recarregar.

**Aba que escreve a URL por `replaceState` tem de passar `null`** (ou `{}`),
nunca o `history.state` atual: com o estado interno do Next (`__NA`) no
argumento, o router toma a troca como dele e não a repassa ao
`useSearchParams` — e o rastro fica sem a aba. Contas a Pagar fazia assim
e foi alinhada às abas do job e da abertura.

## 5. O que mudou nas telas

- **O botão novo substituiu o link** em 34 telas e na faixa do projeto
  (orçamento, agregadas, job, job e agregada do Financeiro). As reservas
  são os destinos fixos de antes.
- **Ganharam o voltar:** Contas a Pagar e Fluxo de Caixa (reserva: Central
  Financeira), Relatório de Faturamento e de Rentabilidade (Relatórios),
  Cadastros e Administração (Configurações).
- **Na faixa de Orçamentos**, seta e projeto eram um link só. Agora o
  voltar é o botão, e o chip do projeto continua levando à tela do projeto.
- **A barra da revisão da abertura** ("Voltar para a fila") virou "Voltar",
  com o mesmo destino do botão do topo: a fila para quem veio dela,
  Visualizar Jobs para quem veio de lá.
- **"Voltar para a aprovação"**, na planilha do job do Financeiro, virou
  **"Ir para a aprovação"**: é troca de aba na mesma página, não um voltar.
- **Excluir conta avulsa ou recorrência** volta para onde a pessoa estava
  (a aba de Contas a Pagar, ou a recorrência de onde abriu a ocorrência).
- **Contas a Pagar › Cartão:** a busca e o "só abertas" da capa sobrevivem
  à ida e volta da fatura (regra 5). A capa só mostra esses filtros a
  partir de seis cartões.

## 6. O que fica para depois

- ~~**Formulário de abertura → "Visualizar planilha interna"** (R3 do
  mapeamento): na fila, a planilha é outra página, e o que foi digitado e
  não salvo se perde ao voltar.~~ ⚠️ **Resolvido na
  [decisão 111](111-abertura-de-job-com-as-abas-do-job.md) (2026-09-27):**
  a abertura ganhou as abas do job, o atalho só troca de aba, e o
  preenchimento sobrevive à consulta. Sair da página com alteração pergunta
  antes, pela mesma proteção de saída desta decisão.
- **Os achados X1–X6** do mapeamento (filtros da Home que a tela não
  aplica, avisos de permissão que ninguém lê, nome do parâmetro da aba)
  não são do voltar e ficaram como estavam.
- **No servidor de desenvolvimento**, a primeira compilação de uma rota
  recarrega a página e zera o rastro; o voltar cai na reserva. Em
  produção isso não acontece.
