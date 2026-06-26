"use client";

import {
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  PanelRightClose,
  PanelRightOpen,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
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

function emptyForm(date, ownerId = DEFAULT_OWNER_ID) {
  return {
    date,
    time: "",
    ownerId,
    ownerPassword: "",
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
    events.map((event) => [event.id, event.date, event.time || "", event.ownerId || "", event.title, event.note || ""]),
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
  const swipeStartX = useRef(null);
  const [todayKey, setTodayKey] = useState(initialTodayKey);
  const [todayLocked, setTodayLocked] = useState(false);
  const [todayAfterDigest, setTodayAfterDigest] = useState(false);
  const [viewDate, setViewDate] = useState(() => keyToDate(initialTodayKey));
  const [selectedDate, setSelectedDate] = useState(initialTodayKey);
  const [events, setEvents] = useState([]);
  const [form, setForm] = useState(emptyForm(initialTodayKey));
  const [ownerPasswordStatus, setOwnerPasswordStatus] = useState({});
  const [editingId, setEditingId] = useState(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [deletingId, setDeletingId] = useState(null);
  const [deletePassword, setDeletePassword] = useState("");
  const eventsRef = useRef([]);
  const eventsLoadedRef = useRef(false);

  const dateContext = useMemo(
    () => ({ todayKey, todayLocked, todayAfterDigest }),
    [todayKey, todayLocked, todayAfterDigest],
  );
  const firstWritableDate = useMemo(
    () => (todayLocked || todayAfterDigest ? addDaysToKey(todayKey, 1) : todayKey),
    [todayKey, todayLocked, todayAfterDigest],
  );

  async function loadEvents({ quiet = false } = {}) {
    if (!quiet) setFeedback("Синхронизирую");

    const response = await fetch("/api/events", { cache: "no-store" });
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || "Не удалось загрузить дела");
    }

    const nextEvents = sortEvents(payload.events || []);
    if (quiet && eventsLoadedRef.current) {
      const syncFeedback = buildSyncFeedback(eventsRef.current, nextEvents);
      if (syncFeedback) setFeedback(syncFeedback);
    }
    eventsRef.current = nextEvents;
    eventsLoadedRef.current = true;
    setEvents(nextEvents);
    setTodayKey(payload.todayKey || getTodayKey());
    setTodayLocked(Boolean(payload.todayLocked));
    setTodayAfterDigest(Boolean(payload.todayAfterDigest));
    setOwnerPasswordStatus(payload.ownerPasswordStatus || {});
    if (!quiet) setFeedback("Обновлено");
  }

  useEffect(() => {
    loadEvents().catch((error) => setFeedback(error.message));
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      loadEvents({ quiet: true }).catch((error) => setFeedback(error.message));
    }, AUTO_REFRESH_MS);

    return () => window.clearInterval(timer);
  }, []);

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

  const monthCells = useMemo(() => buildMonthCells(viewDate), [viewDate]);
  const eventsByDate = useMemo(() => {
    return events.reduce((groups, event) => {
      groups[event.date] ||= [];
      groups[event.date].push(event);
      return groups;
    }, {});
  }, [events]);
  const selectedEvents = eventsByDate[selectedDate] || [];
  const selectedWritable = isWritableDateKey(selectedDate, dateContext);
  const selectedLockReason = getDateLockReason(selectedDate, dateContext);

  useEffect(() => {
    if (!editingId) {
      setForm((current) => ({
        ...emptyForm(selectedDate, current.ownerId),
        ownerPassword: current.ownerPassword,
        title: current.title,
        note: current.note,
      }));
    }
  }, [selectedDate, editingId]);

  function moveMonth(offset) {
    setViewDate((current) => new Date(current.getFullYear(), current.getMonth() + offset, 1));
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
    setDeletingId(null);
    setDeletePassword("");
    if (!editingId) {
      setForm((current) => emptyForm(dateKey, current.ownerId));
    }
  }

  function closeDetails() {
    setDetailsOpen(false);
    setEditingId(null);
    setDeletingId(null);
    setDeletePassword("");
  }

  function jumpToday() {
    selectDate(todayKey, { toggleSame: false });
    setEditingId(null);
  }

  function startEdit(event) {
    if (!isWritableDateKey(event.date, dateContext)) {
      setFeedback(getDateLockReason(event.date, dateContext));
      return;
    }

    setEditingId(event.id);
    setDeletingId(null);
    setDeletePassword("");
    selectDate(event.date, { toggleSame: false });
    setForm({
      date: event.date,
      time: event.time || "",
      ownerId: event.ownerId || DEFAULT_OWNER_ID,
      ownerPassword: "",
      title: event.title,
      note: event.note || "",
    });
  }

  function resetForm(date = selectedDate) {
    setEditingId(null);
    setForm((current) => emptyForm(date, current.ownerId));
  }

  function handleSwipeEnd(clientX) {
    if (swipeStartX.current === null) return;

    const delta = clientX - swipeStartX.current;
    swipeStartX.current = null;

    if (Math.abs(delta) < SWIPE_THRESHOLD) return;
    moveMonth(delta > 0 ? -1 : 1);
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
      setOwnerPasswordStatus((current) => ({ ...current, [form.ownerId]: true }));
      resetForm(form.date);
      selectDate(form.date, { toggleSame: false });
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
        body: JSON.stringify({ ownerPassword: deletePassword }),
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error || "Не удалось удалить");
      }

      const nextEvents = sortEvents(payload.events);
      eventsRef.current = nextEvents;
      eventsLoadedRef.current = true;
      setEvents(nextEvents);
      if (editingId === id) resetForm();
      setDeletingId(null);
      setDeletePassword("");
      setFeedback("Удалено");
    } catch (error) {
      setFeedback(error.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="cosmic-backdrop" aria-hidden="true" />
      <main className={`app-shell${detailsOpen ? "" : " details-collapsed"}`}>
        <section
          className="calendar-panel"
          aria-label="Календарь"
          onTouchStart={(event) => {
            swipeStartX.current = event.touches[0]?.clientX ?? null;
          }}
          onTouchEnd={(event) => {
            handleSwipeEnd(event.changedTouches[0]?.clientX ?? 0);
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
          </header>

          <div className="month-title-row">
            <h2>{formatMonthLabel(viewDate)}</h2>
            <div className="month-controls" aria-label="Навигация по месяцам">
              <button className="today-button" type="button" onClick={jumpToday}>
                К сегодня
              </button>
            </div>
            <div className="month-actions">
              <button
                className="icon-button subtle"
                type="button"
                onClick={() => loadEvents().catch((error) => setFeedback(error.message))}
                aria-label="Синхронизировать"
                title="Синхронизировать"
              >
                <RefreshCw size={18} />
              </button>
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

          <div className="month-grid">
            {monthCells.map((cell) => {
              const dayEvents = eventsByDate[cell.key] || [];
              const active = detailsOpen && selectedDate === cell.key;
              const muted = !isSameMonth(cell.date, viewDate);
              const writable = isWritableDateKey(cell.key, dateContext);

              return (
                <button
                  className={`day-cell${active ? " active" : ""}${muted ? " muted" : ""}${
                    cell.key === todayKey ? " today" : ""
                  }${!writable ? " closed" : ""}`}
                  key={cell.key}
                  type="button"
                  onClick={() => selectDate(cell.key)}
                >
                  <span className="day-number">{cell.date.getDate()}</span>
                  <span className="day-events">
                    {dayEvents.slice(0, 2).map((event) => (
                      <span className="event-chip" key={event.id}>
                        <span>{event.time || NO_TIME_LABEL}</span>
                        {getPersonName(event.ownerId)} · {event.title}
                      </span>
                    ))}
                    {dayEvents.length > 2 ? <span className="more-chip">+{dayEvents.length - 2}</span> : null}
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        {detailsOpen ? (
          <aside className="details-panel" aria-label="Дела на выбранный день">
            <div className="details-header">
              <div>
                <p>Выбранный день</p>
                <h2>{formatDisplayDate(selectedDate)}</h2>
              </div>
              <div className="details-header-actions">
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
                      <h3>{event.title}</h3>
                      {event.note ? <p>{event.note}</p> : null}

                      {deletingId === event.id ? (
                        <form className="delete-form" onSubmit={(formEvent) => deleteEvent(formEvent, event.id)}>
                          <label>
                            Пароль для удаления
                            <input
                              type="password"
                              value={deletePassword}
                              onChange={(inputEvent) => setDeletePassword(inputEvent.target.value)}
                              minLength={4}
                              required
                            />
                          </label>
                          <div className="delete-actions">
                            <button className="delete-confirm-button" type="submit" disabled={busy}>
                              Удалить
                            </button>
                            <button
                              className="delete-cancel-button"
                              type="button"
                              onClick={() => {
                                setDeletingId(null);
                                setDeletePassword("");
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
                            setDeletePassword("");
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
              <form className="event-form" onSubmit={saveEvent}>
                <div className="form-heading">
                  <h2>{editingId ? "Редактировать" : "Добавить"}</h2>
                  {editingId ? (
                    <button className="icon-button subtle" type="button" onClick={() => resetForm()} aria-label="Отменить">
                      <X size={18} />
                    </button>
                  ) : null}
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
                        disabled={Boolean(editingId)}
                        key={person.id}
                        type="button"
                        role="radio"
                        aria-checked={form.ownerId === person.id}
                        onClick={() => setForm((current) => ({ ...current, ownerId: person.id, ownerPassword: "" }))}
                      >
                        {person.name}
                      </button>
                    ))}
                  </div>
                </div>

                <label>
                  Пароль
                  <input
                    type="password"
                    value={form.ownerPassword}
                    onChange={(event) => setForm((current) => ({ ...current, ownerPassword: event.target.value }))}
                    minLength={4}
                    required
                    placeholder={ownerPasswordStatus[form.ownerId] ? "Пароль человека" : "Придумайте первый пароль"}
                  />
                </label>

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
