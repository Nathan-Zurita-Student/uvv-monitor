# Resumos condicionados à coleta do horário

Horários: **12h, 17h e 20h**, sempre em `America/Sao_Paulo`.

## O que muda

O Apps Script dispara a coleta antes do horário e só entrega o resumo depois que `run_history`
confirma uma execução finalizada na janela atual. Se Playwright, a fila ou a instalação de
dependências atrasarem, a mensagem espera; dados da coleta anterior nunca são enviados como o
resumo atual. Ao terminar, o monitor chama o webhook, renova o snapshot e libera o envio.
O Apps Script então lê os dados salvos no Sheets e os status atuais do Telegram.
Até três prioridades são apresentadas com links e botões; tarefas concluídas/ignoradas ficam fora.
Às 20h há um horizonte de três dias, e às quartas/domingos uma revisão de sete dias.

Uma coleta antiga **não é enviada**. Uma coleta atual que terminou parcialmente pode gerar o
resumo, mas ele informa a situação de Portal/AVA, Gmail e Calendar. Arquivos e novidades continuam
sendo entregues pelo coletor quando ele concluir.

## Ativação e teste

1. Publicar `apps-script/Code.gs` como Código.gs e `apps-script/Bot.gs` como Bot.gs no projeto existente.
2. Atualizar a implantação existente para uma nova versão, sem mudar o acesso do webhook.
3. Executar `sendDailyDigestTest` no editor e confirmar mensagem e botões no próprio Telegram.
4. Conferir na aba Acionadores que `processReminders` já roda a cada cinco minutos; se não houver,
   cadastrar esse acionador pela interface. Executar `setupDailyDigests` cria um token restrito e
   ativa os resumos. Não solicita permissão para gerenciar acionadores programaticamente.
   Os resumos funcionam sem API de IA nem conta de faturamento.
5. No GitHub, variável de repositório `DAILY_DIGEST_EXTERNAL=true`: evita os painéis periódicos
   duplicados enviados pelo Node. Não desabilita novidades nem arquivos.

## Agendador primário gratuito (cron-job.org)

Não compartilhe a senha do Portal, token do Telegram, segredo do webhook, tokens Google ou dados
acadêmicos com o agendador. Ele recebe **somente** a URL pública /exec e `DAILY_DIGEST_TOKEN`.
Esse token só pode disparar o resumo do horário atual para o chat já configurado, sem retornar
dados, criar eventos ou alterar status. Obtenha-o nas propriedades do Apps Script, sem imprimir
em logs, commits ou capturas. Confirme com o usuário antes de transmitir essa credencial.

Configurar uma tarefa POST para a URL /exec **sem** `?secret=`:

```json
{ "uvv": "daily_digest", "token": "VALOR_DA_PROPRIEDADE_DAILY_DIGEST_TOKEN" }
```

Header: `Content-Type: application/json`. Timezone: `America/Sao_Paulo`.
Cron personalizado: `0,1,2,3,4 12,17,20 * * *` (tentativas nos cinco primeiros minutos).
Não publicar os resultados nem cadastrar status page pública. A resposta não traz dados
acadêmicos. O endpoint exige o token separado, mesmo que o segredo normal do webhook seja válido.

O comprovante `digest.sent.AAAA-MM-DD HH:mm` fica nas Script Properties, não no cache efêmero.
Chamadas normais repetidas não duplicam; envio só é marcado após confirmação do Telegram. Uma
interrupção exatamente entre o envio e a gravação ainda pode duplicar: não há transação distribuída
entre Telegram e Apps Script. O ScriptLock serializa chamadas e a retenção é de sete dias.

O limite do cron-job.org é 30 segundos. Se o endpoint exceder esse limite ou falhar, a reserva do
Apps Script tenta de novo durante a janela de uma hora. Validar a duração no teste real.
O retorno `sent` confirma envio; `waiting` indica que a coleta atual ainda não terminou; `idle`
indica já entregue ou fora da janela; `disabled` indica desativado; `unauthorized` indica token
inválido. Um HTTP 200 isolado não prova que houve envio.

## Coletas e recuperação

O Apps Script tenta iniciar a coleta às 11h40, 16h40 e 19h40. O cron do GitHub é reserva (11h35,
16h35 e 19h35) e pode atrasar. Os slots lógicos continuam 12:00, 17:00 e 20:00. O slot legado
21:00 é aceito para compatibilidade, mas não consta em novos agendamentos.

Nenhum componente garante entrega no segundo exato: Telegram, internet, Apps Script e agendador
podem falhar. A prioridade é não entregar um resumo desatualizado; se a coleta atrasar, o resumo
também atrasa e é tentado novamente pelo acionador de cinco minutos e pelo callback final.

## Checklist e retorno à versão anterior

- [x] `npm run check` aprovado e regressões de timeout/mensagens cobertas (255 testes).
- [x] Nova implantação publicada (versão 18), mantendo a URL e as permissões existentes.
- [x] `dailyDigestInfo` mostra enabled=true, tokenConfigured=true e horários corretos.
- [x] Agendador privado ativo; teste fora da janela retorna idle (HTTP 200, 2,4 segundos).
- [x] Variável do GitHub ativada; coleta nova termina e renova a memória do bot.
- [x] Não há serviço Google Cloud faturável ativado por esta mudança.
- [ ] Observar a primeira entrega agendada real e a duração da chamada que efetivamente envia.

### Validação em produção — 07/10/2026

A coleta manual no GitHub (run `37669842443`) terminou às 15h57 no fuso de São Paulo:
Portal/AVA, Gmail e Calendar `SUCCESS`, 294 itens encontrados e nenhum erro de fonte.
O resumo de teste chegou às 16h05 com links, status e a coleta atualizada. O botão de consulta
abriu o painel. Uma pergunta real ao assistente confirmou a prova EAD em 31/10 às 8h e o local
da mensagem personalizada, em vez de repetir o comunicado geral sem horário.

A implantação 17 mantém a URL e as permissões anteriores. A variável de repositório
`DAILY_DIGEST_EXTERNAL=true` está ativa. O cron privado foi salvo com a próxima execução às
17h e sem armazenamento de respostas. O primeiro teste retornou idle, corretamente fora
da janela. Um segundo teste foi iniciado, mas o controle do navegador deixou de responder;
seu resultado não foi confirmado. A primeira entrega realmente agendada ainda precisa ser
observada; teste manual e testes automatizados não comprovam pontualidade futura.

Se o novo resumo falhar, definir `DAILY_DIGEST_ENABLED=false` no Apps Script, desativar o cron
externo e definir `DAILY_DIGEST_EXTERNAL=false` no GitHub. O envio antigo volta na próxima coleta.
Não apagar memória acadêmica, implantação, segredos ou repositório para reverter.

### Correção de produção — 08/10/2026

O resumo das 12h foi entregue usando a coleta de 07/10 às 15h57, porque a versão 17 enviava o
snapshot disponível mesmo quando a coleta da janela atual ainda não havia terminado. A versão 18
passa a falhar fechada: retorna `waiting`, inicia a varredura se necessário e só envia depois de
confirmar em `run_history` uma execução iniciada na janela atual e já finalizada. O callback de
conclusão da coleta libera o resumo imediatamente. O cenário foi coberto por teste de integração e
a implantação existente foi atualizada sem alterar sua URL.
