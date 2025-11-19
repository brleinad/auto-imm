/**
 * File Storage Utility
 * Handles storing and retrieving files from Chrome Storage API or localStorage
 * Files are converted to base64 data URLs for storage
 *
 * - In production (Chrome extension): Uses chrome.storage.local with unlimited storage
 * - In development: Falls back to localStorage (10MB limit)
 */

export interface StoredFile {
  id: string;
  name: string;
  type: string;
  size: number;
  dataUrl: string;
  uploadDate: string;
  ocrText?: string;
  ocrProcessed?: boolean;
  ocrError?: string;
}

const STORAGE_KEY = 'extension-files';

/**
 * Check if Chrome Storage API is available
 */
function isChromeStorageAvailable(): boolean {
  return typeof chrome !== 'undefined' &&
         chrome.storage !== undefined &&
         chrome.storage.local !== undefined;
}

/**
 * Convert a File to a data URL (base64)
 */
export async function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/**
 * Generate a unique ID for a file
 */
function generateFileId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Get all stored files from storage (Chrome or localStorage)
 */
async function getStoredFiles(): Promise<StoredFile[]> {
  try {
    if (isChromeStorageAvailable()) {
      // Use Chrome Storage API
      const result = await chrome.storage.local.get(STORAGE_KEY);
      return result[STORAGE_KEY] || [];
    } else {
      // Fallback to localStorage
      const data = localStorage.getItem(STORAGE_KEY);
      return data ? JSON.parse(data) : [];
    }
  } catch (error) {
    console.error('Error reading files from storage:', error);
    return [];
  }
}

/**
 * Save all files to storage (Chrome or localStorage)
 */
async function setStoredFiles(files: StoredFile[]): Promise<void> {
  try {
    if (isChromeStorageAvailable()) {
      // Use Chrome Storage API
      await chrome.storage.local.set({ [STORAGE_KEY]: files });
    } else {
      // Fallback to localStorage
      localStorage.setItem(STORAGE_KEY, JSON.stringify(files));
    }
  } catch (error) {
    console.error('Error saving files to storage:', error);
    throw error;
  }
}

/**
 * Save a file to storage
 * @throws Error if storage quota is exceeded
 */
export async function saveFile(file: File): Promise<StoredFile> {
  try {
    const id = generateFileId();
    const dataUrl = await fileToDataUrl(file);

    const storedFile: StoredFile = {
      id,
      name: file.name,
      type: file.type,
      size: file.size,
      dataUrl,
      uploadDate: new Date().toISOString(),
    };

    // Get existing files and add the new one
    const existingFiles = await getStoredFiles();
    existingFiles.push(storedFile);
    await setStoredFiles(existingFiles);

    return storedFile;
  } catch (error) {
    if (error instanceof Error && error.name === 'QuotaExceededError') {
      const storageType = isChromeStorageAvailable() ? 'Chrome storage' : 'localStorage (10MB limit)';
      throw new Error(`Storage quota exceeded in ${storageType}. Please remove some files and try again.`);
    }
    throw error;
  }
}

/**
 * Save multiple files to storage
 */
export async function saveFiles(files: File[]): Promise<StoredFile[]> {
  const savedFiles: StoredFile[] = [];
  const errors: Error[] = [];

  for (const file of files) {
    try {
      const saved = await saveFile(file);
      savedFiles.push(saved);
    } catch (error) {
      errors.push(error instanceof Error ? error : new Error('Unknown error'));
      // Stop on quota exceeded error
      if (error instanceof Error && error.message.includes('Storage quota exceeded')) {
        break;
      }
    }
  }

  if (errors.length > 0 && savedFiles.length === 0) {
    throw errors[0];
  }

  return savedFiles;
}

/**
 * Get a file from storage by ID
 */
export async function getFile(id: string): Promise<StoredFile | null> {
  try {
    const files = await getStoredFiles();
    return files.find(f => f.id === id) || null;
  } catch (error) {
    console.error('Error reading file:', error);
    return null;
  }
}

/**
 * Get all stored files
 */
export async function getAllFiles(): Promise<StoredFile[]> {
  return getStoredFiles();
}

/**
 * Update a file's OCR data
 */
export async function updateFileOCR(
  id: string,
  ocrText?: string,
  ocrError?: string
): Promise<boolean> {
  try {
    const files = await getStoredFiles();
    const fileIndex = files.findIndex(file => file.id === id);

    if (fileIndex === -1) {
      console.error('File not found:', id);
      return false;
    }

    files[fileIndex] = {
      ...files[fileIndex],
      ocrText,
      ocrError,
      ocrProcessed: true,
    };

    await setStoredFiles(files);
    return true;
  } catch (error) {
    console.error('Error updating file OCR:', error);
    return false;
  }
}

/**
 * Delete a file from storage
 */
export async function deleteFile(id: string): Promise<boolean> {
  try {
    const files = await getStoredFiles();
    const updatedFiles = files.filter(file => file.id !== id);
    await setStoredFiles(updatedFiles);
    return true;
  } catch (error) {
    console.error('Error deleting file:', error);
    return false;
  }
}

/**
 * Delete all stored files
 */
export async function deleteAllFiles(): Promise<boolean> {
  try {
    if (isChromeStorageAvailable()) {
      await chrome.storage.local.remove(STORAGE_KEY);
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
    return true;
  } catch (error) {
    console.error('Error deleting all files:', error);
    return false;
  }
}

/**
 * Get the total size of all stored files in bytes
 */
export async function getTotalStorageSize(): Promise<number> {
  const files = await getStoredFiles();
  return files.reduce((total, file) => total + file.size, 0);
}

/**
 * Format bytes to human-readable size
 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 Bytes';

  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
}

/**
 * Get storage type info for display
 */
export function getStorageInfo(): { type: string; hasUnlimitedStorage: boolean } {
  if (isChromeStorageAvailable()) {
    return {
      type: 'Chrome Storage API',
      hasUnlimitedStorage: true,
    };
  }
  return {
    type: 'localStorage',
    hasUnlimitedStorage: false,
  };
}
