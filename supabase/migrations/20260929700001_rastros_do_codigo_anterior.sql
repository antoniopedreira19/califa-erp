-- Decisão 126 (Tiago, 29/09/2026): o código de antes da decisão 114 sai do
-- sistema. Esta migration é a parte do banco; os PDFs das PPs foram refeitos
-- antes dela (`scripts/rastros-codigo-anterior/2-refazer-pdfs.ts --gravar`),
-- e os arquivos antigos saem depois (passo 3 do mesmo diretório).
--
-- O que muda:
--   1. PP-00040 e PP-00091, parceladas no modelo de antes da decisão 112 (um
--      PDF por parcela), passam a apontar para o documento único que o passo
--      2 subiu. A regra é geral: a PP vai para o caminho canônico só se o
--      arquivo existir no Storage, e toda parcela aponta para o documento da
--      sua PP.
--   2. Código antigo de job citado em texto livre (o descritivo do
--      TES-1003/26 falava do "JOB-0032") vira o código atual.
--   3. Histórico de importação e nome de versão: o código antigo do
--      orçamento no nome do arquivo vira o NOME do orçamento, como a
--      exportação nomeia o arquivo desde a decisão 121 (trocar pelo código
--      novo poria o código do orçamento na tela). O caminho segue a limpeza
--      da importação (`[^\w.\-]` → "_", `lib/importacao/envio.ts`).
--   4. Registro de números usados: o formato antigo ("AMB-0003/26") passa
--      ao formato com a letra ("AMB-P003/26"), mesmo número e mesmo projeto.
--      O gerador já lia os dois como o mesmo número.
--   5. `codigo_anterior` é esvaziado nas quatro tabelas. A coluna sai numa
--      migration seguinte, depois que as outras frentes atualizarem o código.
--
-- Nada muda além disso — nem `updated_at`, que aparece no chat das PPs e
-- decide o "parado há 15 dias" dos orçamentos. O gatilho de `updated_at` das
-- tabelas tocadas fica desligado só dentro deste bloco, e o bloco confere,
-- linha a linha, que a data de alteração ficou igual.
--
-- Tudo num bloco só: cada passo confere quantas linhas mudou, e qualquer
-- diferença do esperado desfaz o bloco inteiro, gatilhos incluídos.

