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

---

## ADR 002 — [reservado]

*A primeira decisão da fase 1 (visão e escopo do MVP) entra aqui: quais formas de pagamento entram no primeiro `.REM`, e se cliente é ou não destinatário do MVP.*
