/**
 * The search results panel.
 *
 * A result is shown with the line either side of it, because a line of chat
 * rarely means anything alone: what makes a hit recognisable is the message it
 * was answering. The hit itself is the one drawn in full; its neighbours are
 * dimmed, so the eye lands on the match without losing the thread around it.
 */

import { useMemo } from "react";

import { useTranslation } from "@/lib/i18n";
import type { Message, Role, SearchSort, User } from "@/lib/protocol";
import { parseSearchInput, searchTerms, splitHighlights, writeFilter } from "@/lib/search";
import { formatFull, formatTime } from "@/lib/time";
import { SEARCH_PAGE_SIZE, useSession, type MessageSearchHit } from "@/store/session";
import { colorRoleOf } from "@/store/selectors";
import { Avatar } from "./Avatar";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  CloseIcon,
  HashIcon,
  JumpIcon,
  PaperclipIcon,
  SearchIcon,
} from "./Icons";

const SORTS: SearchSort[] = ["newest", "oldest", "relevance"];

export function SearchResults() {
  const { t } = useTranslation();

  const search = useSession((state) => state.search);
  const channels = useSession((state) => state.channels);
  const users = useSession((state) => state.users);
  const roles = useSession((state) => state.roles);
  const runSearch = useSession((state) => state.runSearch);
  const closeSearch = useSession((state) => state.closeSearch);
  const jumpToMessage = useSession((state) => state.jumpToMessage);

  // The words to mark come from the query the held results were read with, not
  // from whatever the box has been edited to since.
  const terms = useMemo(() => searchTerms(parseSearchInput(search.ran).text), [search.ran]);

  const pages = Math.max(1, Math.ceil(search.total / SEARCH_PAGE_SIZE));
  const page = Math.floor(search.offset / SEARCH_PAGE_SIZE) + 1;

  return (
    <aside className="results" aria-label={t("results.title")}>
      <header className="results__head">
        <span className="results__title">{t("results.title")}</span>
        <button
          className="iconbtn"
          onClick={closeSearch}
          title={t("search.close")}
          aria-label={t("search.close")}
        >
          <CloseIcon size={16} />
        </button>
      </header>

      <div className="results__toolbar">
        <span className="results__count">
          {search.loading
            ? t("results.searching")
            : search.total === 1
              ? t("results.countOne")
              : t("results.count", { count: search.total })}
        </span>
        <div className="results__sorts" role="group" aria-label={t("results.sort")}>
          {SORTS.map((sort) => (
            <button
              key={sort}
              className={
                search.sort === sort ? "results__sort results__sort--active" : "results__sort"
              }
              aria-pressed={search.sort === sort}
              onClick={() => void runSearch({ input: search.ran, sort })}
            >
              {t(
                sort === "newest"
                  ? "results.sortNewest"
                  : sort === "oldest"
                    ? "results.sortOldest"
                    : "results.sortRelevance",
              )}
            </button>
          ))}
        </div>
      </div>

      {search.unresolved.length > 0 ? (
        <p className="results__warning">
          {t("results.unresolved", {
            filters: search.unresolved
              .map((filter) => writeFilter(filter.key, filter.value))
              .join(", "),
          })}
        </p>
      ) : null}

      <div className="results__list">
        {search.error ? <p className="results__error">{search.error}</p> : null}

        {!search.error && !search.loading && search.ran.trim() === "" ? (
          <Placeholder title={t("results.empty")} body={t("results.emptyHint")} />
        ) : null}

        {!search.error && !search.loading && search.ran.trim() !== "" && search.hits.length === 0 ? (
          <Placeholder title={t("results.none")} body={t("results.noneHint")} />
        ) : null}

        {search.hits.map((hit) => (
          <Hit
            key={hit.message.id}
            hit={hit}
            terms={terms}
            channelName={channels.get(hit.message.channelId)?.name ?? t("results.deletedChannel")}
            users={users}
            roles={roles}
            onJump={() => void jumpToMessage(hit.message.channelId, hit.message.id)}
          />
        ))}
      </div>

      {pages > 1 ? (
        <footer className="results__pager">
          <button
            className="btn btn--ghost"
            disabled={search.offset === 0 || search.loading}
            onClick={() =>
              void runSearch({ input: search.ran, offset: search.offset - SEARCH_PAGE_SIZE })
            }
          >
            <ChevronLeftIcon size={15} />
            {t("results.newerPage")}
          </button>
          <span className="results__page">{t("results.page", { page, pages })}</span>
          <button
            className="btn btn--ghost"
            disabled={page >= pages || search.loading}
            onClick={() =>
              void runSearch({ input: search.ran, offset: search.offset + SEARCH_PAGE_SIZE })
            }
          >
            {t("results.olderPage")}
            <ChevronRightIcon size={15} />
          </button>
        </footer>
      ) : null}
    </aside>
  );
}

