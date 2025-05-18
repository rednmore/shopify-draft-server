// assets/staff-draft-order.js

document.addEventListener("DOMContentLoaded", async () => {
  // ──────────────────────────────────────────────────
  // CHAPITRE 0 — CONSTANTES GLOBALES
  // ──────────────────────────────────────────────────
  const BASE_URL       = "https://shopify-test-server-05d9.onrender.com";
  const API_KEY        = "MacleDo1tRSTHEZ1298";
  const EMAIL_ENDPOINT = `${BASE_URL}/send-order-email`;
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
  } catch (err) {
    document.querySelectorAll(".staff-draft-order-section .feedback")
            .forEach(el => el.textContent = "❌ Impossible de charger les clients.");
    return;
  }

  // ──────────────────────────────────────────────────
  // CHAPITRE 2 — INITIALISATION PAR SECTION
  // ──────────────────────────────────────────────────
  document.querySelectorAll(".staff-draft-order-section").forEach(section => {
    // 2.0 — Variables spécifiques à la section
    const sectionId         = section.dataset.sectionId;
    if (!sectionId) return;

    const lsKey             = `staffDraftOrder:${sectionId}`;
    const lsCustomerKey     = `staffDraftOrder:selected:${sectionId}`;
    const selectEl          = section.querySelector("select.client-selector");
    const feedbackEl        = section.querySelector(".feedback");
    const createBtn         = section.querySelector("button.staff-order-button");

    const placeholderText   = section.dataset.placeholder               || "Search for opticians…";
    const pleaseSelectText  = section.dataset.pleaseSelectCustomerText  || "Please select a customer";
    const creatingText      = section.dataset.creatingText              || "Creating…";
    const confirmText       = section.dataset.confirmText               || "Confirm Order";
    const sendingText       = section.dataset.sendingText               || "Sending…";
    const sendErrorText     = section.dataset.sendErrorText             || "Error, retry";
    const sentText          = section.dataset.sentText                  || "Sent!";

    let selectedCustomerId = null;
    let confirmBtn         = null;

/// ──────────────────────────────────────────────────
// 2.1 — Fonction : afficher “Confirm Order”
// ──────────────────────────────────────────────────

function renderConfirmButton(invoiceUrl, draftId) {
  // masquer “Create order”
  createBtn.style.display = "none";
  feedbackEl.innerHTML    = "";

  // créer et afficher le bouton de confirmation
  confirmBtn = document.createElement("button");
  confirmBtn.textContent           = confirmText;
  confirmBtn.className             = createBtn.className;
  confirmBtn.style.backgroundColor = createBtn.style.backgroundColor;
  confirmBtn.style.color           = createBtn.style.color;
  feedbackEl.appendChild(confirmBtn);

  confirmBtn.addEventListener("click", async () => {
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
          body: JSON.stringify({ 
            invoice_url: invoiceUrl, 
            draft_id: draftId })
        }
      );
      // Lire une seule fois le JSON
      const completeData = await completeRes.json();
      if (!completeRes.ok || (!completeData.order_id && !completeData.order?.id)) {
        throw { message: 'Failed to complete draft', status: completeRes.status, detail: completeData };
      }
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
      if (!sendRes.ok) {
        const err = await sendRes.json().catch(() => ({}));
        throw err;
      }

      confirmBtn.textContent = sentText;
       // vider le panier côté Storefront
    await fetch('/cart/clear.js', { method: 'POST' });
         // supprimer le draft pending
      localStorage.removeItem(lsKey);
    } catch (err) {
      console.error("❌ Erreur confirmation :", err);
      confirmBtn.disabled    = false;
      confirmBtn.textContent = sendErrorText;
    }
  });
}

    // ──────────────────────────────────────────────────
    // 2.2 — Restauration d’un draft non validé
    // ──────────────────────────────────────────────────
    try {
      const raw = localStorage.getItem(lsKey);
      if (raw) {
        const pending = JSON.parse(raw);
        if (Date.now() - pending.ts < EXPIRY_MS) {
          // restaurer le client sélectionné
          selectedCustomerId = localStorage.getItem(lsCustomerKey);
          renderConfirmButton(pending.invoice_url, pending.draft_id);
        } else {
          localStorage.removeItem(lsKey);
        }
      }
    } catch {
      localStorage.removeItem(lsKey);
    }

    // ──────────────────────────────────────────────────
    // 2.3 — INITIALISATION TomSelect (options locales)
    // ──────────────────────────────────────────────────
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

      onInitialize() {
        this.clear(true);
        // si un client est déjà persistant → le re-sélectionner
        const saved = localStorage.getItem(lsCustomerKey);
        if (saved) this.addItem(saved);
      },

      onItemAdd(value) {
        // mémoriser le client
        selectedCustomerId = value;
        localStorage.setItem(lsCustomerKey, value);
        // remettre l’interface en mode “Create order”
        feedbackEl.textContent = "";
        createBtn.style.display = "";
        if (confirmBtn) {
          confirmBtn.remove();
          confirmBtn = null;
        }
      }
    }); // ← fin de TomSelect

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
            renderConfirmButton(pending.invoice_url, pending.draft_id);
            return;
          }
        }
        localStorage.removeItem(lsKey);
      } catch {
        localStorage.removeItem(lsKey);
      }
    })();

    // ──────────────────────────────────────────────────
    // 2.5 — Clic sur “Create order”
    // ──────────────────────────────────────────────────
    createBtn.addEventListener("click", async () => {
      if (!selectedCustomerId) {
        feedbackEl.textContent = pleaseSelectText;
        return;
      }
      // basculer en “chargement”
      createBtn.style.display = "none";
      feedbackEl.textContent  = `⏳ ${creatingText}`;

      try {
        const cart = await (await fetch("/cart.js")).json();
        const resp = await fetch(
          `${BASE_URL}/create-draft-order?key=${encodeURIComponent(API_KEY)}`,
          {
            method:  "POST",
            mode:    "cors",
            headers: { "Content-Type": "application/json" },
            body:    JSON.stringify({
              customer_id: selectedCustomerId,
              items:       cart.items.map(i => ({ variant_id: i.variant_id, quantity: i.quantity }))
            })
          }
        );
        const result = await resp.json();
        if (!resp.ok) throw result;

       // stocker état pending + count panier + draft_id
          localStorage.setItem(lsKey, JSON.stringify({
              ts:          Date.now(),
              invoice_url: result.invoice_url,
              cartCount:   cart.items.reduce((sum, i) => sum + i.quantity, 0),
              draft_id:    result.draft_id
          }));

        // afficher “Confirm Order” en transmettant les 2 infos
          renderConfirmButton(result.invoice_url, result.draft_id);


      } catch (err) {
        feedbackEl.textContent  = `❌ ${err.message || "Error"}`;
        createBtn.style.display = ""; // restaurer en cas d’erreur
      }
    });
  });
});
