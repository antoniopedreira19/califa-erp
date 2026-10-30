-- Revisão das decisões 115 e 224 (30/10/2026): o "Editar planilha" do
-- financeiro com o job aberto não ajusta mais sozinho a previsão de
-- recebimento nem os recolhimentos de imposto. O financeiro continua para a
-- aba Abertura do Job, revisa as previsões sobre os números novos e registra
-- a alteração e a revisão juntas (opção C do protótipo aprovado).
--
-- Essa revisão deixa uma foto no histórico do registro, como a revisão da
-- errata e a edição do registro. Ela ganha tipo próprio para o histórico
-- dizer de onde veio: "Revisão N · alteração do financeiro".
--
-- Aditiva: só alarga o CHECK; as fotos que existem continuam válidas.

alter table public.jobs_aberturas
  drop constraint jobs_aberturas_tipo_check;

alter table public.jobs_aberturas
  add constraint jobs_aberturas_tipo_check
  check (tipo = any (array['abertura'::text, 'revisao_errata'::text, 'edicao'::text, 'revisao_financeiro'::text]));

comment on column public.jobs_aberturas.tipo is
  'abertura = a abertura do job; revisao_errata = revisão depois de errata (decisão 059); edicao = Editar registro; revisao_financeiro = revisão registrada junto com a alteração do financeiro no Editar planilha (revisão das decisões 115 e 224, 30/10/2026).';
