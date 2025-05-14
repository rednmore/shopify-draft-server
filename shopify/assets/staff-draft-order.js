document.addEventListener("DOMContentLoaded", function () {
  const select = document.getElementById("client-selector");
  const feedback = document.getElementById("feedback");
  const info = document.getElementById("selected-info");
  const API_KEY = "MacleDo1tRSTHEZ1298";

  if (!select || !feedback || !info) {
    console.error("❌ Éléments requis non trouvés dans le DOM");
    return;
  }

  fetch("https://shopify-draft-server.onrender.com/list-customers?key=" + encodeURIComponent(API_KEY), {
    method: "GET",
    mode: "cors"
  })
    .then(res => res.json())
    .then(customers => {
      if (!Array.isArray(customers)) {
        feedback.innerHTML = "❌ Données client invalides.";
        return;
      }

      // Supprimer les options précédentes
      select.innerHTML = "";

      // Ajouter les nouvelles options
      customers.forEach(client => {
        const option = document.createElement("option");
        option.value = client.id;
        option.textContent = client.label || `Client ${client.id}`;
        select.appendChild(option);
      });

      // Initialiser TomSelect
new TomSelect("#client-selector", {
  placeholder: "Recherchez un client...",
  maxOptions: 500,
  allowEmptyOption: true,
  persist: false,
  closeAfterSelect: false,
  hideSelected: false,
  sortField: {
    field: "text",
    direction: "asc"
  },
  onItemAdd: function () {
    // ✅ Garde la sélection, mais vide le champ de recherche visuelle
    this.setTextboxValue('');       // ⬅️ Vide la zone de saisie
    this.refreshOptions(false);     // ⬅️ Recharge les options proprement
  },
  render: {
    item: function(data, escape) {
      // ✅ Affiche uniquement le nom dans le champ sélectionné
      return '<div>' + escape(data.text) + '</div>';
    },
    option: function(data, escape) {
      return '<div>' + escape(data.text) + '</div>';
    }
  }
});

      feedback.innerHTML = ""; // On efface les erreurs
    })
    .catch(error => {
      console.error("❌ Erreur lors du chargement des clients :", error);
      feedback.innerHTML = "❌ Impossible de charger les clients.";
    });

  // Écoute du bouton
  document.getElementById("create-draft-order").addEventListener("click", async function () {
    const selectedId = select.value;

    if (!selectedId) {
      feedback.innerHTML = "❌ Veuillez sélectionner un client.";
      return;
    }

    feedback.innerHTML = "⏳ Création de la commande...";

    try {
      const cartRes = await fetch('/cart.js');
      const cart = await cartRes.json();

      const response = await fetch("https://shopify-draft-server.onrender.com/create-draft-order?key=" + encodeURIComponent(API_KEY), {
        method: "POST",
        mode: "cors",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customer_id: selectedId,
          items: cart.items.map(item => ({
            variant_id: item.variant_id,
            quantity: item.quantity
          }))
        })
      });

      const result = await response.json();
      if (response.ok) {
        feedback.innerHTML = `✅ Commande créée. <a href="${result.invoice_url}" target="_blank">Voir la facture</a>`;
      } else {
        feedback.innerHTML = `❌ Erreur : ${result.message}`;
      }
    } catch (e) {
      console.error("❌ Erreur JS :", e);
      feedback.innerHTML = "❌ Une erreur est survenue.";
    }
  });
});
