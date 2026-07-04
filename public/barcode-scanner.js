/**
 * Barkod/karekod tarama — data-barcode-scan işaretli text input'lara
 * kamera ikonu ekler, tıklanınca kamera açılır, okunan kod input'a yazılır.
 * Kütüphane: html5-qrcode (CDN script tag ile bu dosyadan önce yüklenmeli).
 */
(function () {
  let html5QrCode = null;
  let activeInput = null;
  let isProcessing = false;

  function ensureModal() {
    let modal = document.getElementById('barcodeScanModal');
    if (modal) return modal;
    modal = document.createElement('div');
    modal.id = 'barcodeScanModal';
    modal.className = 'barcode-scan-modal';
    modal.innerHTML =
      '<div class="barcode-scan-box">' +
        '<div class="barcode-scan-header">' +
          '<span>&#128247; Barkod Okut</span>' +
          '<button type="button" class="barcode-scan-close" aria-label="Kapat">&times;</button>' +
        '</div>' +
        '<div id="barcodeScanReader"></div>' +
        '<div class="barcode-scan-hint">Barkodu kameraya gösterin</div>' +
      '</div>';
    document.body.appendChild(modal);
    modal.querySelector('.barcode-scan-close').addEventListener('click', closeScanner);
    modal.addEventListener('click', function (e) { if (e.target === modal) closeScanner(); });
    return modal;
  }

  function openScanner(input) {
    if (typeof Html5Qrcode === 'undefined') {
      alert('Tarayıcı kütüphanesi yüklenemedi. İnternet bağlantınızı kontrol edin.');
      return;
    }
    const modal = ensureModal();
    activeInput = input;
    isProcessing = false;
    modal.classList.add('open');

    html5QrCode = new Html5Qrcode('barcodeScanReader');
    html5QrCode.start(
      { facingMode: 'environment' },
      { fps: 10, qrbox: { width: 250, height: 150 } },
      function (decodedText) {
        if (isProcessing) return;
        isProcessing = true;
        const target = activeInput;
        closeScanner();
        if (target) {
          target.value = decodedText.trim();
          target.dispatchEvent(new Event('input', { bubbles: true }));
          target.dispatchEvent(new Event('change', { bubbles: true }));
          target.dispatchEvent(new Event('blur', { bubbles: true }));
          target.focus();
        }
      },
      function () { /* karede kod bulunamadı — sessizce yoksay */ }
    ).catch(function (err) {
      alert('Kamera açılamadı: ' + err);
      closeScanner();
    });
  }

  function closeScanner() {
    const modal = document.getElementById('barcodeScanModal');
    if (modal) modal.classList.remove('open');
    const instance = html5QrCode;
    html5QrCode = null;
    activeInput = null;
    if (instance) {
      instance.stop().then(function () { instance.clear(); }).catch(function () {});
    }
  }

  function attachScanButton(input) {
    if (input.dataset.scanAttached) return;
    input.dataset.scanAttached = '1';

    const wrap = document.createElement('div');
    wrap.className = 'barcode-input-wrap';
    input.parentNode.insertBefore(wrap, input);
    wrap.appendChild(input);

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'barcode-scan-btn';
    btn.setAttribute('aria-label', 'Barkod tara');
    btn.innerHTML = '&#128247;';
    btn.addEventListener('click', function () { openScanner(input); });
    wrap.appendChild(btn);
  }

  document.addEventListener('DOMContentLoaded', function () {
    document.querySelectorAll('input[data-barcode-scan]').forEach(attachScanButton);
  });
})();
