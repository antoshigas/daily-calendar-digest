"use client";

import {
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  buildMonthCells,
  formatDisplayDate,
  formatMonthLabel,
  getTodayKey,
  isSameMonth,
} from "../lib/calendar.js";

const WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

function emptyForm(date) {
  return {
    date,
    time: "",
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

export default function CalendarPage() {
  const todayKey = useMemo(() => getTodayKey(), []);
  const today = useMemo(() => new Date(), []);
  const [viewDate, setViewDate] = useState(new Date(today.getFullYear(), today.getMonth(), 1));
  const [selectedDate, setSelectedDate] = useState(todayKey);
  const [events, setEvents] = useState([]);
  const [form, setForm] = useState(emptyForm(todayKey));
  const [editingId, setEditingId] = useState(null);
  const [status, setStatus] = useState("Загрузка");
  const [busy, setBusy] = useState(false);

  async function loadEvents() {
    setStatus("Загрузка");
    const response = await fetch("/api/events", { cache: "no-store" });
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || "Не удалось загрузить дела");
    }

    setEvents(sortEvents(payload.events || []));
    setStatus("Готово");
  }

  useEffect(() => {
    loadEvents().catch((error) => setStatus(error.message));
  }, []);

  useEffect(() => {
    if (!editingId) {
      setForm((current) => ({ ...emptyForm(selectedDate), title: current.title, note: current.note }));
    }
  }, [selectedDate, editingId]);

  const monthCells = useMemo(() => buildMonthCells(viewDate), [viewDate]);
  const eventsByDate = useMemo(() => {
    return events.reduce((groups, event) => {
      groups[event.date] ||= [];
      groups[event.date].push(event);
      return groups;
    }, {});
  }, [events]);
  const selectedEvents = eventsByDate[selectedDate] || [];

  function moveMonth(offset) {
    setViewDate((current) => new Date(current.getFullYear(), current.getMonth() + offset, 1));
  }

  function jumpToday() {
    const next = new Date();
    setViewDate(new Date(next.getFullYear(), next.getMonth(), 1));
    setSelectedDate(getTodayKey(next));
    setEditingId(null);
    setForm(emptyForm(getTodayKey(next)));
  }

  function startEdit(event) {
    setEditingId(event.id);
    setSelectedDate(event.date);
    setForm({
      date: event.date,
      time: event.time || "",
      title: event.title,
      note: event.note || "",
    });
  }

  function resetForm(date = selectedDate) {
    setEditingId(null);
    setForm(emptyForm(date));
  }

  async function saveEvent(event) {
    event.preventDefault();
    setBusy(true);
    setStatus("Сохранение");

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
      resetForm(form.date);
      setSelectedDate(form.date);
      setStatus("Сохранено");
    } catch (error) {
      setStatus(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function deleteEvent(id) {
    setBusy(true);
    setStatus("Удаление");

    try {
      const response = await fetch(`/api/events?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error || "Не удалось удалить");
      }

      setEvents(sortEvents(payload.events));
      if (editingId === id) resetForm();
      setStatus("Удалено");
    } catch (error) {
      setStatus(error.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="app-shell">
      <section className="calendar-panel" aria-label="Календарь">
        <header className="topbar">
          <div className="brand">
            <span className="brand-icon" aria-hidden="true">
              <CalendarDays size={22} strokeWidth={2.2} />
            </span>
            <div>
              <h1>Календарь</h1>
              <p>{status}</p>
            </div>
          </div>

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
        </header>

        <div className="month-title-row">
          <h2>{formatMonthLabel(viewDate)}</h2>
          <button className="icon-button subtle" type="button" onClick={() => loadEvents().catch((error) => setStatus(error.message))} aria-label="Обновить">
            <RefreshCw size={18} />
          </button>
        </div>

        <div className="weekday-grid" aria-hidden="true">
          {WEEKDAYS.map((day) => (
            <span key={day}>{day}</span>
          ))}
        </div>

        <div className="month-grid">
          {monthCells.map((cell) => {
            const dayEvents = eventsByDate[cell.key] || [];
            const active = selectedDate === cell.key;
            const muted = !isSameMonth(cell.date, viewDate);

            return (
              <button
                className={`day-cell${active ? " active" : ""}${muted ? " muted" : ""}${cell.key === todayKey ? " today" : ""}`}
                key={cell.key}
                type="button"
                onClick={() => {
                  setSelectedDate(cell.key);
                  if (!editingId) setForm(emptyForm(cell.key));
                }}
              >
                <span className="day-number">{cell.date.getDate()}</span>
                <span className="day-events">
                  {dayEvents.slice(0, 2).map((event) => (
                    <span className="event-chip" key={event.id}>
                      <span>{event.time || "весь день"}</span>
                      {event.title}
                    </span>
                  ))}
                  {dayEvents.length > 2 ? <span className="more-chip">+{dayEvents.length - 2}</span> : null}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      <aside className="details-panel" aria-label="Дела на выбранный день">
        <div className="details-header">
          <div>
            <p>Выбранный день</p>
            <h2>{formatDisplayDate(selectedDate)}</h2>
          </div>
          <span className="count-badge">{selectedEvents.length}</span>
        </div>

        <div className="event-list">
          {selectedEvents.length === 0 ? <p className="empty-state">Нет дел</p> : null}
          {selectedEvents.map((event) => (
            <article className="event-row" key={event.id}>
              <div className="event-time">{event.time || "весь день"}</div>
              <div className="event-content">
                <h3>{event.title}</h3>
                {event.note ? <p>{event.note}</p> : null}
              </div>
              <div className="row-actions">
                <button className="icon-button subtle" type="button" onClick={() => startEdit(event)} aria-label="Редактировать">
                  <Pencil size={17} />
                </button>
                <button className="icon-button danger" type="button" onClick={() => deleteEvent(event.id)} aria-label="Удалить">
                  <Trash2 size={17} />
                </button>
              </div>
            </article>
          ))}
        </div>

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
              value={form.date}
              onChange={(event) => {
                setForm((current) => ({ ...current, date: event.target.value }));
                setSelectedDate(event.target.value);
              }}
              required
            />
          </label>

          <label>
            Время
            <input
              type="time"
              value={form.time}
              onChange={(event) => setForm((current) => ({ ...current, time: event.target.value }))}
            />
          </label>

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
      </aside>
    </main>
  );
}
