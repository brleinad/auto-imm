import { writable } from 'svelte/store';
import type { StoredFile } from '../utils/fileStorage';
import {
  getAllFiles,
  saveFiles as saveFilesToStorage,
  deleteFile as deleteFileFromStorage,
  deleteAllFiles as deleteAllFilesFromStorage,
  updateFileOCR,
} from '../utils/fileStorage';
import {
  processMultipleFilesOCR,
  type OCRProgress,
} from '../services/ocrService';

// Create the writable store starting with empty array
export const files = writable<StoredFile[]>([]);

// OCR progress tracking
export const ocrProgress = writable<OCRProgress | null>(null);
export const ocrRunning = writable<boolean>(false);

// Initialize files from Chrome storage asynchronously
export async function initializeFiles(): Promise<void> {
  const storedFiles = await getAllFiles();
  files.set(storedFiles);
}

// Listen for storage changes from other parts of the extension
if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local' && changes['extension-files']) {
      const newFiles = changes['extension-files'].newValue || [];
      files.set(newFiles);
    }
  });
}

/**
 * Add new files to the store and save to Chrome storage
 * @returns Promise with saved files and any error message
 */
export async function addFiles(
  newFiles: File[]
): Promise<{ savedFiles: StoredFile[]; error?: string }> {
  try {
    const savedFiles = await saveFilesToStorage(newFiles);

    // Refresh from storage to get the latest state
    await refreshFiles();

    // Check if some files failed to save
    if (savedFiles.length < newFiles.length) {
      return {
        savedFiles,
        error: `Only ${savedFiles.length} of ${newFiles.length} files were saved. Storage quota may be exceeded.`,
      };
    }

    return { savedFiles };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Failed to save files';
    return { savedFiles: [], error: errorMessage };
  }
}

/**
 * Remove a file from the store and Chrome storage
 */
export async function removeFile(fileId: string): Promise<boolean> {
  const success = await deleteFileFromStorage(fileId);

  if (success) {
    await refreshFiles();
  }

  return success;
}

/**
 * Clear all files from the store and Chrome storage
 */
export async function clearAllFiles(): Promise<boolean> {
  const success = await deleteAllFilesFromStorage();

  if (success) {
    files.set([]);
  }

  return success;
}

/**
 * Refresh the files from Chrome storage
 * Useful if files were modified outside the store
 */
export async function refreshFiles(): Promise<void> {
  const allFiles = await getAllFiles();
  files.set(allFiles);
}

/**
 * Run OCR on all uploaded files
 * Updates files with extracted text and logs consolidated results
 */
export async function runOCROnAllFiles(): Promise<void> {
  const allFiles = await getAllFiles();

  if (allFiles.length === 0) {
    console.log('No files to process');
    return;
  }

  ocrRunning.set(true);
  ocrProgress.set({
    currentFile: '',
    currentIndex: 0,
    totalFiles: allFiles.length,
    progress: 0,
    status: 'Starting OCR processing...',
  });

  try {
    // Process all files
    const results = await processMultipleFilesOCR(allFiles, (progress) => {
      ocrProgress.set(progress);
    });

    // Update each file with OCR results
    for (const [fileId, result] of results.entries()) {
      await updateFileOCR(fileId, result.text, result.error);
    }

    // Refresh files to show updated data
    await refreshFiles();

    // Console.log consolidated results
    console.log('=== OCR Processing Complete ===');
    console.log(`Processed ${results.size} files\n`);

    const updatedFiles = await getAllFiles();
    updatedFiles.forEach((file) => {
      if (file.ocrProcessed) {
        console.log(`\n--- ${file.name} ---`);
        if (file.ocrError) {
          console.log(`Error: ${file.ocrError}`);
        } else if (file.ocrText) {
          console.log(file.ocrText);
        } else {
          console.log('No text extracted');
        }
      }
    });

    console.log('\n=== End of OCR Results ===');

    ocrProgress.set({
      currentFile: '',
      currentIndex: allFiles.length,
      totalFiles: allFiles.length,
      progress: 1,
      status: 'OCR processing complete!',
    });
  } catch (error) {
    console.error('OCR processing failed:', error);
    ocrProgress.set({
      currentFile: '',
      currentIndex: 0,
      totalFiles: allFiles.length,
      progress: 0,
      status: 'OCR processing failed',
    });
  } finally {
    ocrRunning.set(false);
  }
}

/**
 * Run OCR on specific files by their IDs
 * Updates files with extracted text and logs consolidated results
 * @param fileIds - Array of file IDs to process
 */
export async function runOCROnSpecificFiles(fileIds: string[]): Promise<void> {
  if (fileIds.length === 0) {
    console.log('No files to process');
    return;
  }

  // Get all files and filter to only the specified IDs
  const allFiles = await getAllFiles();
  const filesToProcess = allFiles.filter((file) => fileIds.includes(file.id));

  if (filesToProcess.length === 0) {
    console.log('No matching files found to process');
    return;
  }

  ocrRunning.set(true);
  ocrProgress.set({
    currentFile: '',
    currentIndex: 0,
    totalFiles: filesToProcess.length,
    progress: 0,
    status: 'Starting OCR processing...',
  });

  try {
    // Process specific files
    const results = await processMultipleFilesOCR(filesToProcess, (progress) => {
      ocrProgress.set(progress);
    });

    // Update each file with OCR results
    for (const [fileId, result] of results.entries()) {
      await updateFileOCR(fileId, result.text, result.error);
    }

    // Refresh files to show updated data
    await refreshFiles();

    // Console.log consolidated results
    console.log('=== OCR Processing Complete ===');
    console.log(`Processed ${results.size} files\n`);

    const updatedFiles = await getAllFiles();
    updatedFiles.forEach((file) => {
      if (file.ocrProcessed && fileIds.includes(file.id)) {
        console.log(`\n--- ${file.name} ---`);
        if (file.ocrError) {
          console.log(`Error: ${file.ocrError}`);
        } else if (file.ocrText) {
          console.log(file.ocrText);
        } else {
          console.log('No text extracted');
        }
      }
    });

    console.log('\n=== End of OCR Results ===');

    ocrProgress.set({
      currentFile: '',
      currentIndex: filesToProcess.length,
      totalFiles: filesToProcess.length,
      progress: 1,
      status: 'OCR processing complete!',
    });
  } catch (error) {
    console.error('OCR processing failed:', error);
    ocrProgress.set({
      currentFile: '',
      currentIndex: 0,
      totalFiles: filesToProcess.length,
      progress: 0,
      status: 'OCR processing failed',
    });
  } finally {
    ocrRunning.set(false);
  }
}
