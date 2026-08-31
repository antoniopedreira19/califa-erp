-- ---------------------------------------------------------------------------
-- A instrução da nota passa a vir do gerente de projetos; o CNAE, não.
--
-- Até aqui o envio para faturamento pedia o CNAE ao GP. Era o campo errado
-- na mão errada: CNAE é classificação fiscal da nota, e quem emite a nota é
-- o financeiro. O GP não tem como saber, e na prática digitava qualquer
-- coisa para o formulário deixar enviar.
--
-- O que o GP TEM para dizer é como a nota deve ser descrita — o texto que o
-- cliente exige ver na NF para aceitá-la. Hoje esse texto viaja por fora do
-- sistema (mensagem, e-mail) e o financeiro escreve de memória.
--
-- Então os dois trocam de lugar:
--
--   `descricao_nf`  entra aqui, vinda do GP no envio.
--   `cnae`          deixa de ser obrigatório e sai do formulário de envio;
--                   passa a ser pedido ao financeiro na emissão da nota
--                   (ver a migration irmã, em `faturamentos`).
--
-- O CNAE já gravado NÃO é apagado: ele é o registro do que a produção
-- declarou no envio, e serve de rastro. Só perde a obrigatoriedade.
--
-- `descricao_nf` nasce aceitando nulo porque os envios que já existem não
-- têm o que preencher — o campo não existia quando foram feitos. A
-- obrigatoriedade vale para envio NOVO e é imposta no servidor, pelo
-- `envioFaturamentoSchema` da server action, não pelo navegador.
--
-- Decisão do Tiago, 31/08/2026.
-- ---------------------------------------------------------------------------

alter table public.jobs_envio_faturamento
  add column if not exists descricao_nf text;

comment on column public.jobs_envio_faturamento.descricao_nf is
  'Instrucao do gerente de projetos sobre como a NF deve ser descrita. O financeiro copia este texto para a nota. Nulo nos envios anteriores a 31/08/2026, quando o campo passou a existir.';

-- O CHECK exigia CNAE não vazio. Sai junto com a obrigatoriedade: sem ele,
-- `not null` sozinho ainda aceitaria string em branco, e com ele um envio
-- novo (que não manda mais CNAE) seria recusado.
alter table public.jobs_envio_faturamento
  drop constraint if exists chk_envio_cnae;

alter table public.jobs_envio_faturamento
  alter column cnae drop not null;

comment on column public.jobs_envio_faturamento.cnae is
  'CNAE declarado pela producao ate 31/08/2026. Historico: o campo saiu do formulario de envio e o CNAE que vale para a nota agora e o de faturamentos.cnae, informado pelo financeiro na emissao. Nulo nos envios feitos a partir dessa data.';
