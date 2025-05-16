// assets/staff-draft-order.js

document.addEventListener("DOMContentLoaded", () => {
  const BASE_URL       = "https://shopify-test-server-05d9.onrender.com";
  const API_KEY        = "MacleDo1tRSTHEZ1298";
  const EMAIL_ENDPOINT = `${BASE_URL}/send-order-email`;
  const EXPIRY_MS      = 24 * 60 * 60 * 1000; // 24h

  document.querySelectorAll(".staff-draft-order-section").forEach(section => {
    const sectionId = section.dataset.sectionId;
    if (!sectionId) {
      console.error("❌ staff-draft-order: il manque data-section-id");
      return;
    }

    // clés & textes dynamiques
    const lsKey            = `staffDraftOrder:${sectionId}`;
    const selectEl         = section.querySelector("select.client-selector");
    const feedbackEl       = section.querySelector(".feedback");
    const createBtn        = section.querySelector("button.staff-order-button");
    const placeholderText  = section.dataset.placeholder      || "Search for opticians…";
    const pleaseSelectText = section.dataset.pleaseSelectCustomerText || "Please select a customer";
    const creatingText     = section.dataset.creatingText    || "Creating…";
    const validateSendText = section.dataset.validateSendText|| "Click to validate & send order by email";
    const sendingText      = section.dataset.sendingText     || "Sending…";
    const sendErrorText    = section.dataset.sendErrorText   || "Error, retry";
    const sentText         = section.dataset.sentText        || "Sent!";

    let selectedCustomerId = null;

    // Fonction pour afficher le bouton de validation
    function renderValidateButton(invoiceUrl) {
      feedbackEl.innerHTML = "";
      const btn = document.createElement("button");
      btn.textContent = validateSendText;
      // reprendre le style de createBtn
      btn.className = createBtn.className;
      btn.style.backgroundColor = createBtn.style.backgroundColor;
      btn.style.color           = createBtn.style.color;
      feedbackEl.appendChild(btn);

      btn.addEventListener("click", async () => {
        btn.disabled    = true;
        btn.textContent = sendingText;
        try {
          await fetch(EMAIL_ENDPOINT, {
            method:  "POST",
            headers: { "Content-Type": "application/json" },
            body:    JSON.stringify({
              customer_id: selectedCustomerId,
              invoice_url,
              cc:           ["info@rednmore.com"]
            })
          });
          btn.textContent = sentText;
          localStorage.removeItem(lsKey);
        } catch (err) {
          console.error("❌ Erreur envoi email :", err);
          btn.disabled    = false;
          btn.textContent = sendErrorText;
        }
      });
    }

    // restauration si draft créé mais pas encore validé
    let pending;
    try {
      pending = JSON.parse(localStorage.getItem(lsKey));
    } catch {
      pending = null;
    }
    if (pending && Date.now() - pending.ts < EXPIRY_MS) {
      renderValidateButton(pending.invoice_url);
    } else {
      localStorage.removeItem(lsKey);
    }

    // initialisation TomSelect
    const ts = new TomSelect(selectEl, {
      valueField:       "id",
      labelField:       "text",
      searchField:      ["text"],
      placeholder:      placeholderText,
      maxOptions:       500,
      loadThrottle:     300,
      preload:          false,
      allowEmptyOption: true,
      persist:          false,
      closeAfterSelect: true,
      mode:             "single",

      // ouvre la liste et recharge sans taper
      onFocus() {
        this.load(this.input.value || "");
        this.open();
      },

      onType(search) {
        if (search.length) {
          this.clear(true);
          this.setTextboxValue(search);
          this.refreshOptions(false);
        }
      },

      load(query, cb) {
        fetch(
          `${BASE_URL}/list-customers?key=${encodeURIComponent(API_KEY)}&q=${encodeURIComponent(query)}`,
          { mode: "cors" }
        )
          .then(r => r.json())
          .then(data => cb(Array.isArray(data)
            ? data.map(c => ({ id: c.id, text: c.label }))
            : []
          ))
          .catch(() => cb());
      },

      render: {
        option: (item, esc) => {
          const d = document.createElement("div");
          d.textContent = esc(item.text);
          return d;
        }
      },

      onInitialize() {
        this.clear(true);
      },

      onItemAdd(value) {
        selectedCustomerId = value;
        feedbackEl.textContent = "";
      }
    });

    // clic sur "Create order"
    createBtn.addEventListener("click", async () => {
      if (!selectedCustomerId) {
        feedbackEl.textContent = pleaseSelectText;
        return;
      }
      feedbackEl.textContent = "⏳ " + creatingText;

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

        // on stocke l’état pending
        localStorage.setItem(lsKey, JSON.stringify({
          ts:          Date.now(),
          invoice_url: result.invoice_url
        }));

        // on affiche le bouton "validate & send"
        renderValidateButton(result.invoice_url);

      } catch (err) {
        console.error("❌ Erreur création draft :", err);
        feedbackEl.textContent = `❌ ${err.message || "Error"}`;
      }
    });
  });
});
