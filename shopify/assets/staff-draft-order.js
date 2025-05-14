 document.addEventListener("DOMContentLoaded", function () {
  const selector = document.getElementById("client-selector");
  const feedback = document.getElementById("feedback");
  const info = document.getElementById("selected-info");

  const API_KEY = "MacleDo1tRSTHEZ1298";
  console.log("🔑 Clé API utilisée :", API_KEY);

  fetch("https://shopify-draft-server.onrender.com/list-customers?key=" + encodeURIComponent(API_KEY), {
    method: "GET",
    mode: "cors"
  })
    .then(res => {
      console.log("🌐 Statut réponse serveur :", res.status);
      return res.json();
    })
    .then(customers => {
      console.log("📦 Clients reçus du backend :", customers);

      if (!Array.isArray(customers)) {
        feedback.innerHTML = "❌ Données client invalides.";
        return;
      }

      selector.innerHTML = '<option value="">-- Choisir un client --</option>';

      customers.forEach(client => {
        console.log("👤 Client affiché :", client);
        const opt = document.createElement("option");
        opt.value = client.id;
        opt.textContent = client.label || `Client ${client.id}`;
        selector.appendChild(opt);
      });
    })
    .catch(error => {
      console.error("❌ Erreur lors du chargement des clients :", error);
      feedback.innerHTML = "❌ Impossible de charger les clients.";
    });

  selector.addEventListener("change", function () {
    const selectedId = selector.value;
    const selectedText = selector.options[selector.selectedIndex].text;
    info.innerHTML = selectedId ? `👤 Client sélectionné : <strong>${selectedText}</strong>` : "";
  });
});
