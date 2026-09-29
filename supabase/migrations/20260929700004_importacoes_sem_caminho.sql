-- Decisão 129 (Tiago, 29/09/2026): a planilha importada não fica guardada,
-- e o Tiago mandou aplicar a regra também ao que já existia.
--
-- Roda depois do deploy do código novo (que já grava o histórico sem
-- caminho) e depois de `scripts/apagar-planilhas-guardadas.ts`, que tirou
-- do bucket os arquivos guardados pelo código de antes. Aqui, o histórico
-- dessas importações perde o caminho: nome, tamanho, aba, linhas, avisos,
-- autor e data continuam.
--
-- Eram 12 linhas com caminho — 11 apontando para planilhas já apagadas na
-- decisão 126 e 1 para a planilha BUDWEISER de 29/09. A contagem é
-- conferida; qualquer diferença desfaz tudo.

do $$
declare
  n integer;
begin
  update public.orcamento_importacoes
     set arquivo_path = null
   where arquivo_path is not null;
  get diagnostics n = row_count;
  if n <> 12 then
    raise exception 'Histórico: % linhas com caminho, esperadas 12 — nada mudou', n;
  end if;
end;
$$;
