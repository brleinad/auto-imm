<script lang="ts">
  import { Upload } from '../../icons';

  interface Props {
    accept?: string;
    multiple?: boolean;
    disabled?: boolean;
    class?: string;
    onfileschange?: (files: File[]) => void;
  }

  let {
    accept = '*/*',
    multiple = false,
    disabled = false,
    class: className = '',
    onfileschange,
    ...rest
  }: Props = $props();

  let isDragging = $state(false);
  let fileInput: HTMLInputElement;

  function handleDragEnter(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!disabled) {
      isDragging = true;
    }
  }

  function handleDragLeave(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!disabled) {
      isDragging = false;
    }
  }

  function handleDragOver(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
  }

  function handleDrop(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();

    if (disabled) return;

    isDragging = false;

    const droppedFiles = e.dataTransfer?.files;
    if (droppedFiles && droppedFiles.length > 0) {
      const filesArray = Array.from(droppedFiles);
      handleFiles(filesArray);
    }
  }

  function handleInputChange(e: Event) {
    const target = e.target as HTMLInputElement;
    const selectedFiles = target.files;

    if (selectedFiles && selectedFiles.length > 0) {
      const filesArray = Array.from(selectedFiles);
      handleFiles(filesArray);
    }

    // Reset input so same file can be selected again
    target.value = '';
  }

  function handleFiles(filesArray: File[]) {
    if (onfileschange) {
      onfileschange(filesArray);
    }
  }

  function handleClick() {
    if (!disabled && fileInput) {
      fileInput.click();
    }
  }

  const containerClasses = $derived([
    'relative flex flex-col items-center justify-center',
    'border-2 border-dashed rounded-lg',
    'transition-all duration-200',
    'cursor-pointer',
    'p-8',
    isDragging
      ? 'border-primary bg-primary/10 scale-[1.02]'
      : 'border-base-300 hover:border-primary/50 hover:bg-base-300/50',
    disabled && 'opacity-50 cursor-not-allowed',
    className,
  ].filter(Boolean).join(' '));

  const iconContainerClasses = $derived([
    'p-4 rounded-full transition-colors',
    isDragging ? 'bg-primary/20' : 'bg-base-300',
  ].join(' '));

  const iconClasses = $derived([
    'w-8 h-8',
    isDragging && 'text-primary',
  ].filter(Boolean).join(' '));
</script>

<div
  role="button"
  tabindex={disabled ? -1 : 0}
  class={containerClasses}
  ondragenter={handleDragEnter}
  ondragleave={handleDragLeave}
  ondragover={handleDragOver}
  ondrop={handleDrop}
  onclick={handleClick}
  onkeydown={(e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleClick();
    }
  }}
  {...rest}
>
  <input
    bind:this={fileInput}
    type="file"
    {accept}
    {multiple}
    {disabled}
    onchange={handleInputChange}
    class="hidden"
    aria-label="File upload input"
  />

  <div class="flex flex-col items-center gap-3">
    <div class={iconContainerClasses}>
      <Upload class={iconClasses} />
    </div>

    <div class="text-center">
      <p class="font-semibold text-lg">
        {#if isDragging}
          Drop files here
        {:else}
          Drop files or click to browse
        {/if}
      </p>
      <p class="text-sm opacity-70 mt-1">
        {multiple ? 'Select one or more files' : 'Select a file'}
      </p>
    </div>
  </div>
</div>
