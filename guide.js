window.addEventListener('DOMContentLoaded', () => {
  const boxes = document.querySelectorAll('.box');

  boxes.forEach(box => {
    const children = box.querySelectorAll('h3, p, ul, ol, li, img, .guide-screenshot, .guide-code, .guide-warn, .guide-tip, .method-grid, .method-card');
    children.forEach(el => {
      el.style.opacity = '0';
      el.style.transform = 'translateY(8px)';
    });
  });

  boxes.forEach((box, index) => {
    setTimeout(() => {
      box.classList.add('visible');

      const children = box.querySelectorAll('h3, p, ul, ol, li, img, .guide-screenshot, .guide-code, .guide-warn, .guide-tip, .method-grid, .method-card');
      children.forEach((el, i) => {
        el.style.transition = 'opacity 0.4s ease, transform 0.4s ease';
        el.style.transitionDelay = `${i * 40}ms`;
        setTimeout(() => {
          el.style.opacity = '1';
          el.style.transform = 'translateY(0)';
        }, i * 40);
      });
    }, index * 120);
  });
});
