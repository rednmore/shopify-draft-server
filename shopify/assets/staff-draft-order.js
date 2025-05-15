// assets/staff-draft-order.js

document.addEventListener("DOMContentLoaded", () => {
  const API_KEY = "MacleDo1tRSTHEZ1298";

  document
    .querySelectorAll(".staff-draft-order-section")
    .forEach(section => {
      const selectEl   = section.querySelector("select.client-selector");
      const feedbackEl = section.querySelector(".feedback");
      const createBtn  = section.querySelector("button.staff-order-button");
      let selectedCustomerId = null;

      if (!selectEl || !feedbackEl || !createBtn) {
        console.error("❌ Un élément manque dans staff-draft-order.liquid");
        return;
      }

      // Initialiser Tom Select en mode remote load
      new TomSelect(selectEl, {
        valueField:       "id",
        labelField:       "text",
        searchField:      ["text"],
        placeholder:      section.dataset.placeholder || "Search for opticians…",
        maxOptions:       10,
        loadThrottle:     300,
        preload:          false,
        allowEmptyOption: true,
        persist:          false,
        closeAfterSelect: true,
        hideSelected:     false,
        mode:             "single",

        // Chargement dynamique à chaque saisie
        load: function(query, callback) {
          if (!query.length) return callback();
          fetch(
            `https://shopify-draft-server.onrender.com/list-customers?key=${encodeURIComponent(API_KEY)}&q=${encodeURIComponent(query)}`,
            { method: "GET", mode: "cors" }
          )
            .then(res => res.json())
            .then(data => {
              const options = Array.isArray(data)
                ? data.map(c => ({ id: c.id, text: c.label }))
                : [];
              callback(options);
            })
            .catch(() => callback());
        },

        render: {
          option: (item, escape) => {
            const div = document.createElement("div");
            div.textContent = escape(item.text);
            return div;
          }
        },

        // Au démarrage, on s'assure que rien n'est sélectionné
        onInitialize: function() {
          this.clear(true);
        },

        // Quand un client est cliqué dans la liste
        onItemAdd: function(value) {
          selectedCustomerId = value;
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
          const cart = await (await fetch("/cart.js")).json();
          const resp = await fetch(
            `https://shopify-draft-server.onrender.com/create-draft-order?key=${encodeURIComponent(API_KEY)}`,
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
    });
});
