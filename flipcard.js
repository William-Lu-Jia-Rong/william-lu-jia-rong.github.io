// 让 .flip-card 在触摸/点击时翻转，仅在触摸设备或小屏下生效
(function() {
  function isTouchDevice() {
    return 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  }
  function enableFlipOnTouch() {
    var cards = document.querySelectorAll('.flip-card');
    cards.forEach(function(card) {
      // 避免重复绑定
      if (card.dataset.flipBound) return;
      card.dataset.flipBound = '1';
      card.addEventListener('click', function(e) {
        // 只在小屏或触摸设备生效
        if (window.innerWidth > 900 && !isTouchDevice()) return;
        // 切换翻转
        card.classList.toggle('flipped');
      });
    });
  }
  document.addEventListener('DOMContentLoaded', enableFlipOnTouch);
  window.addEventListener('resize', enableFlipOnTouch);
})(); 