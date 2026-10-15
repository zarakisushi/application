# Manual do sistema

- **`Zaraki-Manual-do-Sistema.pdf`**: o manual pronto, para ler, imprimir ou enviar.
- **`manual.html`**: o texto do manual (edite aqui).
- **`img/`**: capturas de tela, geradas a partir do sistema com dados de demonstração.
- **`gerar-pdf.mjs`**: converte o `manual.html` em PDF.

## Atualizar o manual

1. **Se as telas mudaram, gere as capturas de novo** (sobe um banco temporário com dados de demonstração e
   fotografa as telas). Rode a partir de `apps/web`:

   ```sh
   MANUAL_CAPTURES=1 npx tsx e2e/run.mts e2e/manual-capturas.spec.ts
   ```

2. **Edite o texto** em `manual.html`, se necessário.

3. **Gere o PDF.** Rode a partir da raiz do projeto:

   ```sh
   node docs/manual/gerar-pdf.mjs
   ```
