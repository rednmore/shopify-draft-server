// assets/staff-draft-order.js
console.log('🚀 staff-draft-order.js chargé et exécuté');
document.addEventListener("DOMContentLoaded", async () => {
   console.log('📑 DOMContentLoaded fired');
  // ──────────────────────────────────────────────────
  // CHAPITRE 0 — CONSTANTES GLOBALES
  // ──────────────────────────────────────────────────
  const BASE_URL       = "https://shopify-test-server-05d9.onrender.com";
  const API_KEY        = "MacleDo1tRSTHEZ1298";
  const EXPIRY_MS      = 24 * 60 * 60 * 1000; // 24h

  // ──────────────────────────────────────────────────
  // CHAPITRE 1 — CHARGEMENT UNIQUE DE TOUS LES CLIENTS
  // ──────────────────────────────────────────────────
  let allCustomers = [];
  try {
    const res  = await fetch(`${BASE_URL}/list-customers?key=${encodeURIComponent(API_KEY)}`, { mode: "cors" });
    const data = await res.json();
    if (!Array.isArray(data)) throw new Error("Invalid clients data");
    allCustomers = data.map(c => ({ id: c.id, text: c.label }));
    console.log('🚀 allCustomers:', allCustomers);
  } catch (err) {
    document
      .querySelectorAll(".staff-draft-order-section .feedback")
      .forEach(el => el.textContent = "❌ Impossible de charger les clients.");
    return;
  }

  // ──────────────────────────────────────────────────
  // CHAPITRE 2 — INITIALISATION PAR SECTION
  // ──────────────────────────────────────────────────
  document.querySelectorAll(".staff-draft-order-section").forEach(section => {
    // 2.0 — Variables spécifiques à la section
    const sectionId      = section.dataset.sectionId;
    if (!sectionId) return;

    const lsKey          = `staffDraftOrder:${sectionId}`;
    const lsCustomerKey  = `staffDraftOrder:selected:${sectionId}`;
    const selectEl       = section.querySelector("select.client-selector");
    const feedbackEl     = section.querySelector(".feedback");
    const createBtn      = section.querySelector("button.staff-order-button");
    // renommer pour éviter toute confusion
    createBtn.textContent = "Create Draft Order";

    const placeholderText  = section.dataset.placeholder              || "Search for opticians…";
    const pleaseSelectText = section.dataset.pleaseSelectCustomerText || "Please select a customer";
    const creatingText     = section.dataset.creatingText             || "Creating…";
    const confirmText      = section.dataset.confirmText              || "Confirm & Send Order";
    const sendingText      = section.dataset.sendingText              || "Sending…";
    const sendErrorText    = section.dataset.sendErrorText            || "Error, retry";
    const sentText         = section.dataset.sentText                 || "Sent!";

    let selectedCustomerId = null;
    let confirmBtn         = null;

    // ──────────────────────────────────────────────────
    // 2.1 — Fonction : afficher “Confirm & Send Order”
    // ──────────────────────────────────────────────────
    function renderConfirmButton(invoiceUrl, draftId) {
      // masquer “Create Draft Order”
      createBtn.style.display = "none";
      feedbackEl.innerHTML    = "";

      // créer et afficher le bouton de confirmation
      confirmBtn = document.createElement("button");
      confirmBtn.textContent           = confirmText;
      confirmBtn.className             = createBtn.className;
      confirmBtn.style.backgroundColor = createBtn.style.backgroundColor;
      confirmBtn.style.color           = createBtn.style.color;
      feedbackEl.appendChild(confirmBtn);

      // 1er clic : compléter + envoyer l’email
      const onConfirm = async () => {
        confirmBtn.disabled    = true;
        confirmBtn.textContent = sendingText;
        try {
          // 1) Transformer le draft en commande confirmée
          const completeRes = await fetch(
            `${BASE_URL}/complete-draft-order?key=${encodeURIComponent(API_KEY)}`,
            {
              method: 'POST',
              mode:   'cors',
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ invoice_url: invoiceUrl, draft_id: draftId })
            }
          );
          const completeData = await completeRes.json();
          if (!completeRes.ok) throw completeData;
          const orderId = completeData.order_id || completeData.order.id;

          // 2) Envoyer la confirmation de commande par email
          const sendRes = await fetch(
            `${BASE_URL}/send-order-confirmation?key=${encodeURIComponent(API_KEY)}`,
            {
              method: 'POST',
              mode:   'cors',
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                customer_id: selectedCustomerId,
                order_id:    orderId,
                cc:          ["info@rednmore.com"]
              })
            }
          );
          if (!sendRes.ok) throw await sendRes.json();

          // 3) Passer en mode “Sent! → Click for new order”
          confirmBtn.disabled    = false;
          confirmBtn.textContent = `${sentText} → Click for new order`;
          // marquer en localStorage que c'est finalisé
          localStorage.setItem(lsKey, JSON.stringify({
            ts: Date.now(),
            invoiceUrl,
            draft_id: draftId,
            cartCount: null,
            completed: true
          }));
          confirmBtn.removeEventListener("click", onConfirm);

          // 4) 2ᵉ clic : vider le panier et rediriger
          confirmBtn.addEventListener("click", async () => {
            await fetch('/cart/clear.js', { method: 'POST', credentials: 'same-origin' });
            localStorage.removeItem(lsKey);
            localStorage.removeItem(lsCustomerKey);
            window.top.location = window.location.origin + '/collections/all';
          });
        } catch (err) {
          console.error("❌ Erreur confirmation :", err);
          confirmBtn.disabled    = false;
          confirmBtn.textContent = sendErrorText;
        }
      };

      confirmBtn.addEventListener("click", onConfirm);
    }

    // ──────────────────────────────────────────────────
    // 2.2 — Restauration d’un draft non validé ou finalisé
    // ──────────────────────────────────────────────────
    ;(async () => {
      try {
        const raw = localStorage.getItem(lsKey);
        if (!raw) return;

        const pending = JSON.parse(raw);
        const cart        = await (await fetch('/cart.js')).json();
        const currentCount = cart.items.reduce((sum, i) => sum + i.quantity, 0);

        if (pending.completed) {
          selectedCustomerId = localStorage.getItem(lsCustomerKey);
          renderConfirmButton(pending.invoiceUrl, pending.draft_id);
          return;
        }

        if (
          Date.now() - pending.ts < EXPIRY_MS &&
          pending.cartCount === currentCount
        ) {
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

    // ──────────────────────────────────────────────────
    // 2.3 — INITIALISATION TomSelect
    // ──────────────────────────────────────────────────
    console.log('🚀 allCustomers passed to TomSelect:', allCustomers);
    console.log('→ typeof TomSelect:', typeof TomSelect);
    console.log('→ selectEl (should be <select>):', selectEl);

    const ts = new TomSelect(selectEl, {
      valueField:       "id",
      labelField:       "text",
      searchField:      ["text"],
      options:          allCustomers,
      placeholder:      placeholderText,
      maxOptions:       8,
      preload:          true,
      allowEmptyOption: true,
      persist:          false,
      closeAfterSelect: true,
      mode:             "single",

      onType(str) {
        this.clear(true);
        selectedCustomerId = null;
        localStorage.removeItem(lsCustomerKey);
        if (confirmBtn) {
          confirmBtn.remove();
          confirmBtn = null;
          createBtn.style.display = "";
        }
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
        if (confirmBtn) {
          confirmBtn.remove();
          confirmBtn = null;
        }
      }
    });

    // ──────────────────────────────────────────────────
    // 2.4 — Restaurer draft APRÈS TomSelect si panier inchangé
    // ──────────────────────────────────────────────────
    ;(async () => {
      try {
        const raw = localStorage.getItem(lsKey);
        if (!raw) return;
        const pending = JSON.parse(raw);
        if (Date.now() - pending.ts < EXPIRY_MS) {
          const cart = await (await fetch("/cart.js")).json();
          const currentCount = cart.items.reduce((sum, i) => sum + i.quantity, 0);
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
    })();

    // ──────────────────────────────────────────────────
    // 2.5 — Clic sur “Create Draft Order” ou mise à jour si existant
    // ──────────────────────────────────────────────────
    createBtn.addEventListener("click", async () => {
      if (!selectedCustomerId) {
        feedbackEl.textContent = pleaseSelectText;
        return;
      }

      createBtn.style.display = "none";
      feedbackEl.textContent  = `⏳ ${creatingText}`;

      try {
        const cart  = await (await fetch("/cart.js")).json();
        const items = cart.items.map(i => ({
          variant_id: i.variant_id,
          quantity:   i.quantity
        }));

        const pendingRaw = localStorage.getItem(lsKey);
        let endpoint, requestBody, draftId;
        if (pendingRaw) {
          const pending   = JSON.parse(pendingRaw);
          endpoint    = "/update-draft-order";
          draftId     = pending.draft_id;
          requestBody = { draft_id: draftId, items, customer_id: selectedCustomerId };
        } else {
          endpoint    = "/create-draft-order";
          requestBody = { customer_id: selectedCustomerId, items };
        }

        const resp = await fetch(
          `${BASE_URL}${endpoint}?key=${encodeURIComponent(API_KEY)}`,
          {
            method:  "POST",
            mode:    "cors",
            headers: { "Content-Type": "application/json" },
            body:    JSON.stringify(requestBody)
          }
        );
        const data = await resp.json();
        if (!resp.ok) throw data;

        const newDraftId = data.draft_id || draftId;
        const invoiceUrl = data.invoice_url;
        localStorage.setItem(lsKey, JSON.stringify({
          ts:          Date.now(),
          invoiceUrl,
          cartCount:   cart.items.reduce((sum, i) => sum + i.quantity, 0),
          draft_id:    newDraftId
        }));

        renderConfirmButton(invoiceUrl, newDraftId);
      } catch (err) {
        console.error("❌ Erreur création/mise à jour du draft :", err);
        feedbackEl.textContent  = `❌ ${err.message || "Error"}`;
        createBtn.style.display = "";
      }
    });

  }); // forEach section

}); // DOMContentLoaded
