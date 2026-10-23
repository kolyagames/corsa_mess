// Встроенные плагины. Каждый сделан заново по мотивам плагина для BetterDiscord или Vencord:
// чужой код не копировался, повторены только идеи. Включаются в Настройки → Плагины.
(function () {
  const C = window.Corsa;
  const { h } = C;
  const native = window.corsaNative;
  const def = C.builtinPlugin;

  // Общий источник «что сейчас играет»: несколько плагинов слушают один процесс.
  const mediaHub = {
    subs: new Set(), track: null, off: null,
    sub(fn) {
      this.subs.add(fn);
      if (this.subs.size === 1) {
        this.off = native.onMedia((t) => { this.track = t; for (const f of this.subs) f(t); });
        native.mediaWatch(true).then((t) => { if (t) { this.track = t; for (const f of this.subs) f(t); } }).catch(() => {});
      } else if (this.track) fn(this.track);
      return () => {
        this.subs.delete(fn);
        if (!this.subs.size) { if (this.off) this.off(); this.off = null; this.track = null; native.mediaWatch(false).catch(() => {}); }
      };
    },
  };

  const voiceChannelOf = (app, sid) => {
    const conn = app.connection();
    if (!conn) return null;
    for (const [id, list] of Object.entries(conn.voice || {})) if (list.includes(sid)) return app.channel(id);
    return null;
  };
  const fmtClock = (sec) => { const s = Math.max(0, Math.floor(sec)); const hh = Math.floor(s / 3600); const mm = Math.floor((s % 3600) / 60); const ss = s % 60; return (hh ? hh + ':' + String(mm).padStart(2, '0') : mm) + ':' + String(ss).padStart(2, '0'); };

  // ================= Чат =================
  def({
    id: 'typing-indicator', name: 'Индикатор набора', category: 'Чат', origin: 'Vencord: TypingIndicator', defaultOn: true,
    description: 'Точки рядом с каналом, где кто-то сейчас печатает.',
    start(api) {
      api.decorate('channel', ({ channel, typing }) => (channel.type === 'text' && typing.length
        ? Object.assign(h('span', { class: 'typing-ic' }, h('i'), h('i'), h('i')), { title: typing.map((m) => m.name).join(', ') + ' печатает…' }) : null));
    },
  });

  def({
    id: 'invisible-typing', name: 'Невидимый набор', category: 'Чат', origin: 'BetterDiscord: InvisibleTyping', defaultOn: false,
    description: 'Другие не видят «печатает…», пока вы пишете. Кнопка {{ic:pencil}} рядом с полем ввода включает и выключает.',
    start(api) {
      const on = () => api.storage.get('on', true);
      api.intercept('typing', (v) => (on() ? false : v));
      api.decorate('composer', () => {
        const b = h('button', { class: 'btn' + (on() ? ' primary' : ''), title: on() ? 'Невидимый набор включён' : 'Невидимый набор выключен', onclick: () => {
          api.storage.set('on', !on()); b.className = 'btn' + (on() ? ' primary' : ''); b.title = on() ? 'Невидимый набор включён' : 'Невидимый набор выключен';
        } }, '{{ic:pencil}}');
        return b;
      });
    },
  });

  def({
    id: 'no-typing-anim', name: 'Без анимации набора', category: 'Чат', origin: 'Vencord: NoTypingAnimation', defaultOn: true,
    description: 'Точки «печатает…» не прыгают.',
    start(api) { document.body.classList.add('no-typing-anim'); api.cleanup(() => document.body.classList.remove('no-typing-anim')); },
  });

  def({
    id: 'reveal-spoilers', name: 'Показать все спойлеры', category: 'Чат', origin: 'Vencord: RevealAllSpoilers', defaultOn: true,
    description: 'Ctrl + клик по спойлеру открывает все спойлеры в канале.',
    settings: [{ key: 'always', type: 'switch', label: 'Всегда показывать спойлеры', default: false }],
    start(api) {
      const onClick = (e) => {
        const sp = e.target.closest && e.target.closest('.spoiler');
        if (sp && e.ctrlKey) document.querySelectorAll('#messages .spoiler').forEach((x) => x.classList.add('open'));
      };
      document.addEventListener('click', onClick, true);
      api.cleanup(() => document.removeEventListener('click', onClick, true));
      const css = h('style');
      const apply = () => { css.textContent = api.settings.always ? '.spoiler{color:inherit;background:var(--fill)}.spoiler *{visibility:visible}' : ''; };
      apply();
      document.head.append(css);
      api.cleanup(() => css.remove());
      this.onSettings = apply;
    },
  });

  def({
    id: 'message-logger', name: 'Журнал сообщений', category: 'Чат', origin: 'Vencord: MessageLogger', defaultOn: true,
    description: 'Удалённые сообщения остаются у вас зачёркнутыми, у изменённых видна прежняя версия. Хранится только до перезапуска.',
    settings: [
      { key: 'deleted', type: 'switch', label: 'Оставлять удалённые сообщения', default: true },
      { key: 'edits', type: 'switch', label: 'Показывать прежние версии изменённых', default: true },
      { key: 'own', type: 'switch', label: 'Учитывать и мои сообщения', default: false },
    ],
    start(api) {
      const edits = new Map(); // id -> [старые тексты]
      const mine = (msg) => msg && msg.uid === api.app.myPub();
      api.intercept('delete', (keep, { msg }) => (api.settings.deleted && msg && (api.settings.own || !mine(msg)) ? true : keep));
      api.on('edit', (channel, msg, before) => {
        if (!before || before.text === msg.text || (!api.settings.own && mine(msg))) return;
        const list = edits.get(msg.id) || [];
        list.push(before.text || '');
        edits.set(msg.id, list.slice(-10));
      });
      api.decorate('message', ({ msg }) => {
        const list = api.settings.edits ? edits.get(msg.id) : null;
        if (!list || !list.length) return null;
        return h('div', { class: 'edit-history' }, list.map((t) => h('div', { class: 'hint', style: { textDecoration: 'line-through' } }, t)));
      });
    },
  });

  def({
    id: 'expression-cloner', name: 'Копировать эмодзи и стикеры', category: 'Чат', origin: 'Vencord: ExpressionCloner', defaultOn: true,
    description: 'Кнопка {{ic:download}} у сообщения со стикером или своими эмодзи: сохранить их в свою библиотеку.',
    start(api) {
      api.decorate('msgTools', ({ msg }) => {
        const emojis = Object.entries(msg.emojis || {});
        if (!msg.sticker && !emojis.length) return null;
        return h('button', { title: 'Сохранить к себе', onclick: () => {
          const lib = api.app.stickerLib();
          if (!lib.categories.length) lib.addCategory('Мои стикеры');
          let cat = lib.categories[0].id;
          const sel = h('select', { class: 'input' }, lib.categories.map((c) => h('option', { value: c.id }, c.name)));
          sel.addEventListener('change', () => { cat = sel.value; });
          const items = [...(msg.sticker ? [{ type: 'sticker', name: '', url: msg.sticker }] : []), ...emojis.map(([name, url]) => ({ type: 'emoji', name, url }))];
          const dlg = api.app.modal(h('div', { class: 'modal-body' }, h('h3', { style: { marginTop: 0 } }, 'Сохранить к себе'),
            h('div', { class: 'mgr-grid' }, items.map((it) => h('div', { class: 'mgr-item' }, h('div', { class: 'thumb' }, api.app.media(it.url, '')), h('div', { class: 'nm2' }, it.type === 'emoji' ? `:${it.name}:` : 'стикер')))),
            h('label', { class: 'lbl' }, 'Категория'), sel,
            h('div', { class: 'row', style: { marginTop: '14px', justifyContent: 'flex-end' } }, h('button', { class: 'btn primary', onclick: () => {
              let ok = 0;
              for (const it of items) { try { lib.addItem(cat, it); ok++; } catch (e) { /* уже есть или имя занято */ } }
              dlg.close();
              api.toast(ok ? `Сохранено: ${ok}` : 'Уже есть в библиотеке');
            } }, 'Сохранить'))));
        } }, '{{ic:download}}');
      });
    },
  });

  def({
    id: 'petpet', name: 'Погладить', category: 'Чат', origin: 'Vencord: petpet', defaultOn: true,
    description: 'Команда /pet имя: гладит участника, у всех с этим плагином аватар смешно сплющивается.',
    start(api) {
      api.addCommand('pet', ({ args, send, reply }) => {
        const name = args.join(' ').replace(/^@/, '').trim();
        const who = api.app.members().find((m) => m.name.toLowerCase() === name.toLowerCase());
        if (!who) { reply('Нет такого участника: ' + (name || '(пусто)')); return; }
        send(`🫳 *гладит* @${who.name}`);
      }, 'погладить участника');
      api.decorate('message', ({ msg }) => {
        const m = /^🫳 \*гладит\* @(.+)$/.exec(msg.text || '');
        if (!m) return null;
        const who = api.app.members().find((x) => x.name === m[1]);
        if (!who) return null;
        const av = api.app.avatarEl(who, { cls: 'lg pet-anim' });
        return h('div', { class: 'row', style: { marginTop: '6px' } }, av, h('span', { style: { fontSize: '30px' } }, '🫳'));
      });
    },
  });

  def({
    id: 'voice-messages', name: 'Голосовые сообщения', category: 'Чат', origin: 'Vencord: VoiceMessages', defaultOn: true,
    description: 'Кнопка {{ic:mic}} у поля ввода: нажмите, говорите, нажмите ещё раз — отправится. Esc отменяет. До 2 минут, в каналах и в личных.',
    settings: [
      { key: 'echo', type: 'switch', label: 'Подавление эха', default: true },
      { key: 'noise', type: 'switch', label: 'Шумоподавление', default: true },
    ],
    start(api) {
      let rec = null;
      const clock = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
      async function startRec(b, ctx) {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: api.settings.echo, noiseSuppression: api.settings.noise, autoGainControl: true } });
        const mr = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: 64000 });
        const chunks = [];
        const t0 = Date.now();
        let send = true;
        const state = { stop(doSend) { send = doSend; if (mr.state !== 'inactive') mr.stop(); } };
        const placeholder = ctx.field.placeholder;
        ctx.field.placeholder = 'Идёт запись… нажмите на микрофон, чтобы отправить, Esc — отменить';
        const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); state.stop(false); } };
        document.addEventListener('keydown', onKey, true);
        const timer = setInterval(() => { const s = (Date.now() - t0) / 1000; b.replaceChildren(C.icon('stop'), ' ' + clock(s)); if (s >= 120) state.stop(true); }, 250);
        b.classList.add('recording');
        mr.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
        mr.onstop = async () => {
          clearInterval(timer);
          document.removeEventListener('keydown', onKey, true);
          stream.getTracks().forEach((t) => t.stop());
          b.classList.remove('recording'); b.replaceChildren(C.icon('mic'));
          ctx.field.placeholder = placeholder;
          rec = null;
          const dur = (Date.now() - t0) / 1000;
          if (!send || dur < 0.7) return;
          b.disabled = true;
          try {
            const f = await api.app.uploadBlob(new Blob(chunks, { type: 'audio/webm' }), 'голосовое.webm', { voice: true, dur });
            ctx.sendFiles([f]);
          } catch (e) { api.toast('Голосовое не отправлено: ' + String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')); }
          b.disabled = false;
        };
        mr.start(500);
        return state;
      }
      api.decorate('composer', (ctx) => {
        if (!ctx.files) return null;
        const b = h('button', { class: 'btn rec-btn', title: 'Записать голосовое сообщение' }, '{{ic:mic}}');
        b.onclick = async () => {
          if (rec) { rec.stop(true); return; }
          try { rec = await startRec(b, ctx); } catch (e) { api.toast('Нет доступа к микрофону'); }
        };
        return b;
      });
      api.cleanup(() => { if (rec) rec.stop(false); });
    },
  });

  def({
    id: 'media-compressor', name: 'Сжатие картинок', category: 'Чат', origin: 'BetterDiscord: VideoCompressor', defaultOn: true,
    description: 'Большие картинки перед отправкой уменьшаются и пережимаются в WebP: у друзей грузятся быстрее. GIF не трогаются, видео уходят как есть (до 25 МБ).',
    settings: [
      { key: 'minMb', type: 'range', label: 'Сжимать картинки больше', min: 0.2, max: 10, step: 0.1, default: 1.5, unit: ' МБ' },
      { key: 'side', type: 'range', label: 'Наибольшая сторона', min: 1024, max: 4096, step: 64, default: 2560, unit: ' px' },
      { key: 'quality', type: 'range', label: 'Качество', min: 50, max: 95, default: 85, unit: '%' },
    ],
    start(api) {
      api.intercept('upload', async (u) => {
        if (u.voice || !/^image\/(png|jpeg|webp)$/.test(u.blob.type)) return u;
        const s = api.settings;
        const bmp = await createImageBitmap(u.blob);
        const big = Math.max(bmp.width, bmp.height);
        if (u.blob.size < s.minMb * 1048576 && big <= s.side) { bmp.close(); return u; }
        const k = Math.min(1, s.side / big);
        const c = new OffscreenCanvas(Math.max(1, Math.round(bmp.width * k)), Math.max(1, Math.round(bmp.height * k)));
        c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
        bmp.close();
        const out = await c.convertToBlob({ type: 'image/webp', quality: s.quality / 100 });
        if (out.size >= u.blob.size) return u;
        return { ...u, blob: out, type: 'image/webp', name: u.name.replace(/\.[^.]+$/, '') + '.webp' };
      });
    },
  });

  def({
    id: 'anonymise-files', name: 'Скрывать имена файлов', category: 'Чат', origin: 'Vencord: AnonymiseFileNames', defaultOn: true,
    description: 'Перед отправкой имя файла меняется на случайное: никто не увидит, как он назывался у вас (например, «Скриншот_паспорт_Иванов.png»).',
    settings: [
      { key: 'always', type: 'switch', label: 'Скрывать всегда', default: true },
      { key: 'length', type: 'range', label: 'Длина случайного имени', min: 4, max: 16, default: 7 },
    ],
    start(api) {
      api.intercept('upload', (u) => {
        if (!api.settings.always || u.voice) return u;
        const ext = ((/\.[a-z0-9]{1,5}$/i.exec(u.name) || [''])[0]).toLowerCase();
        const abc = 'abcdefghijklmnopqrstuvwxyz0123456789';
        let n = '';
        for (const b of crypto.getRandomValues(new Uint8Array(api.settings.length))) n += abc[b % abc.length];
        return { ...u, name: n + ext };
      });
    },
  });

  // ================= Участники и профиль =================
  def({
    id: 'member-counter', name: 'Счётчик участников', category: 'Участники и профиль', origin: 'BetterDiscord: MemberCounter, Vencord: MemberCount', defaultOn: true,
    description: 'Над списком участников: всего, в сети и в голосе.',
    start(api) {
      api.decorate('memberHeader', ({ members }) => {
        const conn = api.app.connection();
        const inVoice = Object.values(conn ? conn.voice : {}).reduce((n, l) => n + l.length, 0);
        const online = members.filter((m) => ['online', 'idle', 'dnd'].includes(m.status)).length;
        return h('div', { class: 'member-counter' }, h('div', null, h('b', null, members.length), 'всего'), h('div', null, h('b', null, online), 'в сети'), h('div', null, h('b', null, inVoice), 'в голосе'));
      });
    },
  });

  def({
    id: 'voice-activity', name: 'Кто в голосе', category: 'Участники и профиль', origin: 'BetterDiscord: VoiceActivity, Vencord: UserVoiceShow', defaultOn: true,
    description: 'Значок {{ic:speaker}} у тех, кто в голосовом канале, а в профиле — канал и кнопка «Присоединиться».',
    start(api) {
      api.decorate('member', ({ member }) => {
        const ch = voiceChannelOf(api.app, member.sid);
        return ch ? h('span', { class: 'voice-ic', title: 'В голосе: ' + ch.name }, member.screen ? '{{ic:tv}}' : '{{ic:speaker}}') : null;
      });
      api.decorate('profile', ({ user }) => {
        const ch = user.sid && voiceChannelOf(api.app, user.sid);
        if (!ch) return null;
        const v = api.app.voice();
        const here = v && v.channel === ch.id;
        return h('div', { class: 'pf-section' }, h('div', { class: 'lbl2' }, 'В голосовом канале'),
          h('div', { class: 'row' }, h('div', { class: 'grow' }, '{{ic:speaker}} ', h('b', null, ch.name), user.screen ? ' · показывает экран' : '', user.muted ? ' · {{ic:mic-off}}' : ''),
            here ? h('span', { class: 'hint' }, 'вы тоже здесь') : h('button', { class: 'btn primary', onclick: () => { document.querySelectorAll('.overlay').forEach((o) => o.remove()); api.app.joinVoice(ch.id); } }, 'Присоединиться')));
      });
    },
  });

  def({
    id: 'last-message', name: 'Последнее сообщение', category: 'Участники и профиль', origin: 'BetterDiscord: LastMessageDate', defaultOn: true,
    description: 'В профиле: когда человек последний раз писал в этой комнате и сколько он сейчас в сети.',
    start(api) {
      api.decorate('profile', ({ user }) => {
        if (!user.uid) return null;
        let last = null; let where = null;
        for (const ch of api.app.channels()) {
          for (const msg of api.app.history(ch.id)) if (msg.uid === user.uid && (!last || msg.ts > last.ts)) { last = msg; where = ch; }
        }
        const lines = [];
        if (last) lines.push(h('div', null, 'Последнее сообщение: ', h('b', null, api.app.fmtTime(last.ts)), ` в #${where.name}`));
        if (user.joinedAt) lines.push(h('div', null, 'В комнате сейчас: ', h('b', null, C.fmtElapsed(user.joinedAt) || 'меньше минуты')));
        return lines.length ? h('div', { class: 'pf-section' }, ...lines) : null;
      });
    },
  });

  def({
    id: 'view-icons', name: 'Просмотр картинок', category: 'Участники и профиль', origin: 'Vencord: ViewIcons', defaultOn: true,
    description: 'Клик по аватару или баннеру в профиле и по стикеру в чате открывает картинку крупно.',
    start(api) {
      api.addCss('.profile-modal .avatar.lg, .profile-modal .profile-banner[data-view]:not([data-view=""]), .msg .sticker { cursor: zoom-in; }');
      const open = (url) => { const m = api.app.media(url, 'img-viewer'); if (m) api.app.modal(h('div', { class: 'modal-body' }, m), { cls: 'viewer-modal' }); };
      const onClick = (e) => {
        const t = e.target;
        const av = t.closest && t.closest('.profile-modal .avatar.lg');
        if (av) { const img = av.querySelector('img:not(.frame-img), video:not(.frame-img)'); if (img) open(img.src); return; }
        const ban = t.closest && t.closest('.profile-modal .profile-banner');
        if (ban && ban.dataset.view) { open(ban.dataset.view); return; }
        const st = t.closest && t.closest('.msg .sticker');
        if (st && st.dataset.url) open(st.dataset.url);
      };
      document.addEventListener('click', onClick);
      api.cleanup(() => document.removeEventListener('click', onClick));
    },
  });

  def({
    id: 'who-reacted', name: 'Кто отреагировал', category: 'Участники и профиль', origin: 'Vencord: WhoReacted', defaultOn: true,
    description: 'Маленькие аватары тех, кто поставил реакцию, прямо на значке реакции.',
    start(api) {
      api.decorate('reaction', ({ list }) => {
        const who = list.slice(0, 3).map((p) => api.app.memberByPub(p)).filter(Boolean);
        return who.length ? h('span', { class: 'rx-who' }, who.map((m) => api.app.avatarEl(m))) : null;
      });
    },
  });

  def({
    id: 'plain-profiles', name: 'Простые профили', category: 'Участники и профиль', origin: 'Vencord: NoProfileThemes', defaultOn: false,
    description: 'Прячет чужие фоны, таблички и эффекты профилей, если они мешают.',
    settings: [
      { key: 'plates', type: 'switch', label: 'Скрывать таблички в списке', default: true },
      { key: 'fx', type: 'switch', label: 'Скрывать эффекты имени и профиля', default: true },
      { key: 'bg', type: 'switch', label: 'Скрывать фоны и цвета карточек', default: true },
    ],
    start(api) {
      const css = h('style');
      const apply = () => {
        const s = api.settings;
        css.textContent = [
          s.plates ? '.member[class*="plate-"]{background:none!important;color:inherit!important;animation:none!important}.member[class*="plate-"] .act{color:var(--muted)!important}' : '',
          s.fx ? '.profile-modal .fx-canvas{display:none}.member .who-name,.msg .who-name{animation:none!important;text-shadow:none!important}' : '',
          s.bg ? '.profile-modal .profile-card-bg{background-image:none!important;box-shadow:none!important}' : '',
        ].join('');
      };
      apply();
      document.head.append(css);
      api.cleanup(() => css.remove());
      this.onSettings = apply;
    },
  });

  // ================= Уведомления =================
  def({
    id: 'friend-watch', name: 'Слежка за друзьями', category: 'Уведомления', origin: 'BetterDiscord: FriendNotifications', defaultOn: true,
    description: 'Выберите людей кнопкой {{ic:eye}} в их профиле: уведомление, когда они выходят из сети, меняют статус-фразу, заходят в голос, включают музыку или экран.',
    settings: [
      { key: 'all', type: 'switch', label: 'Следить за всеми в комнате', default: false },
      { key: 'offline', type: 'switch', label: 'Вышел из сети', default: true },
      { key: 'custom', type: 'switch', label: 'Сменил статус-фразу', default: true },
      { key: 'voice', type: 'switch', label: 'Зашёл в голосовой канал', default: true },
      { key: 'screen', type: 'switch', label: 'Начал показывать экран', default: true },
      { key: 'music', type: 'switch', label: 'Включил музыку', default: false },
    ],
    start(api) {
      const watched = () => new Set(api.storage.get('uids', []));
      const isWatched = (m) => api.settings.all || watched().has(m.uid);
      let lastVoice = new Map();
      const snapVoice = () => { const conn = api.app.connection(); const map = new Map(); if (conn) for (const [ch, list] of Object.entries(conn.voice)) for (const sid of list) map.set(sid, ch); return map; };
      api.on('connect', () => { lastVoice = snapVoice(); });
      api.on('member', (m, prev) => {
        if (!prev || !isWatched(m) || m.sid === (api.app.me() || {}).sid) return;
        const s = api.settings;
        const on = (x) => ['online', 'idle', 'dnd'].includes(x.status);
        if (s.offline && on(prev) && !on(m)) api.app.notify(m, 'вышел из сети');
        if (s.custom && m.custom && m.custom !== prev.custom) api.app.notify(m, 'новая статус-фраза', m.custom);
        if (s.screen && m.screen && !prev.screen) api.app.notify(m, 'показывает экран');
        const music = (x) => (x.activity && x.activity.kind === 'music' ? x.activity.details : null);
        if (s.music && music(m) && music(m) !== music(prev)) api.app.notify(m, 'слушает', [m.activity.state, m.activity.details].filter(Boolean).join(' — '));
      });
      api.on('voice', () => {
        const next = snapVoice();
        if (api.settings.voice) {
          for (const [sid, ch] of next) {
            if (lastVoice.get(sid) === ch) continue;
            const m = api.app.member(sid);
            const chan = api.app.channel(ch);
            if (m && chan && isWatched(m) && sid !== (api.app.me() || {}).sid) api.app.notify(m, 'зашёл в голос', '{{ic:speaker}} ' + chan.name);
          }
        }
        lastVoice = next;
      });
      api.decorate('profile', ({ user }) => {
        if (!user.uid || user.sid === (api.app.me() || {}).sid) return null;
        const on = watched().has(user.uid);
        const b = h('button', { class: 'btn watch-btn' + (on ? ' on' : ''), onclick: () => {
          const set = watched();
          if (set.has(user.uid)) set.delete(user.uid); else set.add(user.uid);
          api.storage.set('uids', [...set]);
          b.replaceChildren(C.iconText(set.has(user.uid) ? '{{ic:eye}} Слежу' : '{{ic:eye}} Следить'));
          b.classList.toggle('on', set.has(user.uid));
        } }, on ? '{{ic:eye}} Слежу' : '{{ic:eye}} Следить');
        return h('div', { class: 'row', style: { marginTop: '12px' } }, b);
      });
    },
  });

  // ================= Голос и стрим =================
  def({
    id: 'call-timer', name: 'Таймер звонка', category: 'Голос и стрим', origin: 'Vencord: CallTimer', defaultOn: true,
    description: 'Под вашим именем внизу слева — сколько вы уже в голосовом канале.',
    start(api) {
      const text = () => { const v = api.app.voice(); return v && v.joinedAt ? '{{ic:speaker}} ' + fmtClock((Date.now() - v.joinedAt) / 1000) : null; };
      api.intercept('userbarSub', (sub) => text() || sub);
      api.interval(() => { const t = text(); const el = document.querySelector('#userbar .sub'); if (t && el) { el.replaceChildren(C.iconText(t)); el.classList.add('call-timer'); } }, 1000);
    },
  });

  def({
    id: 'spectators', name: 'Зрители трансляции', category: 'Голос и стрим', origin: 'BetterDiscord: ShowSpectators', defaultOn: true,
    description: 'На вашем показе экрана видно, кто его сейчас смотрит.',
    start(api) {
      api.decorate('voiceTile', ({ mine, kind }) => {
        if (kind !== 'screen' || !mine) return null;
        const me = api.app.me();
        const who = api.app.members().filter((m) => me && m.watching === me.sid);
        return h('div', { class: 'spectators', title: who.map((m) => m.name).join(', ') }, who.length ? who.slice(0, 5).map((m) => api.app.avatarEl(m)) : null,
          who.length ? `смотрят: ${who.length}` : 'пока никто не смотрит');
      });
    },
  });

  def({
    id: 'hotkeys', name: 'Горячие клавиши', category: 'Голос и стрим', origin: 'Vencord: WebKeybinds', defaultOn: true,
    description: 'Ctrl+Shift+M — микрофон, Ctrl+Shift+D — звук, Alt+↑/↓ — соседний канал, Ctrl+K — быстрый переход.',
    start(api) {
      const quick = () => {
        const chans = api.app.channels();
        const rooms = api.app.rooms();
        const input = h('input', { class: 'input', placeholder: 'Канал или комната…' });
        const list = h('div', { class: 'migrate-list' });
        let dlg = null;
        const items = () => {
          const q = input.value.toLowerCase();
          return [...chans.map((c) => ({ label: (c.type === 'voice' ? '{{ic:speaker}} ' : '# ') + c.name, go: () => (c.type === 'voice' ? api.app.joinVoice(c.id) : api.app.openChannel(c.id)) })),
            ...rooms.map((r) => ({ label: '{{ic:home}} ' + r.name, go: () => api.app.connectRoom(r) }))]
            .filter((i) => i.label.toLowerCase().includes(q)).slice(0, 12);
        };
        const draw = () => list.replaceChildren(...items().map((i, n) => h('div', { class: 'list-item', style: { cursor: 'pointer', outline: n === 0 ? '1px solid var(--accent)' : '' }, onclick: () => { dlg.close(); i.go(); } }, i.label)));
        input.addEventListener('input', draw);
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { const first = items()[0]; if (first) { dlg.close(); first.go(); } } });
        dlg = api.app.modal(h('div', { class: 'modal-body' }, h('h3', { style: { marginTop: 0 } }, 'Быстрый переход'), input, list));
        draw();
        setTimeout(() => input.focus(), 30);
      };
      const onKey = (e) => {
        const v = api.app.voice();
        if (e.ctrlKey && e.shiftKey && e.code === 'KeyM' && v && v.inChannel) { e.preventDefault(); v.setMuted(!v.muted); }
        else if (e.ctrlKey && e.shiftKey && e.code === 'KeyD' && v && v.inChannel) { e.preventDefault(); v.setDeafened(!v.deafened); }
        else if (e.ctrlKey && !e.shiftKey && e.code === 'KeyK' && api.app.connection()) { e.preventDefault(); quick(); }
        else if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown') && api.app.connection()) {
          const text = api.app.channels().filter((c) => c.type === 'text');
          const cur = api.app.getState().channel;
          const i = text.findIndex((c) => c.id === cur);
          const next = text[(i + (e.key === 'ArrowUp' ? -1 : 1) + text.length) % text.length];
          if (next) { e.preventDefault(); api.app.openChannel(next.id); }
        }
      };
      document.addEventListener('keydown', onKey);
      api.cleanup(() => document.removeEventListener('keydown', onKey));
    },
  });

  // Встроенные звуки для звуковой панели: всё синтезируется кодом, чужих записей нет.
  function noiseBuffer(ctx, sec) {
    const b = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * sec), ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }
  function tone(ctx, { type = 'sine', freq, to, at = 0, dur, vol = 0.3, attack = 0.01, out = ctx.destination }) {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, at);
    if (to) o.frequency.exponentialRampToValueAtTime(to, at + dur);
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(vol, at + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    o.connect(g).connect(out);
    o.start(at); o.stop(at + dur + 0.02);
    return o;
  }
  function noiseHit(ctx, { at = 0, dur, vol = 0.3, filter = 'highpass', freq = 6000, q = 0.7 }) {
    const s = ctx.createBufferSource();
    s.buffer = noiseBuffer(ctx, dur + 0.05);
    const f = ctx.createBiquadFilter();
    f.type = filter; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(vol, at + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    s.connect(f).connect(g).connect(ctx.destination);
    s.start(at); s.stop(at + dur + 0.05);
  }
  const SOUNDS = [
    { key: 'horn', name: '{{ic:horn}} Горн', dur: 1.6, make(ctx) {
      for (const [at, d] of [[0, 0.22], [0.3, 0.18], [0.55, 0.95]]) for (const f of [415, 622, 830]) tone(ctx, { type: 'sawtooth', freq: f, at, dur: d, vol: 0.09, attack: 0.02 });
    } },
    { key: 'rimshot', name: '{{ic:drum}} Ба-дум-тсс', dur: 1.6, make(ctx) {
      tone(ctx, { freq: 180, to: 60, at: 0, dur: 0.25, vol: 0.6 });
      tone(ctx, { freq: 260, to: 120, at: 0.22, dur: 0.2, vol: 0.45 });
      noiseHit(ctx, { at: 0.5, dur: 1.05, vol: 0.32, freq: 7000 });
    } },
    { key: 'applause', name: '{{ic:sparkle}} Аплодисменты', dur: 2.8, make(ctx) {
      for (let i = 0; i < 160; i++) noiseHit(ctx, { at: Math.random() * 2.3, dur: 0.06 + Math.random() * 0.05, vol: 0.12 + Math.random() * 0.1, filter: 'bandpass', freq: 1500 + Math.random() * 2500, q: 1.2 });
    } },
    { key: 'bell', name: '{{ic:bell}} Дзынь', dur: 1.8, make(ctx) {
      for (const [f, v] of [[880, 0.3], [1772, 0.14], [2650, 0.08], [3540, 0.04]]) tone(ctx, { freq: f, at: 0, dur: 1.7, vol: v, attack: 0.003 });
    } },
    { key: 'bloop', name: '{{ic:drop}} Бульк', dur: 0.4, make(ctx) { tone(ctx, { freq: 220, to: 980, at: 0, dur: 0.16, vol: 0.4, attack: 0.005 }); } },
    { key: 'fanfare', name: '{{ic:trumpet}} Фанфары', dur: 1.5, make(ctx) {
      [523, 659, 784].forEach((f, i) => tone(ctx, { type: 'square', freq: f, at: i * 0.13, dur: 0.12, vol: 0.12 }));
      for (const f of [1047, 784, 523]) tone(ctx, { type: 'square', freq: f, at: 0.42, dur: 0.95, vol: 0.08 });
    } },
    { key: 'fail', name: '{{ic:sax}} Провал', dur: 2.6, make(ctx) {
      [392, 370, 349].forEach((f, i) => tone(ctx, { type: 'sawtooth', freq: f, at: i * 0.45, dur: 0.4, vol: 0.14, attack: 0.03 }));
      const o = tone(ctx, { type: 'sawtooth', freq: 330, at: 1.35, dur: 1.2, vol: 0.14, attack: 0.03 });
      const lfo = ctx.createOscillator(); const depth = ctx.createGain();
      lfo.frequency.value = 6; depth.gain.value = 9;
      lfo.connect(depth).connect(o.frequency); lfo.start(1.5); lfo.stop(2.6);
    } },
  ];
  async function renderSound(snd) {
    const ctx = new OfflineAudioContext(2, Math.ceil(48000 * snd.dur), 48000);
    snd.make(ctx);
    return ctx.startRendering();
  }

  def({
    id: 'soundboard', name: 'Звуковая панель', category: 'Голос и стрим', origin: 'Vencord: NitroSoundpad', defaultOn: true,
    description: 'Кнопка «{{ic:speaker}} Звуки» в голосовом канале: звук слышат все в канале. Есть встроенные звуки, можно добавить свои файлы (mp3, ogg, wav до 3 МБ).',
    settings: [{ key: 'volume', type: 'range', label: 'Громкость звуков', min: 5, max: 100, default: 70, unit: '%' }],
    start(api) {
      const cache = new Map();
      let last = 0;
      const play = async (snd, btnEl) => {
        const v = api.app.voice();
        if (!v || !v.inChannel) { api.toast('Сначала зайдите в голосовой канал'); return; }
        if (Date.now() - last < 400) return;
        last = Date.now();
        try {
          let buf = cache.get(snd.key);
          if (!buf) {
            buf = snd.make ? await renderSound(snd) : await v.ctx.decodeAudioData(await (await fetch(snd.url)).arrayBuffer());
            cache.set(snd.key, buf);
          }
          v.playSound(buf, api.settings.volume / 100);
          if (btnEl) { btnEl.classList.add('playing'); setTimeout(() => btnEl.classList.remove('playing'), Math.min(1500, buf.duration * 1000)); }
        } catch (e) { api.toast('Не удалось проиграть звук: ' + e.message); }
      };
      const open = async (anchor) => {
        document.querySelectorAll('.sb-pop').forEach((x) => x.remove());
        const pop = h('div', { class: 'sb-pop' });
        const draw = async () => {
          const own = await native.soundsList().catch(() => []);
          const item = (snd, removable) => {
            const b = h('button', { class: 'sb-item', title: snd.name, onclick: () => play(snd, b) }, snd.name,
              removable ? h('span', { class: 'sb-x', title: 'Удалить', onclick: async (e) => { e.stopPropagation(); await native.soundsRemove(snd.file); cache.delete(snd.key); draw(); } }, '{{ic:close}}') : null);
            return b;
          };
          pop.replaceChildren(h('div', { class: 'hp-title' }, 'Звуковая панель'),
            h('div', { class: 'sb-grid' }, SOUNDS.map((s) => item(s, false)), own.map((f) => item({ key: 'f:' + f.file, name: '{{ic:note}} ' + f.name, url: f.url, file: f.file }, true))),
            h('div', { class: 'row', style: { marginTop: '8px' } },
              h('button', { class: 'btn', onclick: async () => { const r = await native.soundsImport(); if (r.skipped) api.toast(`Пропущено файлов: ${r.skipped} (больше 3 МБ или не звук)`); draw(); } }, '{{ic:plus}} Свои звуки'),
              h('span', { class: 'hint' }, 'Слышат все в канале')));
        };
        await draw();
        document.body.append(pop);
        const r = anchor.getBoundingClientRect();
        pop.style.left = Math.max(8, Math.min(r.left + r.width / 2 - pop.offsetWidth / 2, innerWidth - pop.offsetWidth - 8)) + 'px';
        pop.style.top = Math.max(40, r.top - pop.offsetHeight - 10) + 'px';
        const off = (ev) => { if (!pop.contains(ev.target) && !anchor.contains(ev.target)) { pop.remove(); document.removeEventListener('mousedown', off); } };
        setTimeout(() => document.addEventListener('mousedown', off), 0);
      };
      api.decorate('voiceControls', () => h('button', { class: 'btn', title: 'Звуковая панель', onclick: (e) => open(e.currentTarget) }, '{{ic:speaker}} Звуки'));
    },
  });

  // ================= Комнаты =================
  def({
    id: 'nsfw-tag', name: 'Метка 18+', category: 'Комнаты', origin: 'BetterDiscord: BetterNsfwTag', defaultOn: true,
    description: 'Заметная красная метка у каналов 18+ в списке каналов.',
    start(api) { api.decorate('channel', ({ channel }) => (channel.nsfw ? h('span', { class: 'nsfw-tag' }, '18+') : null)); },
  });

  def({
    id: 'nsfw-blur', name: 'Размытие 18+', category: 'Комнаты', origin: 'Vencord: BlurNSFW', defaultOn: true,
    description: 'Стикеры и картинки в каналах 18+ размыты, пока на них не навести мышь.',
    settings: [{ key: 'blur', type: 'range', label: 'Сила размытия', min: 4, max: 40, default: 10, unit: ' px' }],
    start(api) {
      api.addCss('.msg.nsfw-blur .sticker, .msg.nsfw-blur .text .emoji { filter: blur(var(--nsfw-blur, 18px)); transition: filter .2s; } .msg.nsfw-blur .sticker:hover, .msg.nsfw-blur .text .emoji:hover { filter: none; }');
      const apply = () => document.documentElement.style.setProperty('--nsfw-blur', api.settings.blur + 'px');
      apply();
      this.onSettings = apply;
      api.decorate('message', ({ channel, node }) => { const ch = api.app.channel(channel); if (ch && ch.nsfw) node.classList.add('nsfw-blur'); return null; });
    },
  });

  def({
    id: 'room-counter', name: 'Счётчик комнат', category: 'Комнаты', origin: 'BetterDiscord: ServerCounter', defaultOn: true,
    description: 'Внизу левой полосы — сколько у вас сохранённых комнат.',
    start(api) { api.decorate('railBottom', ({ rooms }) => h('div', { class: 'rail-count' }, 'Комнат', h('br'), h('b', null, rooms.length))); },
  });

  def({
    id: 'room-details', name: 'Детали комнаты', category: 'Комнаты', origin: 'BetterDiscord: ServerDetails', defaultOn: true,
    description: 'Подсказка при наведении на комнату слева: код, адрес, пароль, когда вы заходили и сколько было людей.',
    start(api) {
      api.decorate('roomTooltip', (room) => [
        room.locked ? '{{ic:lock}} закрыта паролем' : '{{ic:unlock}} без пароля',
        `Код: ${room.code}`, `Адрес: ${room.host}:${room.port}`,
        room.lastVisit ? 'Последний вход: ' + api.app.fmtTime(room.lastVisit) : null,
        room.lastMembers ? `Участников при входе: ${room.lastMembers}` : null,
        room.pinned ? '{{ic:pin}} закреплена' : null,
      ]);
    },
  });

  // ================= Активность и музыка =================
  def({
    id: 'activity-toggle', name: 'Кнопка активности', category: 'Активность и музыка', origin: 'BetterDiscord: GameActivityToggle', defaultOn: true,
    description: 'Кнопка {{ic:gamepad}} внизу слева: одним нажатием скрыть или показать друзьям, во что вы играете.',
    start(api) {
      api.decorate('userbar', () => {
        const on = api.app.shareActivity;
        return h('button', { class: 'icon-btn' + (on ? '' : ' off'), title: on ? 'Активность видна друзьям' : 'Активность скрыта', onclick: () => { api.app.setShareActivity(!on); api.app.rerenderUserbar(); } }, on ? '{{ic:gamepad}}' : '{{ic:block}}');
      });
    },
  });

  def({
    id: 'custom-activity', name: 'Своя активность', category: 'Активность и музыка', origin: 'Vencord: CustomRPC', defaultOn: true,
    description: 'Задайте свой статус «Играет в…» вручную. Пока название пустое, плагин ничего не меняет; заполненное важнее найденной игры.',
    settings: [
      { key: 'name', type: 'text', label: 'Название', default: '', max: 64, placeholder: 'Например: Пишу мессенджер' },
      { key: 'details', type: 'text', label: 'Подробности', default: '', max: 128 },
      { key: 'state', type: 'text', label: 'Состояние', default: '', max: 128 },
      { key: 'image', type: 'text', label: 'Картинка (ссылка)', default: '', max: 300, placeholder: 'https://i.imgur.com/…', hint: 'Только с проверенных сайтов, как аватар.' },
      { key: 'kind', type: 'select', label: 'Вид', default: 'game', options: [['game', '{{ic:gamepad}} Играет'], ['music', '{{ic:note}} Слушает']] },
      { key: 'timer', type: 'switch', label: 'Показывать время с начала', default: true },
    ],
    start(api) {
      const started = Date.now();
      const apply = () => {
        const s = api.settings;
        api.app.setActivityOverride(s.name ? { name: s.name, details: s.details, state: s.state, image: C.safeUrl(s.image) || null, kind: s.kind, startedAt: s.timer ? started : null } : null);
      };
      apply();
      this.onSettings = apply;
      api.cleanup(() => api.app.setActivityOverride(null));
    },
  });

  def({
    id: 'now-playing', name: 'Сейчас играет', category: 'Активность и музыка', origin: 'BetterDiscord: SpotifyEnhance', defaultOn: true,
    description: 'Трек из Spotify, Яндекс Музыки, браузера и других плееров: панель с кнопками над вашим именем, «Слушает…» у друзей, кнопка «поделиться треком».',
    settings: [
      { key: 'share', type: 'switch', label: 'Показывать друзьям, что я слушаю', default: true },
      { key: 'panel', type: 'switch', label: 'Панель плеера над моим именем', default: true },
    ],
    start(api) {
      let track = null;
      const push = () => {
        const t = track;
        api.app.setMusic(t && t.playing && api.settings.share ? { name: t.app, details: t.title, state: t.artist, kind: 'music', startedAt: null } : null);
      };
      const unsub = mediaHub.sub((t) => { track = t; push(); api.app.rerender(); });
      api.cleanup(() => { unsub(); api.app.setMusic(null); });
      this.onSettings = () => { push(); api.app.rerender(); };
      const pos = () => (track ? Math.min(track.dur || 0, track.pos + (track.playing ? (Date.now() - track.at) / 1000 : 0)) : 0);
      api.interval(() => {
        const bar = document.querySelector('.np-panel .np-bar i');
        if (bar && track && track.dur) bar.style.width = Math.min(100, (pos() / track.dur) * 100) + '%';
        const tm = document.querySelector('.np-panel .np-time');
        if (tm && track && track.dur) tm.textContent = `${fmtClock(pos())} / ${fmtClock(track.dur)}`;
      }, 1000);
      api.decorate('sideBottom', () => {
        if (!api.settings.panel || !track) return null;
        const cmd = (c) => native.mediaCommand(c);
        const state = api.app.getState();
        return h('div', { class: 'np-panel' },
          h('div', { class: 'np-title', title: track.title }, '{{ic:note}} ', track.title), h('div', { class: 'np-artist' }, [track.artist, track.app].filter(Boolean).join(' · ')),
          track.dur ? h('div', { class: 'np-bar' }, h('i', { style: { width: Math.min(100, (pos() / track.dur) * 100) + '%' } })) : null,
          h('div', { class: 'np-ctrl' },
            h('button', { class: 'icon-btn', title: 'Предыдущий', onclick: () => cmd('prev') }, '{{ic:prev}}'),
            h('button', { class: 'icon-btn', title: track.playing ? 'Пауза' : 'Играть', onclick: () => cmd('toggle') }, track.playing ? '{{ic:pause}}' : '{{ic:play}}'),
            h('button', { class: 'icon-btn', title: 'Следующий', onclick: () => cmd('next') }, '{{ic:next}}'),
            state.view.type === 'text' ? h('button', { class: 'icon-btn', title: 'Поделиться треком в чате', onclick: () => api.app.sendMessage(state.channel, `🎵 Слушаю: ${[track.artist, track.title].filter(Boolean).join(' — ')}`) }, '{{ic:share}}') : null,
            track.dur ? h('span', { class: 'hint np-time', style: { marginLeft: 'auto', alignSelf: 'center' } }, `${fmtClock(pos())} / ${fmtClock(track.dur)}`) : null));
      });
    },
  });

  def({
    id: 'music-theme', name: 'Цвет под музыку', category: 'Активность и музыка', origin: 'BetterDiscord: MusicTheme', defaultOn: false,
    description: 'Цвет интерфейса меняется под трек, который сейчас играет. У каждого трека свой цвет.',
    settings: [{ key: 'sat', type: 'range', label: 'Насыщенность', min: 30, max: 100, default: 75, unit: '%' }],
    start(api) {
      let track = null;
      const hslHex = (hh, s, l) => {
        const k = (n) => (n + hh / 30) % 12; const a = s * Math.min(l, 1 - l);
        const f = (n) => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1))))).toString(16).padStart(2, '0');
        return '#' + f(0) + f(8) + f(4);
      };
      const apply = () => {
        if (!track || !track.playing) { api.app.setAccentOverride(null); return; }
        let hash = 0;
        for (const ch of (track.artist || '') + (track.title || '')) hash = (hash * 31 + ch.codePointAt(0)) >>> 0;
        api.app.setAccentOverride(hslHex(hash % 360, api.settings.sat / 100, 0.58));
      };
      const unsub = mediaHub.sub((t) => { track = t; apply(); });
      this.onSettings = apply;
      api.cleanup(() => { unsub(); api.app.setAccentOverride(null); });
    },
  });

  // ================= Оформление =================
  def({
    id: 'screen-effects', name: 'Эффекты на экране', category: 'Оформление', origin: 'BetterDiscord: DiscordEffects', defaultOn: true,
    description: 'Падающие звёзды, снег, дождь и другие частицы поверх или позади интерфейса.',
    settings: [
      { key: 'effect', type: 'select', label: 'Эффект', default: 'shooting', options: [['shooting', 'Падающие звёзды'], ['snow', 'Снег'], ['rain', 'Дождь'], ['sparkles', 'Искры'], ['hearts', 'Сердца'], ['embers', 'Угольки'], ['stars', 'Звёздное небо'], ['sakura', 'Сакура'], ['bubbles', 'Пузыри']] },
      { key: 'layer', type: 'select', label: 'Слой', default: 'front', options: [['front', 'Поверх интерфейса'], ['behind', 'Позади панелей']] },
      { key: 'count', type: 'range', label: 'Количество', min: 5, max: 160, default: 40 },
      { key: 'speed', type: 'range', label: 'Скорость', min: 0.2, max: 3, step: 0.1, default: 1, unit: '×' },
      { key: 'angle', type: 'range', label: 'Угол (для звёзд)', min: 0, max: 360, default: 332, unit: '°' },
      { key: 'opacity', type: 'range', label: 'Прозрачность', min: 10, max: 100, default: 50, unit: '%' },
      { key: 'color', type: 'color', label: 'Цвет', default: '#ffffff' },
    ],
    start(api) {
      let canvas = null; let run = null;
      const apply = () => {
        if (run) run.stop();
        if (canvas) canvas.remove();
        const s = api.settings;
        canvas = h('canvas', { id: 'screen-fx', class: s.layer === 'behind' ? 'behind' : '' });
        document.body.append(canvas);
        run = C.particles(canvas, s.effect, { count: s.count, speed: s.speed, angle: s.angle, opacity: s.opacity / 100, color: s.color });
      };
      apply();
      this.onSettings = apply;
      api.cleanup(() => { if (run) run.stop(); if (canvas) canvas.remove(); });
    },
  });

  // Что стало с вашими плагинами из BetterDiscord и Vencord (для кнопки «Перенести»).
  const P = (plugin) => ({ plugin });
  const N = (native) => ({ native });
  const X = (none) => ({ none });
  // Плагин и перевод его настроек из BetterDiscord или Vencord (значения проверяются по схеме настроек при переносе).
  const PS = (plugin, settings) => ({ plugin, settings });
  const num = (v) => (Number.isFinite(v) ? v : undefined);
  C.pluginOrigins = {
    // BetterDiscord
    DiscordEffects: PS('screen-effects', (c) => {
      const s = (c && c.settings) || {};
      const effect = { shootingStars: 'shooting', snowflakes: 'snow', rain: 'rain' }[s.effect];
      const rain = effect === 'rain';
      const op = num(rain ? s.rainopacity : s.flakeopacity);
      return { effect, layer: /back|behind/i.test(s.layer || '') ? 'behind' : 'front', angle: num(s.angle), color: rain ? s.raincolor : s.flakecolor, opacity: op == null ? undefined : Math.round(op * 100) };
    }),
    BetterNsfwTag: P('nsfw-tag'), FriendNotifications: P('friend-watch'), GameActivityToggle: P('activity-toggle'),
    InvisibleTyping: P('invisible-typing'), LastMessageDate: P('last-message'), MemberCounter: P('member-counter'), MusicTheme: P('music-theme'),
    ServerCounter: P('room-counter'), ServerDetails: P('room-details'), ShowSpectators: P('spectators'), SpotifyEnhance: P('now-playing'), VoiceActivity: P('voice-activity'),
    PhantomProfile: N('рамки, таблички, эффекты профиля, значки и стили имени, причём их видят все'),
    VideoCompressor: P('media-compressor'), BDFDB: X('служебная библиотека BetterDiscord, не нужна'),
    // Vencord
    BlurNSFW: PS('nsfw-blur', (c) => ({ blur: num(c.blurAmount) })),
    CustomRPC: PS('custom-activity', (c) => ({ name: c.appName, details: c.details, state: c.state, image: C.safeUrl(c.imageBig) || undefined, kind: c.type === 2 ? 'music' : 'game' })),
    MessageLogger: PS('message-logger', (c) => ({ deleted: c.logDeletes, edits: c.logEdits, own: typeof c.ignoreSelf === 'boolean' ? !c.ignoreSelf : undefined })),
    AnonymiseFileNames: PS('anonymise-files', (c) => ({ always: c.anonymiseByDefault, length: num(c.randomisedLength) })),
    VoiceMessages: P('voice-messages'), VoiceDownload: N('кнопка «Скачать» у каждого файла и голосового сообщения'),
    CallTimer: P('call-timer'), ExpressionCloner: P('expression-cloner'), MemberCount: P('member-counter'),
    NoTypingAnimation: P('no-typing-anim'), RevealAllSpoilers: P('reveal-spoilers'), TypingIndicator: P('typing-indicator'),
    UserVoiceShow: P('voice-activity'), ViewIcons: P('view-icons'), WhoReacted: P('who-reacted'), petpet: P('petpet'), WebKeybinds: P('hotkeys'),
    // Сам не включается: прятал бы всё оформление профилей, ради которого и сделан кастом.
    NoProfileThemes: { plugin: 'plain-profiles', optional: true },
    AlwaysAnimate: N('GIF всегда анимированы (можно выключить во «Внешнем виде»)'), Decor: N('свои рамки аватара по ссылке'), FakeNitro: N('все эмодзи и стикеры бесплатно'),
    FakeProfileThemes: N('два цвета профиля, стиль карточки'), USRBG: N('баннер и фон профиля по ссылке'), PinDMs: N('закреп комнат (правый клик по комнате слева)'),
    BetterFolders: N('закреплённые комнаты отделяются сверху'), NoTrack: N('приложение не шлёт никакой статистики'), NoNitroAds: N('рекламы нет'),
    WebContextMenus: N('контекстные меню по правому клику'), WebScreenShareFixes: N('показ экрана до 4K и 120 кадров'), DisableDeepLinks: N('ссылки не открываются, а копируются'),
    CrashHandler: N('ошибки плагинов не роняют приложение'), Settings: N('свои настройки'), SupportHelper: X('служебный модуль Vencord'), FixDiscordCss: X('чинит стили Discord, здесь не нужен'),
    NitroSoundpad: PS('soundboard', (c) => ({ volume: num(c.volume) })), Translate: X('не перенесён: текст сообщений уходил бы стороннему переводчику'),
    iLoveSpam: X('спам-фильтра Discord здесь нет'), PermissionsViewer: X('ролей пока нет, права только у владельца'), PlainFolderIcon: X('папок нет, есть закреп'),
    YoutubeAdblock: X('встроенного YouTube нет'), NewsBanner: X('баннеров новостей Discord нет'), NoPendingCount: X('заявок в друзья нет'),
    AccountPanelServerProfile: X('профиль один для всех комнат'),
  };
})();
