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
const HOURS = Array.from({ length: 24 }, (_, index) => String(index).padStart(2, "0"));
const MINUTES = ["00", "15", "30", "45"];
const AUTO_REFRESH_MS = 18000;
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

function TimePicker({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const [draftHour, setDraftHour] = useState(value ? value.slice(0, 2) : "09");
  const label = value || "весь день";

  useEffect(() => {
    if (value) setDraftHour(value.slice(0, 2));
  }, [value]);

  function pickMinute(minute) {
    onChange(`${draftHour}:${minute}`);
    setOpen(false);
  }

  return (
    <div className="time-picker">
      <button className="time-trigger" type="button" onClick={() => setOpen((current) => !current)}>
        <Clock3 size={17} />
        {label}
      </button>

      {open ? (
        <div className="time-popover">
          <div className="clock-title">Циферблат</div>
          <div className="hour-grid" aria-label="Часы">
            {HOURS.map((hour) => (
              <button
                className={`time-token${draftHour === hour ? " selected" : ""}`}
                key={hour}
                type="button"
                onClick={() => setDraftHour(hour)}
              >
                {hour}
              </button>
            ))}
          </div>
          <div className="minute-grid" aria-label="Минуты">
            {MINUTES.map((minute) => (
              <button className="time-token minute" key={minute} type="button" onClick={() => pickMinute(minute)}>
                {draftHour}:{minute}
              </button>
            ))}
          </div>
          <button
            className="clear-time-button"
            type="button"
            onClick={() => {
              onChange("");
              setOpen(false);
            }}
          >
            Весь день
          </button>
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

    setEvents(sortEvents(payload.events || []));
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
  const todayEvents = eventsByDate[todayKey] || [];
  const selectedWritable = isWritableDateKey(selectedDate, dateContext);
  const selectedLockReason = getDateLockReason(selectedDate, dateContext);

  useEffect(() => {
    if (!detailsOpen) return;
    if (selectedWritable || selectedEvents.length > 0) return;

    setSelectedDate(firstWritableDate);
    setForm(emptyForm(firstWritableDate));

    const nextViewDate = keyToDate(firstWritableDate);
    setViewDate(new Date(nextViewDate.getFullYear(), nextViewDate.getMonth(), 1));
  }, [detailsOpen, firstWritableDate, selectedEvents.length, selectedWritable]);

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
    const canOpenToday = isWritableDateKey(todayKey, dateContext) || todayEvents.length > 0;
    selectDate(canOpenToday ? todayKey : firstWritableDate, { toggleSame: false });
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

      setEvents(sortEvents(payload.events));
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

      setEvents(sortEvents(payload.events));
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
              <button className="icon-button" type="button" onClick={() => moveMonth(-1)} aria-label="Предыдущий месяц">
                <ChevronLeft size={20} />
              </button>
              <button className="today-button" type="button" onClick={jumpToday}>
                Сегодня
              </button>
              <button className="icon-button" type="button" onClick={() => moveMonth(1)} aria-label="Следующий месяц">
                <ChevronRight size={20} />
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
              const canOpen = writable || dayEvents.length > 0;

              return (
                <button
                  className={`day-cell${active ? " active" : ""}${muted ? " muted" : ""}${
                    cell.key === todayKey ? " today" : ""
                  }${!writable ? " closed" : ""}${!canOpen ? " inactive" : ""}`}
                  disabled={!canOpen}
                  key={cell.key}
                  type="button"
                  onClick={() => selectDate(cell.key)}
                >
                  <span className="day-number">{cell.date.getDate()}</span>
                  <span className="day-events">
                    {dayEvents.slice(0, 2).map((event) => (
                      <span className="event-chip" key={event.id}>
                        <span>{event.time || "весь день"}</span>
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
                <p className="empty-state">{selectedWritable ? "Нет дел" : "День закрыт"}</p>
              ) : null}
              {selectedEvents.map((event) => {
                const eventWritable = isWritableDateKey(event.date, dateContext);

                return (
                  <article className="event-row" key={event.id}>
                    <div className="event-time">{event.time || "весь день"}</div>
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
