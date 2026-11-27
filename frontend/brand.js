if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
  for (const img of document.querySelectorAll('img.skinwise-wordmark')) {
    img.src = img.src.replace('skinwise-logo.gif', 'skinwise-logo-static.png');
  }
}
