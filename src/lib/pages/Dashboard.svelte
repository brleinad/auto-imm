<script lang="ts">
  import { onMount } from "svelte";
  import {
    files,
    addFiles,
    removeFile,
    clearAllFiles,
    initializeFiles,
    runOCROnAllFiles,
    runOCROnSpecificFiles,
    ocrProgress,
    ocrRunning,
  } from "../stores/files";
  import { FileUpload, Card, Button, Alert } from "../components/ui";
  import {
    Trash2,
    Image as ImageIcon,
    File as FileIcon,
    FileText,
  } from "../icons";
  import { formatFileSize, getStorageInfo } from "../utils/fileStorage";
  import { isOCRSupported, fillForm } from "../services/ocrApiService";
  import { DEV_FORM_HTML } from "../constants/devFormHTML";

  let uploadStatus = $state<"idle" | "success" | "error">("idle");
  let errorMessage = $state("");
  let successMessage = $state("");
  let expandedOCRFiles = $state<Set<string>>(new Set());
  let formFillStatus = $state<"idle" | "processing" | "success" | "error">(
    "idle",
  );
  let formFillMessage = $state("");
  let fillAttempts = $state(0);
  let isWatchingForm = $state(false);
  const MAX_FILL_ATTEMPTS = 3;

  const storageInfo = getStorageInfo();

  onMount(() => {
    // Load files from storage on component mount
    initializeFiles();

    // Listen for formChanged messages from content script
    const messageListener = (
      message: any,
      sender: chrome.runtime.MessageSender,
      sendResponse: (response?: any) => void
    ) => {
      if (message.action === "formChanged") {
        console.log("Form changed notification received from content script");
        handleFormChanged();
      }
    };

    chrome.runtime.onMessage.addListener(messageListener);

    // Cleanup on unmount
    return () => {
      chrome.runtime.onMessage.removeListener(messageListener);
      stopWatchingForm();
    };
  });

  async function handleRunOCR() {
    await runOCROnAllFiles();
  }

  async function startWatchingForm() {
    try {
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });

      if (!tab?.id) {
        console.warn("No active tab found, cannot start watching form");
        return;
      }

      const response = await chrome.tabs.sendMessage(tab.id, {
        action: "startWatchingForm",
      });

      if (response?.success) {
        isWatchingForm = true;
        console.log("Started watching form for changes");
      } else {
        console.warn("Failed to start watching form");
      }
    } catch (error) {
      console.error("Error starting form watcher:", error);
    }
  }

  async function stopWatchingForm() {
    if (!isWatchingForm) return;

    try {
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });

      if (!tab?.id) {
        isWatchingForm = false;
        return;
      }

      await chrome.tabs.sendMessage(tab.id, {
        action: "stopWatchingForm",
      });

      isWatchingForm = false;
      console.log("Stopped watching form");
    } catch (error) {
      console.error("Error stopping form watcher:", error);
      isWatchingForm = false;
    }
  }

  async function handleFormChanged() {
    // Check if we've exceeded max attempts
    if (fillAttempts >= MAX_FILL_ATTEMPTS) {
      console.log(
        `Max fill attempts (${MAX_FILL_ATTEMPTS}) reached, stopping watcher`,
      );
      await stopWatchingForm();
      return;
    }

    // Check if we're already processing
    if (formFillStatus === "processing") {
      console.log("Form fill already in progress, ignoring change");
      return;
    }

    console.log(
      `Form changed, re-filling (attempt ${fillAttempts + 1}/${MAX_FILL_ATTEMPTS})`,
    );

    // Re-trigger form fill
    await handleFillForm(true);
  }

  function toggleOCRText(fileId: string) {
    if (expandedOCRFiles.has(fileId)) {
      expandedOCRFiles.delete(fileId);
    } else {
      expandedOCRFiles.add(fileId);
    }
    expandedOCRFiles = new Set(expandedOCRFiles); // Trigger reactivity
  }

  const ocrSupportedCount = $derived(
    $files.filter((f) => isOCRSupported(f.type)).length,
  );

  async function handleFilesSelected(selectedFiles: File[]) {
    uploadStatus = "idle";
    errorMessage = "";
    successMessage = "";

    if (selectedFiles.length === 0) return;

    const result = await addFiles(selectedFiles);

    if (result.error) {
      uploadStatus = "error";
      errorMessage = result.error;
      if (result.savedFiles.length > 0) {
        successMessage = `${result.savedFiles.length} file(s) uploaded successfully.`;
      }
    } else {
      uploadStatus = "success";
      successMessage = `${result.savedFiles.length} file(s) uploaded successfully!`;
      // Auto-clear success message after 3 seconds
      setTimeout(() => {
        if (uploadStatus === "success") {
          uploadStatus = "idle";
          successMessage = "";
        }
      }, 3000);
    }

    // Auto-run OCR on newly uploaded files that support it
    if (result.savedFiles.length > 0) {
      const ocrSupportedFileIds = result.savedFiles
        .filter((file) => isOCRSupported(file.type))
        .map((file) => file.id);

      if (ocrSupportedFileIds.length > 0) {
        try {
          await runOCROnSpecificFiles(ocrSupportedFileIds);
        } catch (error) {
          console.error("Auto-OCR failed:", error);
          // Don't show error to user, just log it
          // OCR failure shouldn't block the upload success
        }
      }
    }
  }

  async function handleRemoveFile(fileId: string) {
    const success = await removeFile(fileId);
    if (success) {
      uploadStatus = "idle";
      errorMessage = "";
      successMessage = "";
    }
  }

  async function handleClearAll() {
    if ($files.length === 0) return;

    if (
      confirm(`Are you sure you want to delete all ${$files.length} file(s)?`)
    ) {
      const success = await clearAllFiles();
      if (success) {
        uploadStatus = "idle";
        errorMessage = "";
        successMessage = "";
      }
    }
  }

  function isImage(fileType: string): boolean {
    return fileType.startsWith("image/");
  }

  function isTextFile(fileType: string): boolean {
    return fileType.startsWith("text/") || fileType.includes("document");
  }

  async function handleFillForm(isRefill: boolean = false) {
    // Reset attempts on initial fill (not a refill)
    if (!isRefill) {
      fillAttempts = 0;
      await stopWatchingForm(); // Stop any existing watcher
    }

    formFillStatus = "processing";
    formFillMessage = "";

    try {
      // Get active tab
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });

      if (!tab?.id) {
        throw new Error("No active tab found");
      }

      // Get form HTML - use hardcoded dev HTML or query from page via content script
      const isDev = import.meta.env.DEV;
      let formHTML: string;

      if (isDev) {
        // Development mode: use hardcoded HTML
        formHTML = DEV_FORM_HTML;
        console.log("Using hardcoded dev form HTML");
      } else {
        // Production mode: get form HTML from page via content script
        try {
          const response = await chrome.tabs.sendMessage(tab.id, {
            action: "getFormHTML",
          });

          if (chrome.runtime.lastError) {
            throw new Error(
              `Extension error: ${chrome.runtime.lastError.message}. Try reloading the page.`,
            );
          }

          if (!response) {
            throw new Error(
              "No response from page. Try reloading the page and try again.",
            );
          }

          if (!response.html) {
            throw new Error(
              response.error ||
                "No form found on page. Make sure you're on a page with a form.",
            );
          }

          formHTML = response.html;
        } catch (err) {
          if (
            err instanceof Error &&
            err.message.includes("Receiving end does not exist")
          ) {
            throw new Error(
              "Content script not loaded. Please reload the page and try again.",
            );
          }
          throw err;
        }
      }

      // Collect all OCR text from uploaded files
      const documentsExtractedText = $files
        .filter((file) => file.ocrText)
        .map((file) => `=== ${file.name} ===\n${file.ocrText}`)
        .join("\n\n");

      if (!documentsExtractedText) {
        throw new Error(
          "No OCR text available. Please upload and process documents first.",
        );
      }

      // Call API to get field mappings
      const apiResponse = await fillForm(formHTML, documentsExtractedText);

      if (!apiResponse.fields || apiResponse.fields.length === 0) {
        throw new Error(
          "No matching fields found. Claude couldn't match document data to form fields.",
        );
      }

      // Send field mappings to content script to fill the form
      try {
        const fillResponse = await chrome.tabs.sendMessage(tab.id, {
          action: "fillFields",
          fields: apiResponse.fields,
        });

        if (chrome.runtime.lastError) {
          throw new Error(
            `Extension error: ${chrome.runtime.lastError.message}`,
          );
        }

        if (!fillResponse || !fillResponse.success) {
          throw new Error(
            fillResponse?.error || "Failed to fill form fields",
          );
        }

        formFillStatus = "success";
        const attemptInfo = isRefill ? ` (attempt ${fillAttempts + 1})` : "";
        formFillMessage = `Form filled successfully! ${fillResponse.filled} field(s) filled${fillResponse.failed > 0 ? `, ${fillResponse.failed} failed` : ""}${attemptInfo}.`;

        console.log("Form filling complete:", {
          total: apiResponse.fields.length,
          filled: fillResponse.filled,
          failed: fillResponse.failed,
          attempt: fillAttempts + 1,
        });

        // Increment fill attempts
        fillAttempts++;

        // Start watching for form changes if this is the first fill and we haven't hit max attempts
        if (fillAttempts === 1) {
          await startWatchingForm();
        }
      } catch (err) {
        if (
          err instanceof Error &&
          err.message.includes("Receiving end does not exist")
        ) {
          throw new Error(
            "Lost connection to page. Please reload the page and try again.",
          );
        }
        throw err;
      }

      // Auto-clear success message after 5 seconds
      setTimeout(() => {
        if (formFillStatus === "success") {
          formFillStatus = "idle";
          formFillMessage = "";
        }
      }, 5000);
    } catch (error) {
      formFillStatus = "error";
      formFillMessage =
        error instanceof Error ? error.message : "Failed to fill form";
      console.error("Form fill error:", error);

      // Increment attempts even on error
      if (isRefill) {
        fillAttempts++;
      }

      // Stop watcher if we hit max attempts
      if (fillAttempts >= MAX_FILL_ATTEMPTS) {
        await stopWatchingForm();
      }
    }
  }
