// assets/variant-matrix.js
(function () {
  function closestModalRoot(el) {
    return el.closest('quick-add-modal, modal-dialog, .quick-add-modal, details[open]');
  }
  function closeModal(el) {
    const root = closestModalRoot(el);
    if (!root) return;
    // Option 1: bouton avec data-action="close" (Dawn ferme tout seul)
    const closer = root.querySelector('[data-action="close"], .modal__close-button, [aria-label="Close"]');
    if (closer) { closer.click(); return; }
    // Option 2: details[open]
    const details = el.closest('details[open]');
    if (details) details.removeAttribute('open');
  }

  document.addEventListener('click', async (e) => {
    // CANCEL = reset + close
    const cancelBtn = e.target.closest('.vmatrix__cancel');
    if (cancelBtn) {
      const vmatrix = cancelBtn.closest('.vmatrix');
      vmatrix?.querySelectorAll('.vmatrix__qty').forEach(inp => { inp.value = 0; });
      closeModal(cancelBtn);
      return;
    }

    // VALIDATE = add all qty > 0
    const validateBtn = e.target.closest('.vmatrix__validate');
    if (!validateBtn) return;

    const vmatrix = validateBtn.closest('.vmatrix');
    const rows = vmatrix.querySelectorAll('.vmatrix__row');
    const items = [];
    rows.forEach(row => {
      const q = parseInt(row.querySelector('.vmatrix__qty')?.value || '0', 10);
      if (q > 0) {
        items.push({
          id: Number(row.dataset.variantId),
          quantity: q
        });
      }
    });

    if (!items.length) {
      validateBtn.setAttribute('aria-live', 'polite');
      validateBtn.textContent = (validateBtn.dataset.emptyMsg || 'Choisissez au moins une quantité');
      setTimeout(() => (validateBtn.textContent = 'Valider'), 1200);
      return;
    }

    validateBtn.disabled = true;
    try {
      await fetch('/cart/add.js', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items })
      });
      // Option: déclencher un événement pour mettre à jour le mini-panier/cart drawer
      document.dispatchEvent(new CustomEvent('cart:refresh')); // Dawn écoute souvent ce genre d’evt
      // On laisse le popup ouvert (tu peux fermer si tu préfères) :
      // closeModal(validateBtn);
      // Remet les champs à 0 après ajout
      vmatrix.querySelectorAll('.vmatrix__qty').forEach(inp => { inp.value = 0; });
    } catch (err) {
      console.error('matrix add error', err);
    } finally {
      validateBtn.disabled = false;
    }
  });
})();
