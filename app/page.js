"use client";

import {
  Archive,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  EyeOff,
  History,
  LogIn,
  LogOut,
  PanelRightClose,
  PanelRightOpen,
  Pencil,
  Plus,
  ShieldCheck,
  Trash2,
  UserRound,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ACCOUNTS,
  DEFAULT_OWNER_ID,
  NO_TIME_LABEL,
  PEOPLE,
  addDaysToKey,
  buildMonthCells,
  formatDisplayDate,
  formatMonthLabel,
  getDateLockReason,
  getPersonName,
  getTodayKey,
  isSameMonth,
  isWritableDateKey,
  keyToDate,
} from "../lib/calendar.js";

const WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const HOUR_MARKERS = [
  { label: "00/24", value: 0 },
  { label: "03/15", value: 3 },
  { label: "06/18", value: 6 },
  { label: "09/21", value: 9 },
];
const MINUTE_MARKERS = [
  { label: "00", value: 0 },
  { label: "15", value: 15 },
  { label: "30", value: 30 },
  { label: "45", value: 45 },
];
const AUTO_REFRESH_MS = 6000;
const SWIPE_THRESHOLD = 56;
const SWIPE_INTENT_RATIO = 1.15;
const WHEEL_MONTH_THRESHOLD = 80;
const WHEEL_MONTH_COOLDOWN_MS = 650;
const FOCUS_SCROLL_DELAY_MS = 120;

function emptyForm(date, ownerId = DEFAULT_OWNER_ID) {
  return {
    date,
    time: "",
    ownerId,
    private: false,
    title: "",
    note: "",
  };
}

function sortEvents(events) {
  return [...events].sort((left, right) => {
    const dateCompare = left.date.localeCompare(right.date);
    if (dateCompare !== 0) return dateCompare;
    return (left.time || "99:99").localeCompare(right.time || "99:99");
  });
}

function eventsSignature(events) {
  return JSON.stringify(
    events.map((event) => [
      event.id,
      event.date,
      event.time || "",
      event.ownerId || "",
      event.private ? "private" : "public",
      event.title,
      event.note || "",
      event.updatedAt || "",
      event.deletedAt || "",
    ]),
  );
}

function buildSyncFeedback(previousEvents, nextEvents) {
  if (eventsSignature(previousEvents) === eventsSignature(nextEvents)) return "";

  const previousIds = new Set(previousEvents.map((event) => event.id));
  const nextIds = new Set(nextEvents.map((event) => event.id));
  const added = nextEvents.filter((event) => !previousIds.has(event.id));
  const removed = previousEvents.filter((event) => !nextIds.has(event.id));

  if (added.length === 1) return `Добавлено: ${added[0].title}`;
  if (added.length > 1) return `Добавлено дел: ${added.length}`;
  if (removed.length === 1) return `Удалено: ${removed[0].title}`;
  if (removed.length > 1) return `Удалено дел: ${removed.length}`;
  return "Дела обновлены";
}

function hasRealHistory(event) {
  return (event.history || []).some((entry) => entry.type === "updated");
}

