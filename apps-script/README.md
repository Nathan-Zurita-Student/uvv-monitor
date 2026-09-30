# Webhook gratuito do Telegram

Este pequeno Google Apps Script recebe os cliques dos botões do Telegram imediatamente. O monitor principal continua no GitHub Actions; o Web App trata apenas interações.

## Publicação

1. Execute `npm run sheets:setup` para criar a aba `telegram_task_messages`.
2. Acesse [script.google.com](https://script.google.com), crie um projeto e copie `Code.gs` e `appsscript.json` desta pasta.
3. Em **Configurações do projeto → Propriedades do script**, crie:
   - `TELEGRAM_BOT_TOKEN`
   - `TELEGRAM_CHAT_ID`
   - `GOOGLE_SHEET_ID`
   - `TELEGRAM_WEBHOOK_SECRET` — use uma sequência aleatória longa, com pelo menos 32 caracteres.
4. Em **Implantar → Nova implantação → App da Web**:
   - executar como você;
   - acesso: qualquer pessoa.
5. Autorize somente Sheets e conexões externas.
6. No editor, execute manualmente a função `setupWebhook` uma vez.
7. No `.env` local e nos GitHub Secrets, defina `TELEGRAM_WEBHOOK_ENABLED=true`.

Para voltar ao polling, execute `deleteWebhook` no Apps Script e altere `TELEGRAM_WEBHOOK_ENABLED=false`.

Nunca coloque os valores das propriedades no repositório.
