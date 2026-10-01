const TASK_STATUS_BY_CALLBACK = Object.freeze({
  not_started: 'TODO',
  in_progress: 'IN_PROGRESS',
  completed: 'DONE',
  waiting: 'WAITING',
});

const CALLBACK_BY_TASK_STATUS = Object.freeze({
  TODO: 'not_started',
  IN_PROGRESS: 'in_progress',
  DONE: 'completed',
  WAITING: 'waiting',
});

const STATUS_LABELS = Object.freeze({
  TODO: '⏳ Ainda não comecei',
  IN_PROGRESS: '🔄 Em andamento',
  DONE: '✅ Concluído',
  WAITING: '⏸️ Aguardando',
  NEEDS_CONFIRMATION: '⚠️ Precisa de confirmação',
  IGNORED: '🙈 Ignorado',
});

function doGet(event) {
  if (!event || !event.parameter || !event.parameter.item) {
    return ContentService.createTextOutput('UVV Monitor: ações do Telegram ativas.');
  }
  try {
    return handleTaskActionPage_(event);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return actionResultPage_(
      'Não consegui atualizar',
      'O link pode ter expirado. Volte ao Telegram e use os botões da mensagem mais recente.',
      false,
    );
  }
}

function handleTaskActionPage_(event) {
  const properties = getRequiredProperties_();
  const itemId = String(event.parameter.item || '').toUpperCase();
  const callbackStatus = String(event.parameter.status || '').toLowerCase();
  const token = String(event.parameter.token || '');
  const status = TASK_STATUS_BY_CALLBACK[callbackStatus];
  if (!/^UVV-[A-Z0-9]{4,10}$/.test(itemId) || !status || token.length < 20) {
    return actionResultPage_('Link inválido', 'Use os botões da mensagem mais recente.', false);
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(5000);
  try {
    const spreadsheet = SpreadsheetApp.openById(properties.sheetId);
    const taskMessage = findRecord_(
      spreadsheet,
      'telegram_task_messages',
      'itemId',
      itemId,
    );
    if (!taskMessage || String(taskMessage.data.actionToken || '') !== token) {
      return actionResultPage_(
        'Este botão expirou',
        'Volte ao Telegram e use a mensagem de prioridades mais recente.',
        false,
      );
    }
    const item = findRecord_(spreadsheet, 'detected_items', 'id', itemId);
    if (!item) return actionResultPage_('Tarefa não encontrada', `Não encontrei ${itemId}.`, false);

    updateRecordField_(item, 'status', status);
    const now = new Date().toISOString();
    upsertRecord_(spreadsheet, 'user_task_status', 'itemId', {
      itemId,
      status,
      updatedAt: now,
      source: 'TELEGRAM',
    });
    upsertRecord_(spreadsheet, 'telegram_task_messages', 'itemId', {
      itemId,
      chatId: taskMessage.data.chatId,
      messageId: taskMessage.data.messageId,
      lastRenderedStatus: status,
      updatedAt: now,
      actionToken: token,
    });

    const actionBaseUrl = ScriptApp.getService().getUrl();
    telegramCall_(properties.botToken, 'editMessageText', {
      chat_id: String(taskMessage.data.chatId),
      message_id: Number(taskMessage.data.messageId),
      text: buildTaskText_(item.data, status),
      disable_web_page_preview: true,
      reply_markup: {
        inline_keyboard: buildTaskActionKeyboard_(
          actionBaseUrl,
          itemId,
          token,
          status,
          item.data.sourceUrl,
          item.data.source,
        ),
      },
    });
    return actionResultPage_(
      'Andamento atualizado',
      `${item.data.title} agora está como ${STATUS_LABELS[status]}. Você já pode fechar esta página.`,
      true,
    );
  } finally {
    lock.releaseLock();
  }
}

function actionResultPage_(title, message, success) {
  const color = success ? '#137333' : '#b3261e';
  return HtmlService.createHtmlOutput(
    `<!doctype html><html lang="pt-BR"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml_(title)}</title></head><body style="font-family:Arial,sans-serif;background:#f6f8fc;margin:0;padding:32px"><main style="max-width:560px;margin:40px auto;background:white;padding:28px;border-radius:18px;box-shadow:0 4px 24px #0002"><h1 style="color:${color};font-size:24px">${escapeHtml_(title)}</h1><p style="font-size:17px;line-height:1.5">${escapeHtml_(message)}</p><p style="color:#5f6368">UVV Monitor</p></main></body></html>`,
  ).setTitle(title);
}

function escapeHtml_(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function doPost(event) {
  const properties = getRequiredProperties_();
  if (!event || !event.parameter || event.parameter.secret !== properties.webhookSecret) {
    return ContentService.createTextOutput('unauthorized');
  }

  let update;
  try {
    update = JSON.parse(event.postData.contents);
  } catch (_error) {
    return ContentService.createTextOutput('invalid-json');
  }

  try {
    if (update.callback_query) handleTaskCallback_(update.callback_query, properties);
    else if (update.message && update.message.text) handleTextMessage_(update.message, properties);
  } catch (error) {
    if (update.callback_query && update.callback_query.id) {
      answerCallback_(
        properties.botToken,
        update.callback_query.id,
        'Não consegui atualizar agora. Tente novamente.',
      );
    }
    console.error(error instanceof Error ? error.message : String(error));
  }
  return ContentService.createTextOutput('ok');
}

function setupWebhook() {
  const properties = getRequiredProperties_();
  const deploymentUrl = ScriptApp.getService().getUrl();
  if (!deploymentUrl)
    throw new Error('Publique o projeto como Web App antes de configurar o webhook.');
  const webhookUrl = `${deploymentUrl}?secret=${encodeURIComponent(properties.webhookSecret)}`;
  return telegramCall_(properties.botToken, 'setWebhook', {
    url: webhookUrl,
    allowed_updates: ['message', 'callback_query'],
    drop_pending_updates: false,
  });
}

function deleteWebhook() {
  const properties = getRequiredProperties_();
  return telegramCall_(properties.botToken, 'deleteWebhook', { drop_pending_updates: false });
}

function handleTaskCallback_(callback, properties) {
  const chatId = callback.message && callback.message.chat && String(callback.message.chat.id);
  if (chatId !== properties.chatId) {
    answerCallback_(properties.botToken, callback.id, 'Você não pode alterar esta tarefa.');
    return;
  }
  const parsed = parseTaskCallback_(callback.data || '');
  if (!parsed) {
    answerCallback_(properties.botToken, callback.id, 'Este botão não é mais válido.');
    return;
  }

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) {
    answerCallback_(
      properties.botToken,
      callback.id,
      'Outra atualização está em andamento. Tente novamente.',
    );
    return;
  }
  try {
    const spreadsheet = SpreadsheetApp.openById(properties.sheetId);
    const item = findRecord_(spreadsheet, 'detected_items', 'id', parsed.itemId);
    if (!item) {
      answerCallback_(properties.botToken, callback.id, 'Essa tarefa não foi encontrada.');
      return;
    }

    updateRecordField_(item, 'status', parsed.status);
    upsertRecord_(spreadsheet, 'user_task_status', 'itemId', {
      itemId: parsed.itemId,
      status: parsed.status,
      updatedAt: new Date().toISOString(),
      source: 'TELEGRAM',
    });
    upsertRecord_(spreadsheet, 'telegram_task_messages', 'itemId', {
      itemId: parsed.itemId,
      chatId,
      messageId: callback.message.message_id,
      lastRenderedStatus: parsed.status,
      updatedAt: new Date().toISOString(),
    });

    const currentText = callback.message.text || '';
    const statusLine = `📊 Situação atual: ${STATUS_LABELS[parsed.status]}`;
    const updatedText = /^📊 Situação atual:.*$/m.test(currentText)
      ? currentText.replace(/^📊 Situação atual:.*$/m, statusLine)
      : `${currentText}\n${statusLine}`;
    telegramCall_(properties.botToken, 'editMessageText', {
      chat_id: chatId,
      message_id: callback.message.message_id,
      text: updatedText,
      disable_web_page_preview: true,
      reply_markup: {
        inline_keyboard: buildTaskKeyboard_(
          parsed.itemId,
          parsed.status,
          item.data.sourceUrl,
          item.data.source,
        ),
      },
    });
    answerCallback_(
      properties.botToken,
      callback.id,
      `Status atualizado para ${STATUS_LABELS[parsed.status].replace(/^[^\s]+\s/, '')}.`,
    );
  } finally {
    lock.releaseLock();
  }
}

function handleTextMessage_(message, properties) {
  if (String(message.chat.id) !== properties.chatId) return;
  const text = String(message.text || '').trim();
  if (/^\/(start|ajuda)(?:@\w+)?\b/i.test(text)) {
    sendText_(
      properties.botToken,
      properties.chatId,
      'Olá! Cada prioridade possui botões próprios. Toque em uma opção para atualizar o andamento imediatamente. Os comandos /feito, /fazendo, /pendente, /ignorar e /status também continuam disponíveis.',
    );
    return;
  }

  const replyText =
    message.reply_to_message && message.reply_to_message.text
      ? String(message.reply_to_message.text)
      : '';
  const itemIdMatch = `${text} ${replyText}`.match(/\bUVV-[A-Z0-9]{4,10}\b/i);
  if (!itemIdMatch) return;
  const itemId = itemIdMatch[0].toUpperCase();
  const normalized = normalize_(text);
  let status;
  if (/^\/feito\b/i.test(text) || /\b(ja fiz|terminei|concluido|conclui)\b/.test(normalized))
    status = 'DONE';
  else if (
    /^\/fazendo\b/i.test(text) ||
    /\b(estou fazendo|ja comecei|em andamento)\b/.test(normalized)
  )
    status = 'IN_PROGRESS';
  else if (/^\/pendente\b/i.test(text) || /\b(nao comecei|ainda nao fiz)\b/.test(normalized))
    status = 'TODO';
  else if (/^\/ignorar\b/i.test(text)) status = 'IGNORED';

  const spreadsheet = SpreadsheetApp.openById(properties.sheetId);
  const item = findRecord_(spreadsheet, 'detected_items', 'id', itemId);
  if (!item) {
    sendText_(properties.botToken, properties.chatId, `Não encontrei a tarefa ${itemId}.`);
    return;
  }
  if (/^\/status\b/i.test(text)) {
    sendText_(
      properties.botToken,
      properties.chatId,
      `📌 ${item.data.title}\n📊 Situação atual: ${STATUS_LABELS[item.data.status] || item.data.status}\n🆔 ${itemId}`,
    );
    return;
  }
  if (!status) return;

  const lock = LockService.getScriptLock();
  lock.waitLock(5000);
  try {
    updateRecordField_(item, 'status', status);
    upsertRecord_(spreadsheet, 'user_task_status', 'itemId', {
      itemId,
      status,
      updatedAt: new Date().toISOString(),
      source: 'TELEGRAM',
    });
  } finally {
    lock.releaseLock();
  }
  sendText_(
    properties.botToken,
    properties.chatId,
    `Atualizei “${item.data.title}” para ${STATUS_LABELS[status]}.`,
  );
}

function parseTaskCallback_(value) {
  const match = String(value).match(
    /^task:(UVV-[A-Z0-9]{4,10}):(not_started|in_progress|completed|waiting)$/i,
  );
  if (!match) return null;
  const callbackStatus = match[2].toLowerCase();
  return {
    itemId: match[1].toUpperCase(),
    status: TASK_STATUS_BY_CALLBACK[callbackStatus],
  };
}

function buildTaskKeyboard_(itemId, selectedStatus, sourceUrl, source) {
  function statusButton(text, status) {
    const callbackStatus = CALLBACK_BY_TASK_STATUS[status];
    return {
      text: status === selectedStatus ? `${text} ✓` : text,
      callback_data: `task:${itemId}:${callbackStatus}`,
    };
  }
  const keyboard = [
    [statusButton('⏳ Não comecei', 'TODO'), statusButton('🔄 Em andamento', 'IN_PROGRESS')],
    [statusButton('✅ Concluído', 'DONE'), statusButton('⏸️ Aguardando', 'WAITING')],
  ];
  if (/^https:\/\//i.test(String(sourceUrl || ''))) {
    keyboard.push([
      {
        text: source === 'PORTAL' ? '🔗 Abrir no Portal UVV' : '🔗 Abrir informação',
        url: sourceUrl,
      },
    ]);
  }
  return keyboard;
}

function buildTaskActionKeyboard_(baseUrl, itemId, token, selectedStatus, sourceUrl, source) {
  function statusButton(text, status) {
    const url = `${baseUrl}?item=${encodeURIComponent(itemId)}&status=${encodeURIComponent(
      CALLBACK_BY_TASK_STATUS[status],
    )}&token=${encodeURIComponent(token)}`;
    return { text: status === selectedStatus ? `${text} ✓` : text, url };
  }
  const keyboard = [
    [statusButton('⏳ Não comecei', 'TODO'), statusButton('🔄 Em andamento', 'IN_PROGRESS')],
    [statusButton('✅ Concluído', 'DONE'), statusButton('⏸️ Aguardando', 'WAITING')],
  ];
  if (/^https:\/\//i.test(String(sourceUrl || ''))) {
    keyboard.push([
      {
        text: source === 'PORTAL' ? '🔗 Abrir no Portal UVV' : '🔗 Abrir informação',
        url: sourceUrl,
      },
    ]);
  }
  return keyboard;
}

function buildTaskText_(item, status) {
  const lines = [`📌 ${item.title}`];
  if (item.discipline) lines.push(`🎓 ${item.discipline}`);
  const deadline = item.officialDeadline || item.officialDate;
  lines.push(deadline ? `📅 Prazo/data oficial: ${deadline}` : '📅 Prazo/data oficial: não informado');
  if (item.urgency) lines.push(`⚠️ Prioridade: ${item.urgency}`);
  lines.push(`📊 Situação atual: ${STATUS_LABELS[status] || status}`);
  if (/^https:\/\//i.test(String(item.sourceUrl || ''))) lines.push(`🔗 Link: ${item.sourceUrl}`);
  lines.push(`🆔 Código: ${item.id}`);
  return lines.join('\n');
}

function findRecord_(spreadsheet, sheetName, keyName, keyValue) {
  const sheet = spreadsheet.getSheetByName(sheetName);
  if (!sheet) throw new Error(`Aba ausente: ${sheetName}`);
  const values = sheet.getDataRange().getValues();
  if (values.length === 0) return null;
  const headers = values[0].map(String);
  const keyIndex = headers.indexOf(keyName);
  if (keyIndex < 0) throw new Error(`Coluna ausente: ${sheetName}.${keyName}`);
  for (let index = 1; index < values.length; index += 1) {
    if (String(values[index][keyIndex]) !== String(keyValue)) continue;
    const data = {};
    headers.forEach((header, column) => {
      data[header] = values[index][column];
    });
    return { sheet, row: index + 1, headers, data };
  }
  return null;
}

function updateRecordField_(record, field, value) {
  const column = record.headers.indexOf(field);
  if (column < 0) throw new Error(`Coluna ausente: ${field}`);
  record.sheet.getRange(record.row, column + 1).setValue(value);
  record.data[field] = value;
}

function upsertRecord_(spreadsheet, sheetName, keyName, data) {
  const existing = findRecord_(spreadsheet, sheetName, keyName, data[keyName]);
  const sheet = existing ? existing.sheet : spreadsheet.getSheetByName(sheetName);
  if (!sheet) throw new Error(`Aba ausente: ${sheetName}`);
  const headers = existing
    ? existing.headers
    : sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
  const row = headers.map((header) => (data[header] === undefined ? '' : data[header]));
  if (existing) sheet.getRange(existing.row, 1, 1, headers.length).setValues([row]);
  else sheet.appendRow(row);
}

function answerCallback_(botToken, callbackId, text) {
  try {
    telegramCall_(botToken, 'answerCallbackQuery', { callback_query_id: callbackId, text });
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
  }
}

function sendText_(botToken, chatId, text) {
  return telegramCall_(botToken, 'sendMessage', {
    chat_id: chatId,
    text,
    disable_web_page_preview: true,
  });
}

function telegramCall_(botToken, method, payload) {
  const response = UrlFetchApp.fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });
  const body = JSON.parse(response.getContentText());
  if (response.getResponseCode() >= 400 || !body.ok) {
    throw new Error(
      `Telegram rejeitou ${method}: ${body.description || response.getResponseCode()}`,
    );
  }
  return body.result;
}

function normalize_(value) {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function getRequiredProperties_() {
  const properties = PropertiesService.getScriptProperties();
  const result = {
    botToken: properties.getProperty('TELEGRAM_BOT_TOKEN'),
    chatId: properties.getProperty('TELEGRAM_CHAT_ID'),
    sheetId: properties.getProperty('GOOGLE_SHEET_ID'),
    webhookSecret: properties.getProperty('TELEGRAM_WEBHOOK_SECRET'),
  };
  const missing = Object.keys(result).filter((key) => !result[key]);
  if (missing.length > 0) throw new Error(`Propriedades ausentes: ${missing.join(', ')}`);
  return result;
}
