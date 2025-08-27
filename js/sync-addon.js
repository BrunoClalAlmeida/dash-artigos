// js/sync-addon.js
"use strict";

import {
    pendingIdsFromOutbox,
    drainOutbox,
    refreshFromServer
} from "./core.js";

/** Usa o botão #syncNowBtn se existir. Se não, cria um. */
function getOrMakeSyncButton() {
    let btn = document.getElementById("syncNowBtn");
    if (btn) return btn;

    btn = document.createElement("button");
    btn.id = "syncNowBtn";
    btn.className = "neon-btn px-3";
    Object.assign(btn.style, {
        position: "fixed",
        top: "14px",
        right: "14px",
        zIndex: "100011"
    });
    btn.title = "Sincronizar agora";
    btn.textContent = "Sync";
    document.body.appendChild(btn);
    return btn;
}

function updateSyncBadge(btn) {
    try {
        const n = (pendingIdsFromOutbox() || []).length;
        btn.textContent = n > 0 ? `Sync (${n})` : "Sync";
        btn.disabled = false;
    } catch {
        btn.textContent = "Sync";
    }
}

function markPendingRows() {
    const tbody = document.querySelector("#campaignTable tbody");
    if (!tbody) return;

    const pendSet = new Set(pendingIdsFromOutbox());
    tbody.querySelectorAll("tr").forEach(tr => {
        const id = tr.getAttribute("data-id");
        const actions = tr.querySelector('[data-label="Ações"] .actions');
        if (!actions) return;

        let chip = actions.querySelector(".chip-sync");
        const isPending = id && pendSet.has(id);

        if (isPending && !chip) {
            chip = document.createElement("span");
            chip.className = "chip chip--pill chip-sync";
            chip.textContent = "PENDENTE";
            actions.prepend(chip);
        } else if (!isPending && chip) {
            chip.remove();
        }
    });
}

document.addEventListener("DOMContentLoaded", () => {
    const btn = getOrMakeSyncButton();
    updateSyncBadge(btn);
    markPendingRows();

    btn.addEventListener("click", async () => {
        if (btn.disabled) return;
        const prevText = btn.textContent;
        btn.disabled = true;
        btn.textContent = "Sincronizando..."; // ✅ sem piscar/letra a letra
        try {
            const sent = await drainOutbox(true);
            await refreshFromServer();
            if (window.Swal) {
                window.Swal.fire({
                    toast: true, position: "bottom-end", timer: 1800, showConfirmButton: false,
                    icon: sent > 0 ? "success" : "info",
                    title: sent > 0 ? `Enviadas ${sent} pendências` : "Sincronizado",
                    background: "#0f172a", color: "#e2e8f0"
                });
            }
        } finally {
            btn.disabled = false;
            updateSyncBadge(btn); // volta para "Sync" ou "Sync (N)"
            markPendingRows();
        }
    });

    // atualizações leves
    window.addEventListener("online", () => { updateSyncBadge(btn); markPendingRows(); });
    window.addEventListener("focus", () => { updateSyncBadge(btn); markPendingRows(); });
    window.addEventListener("storage", ev => {
        if (ev && typeof ev.key === "string" && ev.key.includes("dash_artigos_outbox")) {
            updateSyncBadge(btn);
            markPendingRows();
        }
    });
    setInterval(() => { updateSyncBadge(btn); markPendingRows(); }, 3000);
});
