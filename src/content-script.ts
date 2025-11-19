/**
 * Content Script - Runs in page context to access DOM
 * Handles form extraction and field filling via messaging
 */

interface FieldMapping {
  fieldId: string;
  value: string;
}

interface MessageRequest {
  action: 'getFormHTML' | 'fillFields';
  fields?: FieldMapping[];
}

interface MessageResponse {
  html?: string;
  success?: boolean;
  filled?: number;
  failed?: number;
  error?: string;
}

// Listen for messages from extension (side panel)
chrome.runtime.onMessage.addListener(
  (
    request: MessageRequest,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response: MessageResponse) => void
  ) => {
    try {
      if (request.action === 'getFormHTML') {
        // Extract form HTML from page - synchronous operation
        const form = document.querySelector('form');
        if (form) {
          sendResponse({ html: form.outerHTML });
        } else {
          sendResponse({ html: '', error: 'No form found on page' });
        }
        return true; // Keep channel open for async
      }

      if (request.action === 'fillFields' && request.fields) {
        // Fill form fields with provided values - synchronous operation
        let filled = 0;
        let failed = 0;

        request.fields.forEach((field) => {
          try {
            const element = document.getElementById(field.fieldId);

            if (!element) {
              console.warn(`Field not found: ${field.fieldId}`);
              failed++;
              return;
            }

            // Handle different input types
            if (element instanceof HTMLInputElement) {
              if (element.type === 'radio') {
                // For radio buttons, find the one with matching value
                const radio = document.querySelector(
                  `input[type="radio"][name="${element.name}"][value="${field.value}"]`
                ) as HTMLInputElement;
                if (radio) {
                  radio.checked = true;
                  // Trigger events for framework change detection
                  radio.dispatchEvent(new Event('input', { bubbles: true }));
                  radio.dispatchEvent(new Event('change', { bubbles: true }));
                  radio.dispatchEvent(new Event('blur', { bubbles: true }));
                  filled++;
                } else {
                  console.warn(
                    `Radio button not found: name=${element.name}, value=${field.value}`
                  );
                  failed++;
                }
              } else {
                // Text, number, date, etc.
                element.value = field.value;
                // Trigger events for framework change detection
                element.dispatchEvent(new Event('input', { bubbles: true }));
                element.dispatchEvent(new Event('change', { bubbles: true }));
                element.dispatchEvent(new Event('blur', { bubbles: true }));
                filled++;
              }
            } else if (element instanceof HTMLSelectElement) {
              // Dropdown/select
              element.value = field.value;
              // Trigger events for framework change detection
              element.dispatchEvent(new Event('input', { bubbles: true }));
              element.dispatchEvent(new Event('change', { bubbles: true }));
              element.dispatchEvent(new Event('blur', { bubbles: true }));
              filled++;
            } else if (element instanceof HTMLTextAreaElement) {
              // Textarea
              element.value = field.value;
              // Trigger events for framework change detection
              element.dispatchEvent(new Event('input', { bubbles: true }));
              element.dispatchEvent(new Event('change', { bubbles: true }));
              element.dispatchEvent(new Event('blur', { bubbles: true }));
              filled++;
            } else {
              console.warn(`Unsupported element type for: ${field.fieldId}`);
              failed++;
            }
          } catch (err) {
            console.error(`Error filling field ${field.fieldId}:`, err);
            failed++;
          }
        });

        console.log('Content script form filling complete:', {
          total: request.fields.length,
          filled,
          failed,
        });

        // Send response immediately - all operations are synchronous
        sendResponse({ success: true, filled, failed });
        return true; // Keep channel open
      }

      // Unknown action
      sendResponse({ error: 'Unknown action' });
      return false;
    } catch (error) {
      console.error('Content script error:', error);
      sendResponse({ error: error instanceof Error ? error.message : 'Unknown error' });
      return true;
    }
  }
);

console.log('Auto-Imm content script loaded');
