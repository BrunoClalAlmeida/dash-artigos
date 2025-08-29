// js/ui.js
"use strict";

import {
    WEB_APP_URL, SHEETS_KEY,
    DELETE_PASSWORD, CASE_INSENSITIVE, PASS_NORM, normalizeForCompare, // continua importado mas não usado
    SERVER_REFRESH_MS, RETRY_INTERVAL_MS,
    campanhas, saveData,
    uid, esc, sanitizeURL,
    sendToSheets, drainOutbox, refreshFromServer, enqueue,
    flushOutboxKeepalive
} from "./core.js";

/**
 * Dash Artigos — UI completo (exclusão sem senha):
 * - Servidor como verdade (merge remoto autoritativo)
 * - Sync entre dispositivos (polling 5s + refresh pós-ação)
 * - Outbox com backoff e keepalive
 * - Exclusão: apenas confirmação (SEM senha)
 * - Botão de conexão: gira o ícone do próprio botão (sem spinner extra)
 * - Botão de Sync: “Sincronizando...” (estático), sem piscas/letras
 * - Botão Salvar: “Salvando...” (estático), sem spinner
 * - Tabela responsiva, tooltips e dropdown customizados
 */

let render; // definido após init()

function startUI() {
    const form = document.getElementById("campaignForm");
    const tbody = document.querySelector("#campaignTable tbody");
    const connBtn = document.getElementById("connCheckBtn");
    const syncBtn = document.getElementById("syncNowBtn");
    const paisInput = document.getElementById("pais");
    const idiomaInput = document.getElementById("idioma");
    const categoriaInput = document.getElementById("categoria");

    // ===== helper link
    function linkBtn(label, url) {
        const u = sanitizeURL(url); if (!u) return "";
        return `
      <a href="${u}" class="link-btn" target="_blank" rel="noopener noreferrer"
         aria-label="${esc(label)}" title="Abrir ${esc(label)}">
        <span>${esc(label)}</span>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M7 17L17 7"></path><path d="M9 7h8v8"></path>
        </svg>
      </a>`;
    }

    /* =========================
       Render da tabela
    ========================= */
    render = function render() {
        tbody.innerHTML = "";
        campanhas.forEach((c, i) => {
            const idxStr = String(i + 1);
            const isActive = (c.status || "ATIVO") === "ATIVO";

            const tr = document.createElement("tr");
            tr.dataset.id = c.id;
            tr.setAttribute("data-status", c.status || "ATIVO");

            const editDisabledAttr = isActive ? "" : "disabled";
            const editTitle = isActive ? "Editar registro" : "Edição bloqueada (linha INATIVO)";
            const statusCls = isActive ? "neon-del" : "neon-ok";
            const statusText = isActive ? "Desativar" : "Ativar";
            const statusAria = String(isActive);
            const statusTitle = isActive ? "Desativar registro" : "Ativar registro";

            tr.innerHTML = `
        <td class="px-6 py-4" data-label="Tema">
          <div class="tema-cell" data-id="${c.id}">
            <span class="tema-index">${idxStr}</span>
            <span class="tema-text tema-ellipsis">${esc(c.tema)}</span>
          </div>
        </td>
        <td class="px-6 py-4" data-label="Categoria"><span class="neon-label">${esc(c.categoria || "")}</span></td>
        <td class="px-6 py-4" data-label="Artigo">${linkBtn("Ver", c.link_artigo)}</td>
        <td class="px-6 py-4" data-label="Drive">${linkBtn("Drive", c.link_drive)}</td>
        <td class="px-6 py-4" data-label="País"><span class="neon-label">${esc(c.pais)}</span></td>
        <td class="px-6 py-4" data-label="Idioma"><span class="chip chip--pill chip--hollow">${esc(c.idioma)}</span></td>
        <td class="px-6 py-4" data-label="Criativos">${linkBtn("Criativos", c.link_criativos)}</td>
        <td class="px-6 py-4" data-label="Plataforma"><span class="chip chip--pill">${esc(c.plataforma || "")}</span></td>
        <td class="px-6 py-4" data-label="Ações">
          <div class="actions">
            <button class="neon-btn neon-edit px-3 btn-edit"
                    data-index="${i}"
                    ${editDisabledAttr}
                    title="${editTitle}">Editar</button>

            <button class="neon-btn ${statusCls} px-3 btn-status"
                    data-index="${i}"
                    aria-pressed="${statusAria}"
                    title="${statusTitle}">${statusText}</button>

            <button class="neon-btn neon-trash px-3 btn-delete"
                    data-index="${i}"
                    title="Excluir registro">Excluir</button>
          </div>
        </td>
      `;
            tbody.appendChild(tr);
        });
    };

    /* =========================
       Ações na tabela
    ========================= */
    tbody.addEventListener("click", async (e) => {
        const btnEdit = e.target.closest(".btn-edit");
        if (btnEdit) {
            if (btnEdit.hasAttribute("disabled")) {
                Swal.fire({
                    toast: true, position: "bottom-end", timer: 1800, showConfirmButton: false, icon: "info",
                    title: "Edição bloqueada — linha INATIVA", background: "#0f172a", color: "#e2e8f0"
                });
                return;
            }
            const i = Number(btnEdit.dataset.index);
            const c = campanhas[i]; if (!c) return;
            document.getElementById("editIndex").value = i;
            form.tema.value = c.tema;
            form.link_artigo.value = c.link_artigo;
            form.link_drive.value = c.link_drive;
            paisInput.value = c.pais;
            form.plataforma.value = c.plataforma || "";
            form.link_criativos.value = c.link_criativos;
            idiomaInput.value = c.idioma;
            categoriaInput.value = c.categoria || "";
            Swal.fire({
                toast: true, position: "bottom-end", timer: 1400, showConfirmButton: false, icon: "info",
                title: "Editando registro…", background: "#0f172a", color: "#e2e8f0"
            });
            form.tema.focus();
            return;
        }

        const btnStatus = e.target.closest(".btn-status");
        if (btnStatus) {
            const i = Number(btnStatus.dataset.index);
            const c = campanhas[i]; if (!c) return;
            const newStatus = (c.status === "ATIVO") ? "INATIVO" : "ATIVO";
            const updated = { ...c, status: newStatus };
            campanhas[i] = updated; saveData(); render();

            const rowBtn = tbody.querySelector(`tr[data-id="${c.id}"] .btn-status`);
            if (rowBtn) rowBtn.setAttribute("aria-pressed", String(newStatus === "ATIVO"));

            try {
                await sendToSheets({ id: c.id, status: newStatus }, "update");
                await refreshFromServer(render);
                Swal.fire({
                    toast: true, position: "bottom-end", timer: 1800, showConfirmButton: false,
                    icon: (newStatus === "ATIVO" ? "success" : "info"), title: `Status: ${newStatus}`,
                    background: "#0f172a", color: "#e2e8f0"
                });
            } catch {
                enqueue({ id: c.id, status: newStatus }, "update");
                Swal.fire({
                    toast: true, position: "bottom-end", timer: 2400, showConfirmButton: false, icon: "warning",
                    title: `Sem conexão — status em fila (${newStatus})`, background: "#0f172a", color: "#e2e8f0"
                });
            }
            return;
        }

        const btnDelete = e.target.closest(".btn-delete");
        if (btnDelete) {
            const index = Number(btnDelete.dataset.index);
            const c = campanhas[index]; if (!c) return;

            // === SOMENTE CONFIRMAÇÃO (sem senha) ===
            const ask = await Swal.fire({
                customClass: { popup: "dark-modal", confirmButton: "neon-btn neon-danger", cancelButton: "neon-btn neon-save" },
                background: "#0f172a", color: "#e2e8f0",
                icon: "warning", title: "Excluir este registro?",
                html: `Tem certeza que deseja <b>excluir definitivamente</b> este cadastro?<br><br>
               <span class="neon-label">Tema:</span> <b>${esc(c.tema)}</b>`,
                showCancelButton: true, confirmButtonText: "Sim, excluir", cancelButtonText: "Cancelar", reverseButtons: true
            });
            if (!ask.isConfirmed) return;

            // exclusão local
            campanhas.splice(index, 1); saveData(); render();
            const editIdxEl = document.getElementById("editIndex");
            if (editIdxEl && Number(editIdxEl.value) === index) { form.reset(); editIdxEl.value = -1; }

            try {
                await sendToSheets({ id: c.id }, "delete");
                await refreshFromServer(render);
                Swal.fire({
                    toast: true, position: "bottom-end", timer: 1800, showConfirmButton: false,
                    icon: "success", title: "Excluído da planilha", background: "#0f172a", color: "#e2e8f0"
                });
            } catch {
                enqueue({ id: c.id }, "delete");
                Swal.fire({
                    toast: true, position: "bottom-end", timer: 2600, showConfirmButton: false,
                    icon: "warning", title: "Sem conexão — exclusão em fila", background: "#0f172a", color: "#e2e8f0"
                });
            }
        }
    });

    /* =========================
       Submit do formulário (Salvar)
    ========================= */
    form.addEventListener("submit", async (e) => {
        e.preventDefault();

        const submitBtn = form.querySelector('button[type="submit"]');
        const originalSubmitTxt = submitBtn ? submitBtn.textContent : "";

        // UI: texto estático, sem spinner
        if (submitBtn) {
            submitBtn.textContent = "Salvando...";
            submitBtn.setAttribute("aria-busy", "true");
            submitBtn.disabled = true;
        }

        const idxRaw = document.getElementById("editIndex").value.trim();
        const idx = Number.isNaN(parseInt(idxRaw, 10)) ? -1 : parseInt(idxRaw, 10);
        const existing = (idx >= 0) ? campanhas[idx] : null;

        const safeArtigo = sanitizeURL(form.link_artigo.value.trim());
        const safeDrive = sanitizeURL(form.link_drive.value.trim());
        const safeCriativos = sanitizeURL(form.link_criativos.value.trim());

        const data = {
            id: existing?.id || uid(),
            status: existing?.status || "ATIVO",
            tema: form.tema.value.trim(),
            categoria: categoriaInput.value.trim(),
            link_artigo: safeArtigo || form.link_artigo.value.trim(),
            link_drive: safeDrive || form.link_drive.value.trim(),
            pais: paisInput.value.trim(),
            plataforma: form.plataforma.value.trim(),
            link_criativos: safeCriativos || form.link_criativos.value.trim(),
            idioma: idiomaInput.value.trim()
            // updated vem do servidor
        };

        const op = existing ? "update" : "insert";
        if (existing) campanhas[idx] = data; else campanhas.push(data);
        saveData(); render();

        try {
            await sendToSheets(data, op);
            await refreshFromServer(render);
            Swal.fire({
                customClass: { popup: "dark-modal", confirmButton: "neon-btn neon-save" },
                background: "#0f172a", color: "#e2e8f0",
                icon: "success", title: existing ? "Atualizado!" : "Enviado!",
                text: "Sincronizado com o Google Sheets.", confirmButtonText: "OK"
            });
        } catch (err) {
            enqueue(data, op);
            Swal.fire({
                customClass: { popup: "dark-modal", confirmButton: "neon-btn neon-save" },
                background: "#0f172a", color: "#e2e8f0",
                icon: "warning", title: "Sem conexão com o Sheets",
                text: `Registro salvo localmente e colocado na fila. Detalhe: ${err.message}`, confirmButtonText: "OK"
            });
        } finally {
            if (submitBtn) {
                submitBtn.textContent = originalSubmitTxt || "Salvar Campanha";
                submitBtn.removeAttribute("aria-busy");
                submitBtn.disabled = false;
            }
        }

        form.reset(); document.getElementById("editIndex").value = -1;
        render();

        const sent = await drainOutbox(true);
        if (sent > 0) await refreshFromServer(render);
    });

    /* =========================
       Datalist dropdown custom (igual)
    ========================= */
    const activeDD = { el: null, input: null, listId: null };
    let skipNextBlurClose = false;
    let hoveringDD = false;

    const cssRoot = () => getComputedStyle(document.documentElement);
    const numVar = (name, fallback) => {
        const raw = cssRoot().getPropertyValue(name).trim();
        const n = parseFloat(raw || ""); return Number.isFinite(n) ? n : fallback;
    };
    const ddOffsetY = () => numVar("--dd-offset-y", 6);

    function positionDD(dd, input) {
        const rect = input.getBoundingClientRect();
        dd.style.minWidth = rect.width + "px";
        dd.style.left = (rect.left + window.scrollX) + "px";
        dd.style.top = (rect.bottom + window.scrollY + ddOffsetY()) + "px";
    }
    function buildDD(listId, anchorInput) {
        const dl = document.getElementById(listId); if (!dl) return null;
        const dd = document.createElement("div"); dd.className = "mini-dd";
        positionDD(dd, anchorInput);
        dd.addEventListener("mouseenter", () => { hoveringDD = true; });
        dd.addEventListener("mouseleave", () => { hoveringDD = false; });
        const ul = document.createElement("ul");
        Array.from(dl.options).forEach(opt => {
            const li = document.createElement("li");
            li.textContent = opt.value || opt.label || "";
            li.addEventListener("mousedown", (ev) => {
                ev.preventDefault(); anchorInput.value = li.textContent; closeDD();
                anchorInput.dispatchEvent(new Event("change", { bubbles: true }));
            });
            ul.appendChild(li);
        });
        dd.appendChild(ul); document.body.appendChild(dd);
        requestAnimationFrame(() => dd.classList.add("open"));
        return dd;
    }
    function closeDD() {
        if (activeDD.el) {
            activeDD.el.remove(); activeDD.el = null;
            if (activeDD.input && activeDD.listId) activeDD.input.setAttribute("list", activeDD.listId);
            activeDD.input = null; activeDD.listId = null; hoveringDD = false;
        }
    }
    function openDD(input) {
        const listId = input.getAttribute("list"); if (!listId) return;
        input.setAttribute("data-real-list", listId); input.setAttribute("list", "");
        const dd = buildDD(listId, input);
        activeDD.el = dd; activeDD.input = input; activeDD.listId = listId;
    }
    document.addEventListener("mousedown", (ev) => {
        if (activeDD.el) {
            const inside = activeDD.el.contains(ev.target) || activeDD.input === ev.target;
            if (!inside) closeDD();
        }
    });
    document.addEventListener("scroll", (ev) => {
        if (!activeDD.el) return;
        if (activeDD.el.contains(ev.target) || hoveringDD) return;
        closeDD();
    }, true);
    window.addEventListener("resize", () => { if (activeDD.el && activeDD.input) positionDD(activeDD.el, activeDD.input); });
    document.querySelectorAll("input[list]").forEach(inp => {
        inp.addEventListener("pointerdown", () => { if (!activeDD.el) openDD(inp); skipNextBlurClose = true; });
        inp.addEventListener("focus", () => { if (!activeDD.el) openDD(inp); });
        inp.addEventListener("click", () => { if (!activeDD.el) openDD(inp); });
        inp.addEventListener("input", () => {
            if (!activeDD.el) return;
            const dl = document.getElementById(activeDD.listId);
            const term = inp.value.toLowerCase();
            const ul = activeDD.el.querySelector("ul");
            ul.innerHTML = "";
            Array.from(dl.options).forEach(opt => {
                const v = (opt.value || "").toLowerCase();
                if (!term || v.includes(term)) {
                    const li = document.createElement("li");
                    li.textContent = opt.value || opt.label || "";
                    li.addEventListener("mousedown", (ev) => {
                        ev.preventDefault(); inp.value = li.textContent; closeDD();
                        inp.dispatchEvent(new Event("change", { bubbles: true }));
                    });
                    ul.appendChild(li);
                }
            });
        });
        inp.addEventListener("blur", () => {
            if (skipNextBlurClose) { skipNextBlurClose = false; return; }
            setTimeout(closeDD, 120);
        });
    });

    /* =========================
       Tooltip (igual)
    ========================= */
    const tip = document.createElement("div"); tip.className = "tip-layer"; document.body.appendChild(tip);
    let tipTarget = null;
    function positionTip(el) {
        const pad = 10, off = 10;
        const r = el.getBoundingClientRect(); const centerX = r.left + r.width / 2;
        const tw = tip.offsetWidth, th = tip.offsetHeight;
        let pos = "top"; let yTop = r.top - off, yBottom = r.bottom + off, y;
        if (yTop - th < pad) {
            if (yBottom + th <= window.innerHeight - pad) { pos = "bottom"; y = yBottom; }
            else { pos = "top"; y = Math.max(pad + th, yTop); }
        } else { pos = "top"; y = yTop; }
        tip.dataset.pos = pos; tip.style.top = `${y}px`;
        const xMin = pad + tw / 2, xMax = window.innerWidth - pad - tw / 2;
        const x = Math.min(Math.max(centerX, xMin), xMax); const shift = x - centerX;
        tip.style.left = `${x}px`; tip.style.setProperty("--arrow-shift", `${-shift}px`);
    }
    function showTipFor(el, text) {
        if (!text) return; tipTarget = el; tip.innerHTML = text.replace(/\n/g, "<br>");
        positionTip(el); tip.setAttribute("data-show", "true");
    }
    function hideTip() { tipTarget = null; tip.removeAttribute("data-show"); }
    function enterHandler(ev) {
        const el = ev.target.closest("[data-tip],[title]"); if (!el) return;
        if (el.hasAttribute("title")) { const t = el.getAttribute("title"); if (t) el.setAttribute("data-tip", t); el.removeAttribute("title"); }
        const txt = el.getAttribute("data-tip"); if (!txt) return; showTipFor(el, txt);
    }
    function leaveHandler(ev) {
        if (!tipTarget) return;
        if (ev.target === tipTarget || (ev.target.contains && ev.target.contains(tipTarget))) hideTip();
    }
    document.addEventListener("mouseover", enterHandler, true);
    document.addEventListener("focusin", enterHandler, true);
    document.addEventListener("mouseout", leaveHandler, true);
    document.addEventListener("focusout", leaveHandler, true);
    window.addEventListener("scroll", () => { if (tipTarget) positionTip(tipTarget); }, true);
    window.addEventListener("resize", () => { if (tipTarget) positionTip(tipTarget); });

    /* =========================
       Conexão (ping) — ícone gira via .loading
    ========================= */
    function setConnBtn(state, tipText) {
        if (!connBtn) return;
        connBtn.classList.remove("status-fast", "status-med", "status-slow", "status-off");
        if (state) connBtn.classList.add(state);
        if (tipText) connBtn.setAttribute("data-tip", tipText);
        connBtn.classList.remove("loading");
    }
    async function pingSheets(timeoutMs = 7000) {
        const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), timeoutMs);
        const start = performance.now();
        try {
            const body = new URLSearchParams({ key: SHEETS_KEY, op: "ping", data: "{}" }).toString();
            const res = await fetch(WEB_APP_URL, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" }, body, signal: ctrl.signal });
            const ms = Math.round(performance.now() - start); clearTimeout(t);
            return { ok: true, status: res.status, ms };
        } catch (err) { clearTimeout(t); return { ok: false, error: err?.name === "AbortError" ? "timeout" : (err?.message || "erro") }; }
    }
    const classify = (ms) => (ms < 350 ? "fast" : ms < 1000 ? "med" : "slow");
    async function runConnCheck() {
        if (!connBtn) return;
        connBtn.classList.add("loading"); // gira o SVG do botão

        if (!navigator.onLine) {
            setConnBtn("status-off", "Sem conexão com a internet");
            Swal.fire({
                toast: true, position: "bottom-end", timer: 2500, showConfirmButton: false, icon: "error",
                title: "Offline", text: "Sem conexão com a internet.", background: "#0f172a", color: "#e2e8f0"
            });
            return;
        }
        const r = await pingSheets(7000);
        if (!r.ok) {
            setConnBtn("status-off", "Web App sem resposta");
            Swal.fire({
                toast: true, position: "bottom-end", timer: 2800, showConfirmButton: false, icon: "error",
                title: "Sem resposta do Web App", text: "Falha ao contatar o Apps Script.", background: "#0f172a", color: "#e2e8f0"
            });
            return;
        }
        const speed = classify(r.ms);
        const stateCls = speed === "fast" ? "status-fast" : (speed === "med" ? "status-med" : "status-slow");
        const statusTxt = speed === "fast" ? "rápida" : (speed === "med" ? "média" : "lenta");
        setConnBtn(stateCls, `Conexão ${statusTxt} · ${r.ms} ms`);
        connBtn.setAttribute("aria-label", `Conexão ${statusTxt}, ${r.ms} milissegundos`);
        Swal.fire({
            toast: true, position: "bottom-end", timer: 3200, showConfirmButton: false,
            icon: (speed === "fast" ? "success" : (speed === "med" ? "info" : "warning")), title: `Conexão ${statusTxt}`,
            html: `<b>Latência:</b> ${r.ms} ms`, background: "#0f172a", color: "#e2e8f0"
        });
    }
    if (connBtn) {
        connBtn.addEventListener("click", runConnCheck);
        setTimeout(runConnCheck, 800); // ping inicial
    }

    /* =========================
       Botão "Sync" — sem piscar/letra-a-letra
    ========================= */
    if (syncBtn) {
        const originalSyncTxt = syncBtn.textContent.trim() || "Sync";
        syncBtn.addEventListener("click", async () => {
            syncBtn.disabled = true;
            syncBtn.textContent = "Sincronizando...";
            try {
                const sent = await drainOutbox(true);
                await refreshFromServer(render);
                if (window.Swal) {
                    window.Swal.fire({
                        toast: true, position: "bottom-end", timer: 1800, showConfirmButton: false,
                        icon: sent > 0 ? "success" : "info",
                        title: sent > 0 ? `Enviadas ${sent} pendências` : "Sincronizado",
                        background: "#0f172a", color: "#e2e8f0"
                    });
                }
            } finally {
                syncBtn.disabled = false;
                syncBtn.textContent = originalSyncTxt;
            }
        });
    }

    /* =========================
       Bootstrap + Polling + Triggers
    ========================= */
    (async function bootstrapSync() {
        try {
            const sent = await drainOutbox(true);
            if (sent > 0) await refreshFromServer(render);
            await refreshFromServer(render);
        } catch (err) {
            console.warn("[sync] Falha no read/merge; usando somente local:", err?.message || err);
            render();
        }
        setInterval(async () => { await refreshFromServer(render); }, SERVER_REFRESH_MS);
    })();

    window.addEventListener("online", async () => {
        const sent = await drainOutbox(true);
        if (sent > 0) await refreshFromServer(render);
        await refreshFromServer(render);
    });

    setInterval(async () => {
        const sent = await drainOutbox(false);
        if (sent > 0) await refreshFromServer(render);
    }, RETRY_INTERVAL_MS);

    document.addEventListener("visibilitychange", async () => {
        if (document.visibilityState === "visible") {
            await refreshFromServer(render);
        }
    });

    /* =========================
       Keepalive ao sair
    ========================= */
    window.addEventListener("pagehide", flushOutboxKeepalive);
    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden") flushOutboxKeepalive();
    });
}

// ---- Auto-init seguro
if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", startUI, { once: true });
} else {
    startUI();
}
