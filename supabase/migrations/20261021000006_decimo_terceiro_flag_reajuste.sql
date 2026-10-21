-- rls-member-ok: migration so adiciona coluna; nenhuma policy criada.
-- Motivo: Parte 4 do 13o — sinalizar linhas de colaboradores que tiveram
-- mudanca salarial dentro do ano, pro RH decidir se precisa ajustar o
-- calculo via override manual (salario_editado + obs).
--
-- A planilha original tem abas 'Retroativo - Reajuste PJ' e '... CLT' que
-- calculam a diferenca entre o 13o com salario novo e o 13o que seria com
-- salario antigo, pagando a diferenca na 2a parcela. Automatizar esse
-- calculo exige escolher UMA regra (media ponderada por dias? salario
-- vigente em cada parcela?) — fica pra pass futura. Esta flag so permite
-- VER quem precisa de atencao.
--
-- Detectado em criarFolha e recalcular: colaborador com linha em
-- colaboradores_salarios com data_inicio dentro do ano = teve reajuste.
--
-- Nao-destrutivo. Default false preenche linhas existentes sem risco.

alter table public.decimo_terceiro_linhas
  add column if not exists teve_reajuste_no_ano boolean not null default false;

comment on column public.decimo_terceiro_linhas.teve_reajuste_no_ano is
  'TRUE quando o colaborador teve ao menos uma mudanca de salario em colaboradores_salarios com data_inicio dentro do ano da folha. Sinalizacao visual pro RH considerar ajuste de retroativo via override manual (salario_editado).';
