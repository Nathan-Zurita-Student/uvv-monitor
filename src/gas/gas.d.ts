/** Declarações mínimas dos serviços do Google Apps Script usados pelo bot (src/gas). */

declare namespace GasSheets {
  interface Range {
    getValues(): unknown[][];
    setValues(values: string[][]): Range;
  }
  interface Sheet {
    getDataRange(): Range;
    getRange(row: number, column: number, rows: number, columns: number): Range;
    appendRow(values: string[]): Sheet;
    getLastRow(): number;
  }
  interface Spreadsheet {
    getSheetByName(name: string): Sheet | null;
    insertSheet(name: string): Sheet;
  }
}

declare const SpreadsheetApp: { openById(id: string): GasSheets.Spreadsheet };

declare const UrlFetchApp: {
  fetch(
    url: string,
    params: {
      method: 'post' | 'get';
      contentType?: string;
      payload?: string;
      muteHttpExceptions?: boolean;
    },
  ): { getResponseCode(): number; getContentText(): string };
};

declare const CacheService: {
  getScriptCache(): {
    get(key: string): string | null;
    put(key: string, value: string, expirationInSeconds?: number): void;
    remove(key: string): void;
  };
};

declare const LockService: {
  getScriptLock(): {
    waitLock(timeoutInMillis: number): void;
    releaseLock(): void;
  };
};

declare const PropertiesService: {
  getScriptProperties(): { getProperty(key: string): string | null };
};

declare const HtmlService: { createHtmlOutput(html: string): unknown };

declare const ScriptApp: { getService(): { getUrl(): string } };
