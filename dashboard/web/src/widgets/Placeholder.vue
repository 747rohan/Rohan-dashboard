<script setup>
defineProps({ title: String, cls: String });
</script>
<template>
  <div class="widget" :class="cls">
    <h3>// {{ title }}</h3>
    <div class="body"><div class="placeholder">TBD — phase 3</div></div>
  </div>
</template>
