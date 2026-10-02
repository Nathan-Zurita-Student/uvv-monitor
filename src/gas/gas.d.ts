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
    getAll(keys: string[]): Record<string, string>;
    put(key: string, value: string, expirationInSeconds?: number): void;
    putAll(values: Record<string, string>, expirationInSeconds?: number): void;
    remove(key: string): void;
    removeAll(keys: string[]): void;
  };
};

declare namespace GasUtilities {
  interface Blob {
    getBytes(): number[];
    getDataAsString(): string;
  }
}

declare const Utilities: {
  newBlob(data: string | number[], contentType?: string): GasUtilities.Blob;
  gzip(blob: GasUtilities.Blob): GasUtilities.Blob;
  ungzip(blob: GasUtilities.Blob): GasUtilities.Blob;
  base64Encode(data: number[]): string;
  base64Decode(encoded: string): number[];
};

declare const LockService: {
  getScriptLock(): {
    waitLock(timeoutInMillis: number): void;
    releaseLock(): void;
  };
};

declare const PropertiesService: {
  getScriptProperties(): {
    getProperty(key: string): string | null;
    getProperties(): Record<string, string | undefined>;
  };
};

declare const HtmlService: { createHtmlOutput(html: string): unknown };

declare const ScriptApp: { getService(): { getUrl(): string } };
