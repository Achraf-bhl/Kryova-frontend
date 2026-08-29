"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ConversationRow } from "./conversation-row";

import {
  ChevronLeftIcon,
  ChevronRightIcon,
  CloseIcon,
  FilesIcon,
  HistoryIcon,
  MenuIcon,
  PartIcon,
  PlusIcon,
  RunsIcon,
  SearchIcon,
  SettingsIcon,
  SignOutIcon,
} from "@/components/ui/icons";
import { useAuth } from "@/lib/auth-context";
import { api } from "@/lib/api-client";
import { groupConversations } from "@/lib/conversation-groups";
import { onConversationsChanged } from "@/lib/conversation-events";
import type { UserRead } from "@/types/api";
import type { ConversationSummary } from "@/types/conversation";

const NAV = [
  { href: "/dashboard/projects", label: "Projects", Icon: PartIcon },
  { href: "/dashboard/runs", label: "Runs", Icon: RunsIcon },
  { href: "/dashboard/files", label: "Files", Icon: FilesIcon },
  { href: "/dashboard/history", label: "History", Icon: HistoryIcon },
] as const;

function initialsOf(fullName: string | null, email: string): string {
  const source = fullName?.trim() || email.split("@")[0];
  const parts = source.split(/[\s._-]+/).filter(Boolean);
  const letters = parts.slice(0, 2).map((part) => part[0]);
  return (letters.join("") || source[0] || "?").toUpperCase();
}

export interface SidebarProps {
  user: UserRead;
  /** Server-rendered so the history is there on first paint, not after a fetch. */
  initialConversations: ConversationSummary[];
}

