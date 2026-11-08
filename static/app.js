(() => {
  'use strict';

  const DATA = JSON.parse(document.getElementById('data').textContent);
  const M = DATA.media;
  const $ = (s, r = document) => r.querySelector(s);

  /* Безопасное создание элементов: текст всегда через textContent */
  const h = (tag, attrs = {}, ...kids) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') n.className = v;
      else if (k === 'text') n.textContent = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? '' : v);
    }
    for (const c of kids) if (c != null) n.append(c);
    return n;
  };
  const svgIcon = (path) => {
    const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('viewBox', '0 0 24 24');
    const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    p.setAttribute('d', path);
    s.append(p);
    return s;
  };
  const PLAY_PATH = 'M8 5v14l11-7z';
  const fmt = (s) => {
    if (!isFinite(s) || s < 0) return '0:00';
    s = Math.floor(s);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  };
  const store = {
    get(k, d) { try { const v = localStorage.getItem('mk_' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem('mk_' + k, JSON.stringify(v)); } catch { /* приватный режим */ } },
  };
  const isTyping = (e) => /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable;

  /* ================= ПОЯВЛЕНИЕ ПРИ СКРОЛЛЕ ================= */
  const revealIO = new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) { e.target.classList.add('in'); revealIO.unobserve(e.target); }
  }, { threshold: 0.12 });
  const observeReveal = (root = document) => root.querySelectorAll('.reveal:not(.in)').forEach((n) => revealIO.observe(n));
  observeReveal();

  /* ================= ДОП. АНИМАЦИИ ================= */
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  // заголовок по буквам
  const h1 = $('.hero h1');
  const word = h1.textContent;
  h1.textContent = '';
  h1.setAttribute('aria-label', word);
  [...word].forEach((ch, i) => {
    const s = h('span', { class: 'ch', text: ch, 'aria-hidden': 'true' });
    s.style.setProperty('--c', i);
    h1.append(s);
  });

  // лесенка для дочерних элементов
  document.querySelectorAll('.reveal-kids').forEach((box) => {
    [...box.children].forEach((kid, i) => kid.style.setProperty('--k', i));
  });

  // прогресс прокрутки + параллакс первого экрана
  const bar = $('#scrollProgress'), hero = $('.hero');
  let scrollQueued = false;
  const onScroll = () => {
    scrollQueued = false;
    const max = document.documentElement.scrollHeight - innerHeight;
    bar.style.transform = `scaleX(${max > 0 ? scrollY / max : 0})`;
    if (scrollY < innerHeight * 1.2) hero.style.setProperty('--sy', scrollY.toFixed(0));
  };
  addEventListener('scroll', () => { if (!scrollQueued) { scrollQueued = true; requestAnimationFrame(onScroll); } }, { passive: true });
  onScroll();

  if (!reduceMotion && matchMedia('(hover: hover)').matches) {
    // свечение и фото следуют за курсором
    let heroQueued = false, hx = 0, hy = 0;
    hero.addEventListener('pointermove', (e) => {
      hx = e.clientX / innerWidth - 0.5;
      hy = e.clientY / innerHeight - 0.5;
      if (!heroQueued) {
        heroQueued = true;
        requestAnimationFrame(() => {
          heroQueued = false;
          hero.style.setProperty('--mx', hx.toFixed(3));
          hero.style.setProperty('--my', hy.toFixed(3));
        });
      }
    });
    hero.addEventListener('pointerleave', () => { hero.style.setProperty('--mx', 0); hero.style.setProperty('--my', 0); });

    // 3D-наклон карточек
    document.addEventListener('pointermove', (e) => {
      const card = e.target.closest?.('.tilt');
      if (!card) return;
      const r = card.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5;
      card.style.setProperty('--ry', `${(x * 10).toFixed(2)}deg`);
      card.style.setProperty('--rx', `${(-y * 10).toFixed(2)}deg`);
    }, { passive: true });
    document.addEventListener('pointerout', (e) => {
      const card = e.target.closest?.('.tilt');
      if (card && !card.contains(e.relatedTarget)) { card.style.removeProperty('--rx'); card.style.removeProperty('--ry'); }
    });
  }

  /* ================= ГЛАВНОЕ ФОТО ================= */
  if (M.hero) {
    const img = $('#heroImg');
    img.src = M.hero;
    img.hidden = false;
    $('#heroPh').hidden = true;
  }

  /* ================= ПЛЕЕР ================= */
  const tracks = M.tracks;
  const audio = new Audio();
  audio.preload = 'metadata';
  audio.volume = store.get('vol', 0.8);

  const ui = {
    player: $('#player'), title: $('#trackTitle'), artist: $('#trackArtist'),
    coverImg: $('#coverImg'), coverPh: $('#coverPh'), list: $('#playlist'),
    fill: $('#progressFill'), buf: $('#progressBuf'), progress: $('#progress'),
    cur: $('#tCur'), dur: $('#tDur'), vol: $('#volume'),
    shuffle: $('#btnShuffle'), repeat: $('#btnRepeat'),
    mini: $('#mini'), miniTitle: $('#miniTitle'), miniArtist: $('#miniArtist'),
    miniCover: $('#miniCover'), miniFill: $('#miniFill'),
  };

  let idx = Math.min(Math.max(store.get('idx', 0), 0), Math.max(tracks.length - 1, 0));
  let shuffle = store.get('shuffle', false);
  let repeat = store.get('repeat', 'all');          // off | all | one
  let started = false;
  let lastSec = -1;

  ui.vol.value = audio.volume;

  function renderModes() {
    ui.shuffle.classList.toggle('on', shuffle);
    ui.repeat.classList.toggle('on', repeat !== 'off');
    ui.repeat.classList.toggle('one', repeat === 'one');
    ui.repeat.title = { off: 'Повтор выключен (R)', all: 'Повтор плейлиста (R)', one: 'Повтор трека (R)' }[repeat];
  }

  function renderPlaylist() {
    ui.list.textContent = '';
    tracks.forEach((t, i) => {
      ui.list.append(h('li', {
        class: 'track', onclick: () => (i === idx && audio.src ? toggle() : (load(i), play())),
      },
      h('span', { class: 't-num', text: String(i + 1).padStart(2, '0') }),
      h('span', { class: 't-main' }, h('b', { text: t.title }), h('small', { text: t.artist })),
      h('span', { class: 't-dur', text: '—' })));
    });
    probeDurations();
  }

  /* длительности треков — по одному, чтобы не забивать сервер */
  async function probeDurations() {
    for (let i = 0; i < tracks.length; i++) {
      await new Promise((resolve) => {
        const a = new Audio();
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          const cell = ui.list.children[i]?.querySelector('.t-dur');
          if (cell && isFinite(a.duration)) cell.textContent = fmt(a.duration);
          a.removeAttribute('src');
          resolve();
        };
        a.preload = 'metadata';
        a.addEventListener('loadedmetadata', finish, { once: true });
        a.addEventListener('error', finish, { once: true });
        setTimeout(finish, 5000);
        a.src = tracks[i].src;
      });
    }
  }

  function setCover(t) {
    if (t.cover) {
      ui.coverImg.src = t.cover;
      ui.coverImg.hidden = false;
      ui.coverPh.hidden = true;
      ui.miniCover.style.backgroundImage = `url("${t.cover}")`;
      ui.miniCover.textContent = '';
    } else {
      ui.coverImg.hidden = true;
      ui.coverPh.hidden = false;
      ui.miniCover.style.backgroundImage = '';
      ui.miniCover.textContent = 'mk';
    }
  }

  function load(i) {
    if (!tracks.length) return;
    idx = (i + tracks.length) % tracks.length;
    const t = tracks[idx];
    audio.src = t.src;
    lastSec = -1;
    store.set('idx', idx);
    ui.title.textContent = t.title;
    ui.title.classList.remove('swap');
    void ui.title.offsetWidth;          // перезапуск анимации
    ui.title.classList.add('swap');
    ui.artist.textContent = t.artist;
    ui.miniTitle.textContent = t.title;
    ui.miniArtist.textContent = t.artist;
    setCover(t);
    [...ui.list.children].forEach((li, n) => li.classList.toggle('active', n === idx));
    const li = ui.list.children[idx], L = ui.list;   // прокручиваем только сам плейлист, не страницу
    if (li && (li.offsetTop < L.scrollTop || li.offsetTop + li.offsetHeight > L.scrollTop + L.clientHeight)) {
      L.scrollTop = li.offsetTop - L.clientHeight / 2 + li.offsetHeight / 2;
    }
    syncTime(true);
    if ('mediaSession' in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: t.title, artist: t.artist, album: DATA.artist,
        artwork: t.cover ? [{ src: new URL(t.cover, location.href).href }] : [],
      });
    }
  }

  async function play() {
    if (!tracks.length) return;
    if (!audio.src) load(idx);
    started = true;
    ensureAudioGraph();
    try { await audio.play(); } catch (err) { console.warn('Не удалось воспроизвести:', err); }
  }
  function toggle() {
    if (!tracks.length) { document.getElementById('music').scrollIntoView(); return; }
    audio.paused ? play() : audio.pause();
  }
  function next(auto = false) {
    if (!tracks.length) return;
    if (auto && repeat === 'one') { audio.currentTime = 0; play(); return; }
    let n = idx + 1;
    if (shuffle && tracks.length > 1) {
      do n = Math.floor(Math.random() * tracks.length); while (n === idx);
    } else if (auto && repeat === 'off' && n >= tracks.length) {
      audio.pause(); audio.currentTime = 0; return;
    }
    load(n); play();
  }
  function prev() {
    if (!tracks.length) return;
    if (audio.currentTime > 3) { audio.currentTime = 0; return; }
    load(idx - 1); play();
  }
  function seekBy(sec) {
    if (isFinite(audio.duration)) audio.currentTime = Math.min(Math.max(audio.currentTime + sec, 0), audio.duration - 0.1);
  }

  function syncTime(force = false) {
    const d = audio.duration, c = audio.currentTime;
    const p = isFinite(d) && d > 0 ? c / d : 0;
    ui.fill.style.transform = `scaleX(${p})`;
    ui.miniFill.style.transform = `scaleX(${p})`;
    const sec = Math.floor(c);
    if (force || sec !== lastSec) {
      lastSec = sec;
      ui.cur.textContent = fmt(c);
      ui.dur.textContent = fmt(d);
    }
  }

  audio.addEventListener('play', () => {
    document.body.classList.add('playing');
    document.title = `${tracks[idx].title} — ${DATA.artist}`;
    updateMini();
    startViz();
  });
  audio.addEventListener('pause', () => {
    document.body.classList.remove('playing');
    document.title = `${DATA.artist} — фан-сайт`;
  });
  audio.addEventListener('ended', () => next(true));
  audio.addEventListener('timeupdate', () => { if (audio.paused) syncTime(); });
  audio.addEventListener('loadedmetadata', () => syncTime(true));
  audio.addEventListener('progress', () => {
    if (audio.buffered.length && isFinite(audio.duration)) {
      ui.buf.style.transform = `scaleX(${audio.buffered.end(audio.buffered.length - 1) / audio.duration})`;
    }
  });
  audio.addEventListener('error', () => {
    if (audio.src) ui.artist.textContent = 'Не удалось открыть файл — формат не поддерживается браузером';
  });

  /* перемотка мышью/пальцем */
  let seeking = false;
  const seekTo = (e) => {
    const r = ui.progress.getBoundingClientRect();
    const p = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    if (isFinite(audio.duration)) { audio.currentTime = p * audio.duration; syncTime(true); }
  };
  ui.progress.addEventListener('pointerdown', (e) => {
    if (!audio.src) return;
    seeking = true;
    ui.progress.setPointerCapture(e.pointerId);
    seekTo(e);
  });
  ui.progress.addEventListener('pointermove', (e) => { if (seeking) seekTo(e); });
  ui.progress.addEventListener('pointerup', () => { seeking = false; });
  ui.progress.addEventListener('pointercancel', () => { seeking = false; });

  ui.vol.addEventListener('input', () => { audio.volume = +ui.vol.value; audio.muted = false; store.set('vol', audio.volume); });

  $('#btnPlay').addEventListener('click', toggle);
  $('#btnNext').addEventListener('click', () => next());
  $('#btnPrev').addEventListener('click', prev);
  $('#miniPlay').addEventListener('click', toggle);
  $('#miniNext').addEventListener('click', () => next());
  $('#miniPrev').addEventListener('click', prev);
  $('#navPlay').addEventListener('click', toggle);
  $('#heroPlay').addEventListener('click', () => {
    document.getElementById('music').scrollIntoView({ behavior: 'smooth' });
    if (tracks.length && audio.paused) play();
  });
  ui.shuffle.addEventListener('click', () => { shuffle = !shuffle; store.set('shuffle', shuffle); renderModes(); });
  ui.repeat.addEventListener('click', () => {
    repeat = { off: 'all', all: 'one', one: 'off' }[repeat];
    store.set('repeat', repeat);
    renderModes();
  });

  if ('mediaSession' in navigator) {
    const ms = navigator.mediaSession;
    ms.setActionHandler('play', play);
    ms.setActionHandler('pause', () => audio.pause());
    ms.setActionHandler('previoustrack', prev);
    ms.setActionHandler('nexttrack', () => next());
  }

  /* мини-плеер появляется, когда большой плеер ушёл с экрана */
  let playerVisible = true;
  const updateMini = () => ui.mini.classList.toggle('hide', !started || playerVisible);
  new IntersectionObserver(([e]) => { playerVisible = e.isIntersecting; updateMini(); }, { threshold: 0.15 })
    .observe(ui.player);

  /* ================= ВИЗУАЛИЗАТОР + ПУЛЬС СТРАНИЦЫ ================= */
  const canvas = $('#viz');
  const c2 = canvas.getContext('2d');
  const beatEls = document.querySelectorAll('.beat');
  const ACC = getComputedStyle(document.documentElement).getPropertyValue('--acc').trim() || '#d4ff3a';
  let actx = null, analyser = null, freq = null, raf = 0, dpr = 1;
  const BARS = 56;
  const levels = new Float32Array(BARS);

  function ensureAudioGraph() {
    if (actx) { if (actx.state === 'suspended') actx.resume(); return; }
    try {
      actx = new (window.AudioContext || window.webkitAudioContext)();
      const src = actx.createMediaElementSource(audio);
      analyser = actx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.78;
      src.connect(analyser);
      analyser.connect(actx.destination);
      freq = new Uint8Array(analyser.frequencyBinCount);
    } catch (err) {
      console.warn('Визуализатор недоступен:', err);
      analyser = null;
    }
  }

  function sizeCanvas() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    const r = canvas.getBoundingClientRect();
    canvas.width = Math.max(1, Math.round(r.width * dpr));
    canvas.height = Math.max(1, Math.round(r.height * dpr));
    if (audio.paused) drawFrame(false);
  }

  function drawFrame(live) {
    const W = canvas.width, H = canvas.height;
    c2.clearRect(0, 0, W, H);
    let bass = 0;
    if (live && analyser) {
      analyser.getByteFrequencyData(freq);
      for (let i = 0; i < 6; i++) bass += freq[i];
      bass /= 6 * 255;
    }
    const usable = freq ? Math.floor(freq.length * 0.72) : 1;
    const gap = W / BARS;
    c2.fillStyle = ACC;
    for (let i = 0; i < BARS; i++) {
      const target = live && freq ? freq[Math.floor((i / BARS) * usable)] / 255 : 0;
      levels[i] += (target - levels[i]) * (live ? 0.5 : 0.15);
      const bh = Math.max(3 * dpr, levels[i] * H);
      c2.globalAlpha = 0.35 + levels[i] * 0.65;
      c2.fillRect(i * gap + gap * 0.18, (H - bh) / 2, gap * 0.64, bh);
    }
    c2.globalAlpha = 1;
    const beat = live ? Math.max(0, bass - 0.35) / 0.65 : 0;   // реагируем только на сильный бас
    for (const el of beatEls) el.style.setProperty('--beat', beat.toFixed(3));
    return levels.some((v) => v > 0.01);
  }

  function loop() {
    const live = !audio.paused;
    const moving = drawFrame(live);
    syncTime();
    raf = live || moving ? requestAnimationFrame(loop) : 0;   // на паузе плавно гасим и останавливаемся
  }
  function startViz() { if (!raf) raf = requestAnimationFrame(loop); }
  audio.addEventListener('pause', startViz);

  window.addEventListener('resize', sizeCanvas);
  sizeCanvas();

  /* ================= ИНИЦИАЛИЗАЦИЯ ПЛЕЕРА ================= */
  renderModes();
  if (tracks.length) {
    renderPlaylist();
    load(idx);
  } else {
    ui.player.classList.add('is-empty');
    $('#musicEmpty').hidden = false;
    const box = $('#streamLinks');
    for (const s of DATA.streaming) box.append(h('a', { class: 'btn', href: s.url, target: '_blank', rel: 'noopener', text: `${s.name} ↗` }));
  }

  /* ================= МОДАЛКА ================= */
  const modal = $('#modal'), mBody = $('#modalBody');
  let gallery = [], gIdx = -1;

  function openModal(node, withNav = false) {
    mBody.textContent = '';
    mBody.append(node);
    modal.classList.toggle('has-nav', withNav);
    modal.hidden = false;
    document.body.classList.add('lock');
  }
  function closeModal() {
    modal.hidden = true;
    mBody.textContent = '';     // останавливает видео/iframe
    gIdx = -1;
    document.body.classList.remove('lock');
  }
  $('#modalClose').addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => { if (e.target === modal || e.target === mBody) closeModal(); });
  $('#modalPrev').addEventListener('click', () => showPhoto(gIdx - 1));
  $('#modalNext').addEventListener('click', () => showPhoto(gIdx + 1));

  /* ================= КЛИПЫ ================= */
  const YT_ID = /^[\w-]{11}$/;
  const clipGrid = $('#clipGrid');
  const previewIO = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (e.isIntersecting) e.target.play().catch(() => {});
      else e.target.pause();
    }
  }, { threshold: 0.4 });

  function fragmentLabel(c) {
    const range = c.end > c.start ? ` · ${fmt(c.start)}–${fmt(c.end)}` : '';
    return h('div', { class: 'clip-label' }, h('b', { text: c.title }), h('small', { text: c.artist + range }));
  }
  function playBadge() {
    return h('span', { class: 'clip-play' }, svgIcon(PLAY_PATH));
  }
  /* ограничиваем видео отрезком [start, end] */
  function clampFragment(v, c, loop) {
    v.addEventListener('loadedmetadata', () => { if (c.start) v.currentTime = c.start; }, { once: true });
    if (c.end > c.start) {
      v.addEventListener('timeupdate', () => {
        if (v.currentTime >= c.end) {
          if (loop) v.currentTime = c.start;
          else v.pause();
        }
      });
    }
  }

  function openClip(c) {
    if (!audio.paused) audio.pause();
    if (c.src) {
      const v = h('video', { src: c.src, controls: true, autoplay: true, playsinline: true });
      clampFragment(v, { start: c.start, end: 0 }, false);   // целиком, с начала фрагмента
      openModal(v);
    } else {
      const params = new URLSearchParams({ autoplay: '1', rel: '0', start: String(c.start || 0) });
      if (c.end > c.start) params.set('end', String(c.end));
      openModal(h('iframe', {
        src: `https://www.youtube-nocookie.com/embed/${c.youtube}?${params}`,
        title: c.title, allow: 'autoplay; encrypted-media; picture-in-picture; fullscreen', allowfullscreen: true,
      }));
    }
  }

  for (const [ci, c] of DATA.clips.entries()) {
    const card = h('article', { class: 'clip reveal tilt' });
    card.style.setProperty('--i', ci);
    if (c.src) {
      const v = h('video', { src: c.src, muted: true, loop: true, playsinline: true, preload: 'metadata' });
      v.muted = true;
      clampFragment(v, c, true);
      previewIO.observe(v);
      card.append(v, playBadge(), fragmentLabel(c));
      card.addEventListener('click', () => openClip(c));
    } else if (YT_ID.test(c.youtube)) {
      card.append(
        h('img', { src: `https://i.ytimg.com/vi/${c.youtube}/hqdefault.jpg`, alt: c.title, loading: 'lazy' }),
        playBadge(), fragmentLabel(c));
      card.addEventListener('click', () => openClip(c));
    } else {
      card.classList.add('clip-empty');
      card.append(h('div', { class: 'clip-ph' },
        h('span', { text: 'видео ещё не добавлено' }),
        c.search ? h('a', { href: c.search, target: '_blank', rel: 'noopener', text: 'смотреть на YouTube ↗' }) : null,
        h('small', { text: 'впиши ID ролика в CLIPS (app.py) или положи .mp4 в media/clips/' })),
      fragmentLabel(c));
    }
    clipGrid.append(card);
  }

  /* ================= ФОТО ================= */
  const galleryGrid = $('#galleryGrid');
  gallery = M.photos.map((src) => ({ src, caption: '' }));
  function showPhoto(i) {
    if (!gallery.length) return;
    gIdx = (i + gallery.length) % gallery.length;
    const g = gallery[gIdx];
    const fig = h('figure', { class: 'lb' }, h('img', { src: g.src, alt: g.caption || `madk1d — фото ${gIdx + 1}` }),
      g.caption ? h('figcaption', { text: g.caption }) : null);
    openModal(fig, gallery.length > 1);
  }
  function addPhoto(g) {
    const i = gallery.push(g) - 1;
    const fig = h('figure', { class: 'reveal tilt', onclick: () => showPhoto(i) },
      h('img', { src: g.src, alt: g.caption || `madk1d — фото ${i + 1}`, loading: 'lazy' }),
      g.caption ? h('figcaption', { text: g.caption }) : null);
    fig.style.setProperty('--i', i % 6);
    galleryGrid.append(fig);
    revealIO.observe(fig);
  }
  const initial = gallery.splice(0);
  initial.forEach(addPhoto);

  /* кадры из загруженных клипов — дополнительные фото в галерею */
  const clipSources = DATA.clips.filter((c) => c.src);
  async function grabFrames(c, times) {
    const v = document.createElement('video');
    v.muted = true; v.preload = 'auto'; v.playsInline = true; v.src = c.src;
    await new Promise((res, rej) => {
      v.onloadedmetadata = res; v.onerror = rej;
      setTimeout(() => rej(new Error('timeout')), 15000);
    });
    const W = Math.min(960, v.videoWidth || 960);
    const H = Math.round(W * (v.videoHeight || 540) / (v.videoWidth || 960));
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d');
    for (const frac of times) {
      v.currentTime = Math.min(v.duration - 0.5, v.duration * frac);
      await new Promise((res) => { v.onseeked = res; setTimeout(res, 4000); });
      ctx.drawImage(v, 0, 0, W, H);
      const blob = await new Promise((res) => cv.toBlob(res, 'image/jpeg', 0.85));
      if (blob) addPhoto({ src: URL.createObjectURL(blob), caption: `кадр из клипа «${c.title}»` });
    }
    v.removeAttribute('src'); v.load();
  }
  if (clipSources.length) {
    const galleryIO = new IntersectionObserver(async ([e]) => {
      if (!e.isIntersecting) return;
      galleryIO.disconnect();
      for (const c of clipSources) {
        try { await grabFrames(c, [0.2, 0.42, 0.64, 0.86]); } catch (err) { console.warn('Кадры не получены:', c.title, err); }
      }
    }, { rootMargin: '600px' });
    galleryIO.observe(galleryGrid);
  } else if (!gallery.length) {
    ['1', '1.3', '.8', '1.25', '1', '.75'].forEach((ar) => {
      const tile = h('figure', { class: 'ph-tile reveal' }, h('span', { text: 'положи фото в media/photos/' }));
      tile.style.setProperty('--ar', `1 / ${ar}`);
      galleryGrid.append(tile);
    });
  }

  /* ================= СТЕНА ФАНАТОВ ================= */
  const wallList = $('#wallList'), wallForm = $('#wallForm');
  const wallStatus = $('#wallStatus'), wallCount = $('#wallCount');
  const fName = wallForm.elements.namedItem('name'), fText = wallForm.elements.namedItem('text');

  function ago(ts) {
    const s = Math.floor(Date.now() / 1000 - ts);
    if (s < 60) return 'только что';
    if (s < 3600) return `${Math.floor(s / 60)} мин назад`;
    if (s < 86400) return `${Math.floor(s / 3600)} ч назад`;
    return new Date(ts * 1000).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
  }
  function msgNode(m, isNew = false) {
    const li = h('li', { class: 'msg' + (isNew ? ' new' : '') },
      h('div', { class: 'msg-head' }, h('b', { text: m.name }), h('time', { text: ago(m.ts) })),
      h('p', { text: m.text }));
    li.style.setProperty('--r', `${((m.ts % 7) - 3) * 0.5}deg`);
    return li;
  }
  function renderWall(list) {
    wallList.textContent = '';
    if (!list.length) { wallList.append(h('li', { class: 'wall-empty', text: 'Пока пусто — напиши первым.' })); return; }
    for (const m of list.slice().reverse()) wallList.append(msgNode(m));
  }
  fetch('/api/wall').then((r) => r.json()).then(renderWall).catch(() => renderWall([]));

  fText.addEventListener('input', () => { wallCount.textContent = `${fText.value.length} / 280`; });
  wallForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = wallForm.querySelector('button');
    btn.disabled = true;
    wallStatus.className = '';
    wallStatus.textContent = 'отправляю…';
    try {
      const r = await fetch('/api/wall', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: fName.value, text: fText.value }),
      });
      const d = await r.json();
      if (!d.ok) throw new Error(d.error || 'Ошибка');
      wallList.querySelector('.wall-empty')?.remove();
      wallList.prepend(msgNode(d.msg, true));
      fText.value = '';
      wallCount.textContent = '0 / 280';
      wallStatus.className = 'ok';
      wallStatus.textContent = 'готово!';
    } catch (err) {
      wallStatus.className = 'err';
      wallStatus.textContent = err.message === 'Failed to fetch' ? 'сервер недоступен' : err.message;
    } finally {
      btn.disabled = false;
    }
  });

  observeReveal();

  /* ================= ГОРЯЧИЕ КЛАВИШИ ================= */
  document.addEventListener('keydown', (e) => {
    if (isTyping(e) || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.code === 'Space' && /^(BUTTON|A)$/.test(e.target.tagName)) return;  // пробел на кнопке — её собственный клик
    if (!modal.hidden) {
      if (e.key === 'Escape') closeModal();
      else if (gIdx >= 0 && e.key === 'ArrowLeft') showPhoto(gIdx - 1);
      else if (gIdx >= 0 && e.key === 'ArrowRight') showPhoto(gIdx + 1);
      return;
    }
    switch (e.code) {
      case 'Space': e.preventDefault(); toggle(); break;
      case 'ArrowRight': if (audio.src) { e.preventDefault(); seekBy(5); } break;
      case 'ArrowLeft': if (audio.src) { e.preventDefault(); seekBy(-5); } break;
      case 'KeyN': next(); break;
      case 'KeyP': prev(); break;
      case 'KeyM': audio.muted = !audio.muted; break;
      case 'KeyS': ui.shuffle.click(); break;
      case 'KeyR': ui.repeat.click(); break;
      default: break;
    }
  });
})();
