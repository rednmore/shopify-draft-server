# Résumé des points et fichiers impactés

## 1. Serveur Node.js (Render)

But : exposer les routes backend pour gérer clients + commandes staff.

### • `server.js`

- Point d'entrée Express.
- Monte tes routes `sync-customer-data`, `create-draft-order`, `update-draft-order`, etc.
- Charge les variables d'env (`SHOPIFY_API_URL`, `SHOPIFY_API_KEY`, `API_SECRET`, `PUBLIC_WEBHOOK_URL`).
- Pas besoin de trop le modifier sauf pour vérifier que la route `sync-customer-data` est bien montée.

### • `routes/sync-customer-data.js`

- Cœur de la synchro client ↔ Shopify :
  - Parse la `note` (JSON).
  - Aligne `default_address.company`.
  - Upsert metafields `custom.company_name`, `custom.customer_name`, (et éventuellement `custom.custome_name`).
  - Ajoute le champ TVA (`vat_number`) et le tag TVA.
  - Expose routes de debug : `/_ping` et `/_last`.
- Attention : seule la méthode **POST /sync-customer-data** est prévue pour les webhooks. Le `GET` racine renvoie forcément `Cannot GET`.

### • `scripts/register-webhook.js`

- Enregistre les webhooks Shopify :
  - `customers/create`
  - `customers/update`
- L'`address` doit pointer sur **l'URL primaire Render** (ex. `https://shopify-draft-server.onrender.com/sync-customer-data`).
- À relancer si tu modifies `PUBLIC_WEBHOOK_URL`.

## 2. Theme Dawn (front Shopify)

But : permettre aux _staff_ de créer/associer des commandes pour des clients depuis le storefront.

### • `sections/staff-draft-order.liquid`

- Contient le HTML pour le sélecteur client + bouton **Create Draft Order**.
- Intègre aussi le formulaire _Créer un nouveau client_ (si activé).
- Scripts/CSS à inclure avec `defer` pour éviter le warning _parser-blocking_ :
  ```html
  <script src="{{ 'tom-select.complete.min.js' | asset_url }}" defer></script>
  <script src="{{ 'staff-draft-order.js' | asset_url }}" defer></script>
  <link href="{{ 'tom-select.css' | asset_url }}" rel="stylesheet" />
  <link href="{{ 'staff-draft-order.css' | asset_url }}" rel="stylesheet" />
  ```

### • `assets/staff-draft-order.js`

- Gère toute la logique client-side :
  - Fetch `/list-customers` → hydrate TomSelect.
  - Création / mise à jour des draft orders.
  - Bouton "Confirm & Send Order" → complète la commande + email.
  - Option UX : désactiver le bouton si aucun client sélectionné ou panier vide.
  - Formulaire "Créer un client" → POST vers `/create-customer` (à exposer dans ton serveur Node si tu veux cette feature).

### • `assets/staff-draft-order.css`

- Styles associés au bloc staff-order (TomSelect, boutons, formulaire client).

## 3. Modifs sur la navigation / collections (ZYO)

But : contrôler l'expérience d'achat classique sur tes collections.

- Ça se fait dans :
  - **`snippets/quick-order-list.liquid`**
    - Variante du même concept si Dawn utilise ce snippet.

# Actions à retenir

## 1. Render

- Vérifie que `PUBLIC_WEBHOOK_URL` pointe sur `https://shopify-draft-server.onrender.com/sync-customer-data`.
- Teste avec `/_ping` et `/_last`.
- Les webhooks Shopify doivent renvoyer ici.

## 2. Theme Dawn

- `staff-draft-order.liquid` : intégrer bloc + assets avec `defer`.
- `staff-draft-order.js` : garde la logique TomSelect + ajout UX (disable bouton si pas de client/panier vide).
- `staff-draft-order.css` : assurer rendu du sélecteur + formulaire.

## 3. Collections ZYO

- `quick-order-list` : contrôler affichage des boutons d'achat - le popup doit permettre de choisir la variante taille et la quantité et il doit y avoir un bouton add to cart et un bouton remove all.
