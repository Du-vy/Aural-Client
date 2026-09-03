import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "@/lib/i18n";
import { Perm, has } from "@/lib/permissions";
import { useMyPermissions } from "@/store/selectors";
import { useSession } from "@/store/session";
import { buildMentions } from "@/lib/mentions";
import type { Channel, Post } from "@/lib/protocol";
import { Markdown } from "../attachments/Markdown";
import { PostCommentsThread } from "./PostCommentsThread";
import {
  CalendarIcon,
  CheckCircleIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ClockIcon,
  GridIcon,
  HelpCircleIcon,
  ListIcon,
  MapPinIcon,
  MessageSquareIcon,
  TrashIcon,
  XCircleIcon,
} from "../Icons";

interface CalendarChannelViewProps {
  channel: Channel;
  posts: Post[];
  loading: boolean;
  onOpenMember?(userId: number, anchorRect?: DOMRect): void;
  onRequestCreateEvent?(initialDate: Date): void;
}

export function CalendarChannelView({
  channel,
  posts,
  loading,
  onOpenMember,
  onRequestCreateEvent,
}: CalendarChannelViewProps) {
  const { t } = useTranslation();
  const openPostChannel = useSession((state) => state.openPostChannel);
  const rsvpPost = useSession((state) => state.rsvpPost);
  const deletePost = useSession((state) => state.deletePost);
  const self = useSession((state) => state.self);
  const users = useSession((state) => state.users);
  const roles = useSession((state) => state.roles);
  const permissions = useMyPermissions();

  const mentions = useMemo(() => buildMentions(users, roles), [users, roles]);

  const [viewMode, setViewMode] = useState<"month" | "list">("month");
  const [currentDate, setCurrentDate] = useState(() => new Date());
  const [expandedComments, setExpandedComments] = useState<ReadonlySet<number>>(new Set());
  const [selectedPostId, setSelectedPostId] = useState<number | null>(null);

  const canManageChannels = has(permissions, Perm.ManageChannels) || has(permissions, Perm.Administrator);
  const canCreatePosts =
    has(permissions, Perm.CreatePosts) ||
    has(permissions, Perm.ManageChannels) ||
    has(permissions, Perm.Administrator);

  // Calculate start and end unix seconds for the visible month (plus padding)
  const { monthStart, monthEnd } = useMemo(() => {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const start = new Date(year, month, 1, 0, 0, 0);
    const end = new Date(year, month + 1, 0, 23, 59, 59);
    return {
      monthStart: Math.floor(start.getTime() / 1000) - 7 * 86400,
      monthEnd: Math.floor(end.getTime() / 1000) + 7 * 86400,
    };
  }, [currentDate]);

  useEffect(() => {
    void openPostChannel(channel.id, { from: monthStart, to: monthEnd });
  }, [channel.id, monthStart, monthEnd, openPostChannel]);

  function prevMonth() {
    setCurrentDate((d) => new Date(d.getFullYear(), d.getMonth() - 1, 1));
  }

  function nextMonth() {
    setCurrentDate((d) => new Date(d.getFullYear(), d.getMonth() + 1, 1));
  }

  function goToToday() {
    setCurrentDate(new Date());
  }

  function toggleComments(postId: number) {
    setExpandedComments((prev) => {
      const next = new Set(prev);
      if (next.has(postId)) next.delete(postId);
      else next.add(postId);
      return next;
    });
  }

  // Sorted events for list view
  const sortedEvents = useMemo(() => {
    return [...posts]
      .filter((p) => p.event)
      .sort((a, b) => (a.event?.startsAt ?? 0) - (b.event?.startsAt ?? 0));
  }, [posts]);

  // Days grid generation for month view
  const monthGrid = useMemo(() => {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const firstDayIndex = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    const days: Array<{ day: number; date: Date; isCurrentMonth: boolean; events: Post[] }> = [];

    // Previous month padding
    const prevMonthDays = new Date(year, month, 0).getDate();
    for (let i = firstDayIndex - 1; i >= 0; i--) {
      const d = prevMonthDays - i;
      const date = new Date(year, month - 1, d);
      days.push({ day: d, date, isCurrentMonth: false, events: [] });
    }

    // Current month days
    for (let d = 1; d <= daysInMonth; d++) {
      const date = new Date(year, month, d);
      const dayStart = new Date(year, month, d, 0, 0, 0).getTime() / 1000;
      const dayEnd = new Date(year, month, d, 23, 59, 59).getTime() / 1000;

      const dayEvents = posts.filter((p) => {
        if (!p.event) return false;
        return p.event.startsAt >= dayStart && p.event.startsAt <= dayEnd;
      });

      days.push({ day: d, date, isCurrentMonth: true, events: dayEvents });
    }

    // Next month padding to fill grid
    const remaining = 35 - days.length > 0 ? 35 - days.length : 42 - days.length;
    for (let d = 1; d <= remaining; d++) {
      const date = new Date(year, month + 1, d);
      days.push({ day: d, date, isCurrentMonth: false, events: [] });
    }

    return days;
  }, [currentDate, posts]);

  const monthLabel = currentDate.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  const selectedEvent = selectedPostId ? posts.find((p) => p.id === selectedPostId) : null;

  return (
    <div className="calendar-view">
      {/* Calendar Top Toolbar */}
      <div className="calendar-toolbar">
        <div className="calendar-toolbar__nav">
          <h2 className="calendar-toolbar__title">{monthLabel}</h2>
          <button type="button" className="iconbtn" onClick={prevMonth} aria-label="Previous month">
            <ChevronLeftIcon size={18} />
          </button>
          <button type="button" className="iconbtn" onClick={nextMonth} aria-label="Next month">
            <ChevronRightIcon size={18} />
          </button>
          <button type="button" className="btn btn--ghost btn--sm" onClick={goToToday}>
            {t("posts.today")}
          </button>
        </div>

        <div className="calendar-toolbar__actions">
          <div className="calendar-toolbar__switch">
            <button
              type="button"
              className={`btn btn--sm ${viewMode === "month" ? "btn--secondary" : "btn--ghost"}`}
              onClick={() => setViewMode("month")}
            >
              <GridIcon size={14} style={{ marginRight: 6 }} />
              <span>{t("posts.monthView")}</span>
            </button>
            <button
              type="button"
              className={`btn btn--sm ${viewMode === "list" ? "btn--secondary" : "btn--ghost"}`}
              onClick={() => setViewMode("list")}
            >
              <ListIcon size={14} style={{ marginRight: 6 }} />
              <span>{t("posts.listView")}</span>
            </button>
          </div>
        </div>
      </div>

      {viewMode === "month" ? (
        <div className="calendar-month">
          <div className="calendar-month__weekdays">
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => (
              <div key={day} className="calendar-month__weekday">
                {day}
              </div>
            ))}
          </div>

          <div className="calendar-month__grid">
            {monthGrid.map((item, index) => {
              const today = new Date();
              const isToday =
                item.date.getDate() === today.getDate() &&
                item.date.getMonth() === today.getMonth() &&
                item.date.getFullYear() === today.getFullYear();

              return (
                <div
                  key={index}
                  className={`calendar-cell ${!item.isCurrentMonth ? "calendar-cell--outside" : ""} ${isToday ? "calendar-cell--today" : ""} ${canCreatePosts ? "calendar-cell--clickable" : ""}`}
                  onClick={() => {
                    if (canCreatePosts) {
                      onRequestCreateEvent?.(item.date);
                    }
                  }}
                >
                  <div className="calendar-cell__header">
                    <span className="calendar-cell__day">{item.day}</span>
                    {canCreatePosts && item.isCurrentMonth ? (
                      <button
                        type="button"
                        className="calendar-cell__add-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          onRequestCreateEvent?.(item.date);
                        }}
                        title={t("posts.newEvent")}
                        aria-label={t("posts.newEvent")}
                      >
                        +
                      </button>
                    ) : null}
                  </div>
                  <div className="calendar-cell__events">
                    {item.events.map((ev) => (
                      <div
                        key={ev.id}
                        className={`calendar-event-pill ${ev.rsvp?.own === "going" ? "calendar-event-pill--going" : ""}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedPostId(ev.id);
                        }}
                        title={ev.title}
                      >
                        <span className="calendar-event-pill__title">{ev.title}</span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="calendar-agenda">
          {sortedEvents.length === 0 && !loading ? (
            <div className="post-channel__empty">
              <div className="post-channel__empty-icon">
                <CalendarIcon size={40} />
              </div>
              <h3 className="post-channel__empty-title">{t("posts.emptyChannel")}</h3>
              <p className="post-channel__empty-desc">{t("posts.emptyCalendarHint")}</p>
            </div>
          ) : null}

          {sortedEvents.map((post) => {
            const ev = post.event;
            const startDate = ev ? new Date(ev.startsAt * 1000) : null;
            const authorUser = post.userId !== null ? users.get(post.userId) : undefined;
            const isCommentsOpen = expandedComments.has(post.id);
            const canDelete = canManageChannels || self?.id === post.userId;

            return (
              <div key={post.id} className="calendar-card">
                <div className="calendar-card__date-col">
                  <span className="calendar-card__day-num">{startDate?.getDate()}</span>
                  <span className="calendar-card__month-name">
                    {startDate?.toLocaleDateString(undefined, { month: "short" })}
                  </span>
                </div>

                <div className="calendar-card__content">
                  <div className="calendar-card__meta">
                    <h3 className="calendar-card__title">{post.title}</h3>
                    {canDelete ? (
                      <button
                        type="button"
                        className="iconbtn iconbtn--danger"
                        title={t("posts.delete")}
                        onClick={() => void deletePost(post.id)}
                      >
                        <TrashIcon size={14} />
                      </button>
                    ) : null}
                  </div>

                  <div className="calendar-card__details">
                    <span className="calendar-card__detail-item">
                      <ClockIcon size={14} />
                      <span>
                        {ev?.allDay
                          ? t("posts.allDay")
                          : startDate?.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </span>
                    </span>

                    {ev?.location ? (
                      <span className="calendar-card__detail-item">
                        <MapPinIcon size={14} />
                        <span>{ev.location}</span>
                      </span>
                    ) : null}

                    <span className="calendar-card__author">
                      <span>by {authorUser?.nickname ?? post.author}</span>
                    </span>
                  </div>

                  {post.body?.content ? (
                    <div className="calendar-card__body">
                      <Markdown
                        source={post.body.content}
                        mentions={mentions}
                        onOpenMember={onOpenMember}
                        onOpenLink={(url) => window.open(url, "_blank", "noreferrer,noopener")}
                      />
                    </div>
                  ) : null}

                  {/* RSVP Section */}
                  <div className="calendar-rsvp">
                    <div className="calendar-rsvp__buttons">
                      <button
                        type="button"
                        className={`calendar-rsvp__btn ${post.rsvp?.own === "going" ? "calendar-rsvp__btn--active" : ""}`}
                        onClick={() => void rsvpPost(post.id, "going")}
                        disabled={post.locked}
                      >
                        <CheckCircleIcon size={15} />
                        <span>{t("posts.going")}</span>
                        <span className="calendar-rsvp__count">{post.rsvp?.going ?? 0}</span>
                      </button>

                      <button
                        type="button"
                        className={`calendar-rsvp__btn ${post.rsvp?.own === "maybe" ? "calendar-rsvp__btn--active" : ""}`}
                        onClick={() => void rsvpPost(post.id, "maybe")}
                        disabled={post.locked}
                      >
                        <HelpCircleIcon size={15} />
                        <span>{t("posts.maybe")}</span>
                        <span className="calendar-rsvp__count">{post.rsvp?.maybe ?? 0}</span>
                      </button>

                      <button
                        type="button"
                        className={`calendar-rsvp__btn ${post.rsvp?.own === "declined" ? "calendar-rsvp__btn--active" : ""}`}
                        onClick={() => void rsvpPost(post.id, "declined")}
                        disabled={post.locked}
                      >
                        <XCircleIcon size={15} />
                        <span>{t("posts.declined")}</span>
                        <span className="calendar-rsvp__count">{post.rsvp?.declined ?? 0}</span>
                      </button>
                    </div>

                    <button
                      type="button"
                      className="btn btn--sm btn--ghost"
                      onClick={() => toggleComments(post.id)}
                    >
                      <MessageSquareIcon size={14} style={{ marginRight: 6 }} />
                      <span>{post.comments} {t("posts.comments")}</span>
                    </button>
                  </div>

                  {isCommentsOpen ? (
                    <div className="calendar-card__comments">
                      <PostCommentsThread
                        channelId={channel.id}
                        post={post}
                        onOpenMember={onOpenMember}
                      />
                    </div>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Selected Event Modal in Month View */}
      {selectedEvent ? (
        <div className="calendar-modal-backdrop" onClick={() => setSelectedPostId(null)}>
          <div className="calendar-modal" onClick={(e) => e.stopPropagation()}>
            <div className="calendar-modal__header">
              <h3>{selectedEvent.title}</h3>
              <button type="button" className="notice__close" onClick={() => setSelectedPostId(null)}>
                ×
              </button>
            </div>

            <div className="calendar-modal__body">
              {selectedEvent.event ? (
                <div className="calendar-card__details" style={{ marginBottom: 12 }}>
                  <span className="calendar-card__detail-item">
                    <ClockIcon size={14} />
                    <span>
                      {new Date(selectedEvent.event.startsAt * 1000).toLocaleString([], {
                        dateStyle: "medium",
                        timeStyle: "short",
                      })}
                    </span>
                  </span>
                  {selectedEvent.event.location ? (
                    <span className="calendar-card__detail-item">
                      <MapPinIcon size={14} />
                      <span>{selectedEvent.event.location}</span>
                    </span>
                  ) : null}
                </div>
              ) : null}

              {selectedEvent.body?.content ? (
                <Markdown
                  source={selectedEvent.body.content}
                  mentions={mentions}
                  onOpenMember={onOpenMember}
                  onOpenLink={(url) => window.open(url, "_blank", "noreferrer,noopener")}
                />
              ) : null}

              <div className="calendar-rsvp" style={{ marginTop: 16 }}>
                <div className="calendar-rsvp__buttons">
                  <button
                    type="button"
                    className={`calendar-rsvp__btn ${selectedEvent.rsvp?.own === "going" ? "calendar-rsvp__btn--active" : ""}`}
                    onClick={() => void rsvpPost(selectedEvent.id, "going")}
                    disabled={selectedEvent.locked}
                  >
                    <CheckCircleIcon size={15} />
                    <span>{t("posts.going")}</span>
                    <span className="calendar-rsvp__count">{selectedEvent.rsvp?.going ?? 0}</span>
                  </button>

                  <button
                    type="button"
                    className={`calendar-rsvp__btn ${selectedEvent.rsvp?.own === "maybe" ? "calendar-rsvp__btn--active" : ""}`}
                    onClick={() => void rsvpPost(selectedEvent.id, "maybe")}
                    disabled={selectedEvent.locked}
                  >
                    <HelpCircleIcon size={15} />
                    <span>{t("posts.maybe")}</span>
                    <span className="calendar-rsvp__count">{selectedEvent.rsvp?.maybe ?? 0}</span>
                  </button>

                  <button
                    type="button"
                    className={`calendar-rsvp__btn ${selectedEvent.rsvp?.own === "declined" ? "calendar-rsvp__btn--active" : ""}`}
                    onClick={() => void rsvpPost(selectedEvent.id, "declined")}
                    disabled={selectedEvent.locked}
                  >
                    <XCircleIcon size={15} />
                    <span>{t("posts.declined")}</span>
                    <span className="calendar-rsvp__count">{selectedEvent.rsvp?.declined ?? 0}</span>
                  </button>
                </div>
              </div>

              <div style={{ marginTop: 16, borderTop: "1px solid var(--border)", paddingTop: 12 }}>
                <PostCommentsThread
                  channelId={channel.id}
                  post={selectedEvent}
                  onOpenMember={onOpenMember}
                />
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
