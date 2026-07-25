# Implantação no Google Cloud Run

Esta configuração usa uma única requisição para cada conversão. Assim, o
Cloud Run mantém CPU e memória disponíveis durante toda a execução do
Audiveris. PDFs, logs e projetos `.omr` ficam em `/tmp` e são apagados antes da
resposta.

## Recursos recomendados

- região: `us-central1`;
- 2 vCPUs e 4 GiB de memória;
- concorrência HTTP: 1;
- máximo de instâncias: 1;
- mínimo de instâncias: 0;
- timeout da requisição: 15 minutos;
- faturamento baseado em requisições.

## Preparação

Crie um projeto no Google Cloud, associe uma conta de faturamento e habilite as
APIs necessárias:

```bash
gcloud services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  secretmanager.googleapis.com
```

Crie uma chave longa e aleatória. O valor não deve ser salvo no GitHub:

```bash
printf '%s' 'SUBSTITUA_POR_UMA_CHAVE_FORTE' \
  | gcloud secrets create omr-access-key --data-file=-
```

## Implantação

Execute na raiz deste repositório:

```bash
gcloud run deploy partitura-viva-omr \
  --source . \
  --region us-central1 \
  --execution-environment gen2 \
  --cpu 2 \
  --memory 4Gi \
  --concurrency 1 \
  --max-instances 1 \
  --min-instances 0 \
  --timeout 900 \
  --allow-unauthenticated \
  --set-env-vars 'OMR_DATA_DIR=/tmp/partitura-omr,OMR_CONCURRENCY=1,OMR_JOB_TIMEOUT_MS=600000,ALLOWED_ORIGINS=https://SEU-APP.example,SOURCE_URL=https://github.com/Jonas-oa/Conversor-PDF-em-MusicXML' \
  --set-secrets OMR_ACCESS_KEY=omr-access-key:latest
```

O serviço precisa ser publicamente invocável porque o PWA roda no navegador.
A chave `OMR_ACCESS_KEY`, enviada no cabeçalho `X-OMR-Key`, protege os endpoints
de conversão. `/health` e `/source` permanecem públicos.

## Verificação

```bash
SERVICE_URL="$(gcloud run services describe partitura-viva-omr \
  --region us-central1 \
  --format='value(status.url)')"

curl -fsS "$SERVICE_URL/health"

curl -fsS \
  -H 'X-OMR-Key: SUBSTITUA_POR_UMA_CHAVE_FORTE' \
  -F 'score=@partitura.pdf;type=application/pdf' \
  "$SERVICE_URL/v1/convert" \
  -o resultado.json
```

O JSON retornado contém `xml`, `metrics`, `warnings`, `engine` e `sourceUrl`.

## Limites e custo

O máximo de uma instância impede que uso inesperado multiplique o consumo. A
chave de acesso deve ser mantida somente no aparelho do usuário. Configure
alertas de orçamento no Google Cloud; alertas avisam sobre gastos, mas não
interrompem automaticamente o serviço.
