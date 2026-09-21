# 02 — Decisões (ADR log)

Decision log do módulo. Cada decisão é um ADR pequeno com: **contexto**, **decisão**, **consequências**. Ordenados cronologicamente.

Este arquivo é vivo. Não reescreve decisões antigas — cria ADR novo que substitui a anterior e faz o link.

---

## ADR 001 — Colaborador não reaproveita dados bancários via fornecedor

**Data:** 2026-09-21
**Status:** Aplicado
**Migration:** [`20260921100001_colaborador_sem_vinculo_fornecedor.sql`](../../../supabase/migrations/20260921100001_colaborador_sem_vinculo_fornecedor.sql)

### Contexto

A [migration original de RH](../../../supabase/migrations/20260916000005_rh_colaboradores.sql) criou `colaboradores.fornecedor_id` como FK opcional pra fornecedores, com o propósito documentado no comentário da coluna: *"reuso de dados bancários/PIX na baixa da folha"*. Era um atalho consciente pra não duplicar campos bancários enquanto a fase da folha era esqueleto.

Quando o módulo de pagamento por remessa começou (2026-09-21), o Antonio revisitou essa decisão. Motivação: pagamento CNAB obriga desenhar bem onde os dados bancários vivem, e a ambiguidade "colaborador PJ é fornecedor?" precisava ser resolvida antes de qualquer migration nova.

### Decisão

Colaborador ganha shape bancário próprio, sem passar por fornecedores. `colaboradores.fornecedor_id` removido do banco, da UI, do schema Zod e do tipo TypeScript.

### Justificativa

1. **Semântica diferente.** Fornecedor de produção aparece no autocomplete de Pedido de Produção; colaborador PJ **não deveria** aparecer lá. NF emitida por PJ contratado não é serviço de produção — é folha, contabilmente. Manter o link forçava um autocomplete misturado que ninguém queria.
2. **Ciclo de vida diferente.** Colaborador tem admissão, encerramento, alocação por regional/empresa, histórico salarial. Fornecedor não tem nada disso. RLS também é diferente (colaborador é `is_tenant_rh` + `is_tenant_admin`, fornecedor é `is_tenant_member`).
3. **Risco de dado divergente.** Se um freelancer virasse fornecedor **e** colaborador PJ, com dados bancários replicados nas duas tabelas, a troca de conta ficava ambígua — qual das duas atualiza? Uma fonte por papel elimina a ambiguidade.
4. **Custo mínimo agora.** 0 colaboradores tinham `fornecedor_id` preenchido em produção. Zero dado a migrar. Remoção pura, aditiva-negativa.

### Consequências

- Colaborador vai ganhar as colunas `banco_codigo`, `banco_nome`, `agencia`, `agencia_dv`, `conta`, `conta_dv`, `tipo_conta`, `pix_tipo`, `pix_chave` numa migration futura do próprio módulo (fase 1 do CNAB). Mesmo shape que fornecedor já tem — código de UI reaproveita 100%.
- Formulário de novo colaborador perdeu o auto-match por documento e os cards "Fornecedor já cadastrado" / "Criar fornecedor a partir deste cadastro". Simplificação de UX.
- Server action `buscarFornecedorPorDocumento` do módulo de RH foi removida. A função homônima no módulo de fornecedores continua existindo — é outra coisa (previne duplicata no próprio cadastro de fornecedor).
- Card "Dados do colaborador" (página de detalhe) perdeu a linha "Fornecedor vinculado".
- NF emitida por PJ contratado **não vira PP**. Vira conta avulsa gerada pela folha aprovada, quando o motor de folha for implementado — com `folha_id` e (novo campo, a criar) `colaborador_id`. Essa decisão fica registrada como implícita aqui e será formalizada em ADR próprio na fase de folha.

### Arquivos tocados no mesmo commit

Banco:
- `supabase/migrations/20260921100001_colaborador_sem_vinculo_fornecedor.sql`

TypeScript / código:
- `lib/types.ts` — campo `fornecedor_id` removido do tipo `Colaborador`
- `lib/validations/rh-colaboradores.ts` — campo `fornecedor_id` removido do schema Zod
- `app/(app)/rh/colaboradores/actions.ts` — função `buscarFornecedorPorDocumento` removida; bloco `criarFornecedor` removido; `fornecedor_id` removido do insert e do update
- `app/(app)/rh/colaboradores/colaborador-form-novo.tsx` — auto-match e cards removidos
- `app/(app)/rh/colaboradores/[id]/page.tsx` — join `fornecedor:fornecedores(id, nome)` removida do select
- `app/(app)/rh/colaboradores/[id]/card-dados.tsx` — linha "Fornecedor vinculado" e prop removidas
- `app/(app)/rh/colaboradores/[id]/editar-dados-drawer.tsx` — state e envio de `fornecedor_id` removidos

Verificação: `tsc --noEmit` limpo, `next lint` no diretório tocado limpo.

### Nota — bug detectado e corrigido pós-implementação

Após aplicar a migration 20260921100001, foi detectado que a rotina [`aprovarLinhaFolha`](../../../app/(app)/financeiro/contas-a-pagar/actions-folhas.ts) — que materializa folha aprovada em contas avulsas — usava `colab.fornecedor_id` no insert. Removida a coluna, a rotina quebraria em runtime (o `select` do PostgREST retornaria erro por coluna inexistente).

Correção estrutural (não workaround) aplicada no ADR 002 abaixo: `contas_avulsas` ganhou `colaborador_id` como destinatário-primeiro-classe, e a rotina passou a gravar `colaborador_id = colab.id` em vez do vínculo antigo. A `vw_a_pagar` foi recriada expondo a nova coluna.

