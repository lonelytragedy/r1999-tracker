window.addEventListener('DOMContentLoaded', () => {
  const boxes = document.querySelectorAll('.box');

  boxes.forEach((box, index) => {
    setTimeout(() => {
      box.classList.add('visible');

      const children = box.querySelectorAll('h3, p, ul, ol, li, img');
      children.forEach((el, i) => {
        el.style.transition = 'opacity 0.5s ease, transform 0.5s ease';
        el.style.transitionDelay = `${i * 100}ms`;
        el.style.opacity = 1;
        el.style.transform = 'translateY(0)';
      });
    }, index * 150);
  });
});
