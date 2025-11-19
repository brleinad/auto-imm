/**
 * OCR API Service
 * Handles text extraction from images using the backend API
 */

import { apiPost, APIError } from './apiClient';

/**
 * Extract text from an image file using the backend OCR API
 * @param file - The image file to process
 * @returns Promise resolving to the extracted text
 * @throws APIError if the request fails
 */
export async function extractTextFromImage(file: File): Promise<string> {
  // Validate file size (20MB limit per backend requirements)
  const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB
  if (file.size > MAX_FILE_SIZE) {
    throw new APIError('File must be less than 20MB');
  }

  // Create FormData with the file
  const formData = new FormData();
  formData.append('file', file);

  try {
    // POST to /api/ocr endpoint
    const extractedText = await apiPost<{ text: string }>('/api/ocr', formData);
    console.log('BOB: ', extractedText)
    return extractedText.text;
  } catch (error) {
    console.error(error)
    if (error instanceof APIError) {
      // Enhance error messages for common issues
      if (error.status === 401) {
        throw new APIError('Authentication failed. Check API credentials.');
      } else if (error.status === 413) {
        throw new APIError('File too large. Maximum size is 20MB.');
      } else if (error.message.includes('Network error')) {
        throw new APIError(
          'Cannot connect to OCR service. Make sure the backend server is running on http://localhost:3233'
        );
      }
    }
    throw error;
  }
}

/**
 * Check if a file type is supported by the OCR API
 * Supported: JPEG, PNG, PDF
 * Note: PDFs are converted to images server-side before processing with Claude
 */
export function isOCRSupported(fileType: string): boolean {
  const supportedTypes = [
    'image/jpeg',
    'image/jpg',
    'image/png',
    'application/pdf',
  ];
  return supportedTypes.includes(fileType.toLowerCase());
}
