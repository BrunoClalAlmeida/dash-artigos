// js/bootstrap.js
"use strict";

/**
 * Carrega os módulos principais dinamicamente.
 * Se algum import falhar na Vercel, um toast aparece e o erro fica no console.
 */
(async () => {
  const VERSION = "2025-08-28-2";
  const base = (p) => new URL(p, import.meta.url).href;

  try {
    await Promise.all([
      import(base(`./ui.js?v=${VERSION}`)),
      import(base(`./sync-addon.js?v=${VERSION}`)),
    ]);
    console.debug("[bootstrap] módulos carregados");
  } catch (err) {
    console.error("[bootstrap import error]", err);
    if (window.Swal) {
      Swal.fire({
        toast: true,
        position: "bottom-end",
        timer: 6000,
        showConfirmButton: false,
        icon: "error",
        title: "Falha ao carregar scripts",
        text: (err && err.message) ? err.message : "Veja o console (F12)",
        background: "#0f172a",
        color: "#e2e8f0",
      });
    }
  }
})();
