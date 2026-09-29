# 119 — O projeto do financeiro nasce com o job, tem nome único e se renomeia pelo lápis

**Data:** 2026-09-28
**Decidido por:** Tiago
**Migrations:** `20260928500001_projeto_financeiro_nasce_com_job_e_nome_unico.sql`
e `20260928500002_restaura_projeto_financeiro_da_abertura_em_curso.sql`.

---

## 1. O problema

No campo Projeto da abertura do AMB-1010/26, o combo mostrava dois
"Budweiser - Planejamento 2027 RJ 3T 2026" (AMB-F007/26 e AMB-F008/26), e
um deles sem nenhum job. Nas palavras do Tiago:

> Existem casos onde existem projetos denominados pelo financeiro com o
> mesmo nome, isso não deverá ser possível. Além disso, percebi que um deles
> não tem nenhum job, o que também não deveria ser possível, todo projeto
> deve ter pelo menos um job.

A causa era o "+" do campo: ele **gravava** o projeto na hora, antes da
abertura. Quem criava, errava o nome e criava de novo, ou desistia da
abertura, deixava um projeto solto. Em 28/09/2026 eram **11 dos 17**
projetos do financeiro sem job, e todos os nomes repetidos estavam entre
eles. O AMB-F007 foi criado às 16:45 para o AMB-1009/26, e o AMB-F008, com
o mesmo nome, às 16:47 — o job ficou no segundo.

## 2. As regras

| Pergunta | Resposta do Tiago |
|---|---|
| O nome é único em que escopo? | **No sistema inteiro**, não por cliente. A comparação ignora maiúscula, acento e espaço a mais: "teste" e "Teste" são o mesmo nome. |
| Os projetos sem job saem? | **Sim, só os do financeiro e só os vazios.** Projeto com job nunca se apaga; os projetos da produção (`projetos`) não entram. |
| Quando o projeto do financeiro nasce? | Na abertura do job: o job é alocado a um projeto que já existe ou a um criado ali mesmo. |
| Depois de aberto, o projeto do job ainda se troca? | **Sim.** Se a troca deixar o projeto antigo sem job, ele some. Na produção nada muda: `jobs.projeto_id` é outra coluna. |
| Como se muda o nome? | Como no cadastro de fornecedor: o "+" vira **lápis** quando há projeto escolhido. |
| E o job encerrado ou finalizado? | **Continua no projeto para sempre**, e sempre aparece dentro dele no Visualizar Jobs. |

**Job encerrado ou finalizado nunca sai do projeto.** Já era assim, e foi
conferido em 28/09/2026 (TES-1009/26, finalizado, segue no TES-F001/26):

- O Visualizar Jobs e a página do projeto listam `aberto`, `em_producao`,
  `encerrado` e `finalizado` (`STATUS_NA_LISTA`, em `dados-abertos.ts`).
- Só job aberto ou em produção tem o registro editável (`jobEstaAberto`).
  Por isso só ele pode trocar de projeto.
- Nada no sistema zera `jobs.projeto_financeiro_id`. O gatilho da seção 4
  só age quando o job troca de projeto ou é apagado, nunca quando muda de
  status.
- Um projeto cujos jobs estão todos encerrados ou finalizados continua
  existindo: a regra é ter pelo menos um job, de qualquer status.

## 3. O projeto nasce com o job

- O "+" só **reserva** o nome no formulário: a linha aparece no combo com o
  selo **Novo** no lugar do código. Nada é gravado.