do $$
declare
  n        integer;
  total    integer;
  r        record;
  h        text;
  antes    jsonb := '{}'::jsonb;
  tabelas  constant text[] := array[
    'pedidos_compra', 'pedidos_compra_parcelas', 'jobs', 'versoes_orcamento',
    'projetos', 'orcamentos', 'projetos_financeiro'
  ];
  gatilhos constant text[] := array[
    'trg_pp_updated_at', 'trg_pp_parcelas_updated_at', 'trg_jobs_updated_at',
    'trg_versoes_orcamento_updated_at', 'trg_projetos_updated_at',
    'trg_orcamentos_updated_at', 'trg_projetos_financeiro_updated_at'
  ];
  antigo   constant text := '^.+-0[0-9]{3,}/[0-9]{2}$';
  hash_sql constant text :=
    'select md5(coalesce(string_agg(id::text || ''|'' || updated_at::text, '','' order by id), '''')) from public.%I';
begin
  perform set_config('lock_timeout', '5s', true);

  -- Desliga o gatilho (o que também trava a escrita de fora até o fim do
  -- bloco) e guarda a data de alteração de cada linha.
  for i in 1 .. array_length(tabelas, 1) loop
    execute format('alter table public.%I disable trigger %I', tabelas[i], gatilhos[i]);
    execute format(hash_sql, tabelas[i]) into h;
    antes := antes || jsonb_build_object(tabelas[i], h);
  end loop;

  -- 1. Documento único das PPs parceladas de antes da decisão 112.
  update public.pedidos_compra pc
     set pdf_path = pc.tenant_id::text || '/' || pc.job_id::text || '/' || pc.id::text
                    || '/pp-' || pc.codigo || '.pdf'
   where pc.pdf_path is distinct from (pc.tenant_id::text || '/' || pc.job_id::text || '/'
                                       || pc.id::text || '/pp-' || pc.codigo || '.pdf')
     and exists (
       select 1
         from storage.objects o
        where o.bucket_id = 'pedidos-compra'
          and o.name = pc.tenant_id::text || '/' || pc.job_id::text || '/' || pc.id::text
                       || '/pp-' || pc.codigo || '.pdf'
     );
  get diagnostics n = row_count;
  if n <> 2 then
    raise exception 'PPs: % ponteiros trocados, esperados 2', n;
  end if;

  update public.pedidos_compra_parcelas pa
     set pdf_path = pc.pdf_path
    from public.pedidos_compra pc
   where pc.id = pa.pedido_compra_id
     and pa.pdf_path is distinct from pc.pdf_path;
  get diagnostics n = row_count;
  if n <> 4 then
    raise exception 'Parcelas: % ponteiros trocados, esperados 4', n;
  end if;

  -- 2. Código antigo de job em texto livre.
  total := 0;
  for r in
    select tenant_id, codigo, codigo_anterior
      from public.jobs
     where codigo_anterior is not null
  loop
    update public.jobs
       set observacoes = regexp_replace(observacoes, '\m' || r.codigo_anterior || '\M', r.codigo, 'g')
     where tenant_id = r.tenant_id
       and observacoes ~ ('\m' || r.codigo_anterior || '\M');
    get diagnostics n = row_count;
    total := total + n;
  end loop;
  if total <> 1 then
    raise exception 'Descritivos: % trocados, esperado 1', total;
  end if;

  -- 3. Nome de arquivo com código antigo de orçamento.
  update public.orcamento_importacoes i
     set arquivo_nome_original = v.novo_nome,
         arquivo_path = left(i.arquivo_path, length(i.arquivo_path) - length(v.velho_nome))
                        || v.novo_caminho
    from (values
      ('interna-TES-0001-26-01-v3.xlsx', 'interna-Orcamento de Teste-v3.xlsx', 'interna-Orcamento_de_Teste-v3.xlsx'),
      ('interna-TES-0001_26-01-v3.xlsx', 'interna-Orcamento de Teste-v3.xlsx', 'interna-Orcamento_de_Teste-v3.xlsx'),
      ('interna-TES-0002_26-04-v1.xlsx', 'interna-Teste Importcao-v1.xlsx',    'interna-Teste_Importcao-v1.xlsx')
    ) as v(velho_nome, novo_nome, novo_caminho)
   where i.arquivo_nome_original = v.velho_nome
     and right(i.arquivo_path, length(v.velho_nome) + 1) = '-' || v.velho_nome;
  get diagnostics n = row_count;
  if n <> 5 then
    raise exception 'Importações: % trocadas, esperadas 5', n;
  end if;

  update public.versoes_orcamento
     set nome = 'Importada de interna-Orcamento de Teste-v3.xlsx'
   where nome = 'Importada de interna-TES-0001_26-01-v3.xlsx';
  get diagnostics n = row_count;
  if n <> 1 then
    raise exception 'Versões: % renomeadas, esperada 1', n;
  end if;

  -- 4. Registro de números usados no formato com a letra. Antes, a
  --    garantia de que nenhum código convertido é de outro projeto.
  if exists (
    select 1
      from public.codigos_de_projeto_usados u
      join public.codigos_de_projeto_usados p
        on p.tenant_id = u.tenant_id
       and p.codigo = regexp_replace(u.codigo, '^(.+)-0([0-9]{3,})/([0-9]{2})$', '\1-P\2/\3')
     where u.codigo ~ antigo
       and p.projeto_id is distinct from u.projeto_id
  ) then
    raise exception 'Registro: um código convertido já está registrado para outro projeto';
  end if;
  if exists (
    select 1
      from public.codigos_de_projeto_usados u
      join public.projetos p
        on p.tenant_id = u.tenant_id
       and p.codigo = regexp_replace(u.codigo, '^(.+)-0([0-9]{3,})/([0-9]{2})$', '\1-P\2/\3')
     where u.codigo ~ antigo
       and p.id is distinct from u.projeto_id
  ) then
    raise exception 'Registro: um código convertido é o de outro projeto';
  end if;

  insert into public.codigos_de_projeto_usados (tenant_id, codigo, projeto_id, registrado_em)
  select u.tenant_id,
         regexp_replace(u.codigo, '^(.+)-0([0-9]{3,})/([0-9]{2})$', '\1-P\2/\3'),
         u.projeto_id,
         u.registrado_em
    from public.codigos_de_projeto_usados u
   where u.codigo ~ antigo
  on conflict (tenant_id, codigo) do nothing;
  -- 18 sem par no formato novo; os outros 16 já tinham o par (o código de
  -- hoje do mesmo projeto) e ficam só com ele.
  get diagnostics n = row_count;
  if n <> 18 then
    raise exception 'Registro: % convertidos, esperados 18', n;
  end if;

  delete from public.codigos_de_projeto_usados where codigo ~ antigo;
  get diagnostics n = row_count;
  if n <> 34 then
    raise exception 'Registro: % no formato antigo, esperados 34', n;
  end if;

  -- 5. `codigo_anterior` vazio.
  update public.projetos set codigo_anterior = null where codigo_anterior is not null;
  get diagnostics n = row_count;
  if n <> 16 then
    raise exception 'Projetos: % esvaziados, esperados 16', n;
  end if;

  update public.orcamentos set codigo_anterior = null where codigo_anterior is not null;
  get diagnostics n = row_count;
  if n <> 39 then
    raise exception 'Orçamentos: % esvaziados, esperados 39', n;
  end if;

  update public.projetos_financeiro set codigo_anterior = null where codigo_anterior is not null;
  get diagnostics n = row_count;
  if n <> 6 then
    raise exception 'Projetos do financeiro: % esvaziados, esperados 6', n;
  end if;

  update public.jobs set codigo_anterior = null where codigo_anterior is not null;
  get diagnostics n = row_count;
  if n <> 23 then
    raise exception 'Jobs: % esvaziados, esperados 23', n;
  end if;

  -- A data de alteração, depois: igual em todas as linhas. E o gatilho
  -- volta.
  for i in 1 .. array_length(tabelas, 1) loop
    execute format(hash_sql, tabelas[i]) into h;
    if h is distinct from antes ->> tabelas[i] then
      raise exception 'updated_at mudou em %', tabelas[i];
    end if;
    execute format('alter table public.%I enable trigger %I', tabelas[i], gatilhos[i]);
  end loop;
end;
$$;