</script>

<div class="space-y-6">
  <!-- Header -->
  <div>
    <h1 class="text-3xl font-bold">Auto Immigration Form Filler</h1>
  </div>

  <!-- Alerts -->
  {#if uploadStatus === "success" && successMessage}
    <Alert variant="success" showIcon>
      {successMessage}
    </Alert>
  {/if}

  {#if uploadStatus === "error" && errorMessage}
    <Alert variant="error" showIcon>
      {errorMessage}
      {#if successMessage}
        <div class="mt-2">{successMessage}</div>
      {/if}
    </Alert>
  {/if}

  {#if formFillStatus === "success" && formFillMessage}
    <Alert variant="success" showIcon>
      {formFillMessage}
    </Alert>
  {/if}

  {#if formFillStatus === "error" && formFillMessage}
    <Alert variant="error" showIcon>
      {formFillMessage}
    </Alert>
  {/if}

  <!-- Upload Section -->
  <Card title="Upload Files">
    {#snippet children()}
      <FileUpload multiple={true} onfileschange={handleFilesSelected} />

      <div class="mt-4 text-sm opacity-70">
        <p>
          {#if storageInfo.hasUnlimitedStorage}
            Files are stored using {storageInfo.type} with unlimited capacity. Upload
            as many files as you need!
          {:else}
            Files are stored in {storageInfo.type} (10MB limit). For unlimited storage,
            build and load as a Chrome extension.
          {/if}
        </p>
      </div>
    {/snippet}
  </Card>

  <!-- OCR Progress -->
  {#if $ocrRunning && $ocrProgress}
    <Card title="OCR Processing">
      {#snippet children()}
        <div class="space-y-3">
          <div>
            <div class="flex justify-between text-sm mb-1">
              <span>{$ocrProgress.status}</span>
              <span>{Math.round($ocrProgress.progress * 100)}%</span>
            </div>
            <progress
              class="progress progress-primary w-full"
              value={$ocrProgress.progress * 100}
              max="100"
            ></progress>
          </div>
          <p class="text-sm opacity-70">
            Processing file {$ocrProgress.currentIndex + 1} of {$ocrProgress.totalFiles}
          </p>
        </div>
      {/snippet}
    </Card>
  {/if}

  <!-- Files List -->
  {#if $files.length > 0}
    <Card title="Uploaded Files">
      {#snippet children()}
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          {#each $files as file (file.id)}
            <div class="card bg-base-300 shadow-sm">
              <div class="card-body p-4">
                <div class="flex items-start gap-3">
                  <!-- Preview/Icon -->
                  <div class="flex-shrink-0">
                    {#if isImage(file.type)}
                      <div
                        class="w-16 h-16 rounded overflow-hidden bg-base-100"
                      >
                        <img
                          src={file.dataUrl}
                          alt={file.name}
                          class="w-full h-full object-cover"
                        />
                      </div>
                    {:else}
                      <div
                        class="w-16 h-16 rounded bg-base-100 flex items-center justify-center"
                      >
                        {#if isTextFile(file.type)}
                          <FileText class="w-8 h-8 opacity-70" />
                        {:else}
                          <FileIcon class="w-8 h-8 opacity-70" />
                        {/if}
                      </div>
                    {/if}
                  </div>

                  <!-- File Info -->
                  <div class="flex-1 min-w-0">
                    <h4
                      class="font-semibold text-sm truncate"
                      title={file.name}
                    >
                      {file.name}
                    </h4>
                    <p class="text-xs opacity-70 mt-1">
                      {formatFileSize(file.size)}
                    </p>
                    <p class="text-xs opacity-50 mt-0.5">
                      {file.type || "Unknown type"}
                    </p>
                  </div>

                  <!-- Delete Button -->
                  <button
                    class="btn btn-ghost btn-sm btn-square"
                    onclick={() => handleRemoveFile(file.id)}
                    title="Delete file"
                    disabled={$ocrRunning}
                  >
                    <Trash2 class="w-4 h-4" />
                  </button>
                </div>

                <!-- OCR Results -->
                {#if file.ocrProcessed}
                  <div class="mt-3 pt-3 border-t border-base-200">
                    {#if file.ocrError}
                      <div class="text-xs text-error">
                        <span class="font-semibold">OCR Error:</span>
                        {file.ocrError}
                      </div>
                    {:else if file.ocrText}
                      <div class="space-y-2">
                        <button
                          class="text-xs font-semibold text-primary hover:underline"
                          onclick={() => toggleOCRText(file.id)}
                        >
                          {expandedOCRFiles.has(file.id) ? "▼" : "▶"} Extracted
                          Text
                        </button>
                        {#if expandedOCRFiles.has(file.id)}
                          <div
                            class="text-xs bg-base-100 p-2 rounded max-h-40 overflow-y-auto whitespace-pre-wrap"
                          >
                            {file.ocrText}
                          </div>
                        {/if}
                      </div>
                    {:else}
                      <div class="text-xs opacity-50">No text extracted</div>
                    {/if}
                  </div>
                {/if}
              </div>
            </div>
          {/each}
        </div>
      {/snippet}

      {#snippet actions()}
        <div class="flex gap-2 flex-wrap">
          {#if ocrSupportedCount > 0}
            {#if $ocrRunning}
              Processing OCR...
            {/if}
          {/if}
          <Button
            variant="primary"
            onclick={handleFillForm}
            disabled={formFillStatus === "processing" || $ocrRunning}
            loading={formFillStatus === "processing"}
          >
            {#if formFillStatus === "processing"}
              Filling Form...
            {:else}
              Fill Form
            {/if}
          </Button>
          <Button
            variant="error"
            outline
            onclick={handleClearAll}
            disabled={$ocrRunning}
          >
            Clear All Files
          </Button>
        </div>
      {/snippet}
    </Card>
  {:else}
    <div class="card bg-base-200 shadow-xl">
      <div class="card-body items-center text-center py-12">
        <FileIcon class="w-16 h-16 opacity-30 mb-4" />
        <h3 class="text-lg font-semibold">No files uploaded yet</h3>
        <p class="text-sm opacity-70">
          Upload your first file using the upload zone above
        </p>
      </div>
    </div>
  {/if}
</div>
