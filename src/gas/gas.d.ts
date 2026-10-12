/** Declarações mínimas dos serviços do Google Apps Script usados pelo bot (src/gas). */

declare namespace GasSheets {
  interface Range {
    getValues(): unknown[][];
    setValues(values: string[][]): Range;
  }
  interface Sheet {
    getDataRange(): Range;
    getRange(row: number, column: number, rows: number, columns: number): Range;
    appendRow(values: (string | number)[]): Sheet;
    getLastRow(): number;
    deleteRow(row: number): Sheet;
  }
  interface Spreadsheet {
    getSheetByName(name: string): Sheet | null;
    insertSheet(name: string): Sheet;
  }
}

declare const SpreadsheetApp: { openById(id: string): GasSheets.Spreadsheet };

declare namespace GasFetch {
  interface Params {
    method: 'post' | 'get' | 'patch' | 'delete';
    contentType?: string;
    payload?: string;
    muteHttpExceptions?: boolean;
    headers?: Record<string, string>;
  }
  interface Response {
    getResponseCode(): number;
    getContentText(): string;
  }
}

declare const UrlFetchApp: {
  fetch(url: string, params: GasFetch.Params): GasFetch.Response;
  /** Várias requisições em paralelo. */
  fetchAll(requests: Array<GasFetch.Params & { url: string }>): GasFetch.Response[];
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
    getDataAsString(charset?: string): string;
  }
}

declare const Utilities: {
  DigestAlgorithm: { SHA_256: string };
  computeDigest(algorithm: string, value: string): number[];
  getUuid(): string;
  newBlob(data: string | number[], contentType?: string): GasUtilities.Blob;
  gzip(blob: GasUtilities.Blob): GasUtilities.Blob;
  ungzip(blob: GasUtilities.Blob): GasUtilities.Blob;
  base64Encode(data: number[]): string;
  base64Decode(encoded: string): number[];
  base64DecodeWebSafe(encoded: string): number[];
  sleep(milliseconds: number): void;
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
    setProperty(key: string, value: string): unknown;
    deleteProperty(key: string): unknown;
  };
};

declare const HtmlService: { createHtmlOutput(html: string): unknown };

declare const ContentService: {
  MimeType: { JSON: string };
  createTextOutput(text: string): { setMimeType(type: string): unknown };
};

declare const ScriptApp: { getService(): { getUrl(): string } };
