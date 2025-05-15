// assets/staff-draft-order.js

/**
 * Initialise une section Staff Draft Order donnée
 * @param {HTMLElement} section 
 * @param {Array} customers 
 * @param {string} apiKey
 */
function initStaffDraftOrderSection(section, customers, apiKey) {
  const selectEl   = section.querySelector("select.client-selector");
  const feedbackEl = section.querySelector(".feedback");
  const createBtn  = section.querySelector("button.staff-order-button");

  if (!selectEl || !feedbackEl || !createBtn) {
    console.error("❌ Un élément manque dans staff-draft-order.liquid");
    return;
  }
  // Affiche « Loading … » immédiatement
  selectEl.innerHTML = '<option>Loading …</option>';
 
  // remplir le <select> avec une option vide puis la liste
  selectEl.innerHTML = "";
  const emptyOpt = document.createElement("option");
  emptyOpt.value = "";
  emptyOpt.textContent = "";
  selectEl.appendChild(emptyOpt);
  customers.forEach(c => {
    const opt = document.createElement("option");
    opt.value = c.id;
    opt.textContent = c.label || `Client ${c.id}`;
    selectEl.appendChild(opt);
  });
  selectEl.value = "";

  let selectedCustomerId = null;

  // Initialiser Tom Select
  new TomSelect(selectEl, {
    placeholder:      "Search for opticians …",
    hidePlaceholder:  true,
    maxOptions:       500,
    allowEmptyOption: true,
    persist:          false,
    closeAfterSelect: true,
    hideSelected:     false,
    mode:             "single",
    sortField:        { field: "text", direction: "asc" },
    onType: function(search) {
      if (search.length > 0) {
        this.clear(true);
      }
    },
    render: {
      option: (data, escape) => {
        const div = document.createElement("div");
        div.textContent = escape(data.text);
        return div;
      }
    },
    onInitialize: function() {
      this.clear(true);
      this.setTextboxValue("");
      this.refreshOptions(false);
    },
    onItemAdd: function(value) {
      selectedCustomerId = value;
      this.setTextboxValue("");
      this.refreshOptions(false);
      requestAnimationFrame(() => this.control_input.focus());
    }
  });

  // Bouton “Créer la commande”
  createBtn.addEventListener("click", async () => {
    if (!selectedCustomerId) {
      feedbackEl.textContent = "❌ Veuillez sélectionner un client.";
      return;
    }
    feedbackEl.textContent = "⏳ Création de la commande…";

    try {
      const cart    = await (await fetch("/cart.js")).json();
      const resp    = await fetch(
        `https://shopify-draft-server.onrender.com/create-draft-order?key=${encodeURIComponent(apiKey)}`,
        {
          method:  "POST",
          mode:    "cors",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({
            customer_id: selectedCustomerId,
            items:       cart.items.map(i => ({
              variant_id: i.variant_id,
              quantity:   i.quantity
            }))
          })
        }
      );
      const result = await resp.json();
      if (resp.ok) {
        feedbackEl.innerHTML =
          `✅ Commande créée. <a href="${result.invoice_url}" target="_blank">Voir la facture</a>`;
      } else {
        feedbackEl.textContent = `❌ Erreur : ${result.message}`;
      }
    } catch (e) {
      console.error("❌ Erreur JS :", e);
      feedbackEl.textContent = "❌ Une erreur est survenue.";
    }
  });
}

// point d’entrée
document.addEventListener("DOMContentLoaded", async () => {
  const API_KEY = "MacleDo1tRSTHEZ1298";
  let customers = [];

  // 1) Charger la liste des clients une fois
  try {
    const res = await fetch(
      `https://shopify-draft-server.onrender.com/list-customers?key=${encodeURIComponent(API_KEY)}`,
      { method: "GET", mode: "cors" }
    );
    customers = await res.json();
    if (!Array.isArray(customers)) throw new Error("Données invalides");
  } catch (error) {
    console.error("❌ Impossible de charger les clients :", error);
    document
      .querySelectorAll(".staff-draft-order-section .feedback")
      .forEach(el => (el.textContent = "❌ Impossible de charger les clients."));
    return;
  }

  // 2) Initialiser chaque section séparément via la fonction factorisée
  document
    .querySelectorAll(".staff-draft-order-section")
    .forEach(section => initStaffDraftOrderSection(section, customers, API_KEY));
});
