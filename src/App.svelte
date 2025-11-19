<script lang="ts">
  import { onMount } from "svelte";
  import { theme, initializeTheme } from "./lib/stores/theme";

  import Dashboard from "./lib/pages/Dashboard.svelte";

  onMount(() => {
    initializeTheme();
  });
</script>

<div class="h-screen bg-base-300" data-theme={$theme}>
  <div class="flex flex-col h-full">
    <main class="flex-1 p-4 pb-20 overflow-y-auto">
      <div class="max-w-4xl mx-auto">
        <Dashboard />
      </div>
    </main>
  </div>
</div>
