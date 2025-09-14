// assets/staff-draft-order.js
console.log('🚀 staff-draft-order.js chargé');

(() => {
  // ──────────────────────────────────────────────────
  // CHAPITRE 0 — CONSTANTES GLOBALES
  // ──────────────────────────────────────────────────
  const BASE_URL  = "https://shopify-test-server-05d9.onrender.com";
  const API_KEY   = "MacleDo1tRSTHEZ1298";
  const EXPIRY_MS = 24 * 60 * 60 * 1000; // 24h

  // ──────────────────────────────────────────────────
  // UTILITAIRES — INIT ROBUSTE
  // ──────────────────────────────────────────────────

  /**
   * Initialise la combobox + toute la logique de la section passée.
   * Idempotent : détruit l'instance TomSelect existante si nécessaire.
   */
  function initStaffSelectorInSection(section, allCustomers) {
    if (!section || !section.matches('.staff-draft-order-section')) return;

    const sectionId      = section.dataset.sectionId;
    if (!sectionId) return;

    const lsKey          = `staffDraftOrder:${sectionId}`;
    const lsCustomerKey  = `staffDraftOrder:selected:${sectionId}`;

    const selectEl       = section.querySelector("select.client-selector");
    const feedbackEl     = section.querySelector(".feedback");
    const createBtn      = section.querySelector("button.staff-order-button");

    if (!selectEl || !feedbackEl || !createBtn) {
      console.warn('[staff-draft-order] Eléments manquants dans la section', { selectEl, feedbackEl, createBtn });
      return;
    }

    // Définition visible du bouton (comme avant)
    createBtn.textContent = "Create Draft Order";

    const placeholderText  = section.dataset.placeholder              || "Search for opticians…";
    const pleaseSelectText = section.dataset.pleaseSelectCustomerText || "Please select a customer";
    const creatingText     = section.dataset.creatingText             || "Creating…";
    const confirmText      = section.dataset.confirmText              || "Confirm & Send Order";
    const sendingText      = section.dataset.sendingText              || "Sending…";
    const sendErrorText    = section.dataset.sendErrorText            || "Error, retry";
    const sentText         = section.dataset.sentText                 || "Sent!";

    // État local à la section
    let selectedCustomerId = null;
    let confirmBtn         = null;

    // ──────────────────────────────────────────────────
    // Fonction UI : bouton “Confirm & Send Order”
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
          const orderId = completeData.order_id || (completeData.order && completeData.order.id);

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
    // Restauration d’un draft (avant init TomSelect) — logique inchangée
    // ──────────────────────────────────────────────────
    (async () => {
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
    // INITIALISATION TomSelect — avec gardes + idempotence
    // ──────────────────────────────────────────────────
    console.log('🚀 allCustomers passed to TomSelect:', allCustomers);
    if (selectEl.tomselect) {
      try { selectEl.tomselect.destroy(); } catch(_) {}
    }

    if (typeof TomSelect === 'undefined') {
      console.error('❌ TomSelect non défini — vérifier le chargement de tom-select.complete.min.js');
      feedbackEl.textContent = '❌ Erreur de chargement Tom Select.';
      return;
    }

    const ts = new TomSelect(selectEl, {
      valueField:       "id",
      labelField:       "text",
      searchField:      ["text"],
      options:          Array.isArray(allCustomers) ? allCustomers : [],
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
    // Restauration (après init TomSelect) — logique inchangée
    // ──────────────────────────────────────────────────
    (async () => {
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
    // Clic sur “Create Draft Order” — logique inchangée
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
  }

  /**
   * Initialise toutes les sections présentes dans la page.
   */
  function initAllStaffSelectors(allCustomers) {
    document.querySelectorAll(".staff-draft-order-section")
      .forEach(section => initStaffSelectorInSection(section, allCustomers));
  }

  // ──────────────────────────────────────────────────
  // BOOTSTRAP — charge la liste clients puis initialise proprement
  // ──────────────────────────────────────────────────
  async function bootstrap() {
    console.log('📑 bootstrap start');

    // CHAPITRE 1 — CHARGEMENT UNIQUE DE TOUS LES CLIENTS
    let allCustomers = [];
    try {
      const res  = await fetch(`${BASE_URL}/list-customers?key=${encodeURIComponent(API_KEY)}`, { mode: "cors" });
      const data = await res.json();
      if (!Array.isArray(data)) throw new Error("Invalid clients data");
      allCustomers = data.map(c => ({ id: c.id, text: c.label }));
      console.log('🚀 allCustomers:', allCustomers);
    } catch (err) {
      console.error('❌ Impossible de charger les clients :', err);
      // Mode dégradé : on continue l'init (options vides) pour que la combobox s'affiche quand même
      document
        .querySelectorAll(".staff-draft-order-section .feedback")
        .forEach(el => el.textContent = "❌ Clients non chargés (mode dégradé).");
    }

    // Initialisation immédiate / ou au DOM ready
    const startInit = () => initAllStaffSelectors(allCustomers);
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', startInit, { once: true });
    } else {
      startInit();
    }

    // Re-init quand l’éditeur recharge une section
    document.addEventListener('shopify:section:load', (e) => {
      if (e.target && e.target.matches('.staff-draft-order-section')) {
        initStaffSelectorInSection(e.target, allCustomers);
      }
    });

    // Optionnel : re-init après réordonnancement
    document.addEventListener('shopify:section:reorder', () => {
      initAllStaffSelectors(allCustomers);
    });
  }

  // Lance le bootstrap
  bootstrap();
})();
