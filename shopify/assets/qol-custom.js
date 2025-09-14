// assets/qol-custom.js
(function() {
  function findQtyInput(row) {
    // essaie différentes structures possibles
    return (
      row.querySelector('.variant-item__quantity input[type="number"]') ||
      row.querySelector('.quantity__input') ||
      row.querySelector('input[type="number"]')
    );
  }

  function closestQuickOrderList(el) {
    return el.closest('quick-order-list, .quick-order-list-container, [id^="QuickOrderList"]') || document;
  }

  function closeModalIfAny(trigger) {
    // Si le bouton a data-action="close", Dawn va le capter
    if (trigger && trigger.hasAttribute('data-action') && trigger.getAttribute('data-action') === 'close') {
      trigger.click();
      return;
    }
    // fallback: fermer un <details open> qui servirait de modal
    const detailsOpen = trigger.closest('details[open]');
    if (detailsOpen) detailsOpen.removeAttribute('open');
  }

  document.addEventListener('click', async (e) => {
    const validateBtn = e.target.closest('.qol-validate');
    const cancelBtn = e.target.closest('.qol-cancel');

    // CANCEL
    if (cancelBtn) {
      const root = closestQuickOrderList(cancelBtn);
      root.querySelectorAll('tr.variant-item').forEach((row) => {
        const input = findQtyInput(row);
        if (input) input.value = 0;
      });
      closeModalIfAny(cancelBtn);
      return;
    }

    // VALIDATE
    if (!validateBtn) return;

    const root = closestQuickOrderList(validateBtn);
    const rows = root.querySelectorAll('tr.variant-item[data-variant-id]');
    const items = [];

    rows.forEach((row) => {
      const vid = Number(row.getAttribute('data-variant-id'));
      const input = findQtyInput(row);
      if (!vid || !input) return;
      const q = parseInt(input.value || '0', 10);
      if (q > 0) items.push({ id: vid, quantity: q });
    });

    if (!items.length) {
      // petit feedback
      const txt = validateBtn.textContent;
      validateBtn.textContent = validateBtn.dataset.emptyMsg || 'Choisissez au moins une quantité';
      setTimeout(() => (validateBtn.textContent = txt), 1200);
      return;
    }

    validateBtn.disabled = true;
    try {
      const r = await fetch('/cart/add.js', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items })
      });
      if (!r.ok) {
        console.error('Cart add failed', await r.text());
        return;
      }
      // Remettre à 0 après ajout
      rows.forEach((row) => {
        const input = findQtyInput(row);
        if (input) input.value = 0;
      });

      // Notifier le thème (certains thèmes écoutent un evt pour rafraîchir le mini-panier)
      document.dispatchEvent(new CustomEvent('cart:refresh'));

      // Option: fermer le popup automatiquement (décommente si souhaité)
      // closeModalIfAny(validateBtn);
    } catch (err) {
      console.error(err);
    } finally {
      validateBtn.disabled = false;
    }
  });
})();
