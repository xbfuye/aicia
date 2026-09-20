/**
 * AI CIA 前端交互
 * 原则：
 * - 不重建 DOM 做筛选（用 CSS display），原项目 innerHTML 重建导致事件丢失的坑不复存在
 * - 所有动态绑定用事件委托，新增节点自动生效
 * - 零外部依赖，不引 GSAP
 */
(function () {
  'use strict';

  /* ---------- 筛选 + 搜索 ---------- */
  var filters = document.getElementById('filters');
  var cardsBox = document.getElementById('cards');
  var searchInput = document.getElementById('searchInput');
  var currentType = 'all';

  function applyFilters() {
    if (!cardsBox) return;
    var q = (searchInput ? searchInput.value.trim().toLowerCase() : '');
    cardsBox.querySelectorAll('.card').forEach(function (card) {
      var typeOk = (currentType === 'all' || card.dataset.cat === currentType);
      var text = card.textContent.toLowerCase();
      var searchOk = !q || text.indexOf(q) > -1;
      card.style.display = (typeOk && searchOk) ? '' : 'none';
    });
  }

  if (filters && cardsBox) {
    filters.addEventListener('click', function (e) {
      var btn = e.target.closest('button[data-type]');
      if (!btn) return;
      filters.querySelectorAll('button').forEach(function (b) {
        b.classList.toggle('active', b === btn);
      });
      currentType = btn.dataset.type;
      applyFilters();
    });
  }

  if (searchInput) {
    searchInput.addEventListener('input', applyFilters);
  }

  /* ---------- 海报弹窗（事件委托） ---------- */
  document.addEventListener('click', function (e) {
    var trigger = e.target.closest('[data-poster]');
    if (!trigger) return;
    e.preventDefault();
    var src = trigger.dataset.poster;
    if (!src) return;
    openPoster(src);
  });

  function openPoster(src) {
    var overlay = document.getElementById('poster-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'poster-overlay';
      overlay.className = 'poster-overlay';
      overlay.innerHTML =
        '<div class="poster-backdrop" data-close></div>' +
        '<div class="poster-dialog">' +
        '<button class="poster-close" data-close aria-label="关闭">×</button>' +
        '<img class="poster-img" alt="项目海报" />' +
        '<p class="poster-tip">长按保存海报</p>' +
        '</div>';
      document.body.appendChild(overlay);
      overlay.addEventListener('click', function (e) {
        if (e.target.closest('[data-close]')) closePoster();
      });
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') closePoster();
      });
    }
    overlay.querySelector('.poster-img').src = src;
    overlay.classList.add('is-open');
    document.body.style.overflow = 'hidden';
  }

  function closePoster() {
    var overlay = document.getElementById('poster-overlay');
    if (!overlay) return;
    overlay.classList.remove('is-open');
    document.body.style.overflow = '';
  }
})();
