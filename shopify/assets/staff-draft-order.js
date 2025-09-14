// assets/staff-draft-order.js
console.log("🚀 staff-draft-order.js chargé");

(() => {
  // ──────────────────────────────────────────────────
  // CHAPITRE 0 — CONSTANTES GLOBALES
  // ──────────────────────────────────────────────────
  const BASE_URL = "https://shopify-test-server-05d9.onrender.com"; // <-- ton Render
  const API_KEY  = "MacleDo1tRSTHEZ1298";                           // <-- ta clé
  const EXPIRY_MS = 24 * 60 * 60 * 1000; // 24h

  // ──────────────────────────────────────────────────
  // INIT D’UNE SECTION (idempotent)
  // ──────────────────────────────────────────────────
  function initStaffSelectorInSection(section, allCustomers) {
    if (!section || !section.matches(".staff-draft-order-section")) return;

    const sectionId = section.dataset.sectionId || "default";
    const lsKey         = `staffDraftOrder:${sectionId}`;
    const lsCustomerKey = `staffDraftOrder:selected:${sectionId}`;

    const selectEl   = section.querySelector("select.client-selector");
    const feedbackEl = section.querySelector(".feedback");
    const createBtn  = section.querySelector("button.staff-order-button");

    if (!selectEl || !feedbackEl || !createBtn) {
      console.warn("[staff-draft-order] Éléments manquants", { selectEl, feedbackEl, createBtn });
      return;
    }

    // Textes UX depuis data-*, sinon défauts
    createBtn.textContent = "Create Draft Order";
    const placeholderText    = section.dataset.placeholder || "Search for opticians…";
    const pleaseSelectText   = section.dataset.pleaseSelectCustomerText || "Please select a customer";
    const creatingText       = section.dataset.creatingText || "Creating…";
    const confirmText        = section.dataset.confirmText || "Confirm & Send Order";
    const sendingText        = section.dataset.sendingText || "Sending…";
    const sendErrorText      = section.dataset.sendErrorText || "Error, retry";
    const sentText           = section.dataset.sentText || "Sent!";

    // État local
    let selectedCustomerId = null;
    let confirmBtn = null;
    let lastCartCount = null;
    let stateInterval = null;

    // ────────────────────────────────────────────────
    // Helpers panier + état bouton
    // ────────────────────────────────────────────────
    async function fetchCartCount() {
      try {
        const cart = await (await fetch("/cart.js", { credentials: "same-origin" })).json();
        return Array.isArray(cart.items)
          ? cart.items.reduce((s, i) => s + (i.quantity || 0), 0)
          : 0;
      } catch {
        return 0;
      }
    }

    async function updateCreateButtonState(reason = "") {
      if (createBtn.style.display === "none") return; // si en mode confirm, on ne bouge pas
      const cartCount = lastCartCount ?? await fetchCartCount();
      const hasCustomer = !!selectedCustomerId;
      const shouldEnable = hasCustomer && cartCount > 0;
      createBtn.disabled = !shouldEnable;
      createBtn.title = shouldEnable
        ? ""
        : (!hasCustomer && cartCount === 0
            ? "Sélectionnez un client et ajoutez au moins un article au panier"
            : (!hasCustomer ? "Sélectionnez un client" : "Ajoutez au moins un article au panier"));
      lastCartCount = cartCount;
      // console.debug("[state]", { reason, hasCustomer, cartCount, disabled: createBtn.disabled });
    }

    function startCartPolling() {
      if (stateInterval) return;
      stateInterval = setInterval(() => updateCreateButtonState("poll"), 2500);
    }
    function stopCartPolling() {
      if (stateInterval) clearInterval(stateInterval);
      stateInterval = null;
    }

    section.addEventListener("shopify:section:unload", stopCartPolling);
    document.addEventListener("cart:refresh", () => updateCreateButtonState("cart:refresh"));
    document.addEventListener("cart:updated", () => updateCreateButtonState("cart:updated"));

    // État initial
    (async () => {
      lastCartCount = await fetchCartCount();
      await updateCreateButtonState("init");
      startCartPolling();
    })();

    // ────────────────────────────────────────────────
    // CRÉATION CLIENT (STAFF) — non intrusif
    // ────────────────────────────────────────────────
    (function setupCreateCustomer() {
      const form = section.querySelector(".staff-create-customer-form");
      const feedback = section.querySelector(".staff-create-customer .create-feedback");
      if (!form || !feedback) return;

      const required = [
        "email","first_name","last_name","company",
        "address1","zip","city","country_code"
      ];

      function uuidv4() {
        const a = crypto.getRandomValues(new Uint8Array(16));
        a[6] = (a[6] & 0x0f) | 0x40; // version 4
        a[8] = (a[8] & 0x3f) | 0x80; // variant
        const h = [...a].map(x => x.toString(16).padStart(2,"0")).join("");
        return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
      }

      function getFormData(formEl) {
        const fd = new FormData(formEl);
        const obj = Object.fromEntries(fd.entries());
        obj.email       = (obj.email||"").trim();
        obj.first_name  = (obj.first_name||"").trim();
        obj.last_name   = (obj.last_name||"").trim();
        obj.company     = (obj.company||"").trim();
        obj.address1    = (obj.address1||"").trim();
        obj.address2    = (obj.address2||"").trim();
        obj.zip         = (obj.zip||"").trim();
        obj.city        = (obj.city||"").trim();
        obj.country_code= (obj.country_code||"").trim().toUpperCase();
        obj.phone       = (obj.phone||"").trim();
        obj.vat_number  = (obj.vat_number||"").trim();
        obj.note        = (obj.note||"").trim();
        obj.tags        = (obj.tags||"").split(",").map(t=>t.trim()).filter(Boolean);
        return obj;
      }

      function addToTomSelect(customerId, company, firstName, lastName) {
        const el = section.querySelector("select.client-selector");
        if (!el || !el.tomselect) return;
        const labelName = [firstName, lastName].filter(Boolean).join(" ");
        const option = {
          id: String(customerId),
          text: `${company || ""} — ${labelName}`.replace(/^ — /, "")
        };
        el.tomselect.addOption(option);
        el.tomselect.addItem(option.id);
        el.tomselect.refreshOptions(false);
        localStorage.setItem(lsCustomerKey, option.id);
        selectedCustomerId = option.id;
        updateCreateButtonState("addToTomSelect");
      }

      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        feedback.textContent = "";

        const data = getFormData(form);
        const missing = required.filter(k => !data[k]);
        if (missing.length) {
          feedback.textContent = `❌ Champs requis manquants : ${missing.join(", ")}`;
          return;
        }
        if (!/^\S+@\S+\.\S+$/.test(data.email)) {
          feedback.textContent = "❌ Email invalide";
          return;
        }
        if (!/^[A-Z]{2}$/.test(data.country_code)) {
          feedback.textContent = "❌ Code pays (ISO2) invalide";
          return;
        }

        const submitBtn = form.querySelector('button[type="submit"]');
        const prevText = submitBtn ? submitBtn.textContent : "";
        if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = "Création…"; }

        try {
          const idemKey = uuidv4();
          const res = await fetch(
            `${BASE_URL}/create-customer?key=${encodeURIComponent(API_KEY)}`,
            {
              method: "POST",
              mode: "cors",
              headers: {
                "Content-Type": "application/json",
                "Idempotency-Key": idemKey
              },
              body: JSON.stringify({
                email: data.email,
                first_name: data.first_name,
                last_name: data.last_name,
                phone: data.phone || null,
                note: data.note || null,
                tags: data.tags,
                default_address: {
                  address1: data.address1,
                  address2: data.address2 || null,
                  zip: data.zip,
                  city: data.city,
                  country_code: data.country_code,
                  company: data.company,
                  phone: data.phone || null
                },
                metafields: data.vat_number ? [
                  { namespace: "custom", key: "vat_number",    type: "single_line_text_field", value: data.vat_number },
                  { namespace: "custom", key: "company_name",  type: "single_line_text_field", value: data.company }
                ] : [
                  { namespace: "custom", key: "company_name",  type: "single_line_text_field", value: data.company }
                ]
              })
            }
          );

          const payload = await res.json().catch(() => ({}));

          if (res.status === 409 && payload?.id) {
            feedback.textContent = "ℹ️ Client existant — sélection effectuée.";
            addToTomSelect(payload.id, data.company, data.first_name, data.last_name);
            form.reset();
            return;
          }
          if (!res.ok) {
            console.error("create-customer error:", res.status, payload);
            throw new Error(payload?.message || "Erreur création client");
          }

          const customerId = payload.id || payload.customer?.id;
          feedback.textContent = `✅ Client créé (ID ${customerId})`;
          addToTomSelect(customerId, data.company, data.first_name, data.last_name);
          form.reset();
        } catch (err) {
          feedback.textContent = `❌ ${err.message || "Erreur inconnue"}`;
        } finally {
          if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = prevText; }
        }
      });
    })();

    // ────────────────────────────────────────────────
    // BOUTON CONFIRMATION
    // ────────────────────────────────────────────────
    function renderConfirmButton(invoiceUrl, draftId) {
      // cacher le bouton “Create Draft Order”
      createBtn.style.display = "none";
      feedbackEl.innerHTML = "";

      confirmBtn = document.createElement("button");
      confirmBtn.type = "button";
      confirmBtn.textContent = confirmText;
      confirmBtn.className = createBtn.className;
      confirmBtn.style.backgroundColor = createBtn.style.backgroundColor;
      confirmBtn.style.color = createBtn.style.color;
      feedbackEl.appendChild(confirmBtn);

      const onConfirm = async () => {
        confirmBtn.disabled = true;
        confirmBtn.textContent = sendingText;
        try {
          // 1) Finaliser le draft -> Order
          const completeRes = await fetch(
            `${BASE_URL}/complete-draft-order?key=${encodeURIComponent(API_KEY)}`,
            {
              method: "POST",
              mode: "cors",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ invoice_url: invoiceUrl, draft_id: draftId })
            }
          );
          const completeData = await completeRes.json().catch(()=> ({}));
          if (!completeRes.ok) throw completeData;
          const orderId = completeData.order_id || completeData.order?.id;

          // 2) Envoyer l’email de confirmation
          const sendRes = await fetch(
            `${BASE_URL}/send-order-confirmation?key=${encodeURIComponent(API_KEY)}`,
            {
              method: "POST",
              mode: "cors",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                customer_id: selectedCustomerId,
                order_id: orderId,
                cc: ["info@rednmore.com"]
              })
            }
          );
          if (!sendRes.ok) throw await sendRes.json().catch(()=>({message:"Send failed"}));

          // 3) Succès — bouton devient “Sent! → Click for new order”
          confirmBtn.disabled = false;
          confirmBtn.textContent = `${sentText} → Click for new order`;

          localStorage.setItem(lsKey, JSON.stringify({
            ts: Date.now(),
            invoiceUrl,
            draft_id: draftId,
            cartCount: null,
            completed: true
          }));

          confirmBtn.removeEventListener("click", onConfirm);
          confirmBtn.addEventListener("click", async () => {
            await fetch("/cart/clear.js", { method: "POST", credentials: "same-origin" });
            localStorage.removeItem(lsKey);
            localStorage.removeItem(lsCustomerKey);
            window.top.location = `${window.location.origin}/collections/all`;
          });
        } catch (err) {
          console.error("❌ Erreur confirmation :", err);
          confirmBtn.disabled = false;
          confirmBtn.textContent = sendErrorText;
        }
      };

      confirmBtn.addEventListener("click", onConfirm);
    }

    // ────────────────────────────────────────────────
    // RESTAURATION AVANT INIT TomSelect
    // ────────────────────────────────────────────────
    (async () => {
      try {
        const raw = localStorage.getItem(lsKey);
        if (!raw) return;
        const pending = JSON.parse(raw);
        const cart = await (await fetch("/cart.js", { credentials: "same-origin" })).json();
        const currentCount = cart.items.reduce((sum, i) => sum + (i.quantity || 0), 0);

        if (pending.completed) {
          selectedCustomerId = localStorage.getItem(lsCustomerKey);
          renderConfirmButton(pending.invoiceUrl, pending.draft_id);
          return;
        }
        if (Date.now() - pending.ts < EXPIRY_MS && pending.cartCount === currentCount) {
          selectedCustomerId = localStorage.getItem(lsCustomerKey);
          renderConfirmButton(pending.invoiceUrl, pending.draft_id);
          return;
        }
        localStorage.removeItem(lsKey);
        localStorage.removeItem(lsCustomerKey);
      } catch {
        localStorage.removeItem(lsKey);
        localStorage.removeItem(lsCustomerKey);
      }
    })();

    // ────────────────────────────────────────────────
    // INIT TomSelect (idempotent + gardes)
    // ────────────────────────────────────────────────
    if (selectEl.tomselect) {
      try { selectEl.tomselect.destroy(); } catch (_) {}
    }
    if (typeof TomSelect === "undefined") {
      console.error("❌ TomSelect non défini — vérifier le chargement de tom-select.complete.min.js");
      feedbackEl.textContent = "❌ Erreur de chargement Tom Select.";
      return;
    }

    const ts = new TomSelect(selectEl, {
      valueField: "id",
      labelField: "text",
      searchField: ["text"],
      options: Array.isArray(allCustomers) ? allCustomers : [],
      placeholder: placeholderText,
      maxOptions: 8,
      preload: true,
      allowEmptyOption: true,
      persist: false,
      closeAfterSelect: true,
      mode: "single",
      onType(str) {
        this.clear(true);
        selectedCustomerId = null;
        localStorage.removeItem(lsCustomerKey);
        if (confirmBtn) { confirmBtn.remove(); confirmBtn = null; createBtn.style.display = ""; }
        updateCreateButtonState("onType");
      },
      onInitialize() {
        this.clear(true);
        const saved = localStorage.getItem(lsCustomerKey);
        if (saved) this.addItem(saved);
      },
      onItemAdd(value) {
        selectedCustomerId = value;
        localStorage.setItem(lsCustomerKey, value);
        feedbackEl.textContent = "";
        createBtn.style.display = "";
        if (confirmBtn) { confirmBtn.remove(); confirmBtn = null; }
        updateCreateButtonState("onItemAdd");
      }
    });

    // ────────────────────────────────────────────────
    // RESTAURATION APRÈS INIT TomSelect
    // ────────────────────────────────────────────────
    (async () => {
      try {
        const raw = localStorage.getItem(lsKey);
        if (!raw) return;
        const pending = JSON.parse(raw);
        if (Date.now() - pending.ts < EXPIRY_MS) {
          const cart = await (await fetch("/cart.js", { credentials: "same-origin" })).json();
          const currentCount = cart.items.reduce((sum, i) => sum + (i.quantity || 0), 0);
          if (currentCount === pending.cartCount) {
            createBtn.style.display = "none";
            renderConfirmButton(pending.invoiceUrl, pending.draft_id);
            return;
          }
        }
        localStorage.removeItem(lsKey);
      } catch {
        localStorage.removeItem(lsKey);
      }
      updateCreateButtonState("postRestore");
    })();

    // ────────────────────────────────────────────────
    // CLIC “Create Draft Order”
    // ────────────────────────────────────────────────
    createBtn.addEventListener("click", async () => {
      if (!selectedCustomerId) {
        feedbackEl.textContent = pleaseSelectText;
        return;
      }

      createBtn.style.display = "none";
      feedbackEl.textContent = `⏳ ${creatingText}`;

      try {
        const cart = await (await fetch("/cart.js", { credentials: "same-origin" })).json();
        const items = cart.items.map(i => ({ variant_id: i.variant_id, quantity: i.quantity }));

        const pendingRaw = localStorage.getItem(lsKey);
        let endpoint, requestBody, draftId;

        if (pendingRaw) {
          const pending = JSON.parse(pendingRaw);
          endpoint = "/update-draft-order";
          draftId = pending.draft_id;
          requestBody = { draft_id: draftId, items, customer_id: selectedCustomerId };
        } else {
          endpoint = "/create-draft-order";
          requestBody = { customer_id: selectedCustomerId, items };
        }

        const resp = await fetch(
          `${BASE_URL}${endpoint}?key=${encodeURIComponent(API_KEY)}`,
          {
            method: "POST",
            mode: "cors",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(requestBody)
          }
        );

        const data = await resp.json().catch(() => ({}));
        if (!resp.ok) throw data;

        const newDraftId = data.draft_id || draftId;
        const invoiceUrl = data.invoice_url;

        localStorage.setItem(lsKey, JSON.stringify({
          ts: Date.now(),
          invoiceUrl,
          cartCount: cart.items.reduce((sum, i) => sum + (i.quantity || 0), 0),
          draft_id: newDraftId
        }));

        renderConfirmButton(invoiceUrl, newDraftId);
      } catch (err) {
        console.error("❌ Erreur création/mise à jour du draft :", err);
        feedbackEl.textContent = `❌ ${err.message || "Error"}`;
        createBtn.style.display = "";
      }
    });
  }

  // ──────────────────────────────────────────────────
  // INIT TOUTES LES SECTIONS
  // ──────────────────────────────────────────────────
  function initAllStaffSelectors(allCustomers) {
    document
      .querySelectorAll(".staff-draft-order-section")
      .forEach(section => initStaffSelectorInSection(section, allCustomers));
  }

  // ──────────────────────────────────────────────────
  // BOOTSTRAP — charge clients puis init
  // ──────────────────────────────────────────────────
  async function bootstrap() {
    console.log("📑 bootstrap start");

    // 1) Charger la liste des clients
    let allCustomers = [];
    try {
      const res = await fetch(`${BASE_URL}/list-customers?key=${encodeURIComponent(API_KEY)}`, { mode: "cors" });
      const data = await res.json();
      if (!Array.isArray(data)) throw new Error("Invalid clients data");
      allCustomers = data.map(c => ({ id: c.id, text: c.label }));
      console.log("✅ clients chargés:", allCustomers.length);
    } catch (err) {
      console.error("❌ Impossible de charger les clients :", err);
      document
        .querySelectorAll(".staff-draft-order-section .feedback")
        .forEach(el => el.textContent = "❌ Clients non chargés (mode dégradé).");
    }

    // 2) Init immédiate / DOM ready
    const startInit = () => initAllStaffSelectors(allCustomers);
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", startInit, { once: true });
    } else {
      startInit();
    }

    // 3) Re-init quand l’éditeur Shopify recharge une section
    document.addEventListener("shopify:section:load", (e) => {
      if (e.target && e.target.matches(".staff-draft-order-section")) {
        initStaffSelectorInSection(e.target, allCustomers);
      }
    });
    document.addEventListener("shopify:section:reorder", () => {
      initAllStaffSelectors(allCustomers);
    });
  }

  // Go
  bootstrap();
})();
