# Validação real — Für Elise

Data: 24 de julho de 2026

## Entrada

- arquivo: `IMSLP11471-Fur_Elise,_Beethoven,_WoO59_260723_183222.pdf`;
- origem declarada no documento: edição pública IMSLP;
- páginas: 4;
- tamanho: 434.323 bytes;
- imagem renderizada pelo Audiveris: 2480 × 3507 pixels por página.

O PDF de teste não é distribuído neste repositório.

## Ambiente

- Audiveris 5.11.0;
- commit do motor: `9e1e55cd2746037d059345881c53e6a6754bffbd`;
- execução sem interface gráfica;
- comando: `-batch -transcribe -export -save -swap`.

## Resultado estrutural

- `.omr` gerado para diagnóstico e correção;
- `.mxl` gerado com as quatro páginas;
- 1 parte;
- 106 compassos;
- 1.107 elementos de nota;
- 903 notas com altura;
- 204 pausas;
- MusicXML bem-formado e aceito pelo validador estrutural do serviço.

## Alertas observados

O Audiveris não confirmou a duração-alvo de diversos sistemas porque a fórmula
de compasso não foi reconhecida com segurança. Também registrou símbolos sem
associação e acidentes com contexto incerto.

O serviço transforma essas ocorrências do log em avisos visíveis. Portanto, a
conversão é concluída, mas não recebe classificação de revisão dispensável.
Antes de usar o resultado para avaliar notas e ritmo, esses compassos devem ser
comparados com o PDF.

## Conclusão

O fluxo técnico PDF → OMR → MXL → MusicXML validado funcionou nas quatro
páginas. O caso também confirmou que somente validar XML não mede fidelidade
musical; os avisos semânticos do Audiveris precisam fazer parte do resultado.
