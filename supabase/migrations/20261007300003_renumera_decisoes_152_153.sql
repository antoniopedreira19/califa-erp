-- As decisões desta frente nasceram como 150 (a NF do fornecedor com
-- cadastro próprio) e 151 (PP a emitir) e foram renumeradas para 152 e 153
-- antes de publicar (07/10/2026): o main já tinha o 150 (Cadastro de
-- Veículos) e o 151 (errata que cancela a linha). Regra do Tiago para
-- colisão de número: a mais nova move.
--
-- As migrations 20261007300001 e 20261007300002 já tinham sido aplicadas
-- citando 150 e 151 e ficam como estão — migration aplicada não se
-- reescreve. Esta corrige só o que o banco mostra: os comentários de
-- tabela, coluna e função. Os comentários DENTRO das funções continuam
-- dizendo 150/151; os arquivos das decisões registram isso.

comment on function public.chave_do_numero_da_nf(text) is
  'Número da NF sem pontuação, espaços e zeros à esquerda: identifica a mesma nota do mesmo fornecedor (decisão 152).';
comment on table public.notas_fiscais_fornecedor is
  'NF de fornecedor, uma linha por nota (decisão 152, 07/10/2026). Mesma nota = mesmo fornecedor + numero_chave. Pode cobrir mais de uma PP: cada anexo do tipo NF aponta para cá e guarda a parte da nota na sua PP. Conta UMA vez no fiscal, pelo total, a partir de registrada_em.';
comment on column public.pedidos_compra_anexos.nota_fiscal_id is
  'A NF (notas_fiscais_fornecedor) que este anexo é. Preenchido no envio ao financeiro ou na aprovação (decisão 152).';
comment on column public.pedidos_compra_anexos.nf_data_emissao is
  'Data de emissão que a produção informou (decisão 152). Depois da ligação, vale a da nota.';
comment on function public.registrar_notas_fiscais_da_pp(uuid, jsonb, jsonb) is
  'Aprovação da PP pelo financeiro (decisão 152): grava as retenções da PP, liga cada anexo NF à sua nota (cria, liga ou corrige para todas as PPs) e registra a nota na 1ª aprovação.';
comment on table public.pedidos_compra_a_emitir is
  'PP a emitir (decisão 153, 07/10/2026): o formulário da PP salvo antes de gerar. Sem código, fora do realizado, invisível ao financeiro. O id é o que a PP terá ao ser gerada (pp_id = id).';
comment on table public.pedidos_compra_a_emitir_anexos is
  'Anexos da PP a emitir (decisão 153): o tipo, o número e, na NF, os dados que a produção informou (decisão 152). Viram os anexos da PP quando ela é gerada.';
comment on function public.notas_fiscais_do_fornecedor(uuid, text[], uuid) is
  'Decisão 152: as notas do fornecedor com esses números (mesma chave), com as PPs que cada uma já cobre. A produção usa para travar a nota que já existe.';
comment on function public.ligar_notas_fiscais_da_pp(uuid, jsonb) is
  'Decisão 152: no envio da PP ao financeiro, liga cada anexo NF à sua nota (cria a nova ou liga à existente, sem mudar os dados dela) e confere que as partes não passam do valor da nota.';
