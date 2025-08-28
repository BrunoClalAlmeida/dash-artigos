// js/error-handler.js
"use strict";

// Captura erros globais
window.addEventListener("error", (e) => {
  console.error("[global error]", e.error || e.message);
  if (window.Swal) {
    Swal.fire({
      toast: true,
      position: "bottom-end",
      timer: 3500,
      showConfirmButton: false,
      icon: "error",
      title: "Erro de script",
      text: (e.error && e.error.message) || e.message || "Ver console",
      background: "#0f172a",
      color: "#e2e8f0"
    });
  }
});

window.addEventListener("unhandledrejection", (e) => {
  console.error("[unhandledrejection]", e.reason);
  if (window.Swal) {
    Swal.fire({
      toast: true,
      position: "bottom-end",
      timer: 3500,
      showConfirmButton: false,
      icon: "error",
      title: "Falha em promessa",
      text: (e.reason && e.reason.message) || String(e.reason),
      background: "#0f172a",
      color: "#e2e8f0"
    });
  }
});