O achado positivo: **o motor de folha já materializa contas avulsas** e o pagamento a colaborador não precisa mais de "conta avulsa manual" no MVP. Isso muda a resposta da pergunta original sobre destinatários (ver ADR 002).

---

## ADR 002 — Escopo do MVP + colaborador como destinatário primeiro-classe em contas_avulsas

**Data:** 2026-09-21
**Status:** Aplicado (parte estrutural) + Fechado (parte de escopo)
**Migrations:** [`20260921120001_contas_avulsas_colaborador_id.sql`](../../../supabase/migrations/20260921120001_contas_avulsas_colaborador_id.sql)

### Contexto

Duas decisões travadas na mesma sessão porque uma depende da outra:

1. Após ADR 001 remover o atalho `colaboradores.fornecedor_id`, o fluxo de folha (motor pronto, ver `00-descoberta.md §3.4`) precisava de um novo canal pra dizer *pra quem* depositar. Adiar isso quebraria a UI de aprovação de folha imediatamente.
2. O Antonio decidiu o escopo do primeiro arquivo `.REM` — quais formas de pagamento, quem é destinatário, qual empresa contábil inaugura, se retorno CNAB entra.

### Decisão — parte estrutural

`contas_avulsas` ganha `colaborador_id uuid null` referenciando `colaboradores(id)` com `ON DELETE RESTRICT`. `vw_a_pagar` expõe a coluna. `aprovarLinhaFolha` grava `colaborador_id = colab.id` em vez de `fornecedor_id = colab.fornecedor_id`.

`colaborador_id` complementa (não substitui) `fornecedor_id` e `cliente_id` — no fluxo de folha, `colaborador_id` é preenchido e os outros dois ficam null. Sem CHECK impedindo os três preenchidos ao mesmo tempo por enquanto (decisão explícita — evitar restrição prematura).

### Decisão — parte de escopo do MVP

**A. Formas de pagamento no MVP:**
- Boleto Santander (forma 30) + Boleto outros bancos (forma 31)
- PIX por chave ou dados bancários (forma 45)
- TED (forma 03)

Justificativa pra TED entrar apesar de sobrar código no gerador: 6 dos 24 fornecedores hoje não têm PIX cadastrado (só banco/agência/conta), e colaborador CLT tipicamente recebe em conta pessoal sem chave PIX. TED reusa 100% do modelo de dados dos outros (Segmentos A + B), e o incremento no gerador é ~15% (finalidade da TED + escolha de câmara CIP vs STR).

**B. Destinatários no MVP:**
- Fornecedores (24 registros, dados prontos)
- Colaboradores (via motor de folha → contas_avulsas.colaborador_id — o desenho de "conta avulsa manual" foi descartado após o achado de §3.4)

Cliente fica fora do MVP. Volta em fase 2 se surgir demanda concreta.

**C. Empresa contábil que inaugura:** California Filmes (`19437976000154`). Go Crazy e Hitlab replicam depois de homologada.

**D. Retorno CNAB (`.RET`):** fica **fora do MVP**. Baixa após pagamento continua manual — financeiro paga o arquivo no banco, confere no extrato e baixa o título no ERP. Fase 2 adiciona parse do retorno + baixa automática.

### Consequências

**Estrutural:**
- Migration 20260921120001 aplicada. Coluna, índice e view atualizados.
- `actions-folhas.ts` corrigida: `select("id, nome, tipo_contratacao")` e `insert({..., colaborador_id: colab.id, ...})`.
- `lib/types.ts` — `ContaAvulsa` ganha `colaborador_id: string | null` e `folha_id: string | null` (o segundo era inconsistência pré-existente — a coluna já existia no banco mas não no tipo).
- `app/(app)/financeiro/contas-a-pagar/avulsa/[id]/page.tsx` — mapper explícito pro tipo `ContaAvulsa` passa a preencher as duas colunas novas.

**Escopo do MVP:**
- Colaborador **precisa ganhar shape bancário próprio** (`banco_codigo`, `agencia`, `conta`, DVs, `tipo_conta`, `pix_tipo`, `pix_chave`) — próxima migration da fase 1. Mesmo shape que fornecedor já tem.
- `empresas_contabeis` precisa ganhar config CNAB (convênio Santander, endereço, sequencial de arquivo). Só California Filmes inicialmente — as outras duas ficam com null e o gerador rejeita.
- Não vai ter tabela `cnab_retornos` no MVP. Só `cnab_remessas` e `cnab_remessas_itens`. Retorno vira estrutura na fase 2.
- Gerador precisa suportar 3 formas de pagamento (boleto/PIX/TED) na v1, mas o código compartilha a maior parte entre elas.

### Verificação

- Migration aplicada via MCP; conferido que `contas_avulsas.colaborador_id` existe, índice `idx_contas_avulsas_colaborador` existe, `vw_a_pagar` expõe a coluna.
- `tsc --noEmit` limpo após ajuste em `lib/types.ts` e `avulsa/[id]/page.tsx`.
- `next lint` limpo no diretório `app/(app)/financeiro/contas-a-pagar`.
- Fluxo de aprovação de folha volta a funcionar (não foi testado manualmente ainda em runtime — depende de linha de folha enviada + aprovação; o type-check garante que os shapes batem).

---

## ADR 003 — [reservado]

*Próxima decisão será durante a fase 2 (modelagem): shape exato dos campos bancários em colaboradores e da configuração CNAB em empresas_contabeis.*
