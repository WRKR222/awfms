// src/types/pdfkit.d.ts
// Fallback ambient declaration for pdfkit. @types/pdfkit is also listed in
// package.json, but if it fails to resolve for any reason (registry mirror,
// lockfile drift, CI cache, etc.) this keeps the build from failing on an
// implicit-any error for the default import in issuance-plan.service.ts.
// TypeScript prefers a real @types package over this if one resolves
// correctly, so this is purely a safety net, not a replacement.
declare module 'pdfkit' {
  import { Writable } from 'stream';

  interface PDFDocumentOptions {
    margin?: number;
    margins?: { top: number; left: number; bottom: number; right: number };
    size?: string | [number, number];
    layout?: 'portrait' | 'landscape';
    bufferPages?: boolean;
    autoFirstPage?: boolean;
    [key: string]: any;
  }

  class PDFDocument extends Writable {
    constructor(options?: PDFDocumentOptions);
    pipe<T extends NodeJS.WritableStream>(destination: T): T;
    end(): void;
    addPage(options?: PDFDocumentOptions): this;
    fontSize(size: number): this;
    font(src: string, size?: number): this;
    fillColor(color: string, opacity?: number): this;
    strokeColor(color: string, opacity?: number): this;
    text(text: string, x?: number, y?: number, options?: Record<string, any>): this;
    text(text: string, options?: Record<string, any>): this;
    moveDown(lines?: number): this;
    moveUp(lines?: number): this;
    rect(x: number, y: number, width: number, height: number): this;
    fill(color?: string): this;
    stroke(color?: string): this;
    image(src: string | Buffer, x?: number, y?: number, options?: Record<string, any>): this;
    readonly y: number;
    readonly x: number;
    page: { width: number; height: number; margins: Record<string, number> };
    [key: string]: any;
  }

  export = PDFDocument;
}