- O projeto é criado dentro da própria gravação:
  - em `abrirJobNoFinanceiro`, logo antes do update que abre o job;
  - em `editarRegistroDaAbertura` ("Salvar alterações" e "Registrar revisão
    de abertura"), antes da aprovação de save, quando há uma.
- Se o que vem depois falhar (a aprovação, o update do job, ou o update que
  não casou porque outra aba já abriu, reprovou ou encerrou o job), a action
  **apaga o projeto que acabou de criar**.
- O formulário manda um dos dois campos, nunca ambos: `projeto_financeiro_id`
  (projeto que existe) ou `projeto_financeiro_novo` (o nome).
- A action antiga `criarProjetoFinanceiro` saiu.

**O que não tem garantia no banco:** o insert do projeto e o update do job
são duas chamadas do PostgREST, duas transações. Uma constraint adiada
recusaria o insert sozinho. A garantia é a da action, com o desfazer
acima.

## 4. O projeto que fica sem job some

Gatilho `trg_jobs_projeto_financeiro_sem_job_some`, em `jobs` (`after update
of projeto_financeiro_id or delete`):

- Quando o projeto antigo não tem mais job, o gatilho o apaga e grava
  `projeto_financeiro.apagado_sem_job` na auditoria, com código, nome e o
  último job.
- Ele trava a linha do projeto antes de contar, para um job entrando nele
  ao mesmo tempo não perder a corrida.

**O histórico da abertura não perde o nome.** `jobs_aberturas` guarda o
projeto por id, sem FK, e a tela resolve o nome na hora. Por isso a foto
ganhou `projeto_financeiro_rotulo` ("Código · Nome"), preenchido no insert
por gatilho; as 37 fotos que já existiam foram preenchidas. A tela continua
mostrando o nome atual pelo id, e só usa o rótulo quando o projeto foi
apagado, com o aviso "(projeto apagado)".

## 5. Nome único

- Índice `uniq_projetos_financeiro_nome` em
  `(tenant_id, nome_de_projeto_normalizado(nome))`. A função tira acento,
  caixa e espaço a mais, com `translate`, porque `unaccent` não está
  instalado e não é imutável.
- O "+" e o lápis conferem o nome **antes** de reservar ou salvar, pela
  função `projeto_financeiro_com_o_nome`. A mensagem diz qual projeto já usa
  o nome, e de qual cliente: o combo só mostra os projetos do cliente do job,
  e o outro pode estar fora dele.
- A comparação é sempre a do banco. Uma segunda normalização em TypeScript
  acabaria divergindo da do índice.

## 6. O lápis

- O mesmo botão troca de ícone: "+" sem projeto escolhido, lápis com
  projeto escolhido.
- O ✕ no campo limpa a escolha e devolve o "+". O projeto novo reservado,
  que ainda não existe, sai junto.
- O lápis num projeto que **já existe** grava na hora (`renomearProjetoFinanceiro`),
  como a edição do cadastro de fornecedor: o nome é do projeto, e muda para
  todos os jobs dele. Não espera a abertura. O código e o cliente não mudam.
  A auditoria grava `projeto_financeiro.renomeado`, com de/para.
- O lápis no projeto **novo** só troca o nome reservado.
- Renomear e apagar são do administrador e do financeiro. A policy de
  UPDATE de `projetos_financeiro` passou a exigir esses papéis (até aqui
  qualquer membro do tenant podia, e não havia tela). A de DELETE é nova e
  só deixa sair projeto sem job.

## 7. A limpeza, e o projeto que voltou

A migration apagou todo projeto do financeiro sem job, pelo critério da
regra e não por uma lista. Foram **13**, e não os 11 do levantamento:
entre o levantamento e a aplicação, a Priscila abriu jobs com o código
antigo no ar e criou quatro projetos pelo "+".

- AMB-F010/26 "NFL" e AMB-F011/26 "Stella Artois IMC" já tinham job e
  ficaram.
- AMB-F009/26 "NFL" era repetição do F010, criada três minutos antes — o
  próprio defeito desta decisão — e ficou apagado.
- **AMB-F012/26 "Michelob - IMC NE" voltou** (migration 500002). Tinha sido
  criado às 16:13 para o AMB-1008/26, que ainda aguardava abertura às 16:22:
  a abertura estava em curso, e o código antigo precisa do projeto antes do
  clique em "Abrir job". Voltou com o mesmo id, código, nome, autora e data,
  refeito a partir da auditoria, e ganha o job quando a abertura terminar.

**Lição:** limpeza de dado que o código antigo ainda produz, com o código
novo fora do ar, pega trabalho em curso. Antes de aplicar, vale olhar a
auditoria das últimas horas.

## 8. O que ficou de fora

- **Códigos voltam a ser usados.** O gerador pega o maior número existente +
  1, então o código de um projeto apagado pode voltar num projeto novo. Isso
  já aconteceu no teste: o TES-F003/26 "Teste 119 projeto novo" foi apagado
  pelo gatilho, e o seguinte nasceu TES-F003/26 "Teste 119 abertura". O
  histórico não confunde os dois, porque é por id, mas quem lê vê o mesmo
  código. Não travei o código usado.
- **Criar projeto continua liberado a qualquer membro do tenant** pela
  policy de INSERT. A tela só deixa o administrador e o financeiro, e a
  action confere o papel. Não mexi na policy.
- A página do projeto do financeiro (`/financeiro/projetos/[projetoId]`)
  não ganhou o lápis. Hoje só se renomeia pelo campo da abertura.
