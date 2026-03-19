// Browser-compatible port of Python ImageScanResult / scan_image
// OCR powered by Lovable AI edge function

import { supabase } from "@/integrations/supabase/client";

export interface ImageScanResult {
  path: string;
  format: string | null;
  mode: string | null;
  width: number | null;
  height: number | null;
  ocrText: string | null;
  ocrEngine: string | null;
  warning: string | null;
  dataUrl: string | null;
}

async function extractTextFromImage(dataUrl: string, mimeType: string): Promise<{ text: string | null; engine: string | null; warning: string | null }> {
  try {
    const base64 = dataUrl.split(",")[1];
    if (!base64) return { text: null, engine: null, warning: null };

    const { data, error } = await supabase.functions.invoke("scan-image", {
      body: { imageBase64: base64, mimeType },
    });

    if (error) {
      console.warn("OCR edge function error:", error);
      return { text: null, engine: null, warning: "Could not scan the image right now." };
    }

    return {
      text: data?.extracted_text || null,
      engine: data?.engine || null,
      warning: data?.warning || null,
    };
  } catch (e) {
    console.warn("OCR request failed:", e);
    return { text: null, engine: null, warning: "Could not scan the image right now." };
  }
}

export function scanImage(file: File): Promise<ImageScanResult> {
  return new Promise((resolve) => {
    const path = file.name;
    const format = file.type.split("/")[1]?.toUpperCase() || null;

    if (!file.type.startsWith("image/")) {
      resolve({
        path,
        format: null,
        mode: null,
        width: null,
        height: null,
        ocrText: null,
        ocrEngine: null,
        warning: "File is not an image.",
        dataUrl: null,
      });
      return;
    }

    const reader = new FileReader();
    reader.onerror = () => {
      resolve({
        path,
        format,
        mode: null,
        width: null,
        height: null,
        ocrText: null,
        ocrEngine: null,
        warning: "Failed to read file.",
        dataUrl: null,
      });
    };

    reader.onload = () => {
      const dataUrl = reader.result as string;
      const img = new Image();
      img.onerror = () => {
        resolve({
          path,
          format,
          mode: null,
          width: null,
          height: null,
          ocrText: null,
          ocrEngine: null,
          warning: "Failed to decode image.",
          dataUrl,
        });
      };
      img.onload = async () => {
        const mode = file.type === "image/png" ? "RGBA" : "RGB";

        // Run OCR via edge function
        const { text: ocrText, engine: ocrEngine, warning: ocrWarning } = await extractTextFromImage(dataUrl, file.type);

        resolve({
          path,
          format,
          mode,
          width: img.naturalWidth,
          height: img.naturalHeight,
          ocrText,
          ocrEngine,
          warning: ocrText ? null : (ocrWarning || "No text detected in image."),
          dataUrl,
        });
      };
      img.src = dataUrl;
    };

    reader.readAsDataURL(file);
  });
}
