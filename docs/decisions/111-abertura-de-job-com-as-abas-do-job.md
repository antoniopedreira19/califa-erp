# 111 — A abertura de job mostra as abas do job, e trocar de aba não apaga o preenchimento

**Data:** 2026-09-27
**Decidido por:** Tiago
**Migration:** nenhuma.

---

## 1. O problema

Na fila, o formulário "Abrir job no financeiro" era uma página sozinha.
Para conferir a planilha interna, a ficha do job ou a conversa com a
produção, a pessoa saía da página, e o que tinha digitado e ainda não
gravado se perdia. É o R3 do mapeamento do botão Voltar
([decisão 108](108-botao-voltar.md), §6), que ficou para depois.

Na revisão da abertura, com o job já aberto, as cinco abas do job já
estavam em volta do mesmo formulário.

## 2. A decisão

Protótipo "Abertura de job com abas"
(https://claude.ai/artifact/JLkiWHHkYP1SauUKEKoX6M). O Tiago escolheu a
**versão A** em 27/09/2026: as abas, com o formulário de hoje inteiro. A
versão B, que limpava o formulário, ficou de fora.

1. **As cinco abas do job aberto.** A página
   `/financeiro/abertura-de-job/[jobId]` mostra, abaixo do cabeçalho "Abrir
   job no financeiro", as mesmas abas da página do job no financeiro:
   Abertura do Job (o formulário), Informações do Job, Planilha Interna,
   Fluxo de Caixa do Job e Comunicação. São os mesmos componentes, com o
   mesmo carregamento (`carregarDetalheDoJob`).
2. **Trocar de aba não apaga nada.** As abas escondem o conteúdo em vez de
   desmontá-lo, então o formulário continua preenchido. A aba vai para o
   `?aba=` da URL, como no job aberto.
3. **Cada aba volta ao ponto da página em que a pessoa estava nela.** A
   aba ainda não visitada abre do topo das abas.
4. **"Visualizar planilha interna" troca para a aba Planilha Interna.**
   Antes abria a rota da conferência e descartava o preenchimento.
5. **A barra de ação** (a frase do que falta, Reprovar job, Abrir job no
   financeiro) fica só na aba Abertura do Job, como na revisão.
6. **Sair com preenchimento não gravado pergunta antes**: "Sair sem abrir o
   job?", com "Continuar na abertura" e "Sair e descartar", e o destino
   quando a tela sabe o nome dele. Vale para:
   - o Voltar do topo, pela proteção de saída da decisão 108;
   - o menu lateral e os links das abas (os jobs do projeto, na aba
     Informações);
   - as saídas para Orçamentos ("Projeto", "Orçamento aprovado", "Ver
     versão aprovada"), que perguntam depois da confirmação de saída de
     módulo que já tinham;
   - recarregar ou fechar a aba, pelo aviso do próprio navegador.

   Sem nada alterado, sai direto. Clique com ctrl/cmd ou com o botão do
   meio, que abre em outra aba, não pergunta.
7. **Aba Informações antes da abertura.** O projeto mostrado é o da
   produção, porque o do financeiro só nasce na abertura. Competência diz
   "Definida na abertura" e Abertura diz "Ainda não aberto no financeiro".
   A categoria é a do orçamento. Os jobs do projeto são os da produção,
   menos os devolvidos e os cancelados, que não têm página no financeiro.
8. **Aba Fluxo de Caixa.** Sem lançamento do job, um aviso de que o fluxo
   começa na abertura. Se já houver algum (uma PP gerada antes da
   abertura), a matriz de sempre.

## 3. Onde mora

- `app/(app)/financeiro/abertura-de-job/[jobId]/page.tsx` — o cabeçalho, as
  abas e a carga das abas de consulta, no mesmo `Promise.all` da abertura.
- `abertura-form.tsx` — sem o cabeçalho (subiu para a página); o atalho da
  planilha usa `useIrParaAbaDoJob`; a proteção de saída (só no modo
  `abertura`) compara o formulário com a "foto" da primeira renderização.
- `app/(app)/financeiro/jobs/[jobId]/job-financeiro-tabs.tsx` — a prop
  `lembrarRolagem` (só a abertura liga) e o `useIrParaAbaDoJob`.
- `app/(app)/jobs/[jobId]/ficha-job.tsx` — a prop `antesDaAbertura`.
- `components/financeiro/link-saida-de-modulo.tsx` — depois da confirmação
  de saída de módulo, consulta `saidaSegurada(href)` antes de navegar.

## 4. O que não mudou

- **A página do job aberto** (leitura, edição, revisão, aprovação de
  save): mesmas abas, o atalho da planilha continua link, e não ganhou
  rolagem lembrada nem aviso de saída novo.
- **A gravação:** nenhuma action mudou.
- **A rota `/financeiro/abertura-de-job/[jobId]/planilha`** continua: o
  pop-up de conferência da fila abre a planilha por ela.

## 5. Carga da página

A abertura passou a carregar o que a página do job aberto carrega. Medido
em 27/09/2026 com build de produção local (`next start`), o JOB-0051 de
teste, oito cargas por lado, sem contar a primeira:

| | Antes | Depois |
|---|---|---|
| Resposta da página | 0,57–0,82 s | 0,90–1,00 s |
| JS da primeira carga da rota | 207 kB | 387 kB |

Para ficar nesses +0,3 s, as consultas da abertura viraram uma onda só: o
save consumido e o imposto previsto só precisam do id do job, e os
projetos do combo e o faturamento por mês encadeiam atrás do job da fila
sem segurar o resto. Eram três ondas em série; a primeira versão com as
abas, ainda com elas, respondia em ~1,5 s. A página do job aberto, para
comparação, fica em 1,2–1,9 s.

## 6. Fica para depois

- **A versão B do protótipo** (cabeçalho do job, formulário em duas
  colunas, sem as colunas de consulta) não foi escolhida.
- **Guardar um rascunho** ao sair ou recarregar (D6 do protótipo): não. O
  aviso de saída cobre o caso.
- **Página de Jobs da produção:** antes da abertura, "Categoria · Serviço"
  mostra só o serviço, porque `jobs.categoria_id` só é gravado ao abrir. A
  aba Informações da abertura lê a categoria do orçamento; a página da
  produção ficou como estava.