function Placeholder({ title, body }: { title: string; body: string }) {
  return (
    <div className="results__placeholder">
      <span className="results__placeholder-icon">
        <SearchIcon size={24} />
      </span>
      <p className="results__placeholder-title">{title}</p>
      <p className="results__placeholder-body">{body}</p>
    </div>
  );
}

interface HitProps {
  hit: MessageSearchHit;
  terms: readonly string[];
  channelName: string;
  users: ReadonlyMap<number, User>;
  roles: ReadonlyMap<number, Role>;
  onJump(): void;
}

function Hit({ hit, terms, channelName, users, roles, onJump }: HitProps) {
  const { t } = useTranslation();

  return (
    <article className="hit">
      <header className="hit__head">
        <span className="hit__channel">
          <HashIcon size={13} />
          {channelName}
        </span>
        <button
          className="hit__jump"
          onClick={onJump}
          title={t("results.jump")}
          aria-label={t("results.jumpAria", { channel: channelName })}
        >
          <JumpIcon size={14} />
          {t("results.jump")}
        </button>
      </header>

      {hit.before ? <HitMessage message={hit.before} users={users} roles={roles} /> : null}
      <HitMessage message={hit.message} users={users} roles={roles} terms={terms} match />
      {hit.after ? <HitMessage message={hit.after} users={users} roles={roles} /> : null}
    </article>
  );
}

interface HitMessageProps {
  message: Message;
  users: ReadonlyMap<number, User>;
  roles: ReadonlyMap<number, Role>;
  terms?: readonly string[];
  /** Whether this is the message that matched rather than one around it. */
  match?: boolean;
}

function HitMessage({ message, users, roles, terms, match = false }: HitMessageProps) {
  const author = message.userId === null ? undefined : users.get(message.userId);
  // The colour is only knowable while the author is connected: roles travel
  // with the live user record, never with the message.
  const color = author ? (colorRoleOf(author, roles)?.color ?? null) : null;
  const files = message.attachments ?? [];

  const parts = useMemo(
    () => (terms && terms.length > 0 ? splitHighlights(message.content, terms) : null),
    [message.content, terms],
  );

  return (
    <div className={match ? "hit__msg hit__msg--match" : "hit__msg"}>
      <span className="hit__avatar">
        {author ? (
          <Avatar user={author} size="sm" />
        ) : (
          <span className="hit__avatar-offline" aria-hidden="true">
            {message.author.slice(0, 1).toUpperCase()}
          </span>
        )}
      </span>
      <div className="hit__body">
        <div className="hit__meta">
          <span className="hit__author" style={color ? { color } : undefined}>
            {message.author}
          </span>
          <time className="hit__time" title={formatFull(message.createdAt)}>
            {formatTime(message.createdAt)}
          </time>
        </div>
        {message.content ? (
          <p className="hit__text">
            {parts
              ? parts.map((part, index) =>
                  part.match ? (
                    <mark key={index} className="hit__mark">
                      {part.value}
                    </mark>
                  ) : (
                    <span key={index}>{part.value}</span>
                  ),
                )
              : message.content}
          </p>
        ) : null}
        {files.length > 0 ? (
          <ul className="hit__files">
            {files.map((file) => (
              <li key={file.id} className="hit__file">
                <PaperclipIcon size={12} />
                {file.filename}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}
