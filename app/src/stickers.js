// Библиотека стикеров и кастомных эмодзи: категории, импорт и экспорт в JSON.
// Хранятся только ссылки на проверенные сайты (список в allowlist.js).
(function () {
  const C = window.Corsa;

  const FORMAT = 'corsa-mess.stickers';
  const MAX_CATEGORIES = 100;
  const MAX_ITEMS_PER_CATEGORY = 500;
  const MAX_ITEMS_TOTAL = 3000;
  const DEFAULT_CATEGORY = 'Мои стикеры';

  const emojiName = (s) => {
    const n = String(s || '').replace(/[^A-Za-z0-9_]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '').slice(0, 32);
    return n.length >= 2 ? n : 'emoji_' + Math.random().toString(36).slice(2, 6);
  };

  function guessName(url) {
    try {
      const file = decodeURIComponent(new URL(url).pathname.split('/').filter(Boolean).pop() || '');
      return file.replace(/\.[a-z0-9]+$/i, '').slice(0, 40);
    } catch (e) { return ''; }
  }

  const lib = {
    categories: [],

    load() {
      let data = C.store.get('stickerlib', null);
      if (!data || !Array.isArray(data.categories)) {
        // Миграция: раньше был плоский список ссылок на стикеры.
        const old = C.store.get('stickers', []);
        data = { categories: [{ id: C.uuid(), name: DEFAULT_CATEGORY, items: [] }] };
        for (const url of Array.isArray(old) ? old : []) {
          const safe = C.safeUrl(url);
          if (safe) data.categories[0].items.push({ id: C.uuid(), type: 'sticker', name: guessName(safe), url: safe });
        }
      }
      this.categories = data.categories;
      this.save();
    },

    save() { C.store.set('stickerlib', { categories: this.categories }); },

    total() { return this.categories.reduce((n, c) => n + c.items.length, 0); },
    cat(id) { return this.categories.find((c) => c.id === id) || null; },

    addCategory(name) {
      const n = String(name || '').trim().slice(0, 40);
      if (!n) throw new Error('Введите название категории');
      if (this.categories.length >= MAX_CATEGORIES) throw new Error('Слишком много категорий');
      if (this.categories.some((c) => c.name.toLowerCase() === n.toLowerCase())) throw new Error('Такая категория уже есть');
      const c = { id: C.uuid(), name: n, items: [] };
      this.categories.push(c);
      this.save();
      return c;
    },

    renameCategory(id, name) {
      const c = this.cat(id);
      const n = String(name || '').trim().slice(0, 40);
      if (!c || !n) return;
      if (this.categories.some((x) => x !== c && x.name.toLowerCase() === n.toLowerCase())) throw new Error('Такая категория уже есть');
      c.name = n;
      this.save();
    },

    deleteCategory(id) {
      this.categories = this.categories.filter((c) => c.id !== id);
      this.save();
    },

    moveCategory(id, dir) {
      const i = this.categories.findIndex((c) => c.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= this.categories.length) return;
      [this.categories[i], this.categories[j]] = [this.categories[j], this.categories[i]];
      this.save();
    },

    addItem(catId, { type, name, url }) {
      const c = this.cat(catId);
      if (!c) throw new Error('Нет такой категории');
      const safe = C.safeUrl(url);
      if (!safe) throw new Error('Этот сайт не в списке проверенных. Разрешены: ' + window.CorsaAllowlist.HOSTS.join(', '));
      if (c.items.length >= MAX_ITEMS_PER_CATEGORY || this.total() >= MAX_ITEMS_TOTAL) throw new Error('Достигнут предел количества');
      if (c.items.some((i) => i.url === safe && i.type === type)) throw new Error('Это уже есть в категории');
      const kind = type === 'emoji' ? 'emoji' : 'sticker';
      const item = { id: C.uuid(), type: kind, name: kind === 'emoji' ? emojiName(name || guessName(safe)) : String(name || guessName(safe)).slice(0, 40), url: safe };
      c.items.push(item);
      this.save();
      return item;
    },

    removeItem(catId, itemId) {
      const c = this.cat(catId);
      if (!c) return;
      c.items = c.items.filter((i) => i.id !== itemId);
      this.save();
    },

    moveItem(fromId, itemId, toId) {
      const from = this.cat(fromId);
      const to = this.cat(toId);
      if (!from || !to || from === to) return;
      const item = from.items.find((i) => i.id === itemId);
      if (!item || to.items.some((i) => i.url === item.url && i.type === item.type)) return;
      from.items = from.items.filter((i) => i !== item);
      to.items.push(item);
      this.save();
    },

    // Эмодзи по имени для вставки :имя: в сообщение.
    findEmoji(name) {
      for (const c of this.categories) for (const i of c.items) if (i.type === 'emoji' && i.name === name) return i.url;
      return null;
    },

    // Какие из использованных в тексте :имён: есть в нашей библиотеке — их ссылки уходят вместе с сообщением.
    usedEmojis(text) {
      const out = {};
      for (const m of String(text).matchAll(/:([A-Za-z0-9_]{2,32}):/g)) {
        const url = this.findEmoji(m[1]);
        if (url && Object.keys(out).length < 12) out[m[1]] = url;
      }
      return out;
    },

    // ---------- Экспорт ----------
    exportObject(cats) {
      return {
        format: FORMAT, version: 1, exportedAt: new Date().toISOString(),
        categories: cats.map((c) => ({ name: c.name, items: c.items.map((i) => ({ type: i.type, name: i.name, url: i.url })) })),
      };
    },
    exportAll() { return this.exportObject(this.categories); },
    exportCategory(id) { const c = this.cat(id); return c ? this.exportObject([c]) : null; },

    // ---------- Импорт ----------
    // Принимает уже разобранный JSON. Всё, что не проходит проверку, пропускается и считается.
    importData(obj) {
      let cats;
      if (Array.isArray(obj)) cats = [{ name: 'Импорт', items: obj.map((url) => ({ type: 'sticker', url })) }];
      else if (obj && obj.format === FORMAT && Array.isArray(obj.categories)) cats = obj.categories;
      else throw new Error('Это не файл стикеров corsa-mess');
      const res = { categories: 0, items: 0, skipped: 0 };
      for (const raw of cats.slice(0, MAX_CATEGORIES)) {
        if (!raw || typeof raw !== 'object' || !Array.isArray(raw.items)) { res.skipped++; continue; }
        const name = String(raw.name || '').trim().slice(0, 40) || 'Импорт';
        let target = this.categories.find((c) => c.name.toLowerCase() === name.toLowerCase());
        if (!target) {
          if (this.categories.length >= MAX_CATEGORIES) { res.skipped += raw.items.length; continue; }
          target = { id: C.uuid(), name, items: [] };
          this.categories.push(target);
          res.categories++;
        }
        for (const it of raw.items) {
          try {
            if (!it || typeof it !== 'object') throw new Error('bad');
            this.addItem(target.id, { type: it.type, name: it.name, url: it.url });
            res.items++;
          } catch (e) { res.skipped++; }
        }
      }
      this.save();
      return res;
    },
  };

  C.stickerLib = lib;
  C.stickerFormat = FORMAT;
})();
