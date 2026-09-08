<template><svg class="app-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path :d="paths[name] || paths.grid" /></svg></template>
<script setup>
defineProps({name:{type:String,default:'grid'}})
const paths={
 clock:'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18 M12 7v5l3 2',
 grid:'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
 chart:'M4 3v17h17 M8 15l4-5 4 2 5-7',
 report:'M6 3h9l4 4v14H6z M14 3v5h5 M9 12h7 M9 16h5',
 settings:'M9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1z M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8',
 calendar:'M4 5h16v16H4z M8 3v4 M16 3v4 M4 10h16 M8 14h2 M14 14h2 M8 17h2',
 list:'M9 6h12 M9 12h12 M9 18h12 M3 6h1 M3 12h1 M3 18h1',
 download:'M12 3v12 M7 10l5 5 5-5 M4 16v5h16v-5',
 upload:'M12 15V3 M7 8l5-5 5 5 M4 16v5h16v-5',
 play:'M8 4l12 8-12 8z',
 stop:'M6 6h12v12H6z',
 'chevron-left':'M15 5l-7 7 7 7',
 'chevron-right':'M9 5l7 7-7 7',
 'chevron-down':'M5 9l7 7 7-7',
 check:'M5 12l4 4L19 6',
 close:'M6 6l12 12 M6 18L18 6',
 link:'M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-2 2 M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l2-2',
 trash:'M3 6h18 M9 6V3h6v3 M6 6l1 15h10l1-15 M10 10v7 M14 10v7',
 history:'M3 11a9 9 0 1 1 2 7 M3 4v7h7 M12 7v5l3 2',
 restore:'M4 8h10a6 6 0 0 1 0 12h-4 M8 4L4 8l4 4',
 search:'M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14 M15 15l6 6',
 logout:'M9 3H4v18h5 M10 12h11 M17 8l4 4-4 4',
 globe:'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18 M3 12h18 M12 3c-5 5-5 13 0 18 M12 3c5 5 5 13 0 18'
}
</script>
<style>.app-icon { display:inline-block; width:1.15em; height:1.15em; flex-shrink:0; vertical-align:-.18em; }.app button > .app-icon { margin-right:6px; }.app .nav-icon .app-icon,.app .summary-icon .app-icon,.app .stat-icon .app-icon { width:22px; height:22px; }.app .auth-logo .app-icon { width:42px; height:42px; }.app .sidebar-brand .app-icon { margin-right:8px; }.app .section-title > .app-icon { margin-right:8px; }.app .modal-close .app-icon { margin:0; }</style>
