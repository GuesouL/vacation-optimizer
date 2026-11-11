import type { components } from "./api-types";

type PdfPreview = components["schemas"]["PdfPreviewOut"];

export const MAX_PDF_BYTES = 5_000_000; // the server refuses more than this too

export function isPdf(file: { name: string; type: string }): boolean {
  return file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
}

/** Bytes to base64, in slices: one giant String.fromCharCode call overflows the stack on big files. */
export function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

/** The line under the review list: how the dates were found, and what to double-check. */
export function pdfNote(p: Pick<PdfPreview, "method" | "note" | "events">): string {
  if (p.note) return p.note;
  if (!p.events.length) return "";
  if (p.method === "AI") return "Read automatically from the PDF. Check each date against the calendar before adding.";
  if (p.method === "CACHE") return "Another family already brought in this exact file, so these dates came straight back. Check them before adding.";
  return "Read from the PDF's text. Check each date against the calendar before adding.";
}
