/**
 * app.js – Main application logic for 用药助手 (Medication Reminder PWA)
 *
 * Features:
 *  - Multi-user (patient / family member roles)
 *  - Medication schedule management with AI natural language parsing
 *  - Daily reminder generation & check-off (completed items move to bottom)
 *  - Medication quantity tracking with 7-day low-stock alert
 *  - Push / local notifications
 *  - History view with compliance statistics
 *  - Persistent storage via IndexedDB (db.js)
 */

/* ═══════════════════════════════════════════
   CONSTANTS
   ═══════════════════════════════════════════ */
/** Minutes after scheduled time before a dose is marked as missed */
const MISSED_THRESHOLD_MINUTES = 120;

/* ═══════════════════════════════════════════
   STATE
   ═══════════════════════════════════════════ */
const App = {
  state: {
    users:       [],
    medications: [],
    records:     [],      // today's records for active user/patient
    settings:    null,
    activeUser:  null,
    viewedPatient: null,  // if family member is viewing a patient
    editingMedId: null,   // id being edited, or null for new
    historyDate: null,    // currently viewed date in history
    customTimes: [],      // custom times in medication form
    selectedRole: 'patient',
    newUserRole:  'patient',
    notifTimers:  [],     // setTimeout handles for scheduled notifications
  },

  /* ── Entry point ── */
  async init() {
    await this.loadSettings();
    await this.loadUsers();

    // Register service worker
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js').catch(console.warn);
      navigator.serviceWorker.addEventListener('message', (e) => {
        if (e.data?.type === 'MARK_TAKEN') this.handleExternalMark(e.data.data);
        if (e.data?.type === 'SNOOZE')     this.handleSnooze(e.data.data);
      });
    }

    // Handle snooze data passed via URL query string (SW opens page with ?snooze=...)
    try {
      const snoozeParam = new URLSearchParams(location.search).get('snooze');
      if (snoozeParam) {
        this.handleSnooze(JSON.parse(decodeURIComponent(snoozeParam)));
        // Remove the query string without reloading
        history.replaceState(null, '', location.pathname);
      }
    } catch (_) { /* ignore malformed snooze param */ }

    if (this.state.users.length === 0 || !this.state.settings.activeUserId) {
      this.showOnboarding();
    } else {
      await this.setActiveUser(this.state.settings.activeUserId, false);
      this.showMainApp();
    }

    // Clock ticker
    this.startClock();
  },

  /* ─────────────────────────────────────────
     DATA LOADING
     ───────────────────────────────────────── */
  async loadSettings() {
    this.state.settings = await DB.getSettings();
  },

  async loadUsers() {
    this.state.users = await DB.getUsers();
  },

  async setActiveUser(userId, save = true) {
    const user = this.state.users.find((u) => u.id === userId);
    if (!user) return;
    this.state.activeUser = user;
    if (save) {
      this.state.settings.activeUserId = userId;
      await DB.saveSettings(this.state.settings);
    }
    // Determine viewed patient
    if (user.role === 'patient') {
      this.state.viewedPatient = user;
    } else {
      // Family: default to first patient sharing the family code
      const patients = this.state.users.filter(
        (u) => u.role === 'patient' && u.familyCode === user.familyCode
      );
      this.state.viewedPatient = patients[0] || null;
    }
    await this.loadTodayData();
  },

  async loadTodayData() {
    const patient = this.state.viewedPatient;
    if (!patient) return;
    this.state.medications = await DB.getMedicationsByUser(patient.id);
    const today = todayStr();
    this.state.records = await DB.getRecordsByDate(patient.id, today);
    await this.ensureTodayRecords();
  },

  /* ─────────────────────────────────────────
     DAILY RECORD GENERATION
     ───────────────────────────────────────── */
  async ensureTodayRecords() {
    const today = todayStr();
    const patient = this.state.viewedPatient;
    if (!patient) return;

    const activeMeds = this.state.medications.filter((m) => m.active !== false);
    let changed = false;

    for (const med of activeMeds) {
      for (const t of (med.times || [])) {
        const existing = this.state.records.find(
          (r) => r.medicationId === med.id && r.scheduledTime === t && r.date === today
        );
        if (!existing) {
          const rec = {
            id:            genId(),
            userId:        patient.id,
            medicationId:  med.id,
            date:          today,
            scheduledTime: t,
            status:        'pending',
            takenAt:       null
          };
          await DB.saveRecord(rec);
          this.state.records.push(rec);
          changed = true;
        }
      }
    }

    // Mark overdue as missed using absolute local scheduled timestamp (handles midnight correctly)
    const nowMs = Date.now();
    const thresholdMs = MISSED_THRESHOLD_MINUTES * 60 * 1000;
    for (const rec of this.state.records) {
      if (rec.status === 'pending') {
        // Construct using local date components to avoid UTC/local ambiguity
        const [year, month, day] = rec.date.split('-').map(Number);
        const [hour, min] = rec.scheduledTime.split(':').map(Number);
        const scheduledMs = new Date(year, month - 1, day, hour, min, 0).getTime();
        if (nowMs - scheduledMs > thresholdMs) {
          rec.status = 'missed';
          await DB.saveRecord(rec);
          changed = true;
        }
      }
    }

    if (changed) this.scheduleNotifications();
  },

  /* ─────────────────────────────────────────
     MARK TAKEN
     ───────────────────────────────────────── */
  async markTaken(recordId) {
    const rec = this.state.records.find((r) => r.id === recordId);
    if (!rec || rec.status === 'taken') return;

    rec.status  = 'taken';
    rec.takenAt = Date.now();
    await DB.saveRecord(rec);

    // Decrease medication quantity
    const med = this.state.medications.find((m) => m.id === rec.medicationId);
    if (med && med.quantity > 0) {
      med.quantity = Math.max(0, med.quantity - (med.dose || 1));
      await DB.saveMedication(med);
    }

    this.renderTodayTab();
    this.checkLowStock();
    showToast('已记录服药 ✓', 'success');
  },

  async handleExternalMark(data) {
    if (data?.recordId) await this.markTaken(data.recordId);
  },

  /* Schedule a local notification snooze from a SW message or URL param */
  handleSnooze(data) {
    if (!data) return;
    const delay = data.snoozeMs || 15 * 60 * 1000;
    setTimeout(() => {
      if (Notification.permission !== 'granted') return;
      const n = new Notification(data.title || '用药提醒 💊', {
        body:             data.body || '该服药了！',
        icon:             'icons/icon-192.png',
        tag:              data.tag || 'medication-snooze',
        requireInteraction: true
      });
      n.onclick = () => { window.focus(); n.close(); };
    }, delay);
  },

  /* ─────────────────────────────────────────
     NOTIFICATIONS
     ───────────────────────────────────────── */
  async requestNotificationPermission() {
    if (!('Notification' in window)) return false;
    if (Notification.permission === 'granted') return true;
    if (Notification.permission === 'denied') return false;
    const perm = await Notification.requestPermission();
    return perm === 'granted';
  },

  scheduleNotifications() {
    // Clear existing timers
    this.state.notifTimers.forEach(clearTimeout);
    this.state.notifTimers = [];

    if (!this.state.settings.notifications) return;
    if (!('Notification' in window) || Notification.permission !== 'granted') return;

    const advance = (this.state.settings.reminderAdvance || 0) * 60 * 1000;
    const now = Date.now();
    const today = todayStr();

    for (const rec of this.state.records) {
      if (rec.status !== 'pending') continue;
      const med = this.state.medications.find((m) => m.id === rec.medicationId);
      if (!med) continue;

      const [h, m] = rec.scheduledTime.split(':').map(Number);
      const schMs = new Date(`${today}T${rec.scheduledTime}:00`).getTime() - advance;
      const delay = schMs - now;

      if (delay > 0) {
        const timer = setTimeout(async () => {
          if (Notification.permission !== 'granted') return;
          const n = new Notification(`💊 用药提醒`, {
            body:    `${this.state.viewedPatient?.name || ''} 该服 ${med.name} 了（${med.dose}${med.unit}）`,
            icon:    '/icons/icon-192.png',
            badge:   '/icons/icon-192.png',
            tag:     `med-${rec.id}`,
            data:    { recordId: rec.id },
            requireInteraction: true
          });
          n.onclick = () => { window.focus(); this.markTaken(rec.id); n.close(); };
        }, delay);
        this.state.notifTimers.push(timer);
      }
    }
  },

  /* ─────────────────────────────────────────
     LOW-STOCK ALERT
     ───────────────────────────────────────── */
  checkLowStock() {
    const lowItems = [];
    for (const med of this.state.medications) {
      if (med.active === false) continue;
      const dailyDose = (med.times || []).length * (med.dose || 1);
      if (dailyDose <= 0) continue;
      const daysLeft = med.quantity / dailyDose;
      if (daysLeft < 7) {
        lowItems.push({ med, daysLeft: Math.floor(daysLeft) });
      }
    }

    const banner = document.getElementById('lowStockAlert');
    const msg    = document.getElementById('lowStockMessage');
    if (lowItems.length === 0) {
      banner.classList.add('hidden');
      return;
    }
    const parts = lowItems.map(({ med, daysLeft }) =>
      `${med.name} 仅剩 ${med.quantity}${med.unit}（约${daysLeft}天）`
    );
    msg.textContent = '⚠️ 药品即将不足：' + parts.join('；');
    banner.classList.remove('hidden');
  },

  /* ─────────────────────────────────────────
     ONBOARDING
     ───────────────────────────────────────── */
  showOnboarding() {
    document.getElementById('onboarding').classList.remove('hidden');
    document.getElementById('mainApp').classList.add('hidden');
    document.getElementById('startBtn').addEventListener('click', () => this.handleOnboardingSubmit());
    // Role buttons
    document.querySelectorAll('#onboarding .role-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#onboarding .role-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        this.state.selectedRole = btn.dataset.role;
      });
    });
  },

  async handleOnboardingSubmit() {
    const name = document.getElementById('userName').value.trim();
    if (!name) { showToast('请输入姓名', 'warn'); return; }

    const user = {
      id:         genId(),
      name,
      role:       this.state.selectedRole,
      familyCode: genFamilyCode(),
      createdAt:  Date.now()
    };
    await DB.saveUser(user);
    this.state.users.push(user);

    this.state.settings.activeUserId = user.id;
    await DB.saveSettings(this.state.settings);

    this.state.activeUser = user;
    this.state.viewedPatient = user.role === 'patient' ? user : null;
    this.state.medications = [];
    this.state.records = [];

    document.getElementById('onboarding').classList.add('hidden');
    this.showMainApp();

    // Prompt to enable notifications
    this.promptNotifications();
  },

  /* ─────────────────────────────────────────
     MAIN APP
     ───────────────────────────────────────── */
  showMainApp() {
    document.getElementById('onboarding').classList.add('hidden');
    document.getElementById('mainApp').classList.remove('hidden');
    this.bindMainEvents();
    this.renderAll();
    this.scheduleNotifications();
    this.checkLowStock();
  },

  renderAll() {
    this.renderHeader();
    this.renderTodayTab();
    this.renderMedicationsTab();
    this.renderSettingsTab();
    this.updateUserDropdown();
  },

  /* ─────────────────────────────────────────
     CLOCK
     ───────────────────────────────────────── */
  startClock() {
    const tick = () => {
      const now  = new Date();
      const time = now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
      const date = now.toLocaleDateString('zh-CN', {
        year: 'numeric', month: 'long', day: 'numeric', weekday: 'long'
      });
      const timeEl = document.getElementById('currentTime');
      const dateEl = document.getElementById('currentDate');
      if (timeEl) timeEl.textContent = time;
      if (dateEl) dateEl.textContent = date;

      // Refresh today's data when the local date changes
      const todayDate = todayStr();
      if (todayDate !== this._lastClockDate) {
        this._lastClockDate = todayDate;
        if (this._midnightRefreshPending) return;
        this._midnightRefreshPending = true;
        this.loadTodayData().then(() => {
          this.renderAll();
          this._midnightRefreshPending = false;
        });
      }
    };
    tick();
    setInterval(tick, 1000);

    // Check for missed medications every 5 minutes
    setInterval(async () => {
      await this.ensureTodayRecords();
      this.renderTodayTab();
    }, 5 * 60 * 1000);
  },

  /* ─────────────────────────────────────────
     HEADER
     ───────────────────────────────────────── */
  renderHeader() {
    const u = this.state.activeUser;
    const el = document.getElementById('currentUserName');
    if (el && u) el.textContent = u.name;
  },

  updateUserDropdown() {
    const list = document.getElementById('userList');
    if (!list) return;
    list.innerHTML = '';
    this.state.users.forEach((u) => {
      const div = document.createElement('div');
      div.className = 'dropdown-user' + (u.id === this.state.activeUser?.id ? ' active' : '');
      div.innerHTML = `
        <div class="user-avatar ${u.role === 'patient' ? 'avatar-patient' : 'avatar-family'}">
          ${u.name.charAt(0)}
        </div>
        <div class="user-info">
          <div class="user-info-name">${esc(u.name)}</div>
          <div class="user-info-role">${u.role === 'patient' ? '🤒 患者' : '👨‍👩‍👧 家人'}</div>
        </div>
        ${u.id === this.state.activeUser?.id ? '<span class="user-check">✓</span>' : ''}
      `;
      div.addEventListener('click', async () => {
        await this.setActiveUser(u.id);
        this.renderAll();
        this.closeUserDropdown();
      });
      list.appendChild(div);
    });
  },

  closeUserDropdown() {
    document.getElementById('userDropdown').classList.add('hidden');
  },

  /* ─────────────────────────────────────────
     TODAY TAB
     ───────────────────────────────────────── */
  renderTodayTab() {
    const container = document.getElementById('todayMedications');
    const empty     = document.getElementById('todayEmpty');
    if (!container) return;

    const patient = this.state.viewedPatient;
    const isFamily = this.state.activeUser?.role === 'family';

    // Family banner
    let familyBanner = '';
    if (isFamily && patient) {
      familyBanner = `<div class="family-view-banner">
        <span class="banner-icon">💞</span>
        <div class="banner-text">
          <div class="banner-title">正在查看 ${esc(patient.name)} 的用药情况</div>
          <div class="banner-sub">家人关心，用药无忧</div>
        </div>
      </div>`;
    }

    if (!patient || this.state.medications.length === 0) {
      container.innerHTML = '';
      empty.classList.remove('hidden');
      return;
    }

    empty.classList.add('hidden');

    // Group records by time slot
    const timeGroups = {};
    for (const rec of this.state.records) {
      const t = rec.scheduledTime;
      if (!timeGroups[t]) timeGroups[t] = [];
      timeGroups[t].push(rec);
    }

    // Sort times
    const sortedTimes = Object.keys(timeGroups).sort();
    if (sortedTimes.length === 0) {
      container.innerHTML = familyBanner + `<div class="empty-state">
        <div class="empty-icon">✅</div>
        <p>今日用药记录已全部完成</p>
      </div>`;
      return;
    }

    // Summary
    const totalRecs  = this.state.records.length;
    const takenRecs  = this.state.records.filter((r) => r.status === 'taken').length;
    const summaryHtml = `
      <div class="today-summary">
        <span class="summary-icon">${takenRecs === totalRecs ? '🎉' : '💊'}</span>
        <div class="summary-text">
          <div class="summary-title">今日共 ${totalRecs} 次用药</div>
          <div class="summary-detail">已服 ${takenRecs} 次 · 未服 ${totalRecs - takenRecs} 次</div>
        </div>
      </div>`;

    let html = familyBanner + summaryHtml;

    for (const t of sortedTimes) {
      const recs  = timeGroups[t];
      const label = timeLabel(t);
      const done  = recs.every((r) => r.status === 'taken');
      const count = recs.length;
      const doneCount = recs.filter((r) => r.status === 'taken').length;

      html += `<div class="time-group">
        <div class="time-group-header">
          <span class="time-group-label">⏰ ${label}</span>
          <span class="time-group-badge ${done ? 'done' : ''}">${doneCount}/${count}</span>
        </div>`;

      // Sort: pending first, taken last
      const sorted = [...recs].sort((a, b) => {
        if (a.status === 'taken' && b.status !== 'taken') return 1;
        if (a.status !== 'taken' && b.status === 'taken') return -1;
        return 0;
      });

      for (const rec of sorted) {
        const med = this.state.medications.find((m) => m.id === rec.medicationId);
        if (!med) continue;
        const checked = rec.status === 'taken';
        const missed  = rec.status === 'missed';
        const takenTime = rec.takenAt
          ? new Date(rec.takenAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
          : null;

        const isDisabled = isFamily || checked || missed;
        html += `<div class="med-card ${checked ? 'taken' : ''} ${missed ? 'missed' : ''}" data-rec-id="${rec.id}">
          <div class="med-checkbox-wrap">
            <div class="med-checkbox ${checked ? 'checked' : ''}"
                 data-rec-id="${rec.id}"
                 role="checkbox"
                 aria-checked="${checked ? 'true' : 'false'}"
                 aria-label="${esc(med.name)} ${label}"
                 ${isDisabled ? 'aria-disabled="true" style="pointer-events:none;opacity:0.6"' : 'tabindex="0"'}>
              ${checked ? '✓' : (missed ? '✗' : '')}
            </div>
          </div>
          <div class="med-info">
            <div class="med-name">${esc(med.name)}</div>
            <div class="med-dose">${med.dose}${med.unit} · ${label}</div>
            ${med.notes ? `<div class="med-notes">${esc(med.notes)}</div>` : ''}
            ${takenTime ? `<div class="med-notes">✓ ${takenTime} 已服</div>` : ''}
          </div>
          <span class="med-status-tag status-${rec.status}">
            ${rec.status === 'taken' ? '已服' : rec.status === 'missed' ? '漏服' : '待服'}
          </span>
        </div>`;
      }

      html += '</div>';
    }

    container.innerHTML = html;

    // Bind checkbox clicks and keyboard activation (patients only)
    if (!isFamily) {
      container.querySelectorAll('.med-checkbox:not([aria-disabled])').forEach((el) => {
        el.addEventListener('click', () => this.markTaken(el.dataset.recId));
        el.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.markTaken(el.dataset.recId); }
        });
      });
    }
  },

  /* ─────────────────────────────────────────
     MEDICATIONS TAB
     ───────────────────────────────────────── */
  renderMedicationsTab() {
    const list  = document.getElementById('medicationList');
    const empty = document.getElementById('medicationsEmpty');
    if (!list) return;

    const meds = this.state.medications.filter((m) => m.active !== false);

    if (meds.length === 0) {
      list.innerHTML = '';
      empty.classList.remove('hidden');
      return;
    }
    empty.classList.add('hidden');

    list.innerHTML = meds.map((med) => {
      const dailyDose = (med.times || []).length * (med.dose || 1);
      const daysLeft  = dailyDose > 0 ? Math.floor(med.quantity / dailyDose) : Infinity;
      let qtyClass = 'qty-ok';
      let qtyNote  = `剩余 ${med.quantity}${med.unit}`;
      if (daysLeft < 7)  { qtyClass = 'qty-low'; qtyNote += ` (≈${daysLeft}天)`; }
      if (daysLeft <= 0) { qtyClass = 'qty-out'; qtyNote  = '已用完！'; }

      const timePills = (med.times || [])
        .map((t) => `<span class="time-pill">⏰ ${t}</span>`)
        .join('');

      return `<div class="medication-item" data-med-id="${med.id}">
        <div class="med-item-icon">💊</div>
        <div class="med-item-info">
          <div class="med-item-name">${esc(med.name)}</div>
          <div class="med-item-detail">每次 ${med.dose}${med.unit} · 每天 ${(med.times||[]).length} 次</div>
          <div class="med-item-times">
            ${timePills}
            <span class="quantity-pill ${qtyClass}">${qtyNote}</span>
          </div>
          ${med.notes ? `<div class="med-item-detail" style="margin-top:6px">${esc(med.notes)}</div>` : ''}
        </div>
        <div class="med-item-actions">
          <button class="btn-edit"   data-med-id="${med.id}">编辑</button>
          <button class="btn-delete" data-med-id="${med.id}">删除</button>
        </div>
      </div>`;
    }).join('');

    list.querySelectorAll('.btn-edit').forEach((btn) => {
      btn.addEventListener('click', () => this.openMedicationModal(btn.dataset.medId));
    });
    list.querySelectorAll('.btn-delete').forEach((btn) => {
      btn.addEventListener('click', () => this.deleteMedication(btn.dataset.medId));
    });
  },

  /* ─────────────────────────────────────────
     MEDICATION MODAL
     ───────────────────────────────────────── */
  openMedicationModal(medId = null) {
    this.state.editingMedId = medId;
    this.state.customTimes  = [];

    const modal    = document.getElementById('medicationModal');
    const overlay  = document.getElementById('modalOverlay');
    const titleEl  = document.getElementById('modalTitle');
    const aiSection = document.getElementById('aiInputSection');

    titleEl.textContent = medId ? '编辑药品' : '添加药品';
    aiSection.style.display = (medId || !this.state.settings.aiEnabled) ? 'none' : 'block';

    // Clear form
    document.getElementById('aiInput').value    = '';
    document.getElementById('medName').value    = '';
    document.getElementById('medDose').value    = '1';
    document.getElementById('medUnit').value    = '片';
    document.getElementById('medNotes').value   = '';
    document.getElementById('medQuantity').value = '0';
    document.querySelectorAll('.med-time').forEach((cb) => (cb.checked = false));
    document.getElementById('customTimes').innerHTML = '';

    // Populate patient selector
    const patSel = document.getElementById('medPatient');
    patSel.innerHTML = '';
    this.state.users.filter((u) => u.role === 'patient').forEach((u) => {
      const opt = document.createElement('option');
      opt.value = u.id;
      opt.textContent = u.name;
      if (u.id === this.state.viewedPatient?.id) opt.selected = true;
      patSel.appendChild(opt);
    });

    // If editing, populate form with existing data
    if (medId) {
      const med = this.state.medications.find((m) => m.id === medId);
      if (med) {
        document.getElementById('medName').value     = med.name;
        document.getElementById('medDose').value     = med.dose;
        document.getElementById('medUnit').value     = med.unit || '片';
        document.getElementById('medNotes').value    = med.notes || '';
        document.getElementById('medQuantity').value = med.quantity || 0;
        if (patSel.querySelector(`option[value="${med.userId}"]`)) {
          patSel.value = med.userId;
        }

        const defaultTimes = ['07:00','12:00','18:00','22:00'];
        for (const t of (med.times || [])) {
          const cb = document.querySelector(`.med-time[value="${t}"]`);
          if (cb) {
            cb.checked = true;
          } else {
            this.addCustomTimeRow(t);
          }
        }
      }
    }

    // Sync unit label (bound once here, not on every modal open)
    document.getElementById('medQuantityUnit').textContent =
      document.getElementById('medUnit').value;

    modal.classList.remove('hidden');
    overlay.classList.remove('hidden');
  },

  closeMedicationModal() {
    document.getElementById('medicationModal').classList.add('hidden');
    document.getElementById('modalOverlay').classList.add('hidden');
  },

  addCustomTimeRow(value = '') {
    const container = document.getElementById('customTimes');
    const rowId = genId();
    const row = document.createElement('div');
    row.className = 'custom-time-row';
    row.dataset.rowId = rowId;
    row.innerHTML = `
      <input type="time" class="custom-time-input" value="${value}"
             style="flex:1;padding:12px 14px;font-size:1.1rem;border:2px solid var(--border);border-radius:8px">
      <button class="btn-remove-time" data-row-id="${rowId}">✕</button>
    `;
    row.querySelector('.btn-remove-time').addEventListener('click', () => row.remove());
    container.appendChild(row);
  },

  async saveMedication() {
    const name = document.getElementById('medName').value.trim();
    if (!name) { showToast('请输入药品名称', 'warn'); return; }

    const dose = parseFloat(document.getElementById('medDose').value) || 1;
    const unit = document.getElementById('medUnit').value;
    const notes    = document.getElementById('medNotes').value.trim();
    const quantity = parseInt(document.getElementById('medQuantity').value) || 0;
    const userId   = document.getElementById('medPatient').value;

    // Collect times
    const times = [];
    document.querySelectorAll('.med-time:checked').forEach((cb) => times.push(cb.value));
    document.querySelectorAll('.custom-time-input').forEach((inp) => {
      if (inp.value) times.push(inp.value);
    });
    if (times.length === 0) { showToast('请至少选择一个服药时间', 'warn'); return; }
    times.sort();

    const isNew = !this.state.editingMedId;
    const med = isNew
      ? { id: genId(), userId, createdAt: Date.now() }
      : { ...(this.state.medications.find((m) => m.id === this.state.editingMedId) || { id: this.state.editingMedId }) };

    Object.assign(med, { name, dose, unit, times, quantity, notes, active: true });
    await DB.saveMedication(med);

    if (isNew) {
      this.state.medications.push(med);
    } else {
      const idx = this.state.medications.findIndex((m) => m.id === med.id);
      if (idx >= 0) this.state.medications[idx] = med;
    }

    // Refresh today's records
    await this.ensureTodayRecords();
    this.renderAll();
    this.scheduleNotifications();
    this.checkLowStock();
    this.closeMedicationModal();
    showToast(isNew ? '药品添加成功' : '药品已更新', 'success');
  },

  async deleteMedication(medId) {
    if (!confirm('确认删除此药品及其所有记录？')) return;
    await DB.deleteMedication(medId);
    await DB.deleteRecordsByMedication(medId);
    this.state.medications = this.state.medications.filter((m) => m.id !== medId);
    this.state.records = this.state.records.filter((r) => r.medicationId !== medId);
    this.renderAll();
    showToast('药品已删除');
  },

  /* ─────────────────────────────────────────
     AI PARSING
     ───────────────────────────────────────── */
  async parseAiInput() {
    const text = document.getElementById('aiInput').value.trim();
    if (!text) { showToast('请先输入药单描述', 'warn'); return; }

    const parseBtn = document.getElementById('parseAiBtn');
    parseBtn.disabled = true;
    parseBtn.textContent = '解析中…';

    try {
      const result = await AI.parse(text, {
        apiBaseUrl: this.state.settings.apiBaseUrl,
        apiKey:     this.state.settings.apiKey,
        apiModel:   this.state.settings.apiModel
      });

      if (result.name) document.getElementById('medName').value = result.name;
      if (result.dose) document.getElementById('medDose').value = result.dose;
      if (result.unit) document.getElementById('medUnit').value = result.unit;
      if (result.quantity) document.getElementById('medQuantity').value = result.quantity;
      if (result.notes) document.getElementById('medNotes').value = result.notes;
      document.getElementById('medQuantityUnit').textContent = result.unit || '片';

      // Set times
      document.querySelectorAll('.med-time').forEach((cb) => (cb.checked = false));
      document.getElementById('customTimes').innerHTML = '';
      if (result.times?.length) {
        for (const t of result.times) {
          const cb = document.querySelector(`.med-time[value="${t}"]`);
          if (cb) {
            cb.checked = true;
          } else {
            this.addCustomTimeRow(t);
          }
        }
      }
      showToast('药单解析成功', 'success');
    } catch (err) {
      showToast('解析失败：' + err.message, 'error');
    } finally {
      parseBtn.disabled = false;
      parseBtn.textContent = '解析药单';
    }
  },

  /* ─────────────────────────────────────────
     HISTORY TAB
     ───────────────────────────────────────── */
  async renderHistoryTab() {
    const container = document.getElementById('historyRecords');
    if (!container) return;
    if (!this.state.historyDate) this.state.historyDate = todayStr();

    const date    = this.state.historyDate;
    const patient = this.state.viewedPatient;
    if (!patient) { container.innerHTML = '<p class="text-muted" style="padding:20px">请先添加患者</p>'; return; }

    // Update nav title
    const navTitle = document.getElementById('historyNavTitle');
    if (navTitle) navTitle.textContent = formatDateCN(date);

    const records = await DB.getRecordsByDate(patient.id, date);
    const meds    = await DB.getMedicationsByUser(patient.id);

    // Compliance for this day
    const total  = records.length;
    const taken  = records.filter((r) => r.status === 'taken').length;
    const pct    = total > 0 ? Math.round((taken / total) * 100) : 0;

    let html = `
      <div class="compliance-card">
        <div class="compliance-title">服药依从性</div>
        <div class="compliance-bar-wrap">
          <div class="compliance-bar" style="width:${pct}%"></div>
        </div>
        <div class="compliance-label">${taken}/${total} 次 · ${pct}%</div>
      </div>`;

    if (records.length === 0) {
      html += `<div class="empty-state">
        <div class="empty-icon">📭</div>
        <p>当天没有用药记录</p>
      </div>`;
    } else {
      // Group by time
      const byTime = {};
      records.forEach((r) => {
        if (!byTime[r.scheduledTime]) byTime[r.scheduledTime] = [];
        byTime[r.scheduledTime].push(r);
      });

      html += `<div class="history-record-card">
        <div class="record-date-title">${formatDateCN(date)}</div>`;

      Object.keys(byTime).sort().forEach((t) => {
        byTime[t].forEach((rec) => {
          const med = meds.find((m) => m.id === rec.medicationId);
          const icon = rec.status === 'taken' ? '✅' : rec.status === 'missed' ? '❌' : '⏳';
          const takenStr = rec.takenAt
            ? new Date(rec.takenAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
            : '';
          html += `<div class="record-item">
            <span class="record-status-icon">${icon}</span>
            <div class="record-info">
              <div class="record-name">${esc(med?.name || '未知药品')}</div>
              <div class="record-time">${t} ${rec.status === 'taken' ? '✓ 已服（' + takenStr + '）' : rec.status === 'missed' ? '⚠ 漏服' : '待服'}</div>
            </div>
          </div>`;
        });
      });

      html += '</div>';
    }

    container.innerHTML = html;
  },

  /* ─────────────────────────────────────────
     SETTINGS TAB
     ───────────────────────────────────────── */
  renderSettingsTab() {
    // Family code
    const fcEl = document.getElementById('familyCode');
    if (fcEl) fcEl.textContent = this.state.activeUser?.familyCode || '—';

    // Notification toggle
    const notifToggle = document.getElementById('notificationToggle');
    if (notifToggle) notifToggle.checked = this.state.settings.notifications;

    // AI toggle
    const aiToggle = document.getElementById('aiToggle');
    if (aiToggle) {
      aiToggle.checked = this.state.settings.aiEnabled;
      document.getElementById('aiKeyItem').classList.toggle('hidden', !this.state.settings.aiEnabled);
    }

    // Reminder advance
    const advSel = document.getElementById('reminderAdvance');
    if (advSel) advSel.value = String(this.state.settings.reminderAdvance || 10);

    // User list
    const userListEl = document.getElementById('settingsUserList');
    if (userListEl) {
      userListEl.innerHTML = this.state.users.map((u) => `
        <div class="settings-user-card">
          <div class="user-avatar ${u.role === 'patient' ? 'avatar-patient' : 'avatar-family'}" style="width:36px;height:36px;font-size:1.1rem">
            ${u.name.charAt(0)}
          </div>
          <div class="settings-user-info">
            <div class="settings-user-name">${esc(u.name)}</div>
            <div class="settings-user-role">${u.role === 'patient' ? '患者' : '家庭成员'}</div>
          </div>
          <span class="settings-user-badge ${u.role === 'patient' ? 'badge-patient' : 'badge-family'}">
            ${u.role === 'patient' ? '患者' : '家人'}
          </span>
          ${u.id !== this.state.activeUser?.id ? `<button class="btn-delete btn-small" data-del-uid="${u.id}">删除</button>` : '<span class="settings-user-badge badge-current">当前</span>'}
        </div>
      `).join('');

      userListEl.querySelectorAll('[data-del-uid]').forEach((btn) => {
        btn.addEventListener('click', () => this.deleteUser(btn.dataset.delUid));
      });
    }
  },

  async saveSettings() {
    const notifToggle = document.getElementById('notificationToggle');
    const aiToggle    = document.getElementById('aiToggle');
    const advSel      = document.getElementById('reminderAdvance');
    if (notifToggle) this.state.settings.notifications   = notifToggle.checked;
    if (aiToggle)    this.state.settings.aiEnabled       = aiToggle.checked;
    if (advSel)      this.state.settings.reminderAdvance = parseInt(advSel.value);
    await DB.saveSettings(this.state.settings);
  },

  /* ─────────────────────────────────────────
     USER MANAGEMENT
     ───────────────────────────────────────── */
  openAddUserModal() {
    document.getElementById('newUserName').value = '';
    this.state.newUserRole = 'patient';
    document.querySelectorAll('#userModal .role-btn').forEach((b) => b.classList.remove('active'));
    document.getElementById('rolePatient').classList.add('active');
    document.getElementById('userModal').classList.remove('hidden');
    document.getElementById('modalOverlay').classList.remove('hidden');
  },

  closeUserModal() {
    document.getElementById('userModal').classList.add('hidden');
    document.getElementById('modalOverlay').classList.add('hidden');
  },

  async saveNewUser() {
    const name = document.getElementById('newUserName').value.trim();
    if (!name) { showToast('请输入姓名', 'warn'); return; }

    const familyCode = this.state.activeUser?.familyCode || genFamilyCode();
    const user = {
      id:         genId(),
      name,
      role:       this.state.newUserRole,
      familyCode,
      createdAt:  Date.now()
    };
    await DB.saveUser(user);
    this.state.users.push(user);
    this.closeUserModal();
    this.renderAll();
    showToast(`${name} 已添加`, 'success');
  },

  async deleteUser(userId) {
    if (!confirm('确认删除此用户及其所有数据？')) return;

    const isDeletingActive = userId === this.state.activeUser?.id ||
                             userId === this.state.settings.activeUserId;

    await DB.deleteMedicationsByUser(userId);
    await DB.deleteRecordsByUser(userId);
    await DB.deleteUser(userId);
    this.state.users = this.state.users.filter((u) => u.id !== userId);

    if (isDeletingActive) {
      const next = this.state.users[0];
      if (next) {
        // Switch to another existing user
        await this.setActiveUser(next.id, true);
        this.renderAll();
        showToast('用户已删除，已切换到 ' + next.name);
      } else {
        // No users left: reset and show onboarding
        this.state.activeUser = null;
        this.state.viewedPatient = null;
        this.state.medications = [];
        this.state.records = [];
        this.state.settings.activeUserId = null;
        await DB.saveSettings(this.state.settings);
        document.getElementById('mainApp').classList.add('hidden');
        document.getElementById('onboarding').classList.remove('hidden');
        showToast('用户已删除');
      }
    } else {
      this.renderAll();
      showToast('用户已删除');
    }
  },

  /* ─────────────────────────────────────────
     API KEY MODAL
     ───────────────────────────────────────── */
  openApiKeyModal() {
    document.getElementById('apiBaseUrl').value  = this.state.settings.apiBaseUrl || 'https://api.openai.com/v1';
    document.getElementById('apiKeyInput').value = this.state.settings.apiKey || '';
    document.getElementById('apiModel').value    = this.state.settings.apiModel || 'gpt-3.5-turbo';
    document.getElementById('apiKeyModal').classList.remove('hidden');
    document.getElementById('modalOverlay').classList.remove('hidden');
  },

  closeApiKeyModal() {
    document.getElementById('apiKeyModal').classList.add('hidden');
    document.getElementById('modalOverlay').classList.add('hidden');
  },

  async saveApiKey() {
    this.state.settings.apiBaseUrl = document.getElementById('apiBaseUrl').value.trim();
    this.state.settings.apiKey     = document.getElementById('apiKeyInput').value.trim();
    this.state.settings.apiModel   = document.getElementById('apiModel').value.trim();
    await DB.saveSettings(this.state.settings);
    this.closeApiKeyModal();
    showToast('API 设置已保存', 'success');
  },

  /* ─────────────────────────────────────────
     NOTIFICATION PERMISSION PROMPT
     ───────────────────────────────────────── */
  async promptNotifications() {
    if (!('Notification' in window) || Notification.permission === 'granted') return;
    // Show a gentle banner in the today tab
    const banner = document.createElement('div');
    banner.className = 'notif-banner';
    banner.innerHTML = `
      <span style="font-size:1.5rem">🔔</span>
      <div class="notif-banner-text">
        <strong>开启提醒通知</strong>
        允许通知后，我们将在您需要服药时自动提醒您
      </div>
      <button class="btn-text btn-small" id="enableNotifBtn">开启</button>
    `;
    const container = document.getElementById('todayMedications');
    if (container) container.prepend(banner);
    document.getElementById('enableNotifBtn')?.addEventListener('click', async () => {
      const granted = await this.requestNotificationPermission();
      banner.remove();
      if (granted) { showToast('通知已开启 🔔', 'success'); this.scheduleNotifications(); }
    });
  },

  /* ─────────────────────────────────────────
     EVENT BINDINGS
     ───────────────────────────────────────── */
  bindMainEvents() {
    // Guard: only bind once
    if (this._eventsBound) return;
    this._eventsBound = true;

    // User dropdown toggle
    document.getElementById('userSwitchBtn').addEventListener('click', (e) => {
      e.stopPropagation();
      const dd = document.getElementById('userDropdown');
      dd.classList.toggle('hidden');
      if (!dd.classList.contains('hidden')) this.updateUserDropdown();
    });
    document.addEventListener('click', () => this.closeUserDropdown());

    // Tab navigation
    document.querySelectorAll('.nav-btn').forEach((btn) => {
      btn.addEventListener('click', () => showTab(btn.dataset.tab));
    });

    // Add medication buttons
    document.getElementById('addMedicationBtn')?.addEventListener('click', () => this.openMedicationModal());
    document.getElementById('addFirstMedBtn')?.addEventListener('click', () => this.openMedicationModal());

    // Medication modal – bind the unit change listener once here
    document.getElementById('medUnit').addEventListener('change', () => {
      document.getElementById('medQuantityUnit').textContent =
        document.getElementById('medUnit').value;
    });
    document.getElementById('closeMedicationModal').addEventListener('click', () => this.closeMedicationModal());
    document.getElementById('cancelMedicationBtn').addEventListener('click', () => this.closeMedicationModal());
    document.getElementById('saveMedicationBtn').addEventListener('click', () => this.saveMedication());
    document.getElementById('parseAiBtn').addEventListener('click', () => this.parseAiInput());
    document.getElementById('addCustomTimeBtn').addEventListener('click', () => this.addCustomTimeRow());

    // User modal
    document.getElementById('addUserBtn').addEventListener('click', (e) => {
      e.stopPropagation();
      this.closeUserDropdown();
      this.openAddUserModal();
    });
    document.getElementById('closeUserModal').addEventListener('click', () => this.closeUserModal());
    document.getElementById('cancelUserBtn').addEventListener('click', () => this.closeUserModal());
    document.getElementById('saveUserBtn').addEventListener('click', () => this.saveNewUser());
    document.querySelectorAll('#userModal .role-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#userModal .role-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        this.state.newUserRole = btn.dataset.role;
      });
    });

    // API key modal
    document.getElementById('setApiKeyBtn').addEventListener('click', () => this.openApiKeyModal());
    document.getElementById('closeApiKeyModal').addEventListener('click', () => this.closeApiKeyModal());
    document.getElementById('cancelApiKeyBtn').addEventListener('click', () => this.closeApiKeyModal());
    document.getElementById('saveApiKeyBtn').addEventListener('click', () => this.saveApiKey());

    // Settings toggles (save on change)
    document.getElementById('notificationToggle').addEventListener('change', async () => {
      await this.saveSettings();
      if (this.state.settings.notifications) {
        const granted = await this.requestNotificationPermission();
        if (granted) this.scheduleNotifications();
      }
    });
    document.getElementById('aiToggle').addEventListener('change', async () => {
      await this.saveSettings();
      document.getElementById('aiKeyItem').classList.toggle('hidden', !this.state.settings.aiEnabled);
    });
    document.getElementById('reminderAdvance').addEventListener('change', () => this.saveSettings());

    // Low stock close
    document.getElementById('closeLowStockAlert').addEventListener('click', () => {
      document.getElementById('lowStockAlert').classList.add('hidden');
    });

    // Clear data
    document.getElementById('clearDataBtn').addEventListener('click', async () => {
      if (!confirm('确认清除所有数据？此操作不可恢复！')) return;
      await DB.clearAll();
      location.reload();
    });

    // History navigation
    document.getElementById('historyPrev')?.addEventListener('click', () => {
      const d = new Date(this.state.historyDate || todayStr());
      d.setDate(d.getDate() - 1);
      this.state.historyDate = d.toISOString().slice(0, 10);
      this.renderHistoryTab();
    });
    document.getElementById('historyNext')?.addEventListener('click', () => {
      const d = new Date(this.state.historyDate || todayStr());
      d.setDate(d.getDate() + 1);
      const next = d.toISOString().slice(0, 10);
      if (next <= todayStr()) {
        this.state.historyDate = next;
        this.renderHistoryTab();
      }
    });

    // Show history tab triggers re-render
    document.querySelector('[data-tab="tabHistory"]')?.addEventListener('click', () => {
      this.renderHistoryTab();
    });

    // Overlay close
    document.getElementById('modalOverlay').addEventListener('click', () => {
      this.closeMedicationModal();
      this.closeUserModal();
      this.closeApiKeyModal();
    });
  }
};

/* ═══════════════════════════════════════════
   HELPERS
   ═══════════════════════════════════════════ */

function genId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8) + Math.random().toString(36).slice(2, 8);
}

function genFamilyCode() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

function todayStr() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function timeLabel(t) {
  const [h] = t.split(':').map(Number);
  if (h < 9)  return `早上 ${t}`;
  if (h < 13) return `午间 ${t}`;
  if (h < 18) return `下午 ${t}`;
  if (h < 21) return `傍晚 ${t}`;
  return `睡前 ${t}`;
}

function formatDateCN(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });
}

function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function showToast(msg, type = '') {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.className = 'toast show' + (type ? ' ' + type : '');
  // Use assertive for errors so screen readers announce immediately
  t.setAttribute('aria-live', type === 'error' ? 'assertive' : 'polite');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => { t.className = 'toast'; }, 3000);
}

function showTab(tabId) {
  document.querySelectorAll('.tab-content').forEach((s) => s.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach((b) => b.classList.remove('active'));
  document.getElementById(tabId)?.classList.add('active');
  document.querySelector(`.nav-btn[data-tab="${tabId}"]`)?.classList.add('active');
}

/* ═══════════════════════════════════════════
   BOOT
   ═══════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => App.init());
