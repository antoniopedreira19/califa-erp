-- Data do evento do job — campo novo do modal "Enviar job para abertura"
-- (design "Enviar Job - Ajustes de Campos", 27/08/2026).
--
-- Entra na linha das datas, entre "Data de fim" e "Data prevista para
-- recebimento", e é obrigatória NO FORMULÁRIO. A coluna, porém, nasce
-- nullable de propósito: os jobs abertos antes desta data não têm o
-- valor e não há de onde inferi-lo — NOT NULL com default inventaria
-- uma data de evento que ninguém informou.
--
-- Diferente de `data_inicio_prevista`/`data_fim_prevista`, esta data NÃO
-- volta para o orçamento: `orcamentos` não tem o campo e o design não
-- pede que passe a ter. Ela é dado da abertura do job.
--
-- Aditiva: coluna nova, nada é reescrito.

alter table public.jobs
  add column if not exists data_evento date;

comment on column public.jobs.data_evento is
  'Data do evento do job, informada no envio para abertura (obrigatoria no formulario desde 27/08/2026). Nullable porque os jobs anteriores nao tem o dado.';