export function Sidebar({ user, initialConversations }: SidebarProps) {
  const pathname = usePathname();
  const { logout } = useAuth();
  const [conversations, setConversations] = useState(initialConversations);
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  const reload = useCallback(async () => {
    try {
      const page = await api.listConversations();
      setConversations(page.items);
    } catch {
      // A failed refresh leaves the list we already have. Blanking the sidebar
      // because one poll missed would be worse than showing it slightly stale.
    }
  }, []);

  // The chat view fires this when a turn settles, so a new conversation appears
  // (with its generated title) without a router navigation that would cut the
  // stream that produced it.
  useEffect(() => onConversationsChanged(() => void reload()), [reload]);

  // ⌘K / Ctrl-K focuses search, the shortcut the field advertises.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setCollapsed(false);
        setDrawerOpen(true);
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const groups = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const filtered = needle
      ? conversations.filter((item) => item.title.toLowerCase().includes(needle))
      : conversations;
    return groupConversations(filtered);
  }, [conversations, query]);

  const removeConversation = useCallback((conversationId: string) => {
    setConversations((previous) =>
      previous.filter((item) => item.conversation_id !== conversationId),
    );
  }, []);

  const renameConversation = useCallback((conversationId: string, title: string) => {
    setConversations((previous) =>
      previous.map((item) =>
        item.conversation_id === conversationId ? { ...item, title } : item,
      ),
    );
  }, []);

  const content = (
    <div className="flex h-full flex-col gap-3 p-3">
      <div className="flex items-center gap-2">
        <Link
          href="/dashboard"
          className="flex min-w-0 items-center gap-2 rounded-sm px-1 py-1"
          aria-label="Kryova home"
        >
          <span className="k-orb size-5 shrink-0" aria-hidden="true" />
          {!collapsed && (
            <span className="font-display text-sm font-semibold tracking-[0.14em] text-accent">
              KRYOVA
            </span>
          )}
        </Link>
        <button
          type="button"
          onClick={() => setCollapsed((value) => !value)}
          className="ml-auto hidden rounded-sm p-1.5 text-faint hover:text-accent md:block"
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-expanded={!collapsed}
        >
          {collapsed ? (
            <ChevronRightIcon className="size-4" />
          ) : (
            <ChevronLeftIcon className="size-4" />
          )}
        </button>
        <button
          type="button"
          onClick={() => setDrawerOpen(false)}
          className="ml-auto rounded-sm p-1.5 text-faint hover:text-accent md:hidden"
          aria-label="Close menu"
        >
          <CloseIcon className="size-4" />
        </button>
      </div>

      <Link
        href="/dashboard"
        className="flex h-9 items-center justify-center gap-2 rounded-md bg-primary text-sm font-medium text-white transition-colors hover:bg-primary-hover"
      >
        <PlusIcon className="size-4" />
        {!collapsed && "New chat"}
      </Link>

      {!collapsed && (
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-faint" />
          <input
            ref={searchRef}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search chats"
            aria-label="Search conversations"
            className="h-8 w-full rounded-md border border-border bg-surface pl-8 pr-10 text-sm text-accent outline-none placeholder:text-faint focus:border-primary"
          />
          <kbd className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 font-mono text-[0.625rem] text-faint">
            ⌘K
          </kbd>
        </div>
      )}

      <nav className="flex flex-col gap-0.5" aria-label="Sections">
        {NAV.map(({ href, label, Icon }) => (
          <Link
            key={href}
            href={href}
            className="k-nav-item"
            aria-current={pathname === href || pathname.startsWith(`${href}/`) ? "page" : undefined}
            title={collapsed ? label : undefined}
          >
            <Icon className="size-4 shrink-0" />
            {!collapsed && label}
          </Link>
        ))}
      </nav>

      {!collapsed && (
        <div className="k-scroll -mr-1 min-h-0 flex-1 overflow-y-auto pr-1">
          {groups.length === 0 ? (
            <p className="px-2 py-6 text-xs leading-relaxed text-faint">
              {query
                ? `No chat matches “${query}”.`
                : "Your chats will collect here. Start one and it keeps its CATIA document."}
            </p>
          ) : (
            groups.map((group) => (
              <section key={group.label} className="mb-2">
                <h2 className="px-2 pb-1 pt-3 text-[0.6875rem] font-medium uppercase tracking-wider text-faint">
                  {group.label}
                </h2>
                <ul>
                  {group.items.map((conversation) => (
                    <ConversationRow
                      key={conversation.conversation_id}
                      conversation={conversation}
                      active={pathname === `/dashboard/c/${conversation.conversation_id}`}
                      onDeleted={removeConversation}
                      onRenamed={renameConversation}
                    />
                  ))}
                </ul>
              </section>
            ))
          )}
        </div>
      )}

      {collapsed && <div className="flex-1" />}

      <div className="rounded-md border border-border bg-surface p-2">
        <div className="flex items-center gap-2">
          <span
            className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary-soft font-mono text-[0.6875rem] font-semibold text-blueprint"
            aria-hidden="true"
          >
            {initialsOf(user.full_name, user.email)}
          </span>
          {!collapsed && (
            <span className="min-w-0 flex-1">
              <span className="block truncate text-xs font-medium text-accent">
                {user.full_name ?? user.email.split("@")[0]}
              </span>
              <span className="block truncate font-mono text-[0.6875rem] text-faint">
                {user.email}
              </span>
            </span>
          )}
          <button
            type="button"
            onClick={() => void logout()}
            className="rounded-sm p-1.5 text-faint hover:text-danger"
            aria-label="Sign out"
            title="Sign out"
          >
            <SignOutIcon className="size-4" />
          </button>
        </div>
        {!collapsed && (
          <Link
            href="/dashboard/settings"
            className="k-nav-item mt-1 text-xs"
            aria-current={pathname === "/dashboard/settings" ? "page" : undefined}
          >
            <SettingsIcon className="size-3.5" />
            Settings
          </Link>
        )}
      </div>
    </div>
  );

  return (
    <>
      {/* Mobile bar. The sidebar is a drawer under 768px, so the main area
          starts below this. */}
      <div className="fixed inset-x-0 top-0 z-30 flex h-14 items-center gap-2 border-b border-border bg-surface/90 px-3 backdrop-blur-sm md:hidden">
        <button
          type="button"
          onClick={() => setDrawerOpen(true)}
          className="rounded-sm p-2 text-muted hover:text-accent"
          aria-label="Open menu"
          aria-expanded={drawerOpen}
        >
          <MenuIcon className="size-5" />
        </button>
        <Link href="/dashboard" className="flex items-center gap-2">
          <span className="k-orb size-5" aria-hidden="true" />
          <span className="font-display text-sm font-semibold tracking-[0.14em]">KRYOVA</span>
        </Link>
      </div>

      <aside
        className={`hidden shrink-0 border-r border-border bg-surface-sunken md:block ${
          collapsed ? "w-16" : "w-64"
        }`}
      >
        {content}
      </aside>

      {drawerOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-accent/30"
            aria-label="Close menu"
            onClick={() => setDrawerOpen(false)}
          />
          {/* Any link inside the drawer navigates, and a drawer left open then
              covers the page the user just asked for. Delegating from the
              container keeps this in the click that caused it rather than in an
              effect watching the pathname. */}
          <div
            className="k-fade absolute inset-y-0 left-0 w-72 max-w-[85vw] border-r border-border bg-surface-sunken shadow-raised"
            onClick={(event) => {
              if ((event.target as HTMLElement).closest("a")) setDrawerOpen(false);
            }}
          >
            {content}
          </div>
        </div>
      )}
    </>
  );
}
