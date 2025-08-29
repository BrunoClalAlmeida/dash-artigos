"use strict";

import {
    WEB_APP_URL, SHEETS_KEY,
    DELETE_PASSWORD, CASE_INSENSITIVE, PASS_NORM, normalizeForCompare,
    SERVER_REFRESH_MS, RETRY_INTERVAL_MS,
    campanhas, saveData,
    uid, esc, sanitizeURL,
    sendToSheets, drainOutbox, refreshFromServer, enqueue,
    flushOutboxKeepalive,
    getCategories, saveCategories
} from "./core.js";

/**
 * UI com:
 * - Dropdown custom (X em TODAS as categorias, inclusive padrão)
 * - Esconde padrões removidas via lista local "removedDefaultCategories"
 * - SweetAlert com botões: Sim (vermelho) / Não (azul)
 */

let render;

function startUI() {
    const form = document.getElementById("campaignForm");
    const tbody = document.querySelector("#campaignTable tbody");
    const connBtn = document.getElementById("connCheckBtn");
    const syncBtn = document.getElementById("syncNowBtn");
    const paisInput = document.getElementById("pais");
    const idiomaInput = document.getElementById("idioma");
    const categoriaInput = document.getElementById("categoria");
    const categoriaDL = document.getElementById("lista-categorias");

    /* ===== Categorias ===== */
    const defaultCatsAll = Array.from(categoriaDL?.options || [])
        .map(o => o.value || o.label || "")
        .filter(Boolean);

    // removidos de padrão ficam aqui
    const loadRemovedDefaults = () =>
        JSON.parse(localStorage.getItem("removedDefaultCategories") || "[]");
    const saveRemovedDefaults = (arr) =>
        localStorage.setItem("removedDefaultCategories", JSON.stringify(arr));

    let removedDefaults = loadRemovedDefaults();

    // extras (as que você cria)
    let categoriasExtras = getCategories();

    const norm = s => String(s || "").trim();
    const normCI = s => norm(s).toLowerCase();
    const uniqCI = arr => {
        const seen = new Set();
        return arr.filter(v => {
            const k = normCI(v);
            if (!k || seen.has(k)) return false;
            seen.add(k);
            return true;
        });
    };
    const existsCI = (val, list) => list.some(v => normCI(v) === normCI(val));

    function getDefaultCatsVisible() {
        // filtra os padrões removidos
        return defaultCatsAll.filter(c => !removedDefaults.some(r => normCI(r) === normCI(c)));
    }

    function renderCategorias() {
        const defaultsVisiveis = getDefaultCatsVisible();
        const all = uniqCI([...defaultsVisiveis, ...categoriasExtras])
            .sort((a, b) => a.localeCompare(b, "pt-BR", { sensitivity: "base" }));
        categoriaDL.innerHTML = "";
        for (const cat of all) {
            const o = document.createElement("option");
            o.value = cat;
            categoriaDL.appendChild(o);
        }
    }
    renderCategorias();

    async function perguntarCriarCategoria(valor) {
        const r = await Swal.fire({
            customClass: { popup: "dark-modal" },
            background: "#0f172a", color: "#e2e8f0",
            icon: "question",
            title: "Criar nova categoria?",
            text: `A categoria "${valor}" não existe. Deseja criar?`,
            showCancelButton: true,
            confirmButtonText: "Sim",
            cancelButtonText: "Não"
        });
        return r.isConfirmed;
    }

    async function tentarCriarCategoria(valor) {
        if (!valor) return;
        const todos = uniqCI([...getDefaultCatsVisible(), ...categoriasExtras]);
        if (existsCI(valor, todos)) return;
        if (await perguntarCriarCategoria(valor)) {
            categoriasExtras.push(valor.trim());
            saveCategories(categoriasExtras);
            renderCategorias();
            Swal.fire({
                toast: true, position: "bottom-end", timer: 1400, showConfirmButton: false,
                icon: "success", title: "Categoria criada!", background: "#0f172a", color: "#e2e8f0"
            });
        }
    }

    categoriaInput.addEventListener("blur", () => {
        const v = categoriaInput.value.trim();
        if (v) tentarCriarCategoria(v);
    });
    document.getElementById("campaignForm").addEventListener("submit", async () => {
        const v = categoriaInput.value.trim();
        if (v) await tentarCriarCategoria(v);
    }, { capture: true });

    /* ===== Tabela ===== */
    render = function () {
        tbody.innerHTML = "";
        campanhas.forEach((c, i) => {
            const tr = document.createElement("tr");
            tr.dataset.id = c.id;
            tr.setAttribute("data-status", c.status || "ATIVO");

            const isActive = (c.status || "ATIVO") === "ATIVO";
            const statusCls = isActive ? "neon-del" : "neon-ok";
            const statusText = isActive ? "Desativar" : "Ativar";
            const editDisabledAttr = isActive ? "" : "disabled";
            const editTitle = isActive ? "Editar registro" : "Edição bloqueada (linha INATIVO)";

            tr.innerHTML = `
        <td class="px-6 py-4" data-label="Tema">
          <div class="tema-cell" data-id="${c.id}">
            <span class="tema-index">${String(i + 1)}</span>
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
            <button class="neon-btn neon-edit px-3 btn-edit" data-index="${i}" ${editDisabledAttr} title="${editTitle}">Editar</button>
            <button class="neon-btn ${statusCls} px-3 btn-status" data-index="${i}" title="${statusText}">${statusText}</button>
            <button class="neon-btn neon-trash px-3 btn-delete" data-index="${i}" title="Excluir registro">Excluir</button>
          </div>
        </td>
      `;
            tbody.appendChild(tr);
        });
    };

    function linkBtn(label, url) {
        const u = sanitizeURL(url); if (!u) return "";
        return `
      <a href="${u}" class="link-btn" target="_blank" rel="noopener noreferrer" aria-label="${esc(label)}" title="Abrir ${esc(label)}">
        <span>${esc(label)}</span>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M7 17L17 7"></path><path d="M9 7h8v8"></path>
        </svg>
      </a>`;
    }

    /* ===== Ações Tabela ===== */
    tbody.addEventListener("click", async (e) => {
        const btnEdit = e.target.closest(".btn-edit");
        if (btnEdit) {
            if (btnEdit.hasAttribute("disabled")) {
                Swal.fire({
                    toast: true, position: "bottom-end", timer: 1600, showConfirmButton: false, icon: "info",
                    title: "Edição bloqueada — linha INATIVA", background: "#0f172a", color: "#e2e8f0"
                });
                return;
            }
            const i = Number(btnEdit.dataset.index), c = campanhas[i]; if (!c) return;
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
                toast: true, position: "bottom-end", timer: 1200, showConfirmButton: false, icon: "info",
                title: "Editando registro…", background: "#0f172a", color: "#e2e8f0"
            });
            form.tema.focus();
            return;
        }

        const btnStatus = e.target.closest(".btn-status");
        if (btnStatus) {
            const i = Number(btnStatus.dataset.index), c = campanhas[i]; if (!c) return;
            const newStatus = (c.status === "ATIVO") ? "INATIVO" : "ATIVO";
            campanhas[i] = { ...c, status: newStatus }; saveData(); render();
            try {
                await sendToSheets({ id: c.id, status: newStatus }, "update");
                await refreshFromServer(render);
                Swal.fire({
                    toast: true, position: "bottom-end", timer: 1800, showConfirmButton: false,
                    icon: (newStatus === "ATIVO" ? "success" : "info"), title: `Status: ${newStatus}`, background: "#0f172a", color: "#e2e8f0"
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
            const i = Number(btnDelete.dataset.index), c = campanhas[i]; if (!c) return;
            const ask = await Swal.fire({
                customClass: { popup: "dark-modal" },
                background: "#0f172a", color: "#e2e8f0",
                icon: "warning",
                title: "Excluir este registro?",
                html: `Tem certeza que deseja <b>excluir definitivamente</b> este cadastro?<br><br>
             <span class="neon-label">Tema:</span> <b>${esc(c.tema)}</b>`,
                showCancelButton: true,
                confirmButtonText: "Sim, excluir",
                cancelButtonText: "Cancelar",
                reverseButtons: true
            });
            if (!ask.isConfirmed) return;

            campanhas.splice(i, 1); saveData(); render();
            document.getElementById("editIndex").value = -1;
            try {
                await sendToSheets({ id: c.id }, "delete");
                await refreshFromServer(render);
                Swal.fire({
                    toast: true, position: "bottom-end", timer: 1600, showConfirmButton: false, icon: "success",
                    title: "Excluído da planilha", background: "#0f172a", color: "#e2e8f0"
                });
            } catch {
                enqueue({ id: c.id }, "delete");
                Swal.fire({
                    toast: true, position: "bottom-end", timer: 2200, showConfirmButton: false, icon: "warning",
                    title: "Sem conexão — exclusão em fila", background: "#0f172a", color: "#e2e8f0"
                });
            }
        }
    });

    /* ===== Salvar ===== */
    form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const submitBtn = form.querySelector('button[type="submit"]');
        const original = submitBtn?.textContent || "";
        if (submitBtn) { submitBtn.textContent = "Salvando..."; submitBtn.disabled = true; submitBtn.setAttribute("aria-busy", "true"); }

        const idx = parseInt(document.getElementById("editIndex").value || "-1", 10);
        const existing = idx >= 0 ? campanhas[idx] : null;

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
        };

        const op = existing ? "update" : "insert";
        if (existing) campanhas[idx] = data; else campanhas.push(data);
        saveData(); render();

        try {
            await sendToSheets(data, op);
            await refreshFromServer(render);
            Swal.fire({
                customClass: { popup: "dark-modal" }, background: "#0f172a", color: "#e2e8f0",
                icon: "success", title: existing ? "Atualizado!" : "Enviado!", text: "Sincronizado com o Google Sheets.", confirmButtonText: "OK"
            });
        } catch (err) {
            enqueue(data, op);
            Swal.fire({
                customClass: { popup: "dark-modal" }, background: "#0f172a", color: "#e2e8f0",
                icon: "warning", title: "Sem conexão com o Sheets", text: `Registro salvo localmente e colocado na fila. Detalhe: ${err.message}`, confirmButtonText: "OK"
            });
        } finally {
            if (submitBtn) { submitBtn.textContent = original || "Salvar Campanha"; submitBtn.disabled = false; submitBtn.removeAttribute("aria-busy"); }
        }

        form.reset(); document.getElementById("editIndex").value = -1;
        render();

        const sent = await drainOutbox(true);
        if (sent > 0) await refreshFromServer(render);
    });

    /* ===== Dropdown custom (categoria) ===== */
    const activeDD = { el: null, input: null, listId: null };
    let hoveringDD = false;
    const ddOffsetY = 6;

    function positionDD(dd, input) {
        const r = input.getBoundingClientRect();
        dd.style.minWidth = r.width + "px";
        dd.style.left = (r.left + window.scrollX) + "px";
        dd.style.top = (r.bottom + window.scrollY + ddOffsetY) + "px";
    }

    function renderMiniList(ul, dl, term, anchorInput) {
        const t = String(term || "").trim(), tLower = t.toLowerCase();
        ul.innerHTML = "";

        const options = Array.from(dl.options);
        options.forEach(opt => {
            const txt = opt.value || opt.label || "";
            if (!t || txt.toLowerCase().includes(tLower)) {
                const li = document.createElement("li");
                const row = document.createElement("div"); row.className = "dd-row";

                const label = document.createElement("span"); label.className = "dd-label"; label.textContent = txt;

                const btn = document.createElement("button");
                btn.className = "dd-remove"; btn.type = "button"; btn.title = "Remover"; btn.setAttribute("aria-label", `Remover categoria ${txt}`);
                btn.addEventListener("click", async (ev) => {
                    ev.stopPropagation();
                    // fecha a dropdown antes do modal pra evitar sobreposição visual
                    closeDD();

                    const ask = await Swal.fire({
                        customClass: { popup: "dark-modal" },
                        background: "#0f172a",
                        color: "#e2e8f0",
                        icon: "warning",
                        title: "Remover categoria?",
                        text: `Deseja remover "${txt}" das opções? (não afeta registros já salvos)`,
                        showCancelButton: true,
                        confirmButtonText: "Sim",
                        cancelButtonText: "Não",
                        reverseButtons: true
                    });
                    if (!ask.isConfirmed) return;

                    // se é padrão visível -> marca como removido
                    const isDefault = defaultCatsAll.some(c => normCI(c) === normCI(txt));
                    if (isDefault) {
                        removedDefaults = uniqCI([...removedDefaults, txt]);
                        saveRemovedDefaults(removedDefaults);
                    } else {
                        categoriasExtras = categoriasExtras.filter(c => normCI(c) !== normCI(txt));
                        saveCategories(categoriasExtras);
                    }
                    renderCategorias();
                    renderMiniList(ul, dl, anchorInput.value, anchorInput);
                    Swal.fire({
                        toast: true, position: "bottom-end", timer: 1200, showConfirmButton: false,
                        icon: "success", title: "Categoria removida", background: "#0f172a", color: "#e2e8f0"
                    });
                });

                li.addEventListener("mousedown", (ev) => {
                    if (ev.target.closest(".dd-remove")) return;
                    ev.preventDefault();
                    anchorInput.value = txt;
                    closeDD();
                    anchorInput.dispatchEvent(new Event("change", { bubbles: true }));
                });

                row.appendChild(label); row.appendChild(btn); li.appendChild(row); ul.appendChild(li);
            }
        });

        const allNow = uniqCI([...getDefaultCatsVisible(), ...categoriasExtras]);
        if (t && !existsCI(t, allNow)) {
            const liAdd = document.createElement("li");
            liAdd.className = "dd-create";
            liAdd.textContent = `➕ Criar categoria “${t}”`;
            liAdd.addEventListener("mousedown", async (ev) => {
                ev.preventDefault();
                const ok = await perguntarCriarCategoria(t);
                if (!ok) return;
                categoriasExtras.push(t.trim()); saveCategories(categoriasExtras);
                renderCategorias();
                anchorInput.value = t; closeDD();
                anchorInput.dispatchEvent(new Event("change", { bubbles: true }));
            });
            ul.appendChild(liAdd);
        }
    }

    function buildDD(listId, anchorInput) {
        const dl = document.getElementById(listId); if (!dl) return null;
        const dd = document.createElement("div"); dd.className = "mini-dd";
        positionDD(dd, anchorInput);
        dd.addEventListener("mouseenter", () => { hoveringDD = true; });
        dd.addEventListener("mouseleave", () => { hoveringDD = false; });

        const ul = document.createElement("ul");
        dd.appendChild(ul); document.body.appendChild(dd);
        renderMiniList(ul, dl, "", anchorInput);
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
        let skipBlur = false;
        inp.addEventListener("pointerdown", () => { if (!activeDD.el) openDD(inp); skipBlur = true; });
        inp.addEventListener("focus", () => { if (!activeDD.el) openDD(inp); });
        inp.addEventListener("click", () => { if (!activeDD.el) openDD(inp); });
        inp.addEventListener("input", () => {
            if (!activeDD.el) return;
            const dl = document.getElementById(activeDD.listId);
            const ul = activeDD.el.querySelector("ul");
            renderMiniList(ul, dl, inp.value, inp);
        });
        inp.addEventListener("blur", () => {
            if (skipBlur) { skipBlur = false; return; }
            setTimeout(closeDD, 120);
        });
    });

    /* ===== Tooltip ===== */
    const tip = document.createElement("div"); tip.className = "tip-layer"; document.body.appendChild(tip);
    let tipTarget = null;
    function positionTip(el) {
        const pad = 10, off = 10, r = el.getBoundingClientRect(); const centerX = r.left + r.width / 2;
        const tw = tip.offsetWidth, th = tip.offsetHeight; let pos = "top"; let yTop = r.top - off, yBottom = r.bottom + off, y;
        if (yTop - th < pad) { if (yBottom + th <= window.innerHeight - pad) { pos = "bottom"; y = yBottom; } else { y = Math.max(pad + th, yTop); } }
        else { y = yTop; }
        tip.dataset.pos = pos; tip.style.top = `${y}px`;
        const xMin = pad + tw / 2, xMax = window.innerWidth - pad - tw / 2;
        const x = Math.min(Math.max(centerX, xMin), xMax); const shift = x - centerX;
        tip.style.left = `${x}px`; tip.style.setProperty("--arrow-shift", `${-shift}px`);
    }
    function showTipFor(el, text) { if (!text) return; tipTarget = el; tip.innerHTML = text.replace(/\n/g, "<br>"); positionTip(el); tip.setAttribute("data-show", "true"); }
    function hideTip() { tipTarget = null; tip.removeAttribute("data-show"); }
    function enterHandler(ev) {
        const el = ev.target.closest("[data-tip],[title]"); if (!el) return;
        if (el.hasAttribute("title")) { const t = el.getAttribute("title"); if (t) el.setAttribute("data-tip", t); el.removeAttribute("title"); }
        const txt = el.getAttribute("data-tip"); if (!txt) return; showTipFor(el, txt);
    }
    function leaveHandler(ev) { if (!tipTarget) return; if (ev.target === tipTarget || (ev.target.contains && ev.target.contains(tipTarget))) hideTip(); }
    document.addEventListener("mouseover", enterHandler, true);
    document.addEventListener("focusin", enterHandler, true);
    document.addEventListener("mouseout", leaveHandler, true);
    document.addEventListener("focusout", leaveHandler, true);
    window.addEventListener("scroll", () => { if (tipTarget) positionTip(tipTarget); }, true);
    window.addEventListener("resize", () => { if (tipTarget) positionTip(tipTarget); });

    /* ===== Conexão & Sync (mesmo de antes) ===== */
    function setConnBtn(state, tipText) {
        if (!connBtn) return;
        connBtn.classList.remove("status-fast", "status-med", "status-slow", "status-off");
        if (state) connBtn.classList.add(state);
        if (tipText) connBtn.setAttribute("data-tip", tipText);
        connBtn.classList.remove("loading");
    }
    async function pingSheets(timeoutMs = 7000) {
        const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), timeoutMs); const start = performance.now();
        try {
            const body = new URLSearchParams({ key: SHEETS_KEY, op: "ping", data: "{}" }).toString();
            const res = await fetch(WEB_APP_URL, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" }, body, signal: ctrl.signal });
            const ms = Math.round(performance.now() - start); clearTimeout(t); return { ok: true, status: res.status, ms };
        } catch (err) { clearTimeout(t); return { ok: false, error: err?.name === "AbortError" ? "timeout" : (err?.message || "erro") }; }
    }
    const classify = (ms) => (ms < 350 ? "fast" : ms < 1000 ? "med" : "slow");
    async function runConnCheck() {
        if (!connBtn) return; connBtn.classList.add("loading");
        if (!navigator.onLine) { setConnBtn("status-off", "Sem conexão"); Swal.fire({ toast: true, position: "bottom-end", timer: 2500, showConfirmButton: false, icon: "error", title: "Offline", background: "#0f172a", color: "#e2e8f0" }); return; }
        const r = await pingSheets(7000);
        if (!r.ok) { setConnBtn("status-off", "Web App sem resposta"); Swal.fire({ toast: true, position: "bottom-end", timer: 2800, showConfirmButton: false, icon: "error", title: "Sem resposta do Web App", background: "#0f172a", color: "#e2e8f0" }); return; }
        const speed = classify(r.ms), cls = speed === "fast" ? "status-fast" : (speed === "med" ? "status-med" : "status-slow");
        const txt = speed === "fast" ? "rápida" : (speed === "med" ? "média" : "lenta");
        setConnBtn(cls, `Conexão ${txt} · ${r.ms} ms`);
        Swal.fire({ toast: true, position: "bottom-end", timer: 3200, showConfirmButton: false, icon: (speed === "fast" ? "success" : (speed === "med" ? "info" : "warning")), title: `Conexão ${txt}`, html: `<b>Latência:</b> ${r.ms} ms`, background: "#0f172a", color: "#e2e8f0" });
    }
    if (connBtn) { connBtn.addEventListener("click", runConnCheck); setTimeout(runConnCheck, 800); }

    if (syncBtn) {
        const original = syncBtn.textContent.trim() || "Sync";
        syncBtn.addEventListener("click", async () => {
            syncBtn.disabled = true; syncBtn.textContent = "Sincronizando...";
            try {
                const sent = await drainOutbox(true);
                await refreshFromServer(render);
                Swal.fire({ toast: true, position: "bottom-end", timer: 1800, showConfirmButton: false, icon: sent > 0 ? "success" : "info", title: sent > 0 ? `Enviadas ${sent} pendências` : "Sincronizado", background: "#0f172a", color: "#e2e8f0" });
            } finally {
                syncBtn.disabled = false; syncBtn.textContent = original;
            }
        });
    }

    (async function bootstrapSync() {
        try { const sent = await drainOutbox(true); if (sent > 0) await refreshFromServer(render); await refreshFromServer(render); }
        catch { render(); }
        setInterval(async () => { await refreshFromServer(render); }, SERVER_REFRESH_MS);
    })();

    window.addEventListener("online", async () => {
        const sent = await drainOutbox(true); if (sent > 0) await refreshFromServer(render);
        await refreshFromServer(render);
    });
    setInterval(async () => { const sent = await drainOutbox(false); if (sent > 0) await refreshFromServer(render); }, RETRY_INTERVAL_MS);
    document.addEventListener("visibilitychange", async () => { if (document.visibilityState === "visible") await refreshFromServer(render); });

    window.addEventListener("pagehide", flushOutboxKeepalive);
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") flushOutboxKeepalive(); });
}

/* ==== auto-init ==== */
if (document.readyState === "loading") { document.addEventListener("DOMContentLoaded", startUI, { once: true }); }
else { startUI(); }
