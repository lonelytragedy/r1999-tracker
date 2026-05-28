(function() {
  const RU = ['ru','be','uk','kk','ky','tg','uz','tk','az','hy','ka','mn'];
  const saved = localStorage.getItem('r1999_lang');
  const lang = (saved === 'ru' || saved === 'en') ? saved
    : RU.includes((navigator.language || '').split('-')[0].toLowerCase()) ? 'ru' : 'en';
  document.documentElement.lang = lang;
  document.write('<scr' + 'ipt src="localization/' + lang + '.js"><\/scr' + 'ipt>');
})();