function formatAuditDate(value) {
  if (!value) return "";

  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function getActorName(actorId) {
  return PEOPLE.find((person) => person.id === actorId)?.name || "Кто-то";
}

function groupDeletedByDate(deletedEvents) {
  return deletedEvents.reduce((groups, event) => {
    groups[event.date] ||= [];
    groups[event.date].push(event);
    return groups;
  }, {});
}

function HistoryBlock({ event, compact = false }) {
  const entries = event.history || [];
  if (entries.length === 0) return null;

  return (
    <div className={`history-block${compact ? " compact" : ""}`}>
      {entries.map((entry) => (
        <div className="history-entry" key={entry.id}>
          <div className="history-entry-head">
            <span>{getActorName(entry.actorId)}</span>
            <span>{formatAuditDate(entry.at)}</span>
          </div>
          <p>{entry.summary || (entry.type === "updated" ? "Изменение" : "Событие")}</p>
          {Object.keys(entry.changes || {}).length > 0 ? (
            <ul>
              {Object.entries(entry.changes).map(([field, change]) => (
                <li key={field}>
                  <span>{change.label}</span>
                  <strong>
                    {change.before} → {change.after}
                  </strong>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function clockPoint(value, total, radius) {
  const angle = (Number(value) / total) * Math.PI * 2 - Math.PI / 2;
  return {
    "--x": `${Math.cos(angle) * radius}px`,
    "--y": `${Math.sin(angle) * radius}px`,
  };
}

function clockHandStyle(value, total, radius) {
  return {
    "--angle": `${(Number(value) / total) * 360}deg`,
    "--hand": `${radius}px`,
  };
}

function normalizeMinute(value) {
  if (value === "") return "00";

  const numericValue = Number(value);
  if (Number.isNaN(numericValue)) return "00";

  return String(Math.min(59, Math.max(0, numericValue))).padStart(2, "0");
}

function normalizeHour(value) {
  const normalizedValue = ((Math.round(value) % 24) + 24) % 24;
  return String(normalizedValue).padStart(2, "0");
}

function closestContinuousHour(angle, currentHour) {
  const hourOnDial = Math.round((angle / (Math.PI * 2)) * 12) % 12;
  const candidates = [hourOnDial, hourOnDial + 12, hourOnDial + 24];
  return candidates.reduce((best, candidate) =>
    Math.abs(candidate - currentHour) < Math.abs(best - currentHour) ? candidate : best,
  );
}

function normalizeAngleDelta(delta) {
  if (delta > Math.PI) return delta - Math.PI * 2;
  if (delta < -Math.PI) return delta + Math.PI * 2;
  return delta;
}

function getScrollContainer(element) {
  let current = element.parentElement;

  while (current && current !== document.body) {
    const style = window.getComputedStyle(current);
    const canScroll = /(auto|scroll)/.test(style.overflowY) && current.scrollHeight > current.clientHeight + 2;
    if (canScroll) return current;
    current = current.parentElement;
  }

  return element.closest(".details-panel") || document.scrollingElement;
}

function keepFieldVisible(element) {
  const target = element instanceof HTMLElement ? element : null;
  if (!target || !target.closest(".details-panel")) return;

  const viewport = window.visualViewport;
  const viewportTop = viewport?.offsetTop ?? 0;
  const viewportHeight = viewport?.height ?? window.innerHeight;
  const safeTop = viewportTop + 66;
  const safeBottom = viewportTop + viewportHeight - 112;
  const rect = target.getBoundingClientRect();

  let delta = 0;
  if (rect.bottom > safeBottom) {
    delta = rect.bottom - safeBottom;
  } else if (rect.top < safeTop) {
    delta = rect.top - safeTop;
  }

  const container = getScrollContainer(target);
  if (container && delta !== 0) {
    container.scrollBy({ top: delta, behavior: "smooth" });
  }

  window.setTimeout(() => {
    target.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" });
  }, 40);
}

function TimePicker({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const [draftHour, setDraftHour] = useState(value ? value.slice(0, 2) : "09");
  const [draftMinute, setDraftMinute] = useState(value ? value.slice(3, 5) : "00");
  const [mode, setMode] = useState("hour");
  const pickerRef = useRef(null);
  const clockFaceRef = useRef(null);
  const draggingRef = useRef(false);
  const hourDragRef = useRef(null);
  const label = value || NO_TIME_LABEL;

  useEffect(() => {
    if (!value) return;
    setDraftHour(value.slice(0, 2));
    setDraftMinute(value.slice(3, 5));
  }, [value]);

  useEffect(() => {
    if (!open) return undefined;

    function handlePointerDown(event) {
      if (pickerRef.current?.contains(event.target)) return;
      setOpen(false);
    }

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [open]);

  function commitTime(minute = draftMinute) {
    onChange(`${draftHour}:${normalizeMinute(minute)}`);
    setOpen(false);
  }

  function getPointerAngle(event) {
    const rect = clockFaceRef.current?.getBoundingClientRect();
    if (!rect) return null;

    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const dx = event.clientX - centerX;
    const dy = event.clientY - centerY;
    let angle = Math.atan2(dy, dx) + Math.PI / 2;
    if (angle < 0) angle += Math.PI * 2;
    return angle;
  }

  function pickFromPointer(event, targetMode = mode) {
    const angle = getPointerAngle(event);
    if (angle === null) return;

    if (targetMode === "hour") {
      if (!hourDragRef.current) {
        const continuousHour = closestContinuousHour(angle, Number(draftHour));
        hourDragRef.current = { previousAngle: angle, value: continuousHour };
        setDraftHour(normalizeHour(continuousHour));
        return;
      }

      const delta = normalizeAngleDelta(angle - hourDragRef.current.previousAngle);
      const nextValue = hourDragRef.current.value + (delta / (Math.PI * 2)) * 12;
      hourDragRef.current = { previousAngle: angle, value: nextValue };
      setDraftHour(normalizeHour(nextValue));
      return;
    }

    const minute = Math.round((angle / (Math.PI * 2)) * 60) % 60;
    setDraftMinute(String(minute).padStart(2, "0"));
  }

  function handleClockPointerDown(event) {
    draggingRef.current = true;
    hourDragRef.current = null;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    pickFromPointer(event);
  }

  function handleClockPointerMove(event) {
    if (!draggingRef.current) return;
    pickFromPointer(event);
  }

  function handleClockPointerUp(event) {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    pickFromPointer(event);
    hourDragRef.current = null;
    if (mode === "hour") setMode("minute");
  }

  const handValue = mode === "hour" ? Number(draftHour) % 12 : Number(draftMinute);
  const handStyle = clockHandStyle(handValue, mode === "hour" ? 12 : 60, 104);

  return (
    <div className="time-picker" ref={pickerRef}>
      <button
        className="time-trigger"
        type="button"
        onClick={() => {
          setOpen((current) => !current);
          setMode("hour");
        }}
      >
        <Clock3 size={17} />
        {label}
      </button>

      {open ? (
        <div className="time-popover" role="dialog" aria-label="Выбор времени">
          <div className="time-popover-head">
            <div>
              <div className="clock-display" aria-label="Выбранное время">
                <button
                  className={`clock-display-part${mode === "hour" ? " active" : ""}`}
                  type="button"
                  onClick={() => setMode("hour")}
                >
                  {draftHour}
                </button>
                <span>:</span>
                <button
                  className={`clock-display-part${mode === "minute" ? " active" : ""}`}
                  type="button"
                  onClick={() => setMode("minute")}
                >
                  {draftMinute}
                </button>
              </div>
              <div className="clock-mode-tabs" role="group" aria-label="Режим выбора времени">
                <button
                  className={`clock-mode-tab${mode === "hour" ? " selected" : ""}`}
                  type="button"
                  onClick={() => setMode("hour")}
                >
                  Часы
                </button>
                <button
                  className={`clock-mode-tab${mode === "minute" ? " selected" : ""}`}
                  type="button"
                  onClick={() => setMode("minute")}
                >
                  Минуты
                </button>
              </div>
            </div>
            <button className="icon-button subtle compact" type="button" onClick={() => setOpen(false)} aria-label="Закрыть">
              <X size={16} />
            </button>
          </div>

          <div
            className={`clock-face ${mode}`}
            ref={clockFaceRef}
            role="application"
            aria-label={mode === "hour" ? "Круговой выбор часа" : "Круговой выбор минут"}
            onPointerDown={handleClockPointerDown}
            onPointerMove={handleClockPointerMove}
            onPointerUp={handleClockPointerUp}
            onPointerCancel={handleClockPointerUp}
          >
            <div className="clock-hand" style={handStyle} aria-hidden="true" />
            <div className="clock-center">
              <span>{mode === "hour" ? "час" : "мин"}</span>
              <strong>
                {draftHour}:{draftMinute}
              </strong>
            </div>

            {(mode === "hour" ? HOUR_MARKERS : MINUTE_MARKERS).map((marker) => {
              const radius = 104;
              const style = clockPoint(marker.value, mode === "hour" ? 12 : 60, radius);
              const selected =
                mode === "hour" ? Number(draftHour) % 12 === marker.value : Number(draftMinute) === marker.value;

              return (
                <span
                  className={`clock-option${selected ? " selected" : ""}${mode === "hour" ? " hour" : " minute"}`}
                  key={marker.label}
                  style={style}
                >
                  {marker.label}
                </span>
              );
            })}
          </div>

          {mode === "minute" ? (
            <label className="minute-exact">
              Точная минута
              <input
                type="number"
                min="0"
                max="59"
                inputMode="numeric"
                value={Number(draftMinute)}
                onChange={(event) => setDraftMinute(normalizeMinute(event.target.value))}
              />
            </label>
          ) : null}

          <div className="time-popover-actions">
            <button
              className="clear-time-button"
              type="button"
              onClick={() => {
                onChange("");
                setOpen(false);
              }}
            >
              Без времени
            </button>
            <button className="done-time-button" type="button" onClick={() => commitTime()}>
              Готово
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default function CalendarPage() {
  const initialTodayKey = useMemo(() => getTodayKey(), []);
  const calendarPanelRef = useRef(null);
  const detailsPanelRef = useRef(null);
  const swipeStartX = useRef(null);
  const swipeStartY = useRef(null);
  const daySwipeStartX = useRef(null);
  const daySwipeStartY = useRef(null);
  const [todayKey, setTodayKey] = useState(initialTodayKey);
  const [todayLocked, setTodayLocked] = useState(false);
  const [todayAfterDigest, setTodayAfterDigest] = useState(false);
  const [viewDate, setViewDate] = useState(() => keyToDate(initialTodayKey));
  const [selectedDate, setSelectedDate] = useState(initialTodayKey);
  const [events, setEvents] = useState([]);
  const [deletedEvents, setDeletedEvents] = useState([]);
  const [form, setForm] = useState(emptyForm(initialTodayKey));
  const [account, setAccount] = useState(null);
  const [accounts, setAccounts] = useState(ACCOUNTS);
  const [loginForm, setLoginForm] = useState({ accountId: ACCOUNTS[0]?.id || DEFAULT_OWNER_ID, password: "" });
  const [authReady, setAuthReady] = useState(false);
  const [viewMode, setViewMode] = useState("calendar");
  const [expandedHistoryId, setExpandedHistoryId] = useState(null);
  const [monthMotion, setMonthMotion] = useState("");
  const [dayMotion, setDayMotion] = useState("");
  const [editingId, setEditingId] = useState(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [deletingId, setDeletingId] = useState(null);
  const eventsRef = useRef([]);
  const eventsLoadedRef = useRef(false);
  const monthMotionTimerRef = useRef(null);
  const dayMotionTimerRef = useRef(null);
  const wheelMonthRef = useRef({ lastAt: 0 });

  const dateContext = useMemo(
    () => ({ todayKey, todayLocked, todayAfterDigest }),
    [todayKey, todayLocked, todayAfterDigest],
  );
  const firstWritableDate = useMemo(
    () => (todayLocked || todayAfterDigest ? addDaysToKey(todayKey, 1) : todayKey),
    [todayKey, todayLocked, todayAfterDigest],
  );

  async function loadAuth() {
    const response = await fetch("/api/auth/me", { cache: "no-store" });
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || "Не удалось проверить вход");
    }

    setAccount(payload.account || null);
    setAccounts(payload.accounts || ACCOUNTS);
    setAuthReady(true);

    if (payload.account) {
      await loadEvents({ quiet: true });
    }
  }

  async function loadEvents({ quiet = false } = {}) {
    const response = await fetch("/api/events", { cache: "no-store" });
    const payload = await response.json();

    if (!response.ok) {
      if (response.status === 401) {
        setAccount(null);
        setAuthReady(true);
      }
      throw new Error(payload.error || "Не удалось загрузить дела");
    }

    const nextEvents = sortEvents(payload.events || []);
    const nextDeletedEvents = payload.deletedEvents || [];
    if (quiet && eventsLoadedRef.current) {
      const syncFeedback = buildSyncFeedback(eventsRef.current, nextEvents);
      if (syncFeedback) setFeedback(syncFeedback);
    }
    eventsRef.current = nextEvents;
    eventsLoadedRef.current = true;
    setAccount(payload.account || account);
    setAccounts(payload.accounts || accounts);
    setEvents(nextEvents);
    setDeletedEvents(nextDeletedEvents);
    setTodayKey(payload.todayKey || getTodayKey());
    setTodayLocked(Boolean(payload.todayLocked));
    setTodayAfterDigest(Boolean(payload.todayAfterDigest));
  }

  useEffect(() => {
    loadAuth().catch((error) => {
      setAuthReady(true);
      setFeedback(error.message);
    });
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (account) loadEvents({ quiet: true }).catch((error) => setFeedback(error.message));
    }, AUTO_REFRESH_MS);

    return () => window.clearInterval(timer);
  }, [account]);

  useEffect(() => {
    if (!feedback) return undefined;

    const timer = window.setTimeout(() => {
      setFeedback("");
    }, 3600);

    return () => window.clearTimeout(timer);
  }, [feedback]);

  useEffect(() => {
    function handleKeyDown(event) {
      const tagName = document.activeElement?.tagName;
      if (tagName === "INPUT" || tagName === "TEXTAREA" || tagName === "BUTTON") return;
      if (event.key === "ArrowLeft") moveMonth(-1);
      if (event.key === "ArrowRight") moveMonth(1);
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => {
    const panel = calendarPanelRef.current;
    if (!panel) return undefined;

    function handleTouchMove(event) {
      if (event.touches.length !== 1 || swipeStartX.current === null || swipeStartY.current === null) return;

      const touch = event.touches[0];
      const deltaX = touch.clientX - swipeStartX.current;
      const deltaY = touch.clientY - swipeStartY.current;
      const horizontalIntent = Math.abs(deltaX) > 10 && Math.abs(deltaX) > Math.abs(deltaY) * SWIPE_INTENT_RATIO;

      if (horizontalIntent) {
        event.preventDefault();
      }
    }

    panel.addEventListener("touchmove", handleTouchMove, { passive: false });
    return () => panel.removeEventListener("touchmove", handleTouchMove);
  }, []);

  useEffect(() => {
    const root = document.documentElement;

    function updateAppHeight() {
      const height = window.visualViewport?.height ?? window.innerHeight;
      root.style.setProperty("--app-height", `${Math.round(height)}px`);
    }

    updateAppHeight();
    window.visualViewport?.addEventListener("resize", updateAppHeight);
    window.visualViewport?.addEventListener("scroll", updateAppHeight);
    window.addEventListener("resize", updateAppHeight);

    return () => {
      window.visualViewport?.removeEventListener("resize", updateAppHeight);
      window.visualViewport?.removeEventListener("scroll", updateAppHeight);
      window.removeEventListener("resize", updateAppHeight);
      root.style.removeProperty("--app-height");
    };
  }, []);

  useEffect(() => {
    function handleFocusIn(event) {
      const target = event.target;
      if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) return;

      window.setTimeout(() => keepFieldVisible(target), FOCUS_SCROLL_DELAY_MS);
      window.setTimeout(() => keepFieldVisible(target), FOCUS_SCROLL_DELAY_MS + 260);
    }

    document.addEventListener("focusin", handleFocusIn);
    return () => document.removeEventListener("focusin", handleFocusIn);
  }, []);

  useEffect(() => {
    const panel = detailsPanelRef.current;
    if (!panel || !detailsOpen) return undefined;

    function handleTouchMove(event) {
      if (event.touches.length !== 1 || daySwipeStartX.current === null || daySwipeStartY.current === null) return;
      if (shouldIgnoreDaySwipe(event.target)) return;

      const touch = event.touches[0];
      const deltaX = touch.clientX - daySwipeStartX.current;
      const deltaY = touch.clientY - daySwipeStartY.current;
      const horizontalIntent = Math.abs(deltaX) > 10 && Math.abs(deltaX) > Math.abs(deltaY) * SWIPE_INTENT_RATIO;

      if (horizontalIntent) {
        event.preventDefault();
      }
    }

    panel.addEventListener("touchmove", handleTouchMove, { passive: false });
    return () => panel.removeEventListener("touchmove", handleTouchMove);
  }, [detailsOpen]);

  useEffect(() => {
    return () => {
      if (monthMotionTimerRef.current) {
        window.clearTimeout(monthMotionTimerRef.current);
      }
      if (dayMotionTimerRef.current) {
        window.clearTimeout(dayMotionTimerRef.current);
      }
    };
  }, []);

  const previousViewDate = useMemo(() => new Date(viewDate.getFullYear(), viewDate.getMonth() - 1, 1), [viewDate]);
  const nextViewDate = useMemo(() => new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 1), [viewDate]);
  const previousMonthCells = useMemo(() => buildMonthCells(previousViewDate), [previousViewDate]);
  const monthCells = useMemo(() => buildMonthCells(viewDate), [viewDate]);
  const nextMonthCells = useMemo(() => buildMonthCells(nextViewDate), [nextViewDate]);
  const eventsByDate = useMemo(() => {
    return events.reduce((groups, event) => {
      groups[event.date] ||= [];
      groups[event.date].push(event);
      return groups;
    }, {});
  }, [events]);
  const selectedEvents = eventsByDate[selectedDate] || [];
  const deletedByDate = useMemo(() => groupDeletedByDate(deletedEvents), [deletedEvents]);
  const canUsePrivate = account?.id === "kristina";
  const selectedWritable = isWritableDateKey(selectedDate, dateContext);
  const selectedLockReason = getDateLockReason(selectedDate, dateContext);

  useEffect(() => {
    if (!editingId) {
      setForm((current) => ({
        ...emptyForm(selectedDate, current.ownerId),
        title: current.title,
        note: current.note,
      }));
    }
  }, [selectedDate, editingId]);

  function moveMonth(offset) {
    if (monthMotionTimerRef.current) {
      window.clearTimeout(monthMotionTimerRef.current);
    }

    setMonthMotion(offset > 0 ? "slide-next" : "slide-previous");
    setViewDate((current) => new Date(current.getFullYear(), current.getMonth() + offset, 1));
    monthMotionTimerRef.current = window.setTimeout(() => setMonthMotion(""), 360);
  }

  function selectDate(dateKey, { toggleSame = true } = {}) {
    if (toggleSame && detailsOpen && selectedDate === dateKey) {
      closeDetails();
      return;
    }

    const nextDate = keyToDate(dateKey);
    setViewDate((current) =>
      isSameMonth(nextDate, current) ? current : new Date(nextDate.getFullYear(), nextDate.getMonth(), 1),
    );
    setSelectedDate(dateKey);
    setDetailsOpen(true);
    setFormOpen(false);
    setDeletingId(null);
    if (!editingId) {
      setForm((current) => emptyForm(dateKey, current.ownerId));
    }
  }

  function closeDetails() {
    setDetailsOpen(false);
    setEditingId(null);
    setFormOpen(false);
    setDeletingId(null);
  }

  function jumpToday() {
    selectDate(todayKey, { toggleSame: false });
    setEditingId(null);
    setFormOpen(false);
  }

  function moveSelectedDay(offset) {
    if (dayMotionTimerRef.current) {
      window.clearTimeout(dayMotionTimerRef.current);
    }

    setDayMotion(offset > 0 ? "day-next" : "day-previous");
    selectDate(addDaysToKey(selectedDate, offset), { toggleSame: false });
    setEditingId(null);
    setExpandedHistoryId(null);
    setFormOpen(false);
    setDeletingId(null);
    dayMotionTimerRef.current = window.setTimeout(() => setDayMotion(""), 280);
  }

  function toggleDeletedView() {
    setDetailsOpen(false);
    setFormOpen(false);
    setEditingId(null);
    setDeletingId(null);
    setViewMode((currentMode) => (currentMode === "deleted" ? "calendar" : "deleted"));
  }

  function startEdit(event) {
    if (!isWritableDateKey(event.date, dateContext)) {
      setFeedback(getDateLockReason(event.date, dateContext));
      return;
    }

    setEditingId(event.id);
    setDeletingId(null);
    selectDate(event.date, { toggleSame: false });
    setFormOpen(true);
    setForm({
      date: event.date,
      time: event.time || "",
      ownerId: event.ownerId || DEFAULT_OWNER_ID,
      private: Boolean(event.private),
      title: event.title,
      note: event.note || "",
    });
  }

  function resetForm(date = selectedDate) {
    setEditingId(null);
    setFormOpen(false);
    setForm((current) => emptyForm(date, current.ownerId));
  }

  function openCreateForm() {
    setEditingId(null);
    setDeletingId(null);
    setForm((current) => emptyForm(selectedDate, current.ownerId));
    setFormOpen(true);
  }

  function handleSwipeEnd(clientX, clientY) {
    if (swipeStartX.current === null || swipeStartY.current === null) return;

    const deltaX = clientX - swipeStartX.current;
    const deltaY = clientY - swipeStartY.current;
    swipeStartX.current = null;
    swipeStartY.current = null;

    if (Math.abs(deltaX) < SWIPE_THRESHOLD || Math.abs(deltaX) < Math.abs(deltaY) * SWIPE_INTENT_RATIO) return;
    moveMonth(deltaX > 0 ? -1 : 1);
  }

  function shouldIgnoreDaySwipe(target) {
    return (
      target instanceof Element &&
      Boolean(target.closest("button, input, textarea, select, .event-form, .delete-form, .time-popover"))
    );
  }

  function handleDayTouchStart(event) {
    if (shouldIgnoreDaySwipe(event.target)) {
      daySwipeStartX.current = null;
      daySwipeStartY.current = null;
      return;
    }

    daySwipeStartX.current = event.touches[0]?.clientX ?? null;
    daySwipeStartY.current = event.touches[0]?.clientY ?? null;
  }

  function handleDaySwipeEnd(clientX, clientY) {
    if (daySwipeStartX.current === null || daySwipeStartY.current === null) return;

    const deltaX = clientX - daySwipeStartX.current;
    const deltaY = clientY - daySwipeStartY.current;
    daySwipeStartX.current = null;
    daySwipeStartY.current = null;

    if (Math.abs(deltaX) < SWIPE_THRESHOLD || Math.abs(deltaX) < Math.abs(deltaY) * SWIPE_INTENT_RATIO) return;
    moveSelectedDay(deltaX > 0 ? -1 : 1);
  }

  function isLikelyMouseWheel(event) {
    if (event.ctrlKey || event.metaKey || event.shiftKey) return false;

    const absX = Math.abs(event.deltaX);
    const absY = Math.abs(event.deltaY);
    if (absY === 0 || absX > absY * 0.35) return false;

    if (event.deltaMode === 1) {
      return absY >= 1 && absY <= 20;
    }

    if (event.deltaMode !== 0 || absY < WHEEL_MONTH_THRESHOLD || !Number.isInteger(event.deltaY)) {
      return false;
    }

    return absY % 50 === 0 || absY % 100 === 0 || absY % 120 === 0;
  }

  function handleCalendarWheel(event) {
    if (!isLikelyMouseWheel(event)) return;

    event.preventDefault();

    const now = Date.now();
    if (now - wheelMonthRef.current.lastAt < WHEEL_MONTH_COOLDOWN_MS) return;

    wheelMonthRef.current.lastAt = now;
    moveMonth(event.deltaY > 0 ? 1 : -1);
  }

  async function login(event) {
    event.preventDefault();
    setBusy(true);
    setFeedback("");

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(loginForm),
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error || "Не удалось войти");
      }

      setAccount(payload.account);
      setAccounts(payload.accounts || ACCOUNTS);
      setLoginForm((current) => ({ ...current, password: "" }));
      eventsLoadedRef.current = false;
      await loadEvents({ quiet: true });
      setFeedback("");
    } catch (error) {
      setFeedback(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    setBusy(true);

    try {
      await fetch("/api/auth/logout", { method: "POST" });
      setAccount(null);
      setEvents([]);
      setDeletedEvents([]);
      eventsRef.current = [];
      eventsLoadedRef.current = false;
      setDetailsOpen(false);
      setViewMode("calendar");
      setFeedback("Вы вышли");
    } catch (error) {
      setFeedback(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function saveEvent(event) {
    event.preventDefault();

    const existingEvent = editingId ? events.find((item) => item.id === editingId) : null;
    if (
      !isWritableDateKey(form.date, dateContext) ||
      (existingEvent && !isWritableDateKey(existingEvent.date, dateContext))
    ) {
      setFeedback(getDateLockReason(existingEvent?.date || form.date, dateContext));
      return;
    }

    setBusy(true);
    setFeedback("Сохраняю");

    try {
      const method = editingId ? "PUT" : "POST";
      const response = await fetch("/api/events", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editingId ? { ...form, id: editingId } : form),
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error || "Не удалось сохранить");
      }

      const nextEvents = sortEvents(payload.events);
      eventsRef.current = nextEvents;
      eventsLoadedRef.current = true;
      setEvents(nextEvents);
      setDeletedEvents(payload.deletedEvents || deletedEvents);
      resetForm(form.date);
      selectDate(form.date, { toggleSame: false });
      setFormOpen(false);
      setFeedback("Сохранено");
    } catch (error) {
      setFeedback(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function deleteEvent(event, id) {
    event.preventDefault();

    const target = events.find((item) => item.id === id);
    if (target && !isWritableDateKey(target.date, dateContext)) {
      setFeedback(getDateLockReason(target.date, dateContext));
      return;
    }

    setBusy(true);
    setFeedback("Удаляю");

    try {
      const response = await fetch(`/api/events?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error || "Не удалось удалить");
      }

      const nextEvents = sortEvents(payload.events);
      eventsRef.current = nextEvents;
      eventsLoadedRef.current = true;
      setEvents(nextEvents);
      setDeletedEvents(payload.deletedEvents || deletedEvents);
      if (editingId === id) resetForm();
      setDeletingId(null);
      setFeedback("Удалено");
    } catch (error) {
      setFeedback(error.message);
    } finally {
      setBusy(false);
    }
  }

  function renderMonthGrid(cells, gridDate, { inert = false } = {}) {
    return (
      <div className="month-grid" aria-hidden={inert ? "true" : undefined}>
        {cells.map((cell) => {
          const dayEvents = eventsByDate[cell.key] || [];
          const active = !inert && detailsOpen && selectedDate === cell.key;
          const muted = !isSameMonth(cell.date, gridDate);
          const writable = isWritableDateKey(cell.key, dateContext);

          return (
            <button
              className={`day-cell${active ? " active" : ""}${muted ? " muted" : ""}${
                cell.key === todayKey ? " today" : ""
              }${!writable ? " closed" : ""}`}
              disabled={inert}
              key={cell.key}
              tabIndex={inert ? -1 : 0}
              type="button"
              onClick={() => selectDate(cell.key)}
            >
              <span className="day-number">{cell.date.getDate()}</span>
              <span className="day-events">
                {dayEvents.slice(0, 2).map((item) => (
                  <span className="event-chip" key={item.id}>
                    <span>{item.time || NO_TIME_LABEL}</span>
                    {getPersonName(item.ownerId)} · {item.title}
                  </span>
                ))}
                {dayEvents.length > 2 ? <span className="more-chip">+{dayEvents.length - 2}</span> : null}
              </span>
            </button>
          );
        })}
      </div>
    );
  }

  if (!authReady) {
    return (
      <>
        <div className="cosmic-backdrop" aria-hidden="true" />
        <main className="auth-shell">
          <div className="auth-card">
            <ShieldCheck size={28} />
            <h1>Орбита дел</h1>
            <p>Проверяю вход</p>
          </div>
        </main>
      </>
    );
  }

  if (!account) {
    return (
      <>
        <div className="cosmic-backdrop" aria-hidden="true" />
        <main className="auth-shell">
          <form className="auth-card" onSubmit={login}>
            <ShieldCheck size={30} />
            <div>
              <h1>Орбита дел</h1>
              <p>Существующий аккаунт</p>
            </div>

            <label>
              Аккаунт
              <select
                value={loginForm.accountId}
                onChange={(event) => setLoginForm((current) => ({ ...current, accountId: event.target.value }))}
              >
                {accounts.map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.name}
                  </option>
                ))}
              </select>
            </label>

            <label>
              Пароль
              <input
                type="password"
                value={loginForm.password}
                onChange={(event) => setLoginForm((current) => ({ ...current, password: event.target.value }))}
                autoComplete="current-password"
                required
              />
            </label>

            <button className="save-button" type="submit" disabled={busy}>
              <LogIn size={18} />
              Войти
            </button>

            {feedback ? <div className="auth-feedback">{feedback}</div> : null}
          </form>
        </main>
      </>
    );
  }

  return (
    <>
      <div className={`cosmic-backdrop${account.id === "kristina" ? " kristina-theme" : ""}`} aria-hidden="true" />
      <main
        className={`app-shell${detailsOpen ? "" : " details-collapsed"}${account.id === "kristina" ? " kristina-theme" : ""}`}
      >
        <section
          className="calendar-panel"
          ref={calendarPanelRef}
          aria-label="Календарь"
          onTouchStart={(event) => {
            if (viewMode !== "calendar") {
              swipeStartX.current = null;
              swipeStartY.current = null;
              return;
            }

            swipeStartX.current = event.touches[0]?.clientX ?? null;
            swipeStartY.current = event.touches[0]?.clientY ?? null;
          }}
          onTouchEnd={(event) => {
            if (viewMode !== "calendar") return;
            handleSwipeEnd(event.changedTouches[0]?.clientX ?? 0, event.changedTouches[0]?.clientY ?? 0);
          }}
          onTouchCancel={() => {
            swipeStartX.current = null;
            swipeStartY.current = null;
          }}
          onWheel={(event) => {
            if (viewMode === "calendar") handleCalendarWheel(event);
          }}
        >
          <header className="topbar">
            <div className="brand">
              <span className="brand-icon" aria-hidden="true">
                <CalendarDays size={22} strokeWidth={2.2} />
              </span>
              <div>
                <h1>Орбита дел</h1>
                <p>Семейный календарь</p>
              </div>
            </div>
            <div className="account-bar">
              <span className={`account-pill owner-${account.id}`}>
                <UserRound size={15} />
                {account.name}
              </span>
              <button
                className={`icon-button subtle${viewMode === "deleted" ? " active-control" : ""}`}
                type="button"
                onClick={toggleDeletedView}
                aria-label="Удалённые дела"
                title="Удалённые дела"
              >
                <Archive size={17} />
              </button>
              <button className="icon-button subtle" type="button" onClick={logout} aria-label="Выйти" title="Выйти">
                <LogOut size={17} />
              </button>
            </div>
          </header>

          {viewMode === "deleted" ? (
            <section className="deleted-view" aria-label="Удалённые дела">
              <div className="deleted-head">
                <div>
                  <p>Архив</p>
                  <h2>Удалённые дела</h2>
                </div>
                <div className="details-header-actions">
                  <span className="count-badge">{deletedEvents.length}</span>
                  <button
                    className="icon-button subtle"
                    type="button"
                    onClick={toggleDeletedView}
                    aria-label="Вернуться к календарю"
                    title="Вернуться к календарю"
                  >
                    <X size={18} />
                  </button>
                </div>
              </div>

              {deletedEvents.length === 0 ? <p className="empty-state">Удалённых дел нет</p> : null}

              <div className="deleted-list">
                {Object.entries(deletedByDate).map(([dateKey, items]) => (
                  <section className="deleted-date-group" key={dateKey}>
                    <h3>{formatDisplayDate(dateKey)}</h3>
                    {items.map((event) => (
                      <article className="event-row deleted-row" key={`${event.id}-${event.deletedAt}`}>
                        <div className="event-time">{event.time || NO_TIME_LABEL}</div>
                        <div className="event-content">
                          <span className={`owner-pill owner-${event.ownerId || DEFAULT_OWNER_ID}`}>
                            {getPersonName(event.ownerId)}
                          </span>
                          {event.private ? <span className="private-pill">частное</span> : null}
                          <h3>{event.title}</h3>
                          {event.note ? <p>{event.note}</p> : null}
                          <p>
                            Удалил(а): {getActorName(event.deletedBy)} · {formatAuditDate(event.deletedAt)}
                          </p>
                          <HistoryBlock event={event} />
                        </div>
                      </article>
                    ))}
                  </section>
                ))}
              </div>
            </section>
          ) : (
            <>
          <div className="month-title-row">
            <div className="month-heading">
              <button
                className="icon-button subtle mobile-month-nav"
                type="button"
                onClick={() => moveMonth(-1)}
                aria-label="Предыдущий месяц"
                title="Предыдущий месяц"
              >
                <ChevronLeft size={18} />
              </button>
              <h2>{formatMonthLabel(viewDate)}</h2>
              <button
                className="icon-button subtle mobile-month-nav"
                type="button"
                onClick={() => moveMonth(1)}
                aria-label="Следующий месяц"
                title="Следующий месяц"
              >
                <ChevronRight size={18} />
              </button>
            </div>
            <div className="month-controls" aria-label="Навигация по месяцам">
              <button className="today-button" type="button" onClick={jumpToday}>
                К сегодня
              </button>
            </div>
            <div className="month-actions">
              <button
                className={`icon-button subtle${detailsOpen ? " active-control" : ""}`}
                type="button"
                onClick={() => setDetailsOpen((current) => !current)}
                aria-label={detailsOpen ? "Скрыть детали дня" : "Показать детали дня"}
                title={detailsOpen ? "Скрыть детали дня" : "Показать детали дня"}
              >
                {detailsOpen ? <PanelRightClose size={18} /> : <PanelRightOpen size={18} />}
              </button>
            </div>
          </div>

          {feedback ? <div className="feedback-line">{feedback}</div> : null}

          <button className="calendar-side-nav previous" type="button" onClick={() => moveMonth(-1)} aria-label="Предыдущий месяц">
            <ChevronLeft size={22} />
          </button>
          <button className="calendar-side-nav next" type="button" onClick={() => moveMonth(1)} aria-label="Следующий месяц">
            <ChevronRight size={22} />
          </button>

          <div className="weekday-grid" aria-hidden="true">
            {WEEKDAYS.map((day) => (
              <span key={day}>{day}</span>
            ))}
          </div>

          <div className="month-viewport">
            <div className={`month-strip ${monthMotion}`}>
              {renderMonthGrid(previousMonthCells, previousViewDate, { inert: true })}
              {renderMonthGrid(monthCells, viewDate)}
              {renderMonthGrid(nextMonthCells, nextViewDate, { inert: true })}
            </div>
          </div>
            </>
          )}
        </section>

        {viewMode === "calendar" && detailsOpen ? (
          <aside
            className={`details-panel${formOpen ? " form-open" : ""}${dayMotion ? ` ${dayMotion}` : ""}`}
            ref={detailsPanelRef}
            aria-label="Дела на выбранный день"
            onTouchStart={handleDayTouchStart}
            onTouchEnd={(event) => {
              handleDaySwipeEnd(event.changedTouches[0]?.clientX ?? 0, event.changedTouches[0]?.clientY ?? 0);
            }}
            onTouchCancel={() => {
              daySwipeStartX.current = null;
              daySwipeStartY.current = null;
            }}
          >
            <div className="details-header">
              <div>
                <p>Выбранный день</p>
                <h2>{formatDisplayDate(selectedDate)}</h2>
              </div>
              <div className="details-header-actions">
                <div className="day-nav-group" aria-label="Навигация по дням">
                  <button
                    className="icon-button subtle"
                    type="button"
                    onClick={() => moveSelectedDay(-1)}
                    aria-label="Предыдущий день"
                    title="Предыдущий день"
                  >
                    <ChevronLeft size={18} />
                  </button>
                  <button
                    className="icon-button subtle"
                    type="button"
                    onClick={() => moveSelectedDay(1)}
                    aria-label="Следующий день"
                    title="Следующий день"
                  >
                    <ChevronRight size={18} />
                  </button>
                </div>
                <span className="count-badge">{selectedEvents.length}</span>
                <button className="icon-button subtle" type="button" onClick={closeDetails} aria-label="Скрыть детали дня" title="Скрыть детали дня">
                  <PanelRightClose size={18} />
                </button>
              </div>
            </div>

            <div className="event-list">
              {selectedEvents.length === 0 ? (
                <p className="empty-state">Дел нет</p>
              ) : null}
              {selectedEvents.map((event) => {
                const eventWritable = isWritableDateKey(event.date, dateContext);

                return (
                  <article className="event-row" key={event.id}>
                    <div className="event-time">{event.time || NO_TIME_LABEL}</div>
                    <div className="event-content">
                      <span className={`owner-pill owner-${event.ownerId || DEFAULT_OWNER_ID}`}>
                        {getPersonName(event.ownerId)}
                      </span>
                      {event.private ? <span className="private-pill">частное</span> : null}
                      <h3>{event.title}</h3>
                      {event.note ? <p>{event.note}</p> : null}
                      {hasRealHistory(event) ? (
                        <>
                          <button
                            className="history-toggle"
                            type="button"
                            onClick={() =>
                              setExpandedHistoryId((current) => (current === event.id ? null : event.id))
                            }
                          >
                            <History size={15} />
                            История
                          </button>
                          {expandedHistoryId === event.id ? <HistoryBlock event={event} compact /> : null}
                        </>
                      ) : null}

                      {deletingId === event.id ? (
                        <form className="delete-form" onSubmit={(formEvent) => deleteEvent(formEvent, event.id)}>
                          <p>Удалить это дело? Оно уйдёт в список удалённых вместе с историей.</p>
                          <div className="delete-actions">
                            <button className="delete-confirm-button" type="submit" disabled={busy}>
                              Удалить
                            </button>
                            <button
                              className="delete-cancel-button"
                              type="button"
                              onClick={() => {
                                setDeletingId(null);
                              }}
                            >
                              Отмена
                            </button>
                          </div>
                        </form>
                      ) : null}
                    </div>
                    {eventWritable ? (
                      <div className="row-actions">
                        <button className="icon-button subtle" type="button" onClick={() => startEdit(event)} aria-label="Редактировать">
                          <Pencil size={17} />
                        </button>
                        <button
                          className="icon-button danger"
                          type="button"
                          onClick={() => {
                            setDeletingId(event.id);
                          }}
                          aria-label="Удалить"
                        >
                          <Trash2 size={17} />
                        </button>
                      </div>
                    ) : null}
                  </article>
                );
              })}
            </div>

            {selectedWritable ? (
              formOpen ? (
              <form className="event-form" onSubmit={saveEvent}>
                <div className="form-heading">
                  <h2>{editingId ? "Редактировать" : "Добавить"}</h2>
                  <button className="icon-button subtle" type="button" onClick={() => resetForm()} aria-label="Скрыть форму">
                    <X size={18} />
                  </button>
                </div>

                <label>
                  Дата
                  <input
                    type="date"
                    min={firstWritableDate}
                    value={form.date}
                    onChange={(event) => {
                      const nextDateKey = event.target.value;
                      const nextDate = keyToDate(nextDateKey);

                      setForm((current) => ({ ...current, date: nextDateKey }));
                      setSelectedDate(nextDateKey);
                      setViewDate((current) =>
                        isSameMonth(nextDate, current)
                          ? current
                          : new Date(nextDate.getFullYear(), nextDate.getMonth(), 1),
                      );
                    }}
                    required
                  />
                </label>

                <div className="owner-field">
                  <span>Человек</span>
                  <div className="owner-picker" role="radiogroup" aria-label="Человек">
                    {PEOPLE.map((person) => (
                      <button
                        className={`owner-option owner-${person.id}${form.ownerId === person.id ? " selected" : ""}`}
                        key={person.id}
                        type="button"
                        role="radio"
                        aria-checked={form.ownerId === person.id}
                        onClick={() =>
                          setForm((current) => ({
                            ...current,
                            ownerId: person.id,
                            private: person.id === "kristina" ? current.private : false,
                          }))
                        }
                      >
                        {person.name}
                      </button>
                    ))}
                  </div>
                </div>

                {canUsePrivate && form.ownerId === "kristina" ? (
                  <label className="private-toggle">
                    <input
                      type="checkbox"
                      checked={Boolean(form.private)}
                      onChange={(event) =>
                        setForm((current) => ({ ...current, private: event.target.checked }))
                      }
                    />
                    <span>
                      <EyeOff size={17} />
                      Частное дело
                    </span>
                  </label>
                ) : null}

                <div className="form-field">
                  <span>Время</span>
                  <TimePicker
                    value={form.time}
                    onChange={(time) => setForm((current) => ({ ...current, time }))}
                  />
                </div>

                <label>
                  Дело
                  <input
                    type="text"
                    value={form.title}
                    onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))}
                    maxLength={120}
                    required
                  />
                </label>

                <label>
                  Заметка
                  <textarea
                    value={form.note}
                    onChange={(event) => setForm((current) => ({ ...current, note: event.target.value }))}
                    maxLength={300}
                    rows={3}
                  />
                </label>

                <button className="save-button" type="submit" disabled={busy}>
                  {editingId ? <Check size={18} /> : <Plus size={18} />}
                  {editingId ? "Сохранить" : "Добавить"}
                </button>
              </form>
              ) : (
                <div className="add-event-panel">
                  <button className="add-event-button" type="button" onClick={openCreateForm}>
                    <Plus size={18} />
                    Добавить дело
                  </button>
                </div>
              )
            ) : (
              <div className="readonly-note">
                <h2>Только просмотр</h2>
                <p>{selectedLockReason}</p>
              </div>
            )}
          </aside>
        ) : null}
      </main>
    </>
  );
}
