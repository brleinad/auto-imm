/**
 * OCR Service
 * Handles text extraction from images and PDFs using backend API
 */

import { extractTextFromImage, isOCRSupported as isOCRSupportedAPI } from './ocrApiService';
import type { StoredFile } from '../utils/fileStorage';

export interface OCRProgress {
  currentFile: string;
  currentIndex: number;
  totalFiles: number;
  progress: number; // 0-1
  status: string;
}

export type ProgressCallback = (progress: OCRProgress) => void;

/**
 * Convert data URL to File object
 */
function dataUrlToFile(dataUrl: string, filename: string, mimeType: string): File {
  const arr = dataUrl.split(',');
  const bstr = atob(arr[1]);
  let n = bstr.length;
  const u8arr = new Uint8Array(n);
  while (n--) {
    u8arr[n] = bstr.charCodeAt(n);
  }
  return new File([u8arr], filename, { type: mimeType });
}

/**
 * Process a single file with OCR using the backend API
 */
export async function processFileOCR(
  file: StoredFile,
  onProgress?: ProgressCallback
): Promise<string> {
  try {
    // Update progress - starting
    if (onProgress) {
      onProgress({
        currentFile: file.name,
        currentIndex: 0,
        totalFiles: 1,
        progress: 0,
        status: `Processing ${file.name}...`,
      });
    }

    // Convert data URL to File object
    const fileObj = dataUrlToFile(file.dataUrl, file.name, file.type);

    // Call backend API
    const text = await extractTextFromImage(fileObj);

    // Update progress - complete
    if (onProgress) {
      onProgress({
        currentFile: file.name,
        currentIndex: 1,
        totalFiles: 1,
        progress: 1,
        status: `Completed ${file.name}`,
      });
    }

    return text;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(`OCR failed for ${file.name}:`, errorMessage);
    throw error;
  }
}

/**
 * Process multiple files with parallel processing (max 3 concurrent)
 */
export async function processMultipleFilesOCR(
  files: StoredFile[],
  onProgress?: ProgressCallback
): Promise<Map<string, { text?: string; error?: string }>> {
  // Filter to only processable files
  const processableFiles = files.filter((f) => isOCRSupported(f.type));

  if (processableFiles.length === 0) {
    return new Map();
  }

  const results = new Map<string, { text?: string; error?: string }>();
  const concurrencyLimit = 3;

  // Process files with concurrency control
  const processFile = async (file: StoredFile, index: number) => {
    try {
      if (onProgress) {
        onProgress({
          currentFile: file.name,
          currentIndex: index,
          totalFiles: processableFiles.length,
          progress: index / processableFiles.length,
          status: `Processing ${file.name}...`,
        });
      }

      // Convert data URL to File object
      const fileObj = dataUrlToFile(file.dataUrl, file.name, file.type);

      // Call backend API
      const text = await extractTextFromImage(fileObj);

      results.set(file.id, { text });

      if (onProgress) {
        onProgress({
          currentFile: file.name,
          currentIndex: index + 1,
          totalFiles: processableFiles.length,
          progress: (index + 1) / processableFiles.length,
          status: `Completed ${file.name}`,
        });
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error(`OCR failed for ${file.name}:`, errorMessage);
      results.set(file.id, { error: errorMessage });

      if (onProgress) {
        onProgress({
          currentFile: file.name,
          currentIndex: index + 1,
          totalFiles: processableFiles.length,
          progress: (index + 1) / processableFiles.length,
          status: `Failed: ${file.name}`,
        });
      }
    }
  };

  // Process in batches of concurrencyLimit
  for (let i = 0; i < processableFiles.length; i += concurrencyLimit) {
    const batch = processableFiles.slice(i, i + concurrencyLimit);
    await Promise.all(batch.map((file, batchIndex) => processFile(file, i + batchIndex)));
  }

  return results;
}

/**
 * Check if a file type is supported for OCR
 */
export function isOCRSupported(fileType: string): boolean {
  return isOCRSupportedAPI(fileType);
}
