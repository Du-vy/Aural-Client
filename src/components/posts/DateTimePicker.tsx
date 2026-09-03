import { useEffect, useRef, useState } from "react";
import { useTranslation } from "@/lib/i18n";
import { CalendarIcon, ChevronLeftIcon, ChevronRightIcon, ClockIcon } from "../Icons";

interface DateTimePickerProps {
  value: string; // ISO string format or YYYY-MM-DDTHH:mm
  onChange(value: string): void;
  allDay?: boolean;
  disabled?: boolean;
  label?: string;
  id?: string;
}

export function DateTimePicker({
  value,
  onChange,
  allDay = false,
  disabled = false,
  id,
}: DateTimePickerProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Parse initial date
  const parsedDate = value ? new Date(value) : new Date();
  const validDate = isNaN(parsedDate.getTime()) ? new Date() : parsedDate;

  const [viewYear, setViewYear] = useState(validDate.getFullYear());
  const [viewMonth, setViewMonth] = useState(validDate.getMonth());

  // Close on outside click or Escape
  useEffect(() => {
    if (!open) return;

    function handleOutsideClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }

    function handleEscape(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", handleOutsideClick);
    window.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleOutsideClick);
      window.removeEventListener("keydown", handleEscape);
    };
  }, [open]);

  // Sync view year/month when value changes externally
  useEffect(() => {
    if (value) {
      const d = new Date(value);
      if (!isNaN(d.getTime())) {
        setViewYear(d.getFullYear());
        setViewMonth(d.getMonth());
      }
    }
  }, [value]);

  function pad(n: number) {
    return n < 10 ? `0${n}` : `${n}`;
  }

  function formatDisplay() {
    if (!value) return t("posts.eventStartsAt");
    const d = new Date(value);
    if (isNaN(d.getTime())) return value;

    const dateStr = d.toLocaleDateString(undefined, {
      weekday: "short",
      day: "numeric",
      month: "short",
      year: "numeric",
    });

    if (allDay) {
      return `${dateStr} (${t("posts.allDay")})`;
    }

    const timeStr = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    return `${dateStr}, ${timeStr}`;
  }

  function updateDate(year: number, month: number, day: number) {
    const d = new Date(validDate);
    d.setFullYear(year, month, day);
    const isoString = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    onChange(isoString);
  }

  function updateTime(hours: number, minutes: number) {
    const d = new Date(validDate);
    d.setHours(hours, minutes, 0, 0);
    const isoString = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    onChange(isoString);
  }

  function prevMonth() {
    if (viewMonth === 0) {
      setViewMonth(11);
      setViewYear((y) => y - 1);
    } else {
      setViewMonth((m) => m - 1);
    }
  }

  function nextMonth() {
    if (viewMonth === 11) {
      setViewMonth(0);
      setViewYear((y) => y + 1);
    } else {
      setViewMonth((m) => m + 1);
    }
  }

  function setToday() {
    const now = new Date();
    setViewYear(now.getFullYear());
    setViewMonth(now.getMonth());
    updateDate(now.getFullYear(), now.getMonth(), now.getDate());
  }

  // Days matrix for current view
  const firstDay = new Date(viewYear, viewMonth, 1).getDay();
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const prevMonthDays = new Date(viewYear, viewMonth, 0).getDate();

  const days: Array<{ day: number; monthOffset: number; date: Date }> = [];

  for (let i = firstDay - 1; i >= 0; i--) {
    const d = prevMonthDays - i;
    days.push({ day: d, monthOffset: -1, date: new Date(viewYear, viewMonth - 1, d) });
  }

  for (let d = 1; d <= daysInMonth; d++) {
    days.push({ day: d, monthOffset: 0, date: new Date(viewYear, viewMonth, d) });
  }

  const remaining = 35 - days.length > 0 ? 35 - days.length : 42 - days.length;
  for (let d = 1; d <= remaining; d++) {
    days.push({ day: d, monthOffset: 1, date: new Date(viewYear, viewMonth + 1, d) });
  }

  const monthLabel = new Date(viewYear, viewMonth, 1).toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });

  const hours = validDate.getHours();
  const minutes = validDate.getMinutes();

  return (
    <div className="datetime-picker" ref={containerRef}>
      <button
        id={id}
        type="button"
        className="datetime-picker__trigger input"
        onClick={() => !disabled && setOpen((o) => !o)}
        disabled={disabled}
      >
        <span className="datetime-picker__trigger-icon">
          <CalendarIcon size={16} />
        </span>
        <span className="datetime-picker__trigger-text">{formatDisplay()}</span>
      </button>

      {open ? (
        <div className="datetime-picker__popover">
          <div className="datetime-picker__header">
            <span className="datetime-picker__month-title">{monthLabel}</span>
            <div className="datetime-picker__nav">
              <button
                type="button"
                className="iconbtn iconbtn--sm"
                onClick={prevMonth}
                aria-label="Previous month"
              >
                <ChevronLeftIcon size={16} />
              </button>
              <button
                type="button"
                className="iconbtn iconbtn--sm"
                onClick={nextMonth}
                aria-label="Next month"
              >
                <ChevronRightIcon size={16} />
              </button>
            </div>
          </div>

          <div className="datetime-picker__weekdays">
            {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((w) => (
              <span key={w} className="datetime-picker__weekday">
                {w}
              </span>
            ))}
          </div>

          <div className="datetime-picker__days">
            {days.map((item, idx) => {
              const isSelected =
                item.monthOffset === 0 &&
                item.day === validDate.getDate() &&
                viewMonth === validDate.getMonth() &&
                viewYear === validDate.getFullYear();

              const isToday =
                item.date.toDateString() === new Date().toDateString();

              return (
                <button
                  key={idx}
                  type="button"
                  className={`datetime-picker__day ${item.monthOffset !== 0 ? "datetime-picker__day--outside" : ""} ${isSelected ? "datetime-picker__day--selected" : ""} ${isToday ? "datetime-picker__day--today" : ""}`}
                  onClick={() => {
                    const targetYear = item.monthOffset === -1 ? (viewMonth === 0 ? viewYear - 1 : viewYear) : item.monthOffset === 1 ? (viewMonth === 11 ? viewYear + 1 : viewYear) : viewYear;
                    const targetMonth = item.monthOffset === -1 ? (viewMonth === 0 ? 11 : viewMonth - 1) : item.monthOffset === 1 ? (viewMonth === 11 ? 0 : viewMonth + 1) : viewMonth;
                    updateDate(targetYear, targetMonth, item.day);
                  }}
                >
                  {item.day}
                </button>
              );
            })}
          </div>

          {!allDay ? (
            <div className="datetime-picker__time-section">
              <span className="datetime-picker__time-label">
                <ClockIcon size={14} />
                <span>Time:</span>
              </span>

              <div className="datetime-picker__time-inputs">
                <select
                  className="select select--sm"
                  value={hours}
                  onChange={(e) => updateTime(Number(e.target.value), minutes)}
                >
                  {Array.from({ length: 24 }, (_, i) => (
                    <option key={i} value={i}>
                      {pad(i)}:00
                    </option>
                  ))}
                </select>
                <span>:</span>
                <select
                  className="select select--sm"
                  value={Math.floor(minutes / 5) * 5}
                  onChange={(e) => updateTime(hours, Number(e.target.value))}
                >
                  {Array.from({ length: 12 }, (_, i) => i * 5).map((m) => (
                    <option key={m} value={m}>
                      {pad(m)}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          ) : null}

          <div className="datetime-picker__footer">
            <button
              type="button"
              className="btn btn--sm btn--ghost"
              onClick={setToday}
            >
              {t("posts.today")}
            </button>
            <button
              type="button"
              className="btn btn--sm btn--primary"
              onClick={() => setOpen(false)}
            >
              OK
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
