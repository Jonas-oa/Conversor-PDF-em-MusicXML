# Partitura Viva OMR Service

Microsserviço isolado que recebe um PDF, executa o Audiveris em lote e entrega
MusicXML não compactado após validação estrutural.

## Licença e fronteira

Este repositório é um programa separado, licenciado sob GNU AGPLv3. O PWA
[`aula-de-piano-offline`](https://github.com/Jonas-oa/aula-de-piano-offline)
continua MIT e se comunica com este serviço apenas pela API HTTP. Toda
implantação pública deve definir `SOURCE_URL` para a versão exata do
código-fonte em execução e manter o endpoint `/source` visível.

Audiveris 5.11.0 também é AGPLv3 e é executado como processo externo. Não há
código Audiveris copiado ou vinculado ao PWA.

## API

- `POST /v1/convert`: conversão síncrona para Cloud Run; devolve MusicXML,
  métricas e avisos na mesma resposta;
- `POST /v1/jobs`: multipart com o campo `score` contendo um PDF;
- `GET /v1/jobs/:id`: estado, métricas e avisos;
- `GET /v1/jobs/:id/result`: MusicXML após conclusão;
- `GET /health`: saúde, fila, versão do motor e fonte;
- `GET /source`: redireciona para o código-fonte correspondente.

Os trabalhos sobrevivem à reinicialização em `OMR_DATA_DIR` e são apagados
após o TTL configurado.

No Cloud Run, use `POST /v1/convert`. Esse endpoint mantém a requisição aberta,
usa apenas armazenamento temporário e remove o PDF antes de responder. O fluxo
assíncrono `/v1/jobs` permanece disponível para servidores com disco
persistente e CPU continuamente alocada.

## Desenvolvimento

```bash
npm install
npm test
npm start
```

Sem Audiveris instalado, os testes continuam funcionando com um executor
simulado. A execução real requer `AUDIVERIS_COMMAND`.

## Variáveis

- `ALLOWED_ORIGINS`: origens do PWA separadas por vírgula;
- `SOURCE_URL`: código-fonte exato oferecido aos usuários;
- `OMR_ACCESS_KEY`: chave opcional exigida em `X-OMR-Key` ou `Authorization:
  Bearer`; recomendada em toda implantação pública;
- `OMR_DATA_DIR`: diretório persistente dos trabalhos;
- `MAX_UPLOAD_BYTES`: padrão 30 MiB;
- `MAX_QUEUED_JOBS`: padrão 20;
- `OMR_CONCURRENCY`: padrão 1;
- `OMR_JOB_TIMEOUT_MS`: padrão 10 minutos;
- `OMR_JOB_TTL_MS`: padrão 24 horas;
- `AUDIVERIS_COMMAND`: executável Audiveris;
- `AUDIVERIS_VERSION`: versão informada pela API.
- `OCR_LANGUAGE_FILE`: arquivo `eng.traineddata` usado para títulos e textos.

## Comando Audiveris

O executor usa:

```text
Audiveris -batch -transcribe -export -save -swap -output <dir> -- <pdf>
```

Esse conjunto processa todas as páginas, exporta `.mxl`, preserva o projeto
`.omr` para diagnóstico e reduz o uso de memória em partituras extensas.

O ensaio real com o PDF de quatro páginas de *Für Elise* está registrado em
[`docs/validation-fur-elise.md`](docs/validation-fur-elise.md).

O passo a passo de implantação serverless está em
[`docs/cloud-run.md`](docs/cloud-run.md).
