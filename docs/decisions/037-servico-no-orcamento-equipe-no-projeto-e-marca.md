# 037 — Serviço no orçamento, Equipe no projeto, e "Produto" vira "Marca"

**Data:** 2026-09-02
**Decidido por:** Tiago

Design: `Projeto e Orcamento - Equipe e Servico.dc.html`.

---

## 1. Serviço desce do projeto para o orçamento

Era um campo do formulário de projeto e gravava `projetos.categoria_id`.
Passa a ser **do orçamento** (`orcamentos.servico_id`), imediatamente
antes de Categoria, os dois na mesma linha.

O motivo é de significado: o serviço descreve **o trabalho de um job**,
não a iniciativa inteira do cliente. Um projeto pode ter um job de
Ativação e outro de Always On.

**As PPs existentes herdaram o serviço do projeto** (regra do Tiago):
45 dos 46 orçamentos foram backfillados — o único de fora pertence ao
projeto que não tinha serviço preenchido.

### Não precisou de lista nova

O design levantou o risco de Serviço e Categoria mostrarem as mesmas
opções, já que os dois leem `categorias_dominio`. **Não mostram:** a
coluna `escopo` já separava as duas listas.

| escopo | campo | opções |
|---|---|---|
| `projeto` | Serviço | Always On · Ativação · Fee · Interno |
| `orcamento` | Categoria | Ativação · Conteúdo · Extra · Influencer |

O escopo se chama `projeto` porque o campo nasceu lá. Renomear um valor
de enum em uso mexeria nas linhas gravadas sem devolver nada — o nome
ficou, e o helper `lib/data/servicos.ts` explica a herança.

### `projetos.categoria_id` fica

Coluna preservada com o dado histórico e marcada como legada no
comentário: remover coluna populada é destrutivo. Nada mais escreve nela.

**A coluna "Serviço" da lista de projetos** passou a ler os orçamentos —
os serviços distintos, com contador `+N` a partir do segundo, igual às
regionais. Como todo orçamento herdou o serviço do projeto no backfill, a
lista exibe hoje exatamente os mesmos valores de antes.

## 2. O projeto ganha Equipe, obrigatória e nunca vazia

Ocupa a vaga que o Serviço deixou. Seleção múltipla de usuários, no mesmo
componente dos GPs.

**Três grupos entram sozinhos e não podem ser removidos** (regra do
Tiago): quem **criou** o projeto, os **GPs Responsáveis**, e os
**produtores dos orçamentos** do projeto. É isso que faz o campo, sendo
obrigatório, nunca ficar vazio — na criação o criador já está lá.

Eles são **derivados na leitura, não copiados**. Copiar exigiria
re-sincronizar a cada troca de GP e a cada orçamento novo, e a primeira
divergência deixaria a equipe mentindo. `projeto_responsaveis.papel`
separa o que é `gp` do que é acréscimo manual (`equipe`); os três
automáticos não têm linha própria.

No formulário isso aparece como **chip sem "x"** — `MultiSelect` ganhou a
prop `travados`. Oferecer um botão de remover que não remove seria pior
do que não oferecer.

Efeito colateral bem-vindo: como `projeto_responsaveis` é um dos vínculos
do recorte "Meus" da [036](036-filtro-meus-e-produto-regional-nas-listas.md),
quem entra na Equipe passa a ver o projeto como seu.

## 3. O orçamento ganha Descritivo

Última linha do formulário, largura inteira, teto de 500 caracteres — o
mesmo de `jobs.observacoes`, para não gerar texto que não caberia adiante.

Ele **pré-preenche o Descritivo do envio para abertura**, que até aqui só
nascia no fim da linha, quando quem escreve já perdeu o contexto da
negociação. Lá segue **editável**: é ponto de partida, não valor travado.
Job já enviado manda no que aparece — sobrescrever com o do orçamento
apagaria a edição feita no modal.

## 4. "Produto" vira "Marca" em todo o sistema

Rótulo trocado em: formulário e detalhe do projeto, coluna e filtro das
listas de Projetos e de Jobs, ficha e editor do job, telas de abertura no
Financeiro, modal de envio, PDF da PP e o cadastro do cliente.

**Os nomes técnicos ficam:** `projetos.produto_id`, `cliente_produtos`,
`jobs.produto`. Renomear coluna e tabela em uso é destrutivo, exigiria
parar a outra frente, e não muda nada para quem usa o sistema.

## 5. O que NÃO mudou

Instrução do Tiago: usar só o que o design traz.

- A grade de 2 colunas, as cores e a tipografia dos dois formulários.
- O restante dos campos do orçamento (Regional, Cidade, GP, Produtor,
  datas) segue na mesma ordem.
