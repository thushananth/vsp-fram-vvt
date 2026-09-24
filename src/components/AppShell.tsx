"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  ClipboardList,
  Contact,
  HandCoins,
  LayoutDashboard,
  LogOut,
  Menu,
  MoreHorizontal,
  Package,
  PanelLeftClose,
  PanelLeftOpen,
  Receipt,
  Settings,
  ShieldCheck,
  Users,
  Wifi,
  WifiOff,
  X,
  type LucideIcon,
  PackageX,
  TrendingUp,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useOnline } from "@/lib/online";
import { useBillJournal } from "@/lib/billJournal";
import { useBillNumberLease } from "@/lib/billNumbers";
import BrandMark from "@/components/BrandMark";

type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  adminOnly?: boolean;
};

const FULL_NAV: NavItem[] = [
  { href: "/", label: "Billing", icon: Receipt },
  { href: "/bills", label: "Bills", icon: ClipboardList },
  { href: "/report", label: "Report", icon: BarChart3 },
  { href: "/stock", label: "Stock", icon: Package },
  { href: "/returns", label: "Returns", icon: PackageX },
  { href: "/profit", label: "Profit", icon: TrendingUp, adminOnly: true },
  { href: "/customers", label: "Customers", icon: Contact },
  { href: "/credit", label: "Credit", icon: HandCoins },
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, adminOnly: true },
  { href: "/users", label: "Users", icon: Users, adminOnly: true },
  { href: "/devices", label: "Devices", icon: ShieldCheck, adminOnly: true },
  { href: "/settings", label: "Settings", icon: Settings, adminOnly: true },
];

// The bottom bar only ever shows the everyday cashier flow — everything
// else (Dashboard, Users, sign out) lives in the sidebar/drawer.
const CORE_HREFS = ["/", "/bills", "/stock", "/report"];

const SIDEBAR_KEY = "chickenfarm.sidebarCollapsed";

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { profile, signOut } = useAuth();
  const online = useOnline();
  // Keeps a block of bill numbers banked while the connection is good, so the
  // till can keep numbering sales when it isn't.
  useBillNumberLease(true);
  const journal = useBillJournal();
  const queued = journal.filter((e) => e.state === "pending").length;
  const held = journal.filter((e) => e.state === "failed").length;
  const [collapsed, setCollapsed] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    setCollapsed(window.localStorage.getItem(SIDEBAR_KEY) === "1");
  }, []);

  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  function toggleCollapsed() {
    setCollapsed((prev) => {
      window.localStorage.setItem(SIDEBAR_KEY, prev ? "0" : "1");
      return !prev;
    });
  }

  const role = profile?.role ?? "cashier";
  const items = FULL_NAV.filter((item) => !item.adminOnly || role === "admin");
  const coreItems = items.filter((item) => CORE_HREFS.includes(item.href));

  return (
    <div className="flex min-h-screen w-full flex-col md:flex-row">
      {/* Desktop sidebar — minimizable */}
      <aside
        className={`surface-nav sticky top-0 hidden h-screen shrink-0 flex-col border-r border-white/[0.06] text-white transition-[width] duration-200 md:flex ${
          collapsed ? "w-[72px]" : "w-64"
        }`}
      >
        <SidebarContent
          items={items}
          pathname={pathname}
          collapsed={collapsed}
          profile={profile}
          onToggle={toggleCollapsed}
          onSignOut={() => signOut()}
          variant="sidebar"
        />
      </aside>

      {/* Mobile/tablet drawer sidebar */}
      {drawerOpen && (
        <div className="fixed inset-0 z-40 flex md:hidden">
          <div
            className="absolute inset-0 bg-ink-900/70 backdrop-blur-[2px]"
            onClick={() => setDrawerOpen(false)}
          />
          <aside className="surface-nav relative flex h-full w-72 max-w-[80vw] flex-col text-white shadow-2xl">
            <SidebarContent
              items={items}
              pathname={pathname}
              collapsed={false}
              profile={profile}
              onToggle={() => setDrawerOpen(false)}
              onSignOut={() => signOut()}
              variant="drawer"
            />
          </aside>
        </div>
      )}

      <div className="flex min-h-screen flex-1 flex-col">
        <header className="sticky top-0 z-10 flex items-center justify-between border-b border-white/[0.07] bg-ink-800 px-4 py-3 text-white md:hidden">
          <div className="flex items-center gap-2.5">
            <button
              onClick={() => setDrawerOpen(true)}
              aria-label="Open menu"
              className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/15 text-white/75 transition-colors hover:bg-white/10 hover:text-white"
            >
              <Menu size={18} strokeWidth={2.2} />
            </button>
            <span className="text-base font-extrabold tracking-tight">Chicken Farm POS</span>
          </div>
          <OnlinePill online={online} queued={queued} held={held} tone="dark" />
        </header>

        {/* Every page renders its own heading, so this bar stays just the
            connection state — no second title competing with it. */}
        <div className="hidden items-center justify-end border-b border-border bg-surface px-6 py-3 md:flex">
          <OnlinePill online={online} queued={queued} held={held} tone="light" />
        </div>

        <main className="flex-1 bg-ground pb-[60px]">{children}</main>
      </div>

      {/* Bottom nav — the everyday flow, kept on every page/breakpoint */}
      <nav
        className={`fixed inset-x-0 bottom-0 z-10 flex border-t border-border bg-surface transition-[left] duration-200 ${
          collapsed ? "md:left-[72px]" : "md:left-64"
        }`}
      >
        {coreItems.map((item) => {
          const active = pathname === item.href;
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={`relative flex min-h-[60px] flex-1 flex-col items-center justify-center gap-1 text-[11px] font-bold transition-colors ${
                active ? "text-accent" : "text-muted hover:text-ink"
              }`}
            >
              {active && (
                <span className="absolute inset-x-0 top-0 mx-auto h-[3px] w-10 rounded-b-full bg-accent" />
              )}
              <Icon size={19} strokeWidth={active ? 2.4 : 2} />
              {item.label}
            </Link>
          );
        })}
        <button
          onClick={() => setDrawerOpen(true)}
          className="flex min-h-[60px] flex-1 flex-col items-center justify-center gap-1 text-[11px] font-bold text-muted transition-colors hover:text-ink md:hidden"
        >
          <MoreHorizontal size={19} strokeWidth={2} />
          More
        </button>
      </nav>
    </div>
  );
}

function OnlinePill({
  online,
  queued,
  held,
  tone,
}: {
  online: boolean;
  queued: number;
  held: number;
  tone: "dark" | "light";
}) {
  const Icon = online ? Wifi : WifiOff;
  // The token greens/oranges are tuned for white surfaces; on ink they need
  // to be lifted a step to stay legible.
  const palette = online
    ? tone === "dark"
      ? "bg-success/15 text-[#4ADE80]"
      : "bg-success/10 text-success"
    : tone === "dark"
      ? "bg-warning/15 text-[#FB923C]"
      : "bg-warning/10 text-warning";

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${palette}`}
    >
      <Icon size={13} strokeWidth={2.5} />
      {online ? "Online" : "Offline"}
      {queued > 0 && ` · ${queued} queued`}
      {held > 0 && ` · ${held} held`}
    </span>
  );
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters = parts.slice(0, 2).map((part) => part[0]);
  return letters.join("").toUpperCase() || "?";
}

function SidebarContent({
  items,
  pathname,
  collapsed,
  profile,
  onToggle,
  onSignOut,
  variant,
}: {
  items: NavItem[];
  pathname: string;
  collapsed: boolean;
  profile: { name: string; email: string } | null;
  onToggle: () => void;
  onSignOut: () => void;
  variant: "sidebar" | "drawer";
}) {
  const isDrawer = variant === "drawer";
  // Same items, same order — only grouped, since the admin entries genuinely
  // are a different job from the everyday cashier flow.
  const everyday = items.filter((item) => !item.adminOnly);
  const management = items.filter((item) => item.adminOnly);

  return (
    <>
      <div
        className={`flex items-center gap-3 border-b border-white/[0.07] py-4 ${
          collapsed ? "justify-center px-0" : "px-4"
        }`}
      >
        <BrandMark size="sm" />
        {!collapsed && (
          <div className="min-w-0 flex-1">
            <p className="truncate text-[15px] font-extrabold leading-tight tracking-tight">
              Chicken Farm POS
            </p>
            <p className="truncate text-[10px] font-bold uppercase tracking-[0.16em] text-white/30">
              VSP FARM
            </p>
          </div>
        )}
        {isDrawer && (
          <button
            onClick={onToggle}
            aria-label="Close menu"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-white/50 transition-colors hover:bg-white/[0.08] hover:text-white"
          >
            <X size={18} strokeWidth={2.2} />
          </button>
        )}
      </div>

      <nav className="flex flex-1 flex-col overflow-y-auto px-3 py-4">
        <NavGroup
          label="Everyday"
          items={everyday}
          pathname={pathname}
          collapsed={collapsed}
          divided={false}
        />
        {management.length > 0 && (
          <NavGroup
            label="Management"
            items={management}
            pathname={pathname}
            collapsed={collapsed}
            divided
            className="mt-6"
          />
        )}
      </nav>

      <div className="border-t border-white/[0.07] px-3 py-3">
        {profile && (
          <div
            className={`mb-2 flex items-center gap-2.5 ${collapsed ? "justify-center" : "px-1"}`}
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/10 text-[12px] font-bold text-white ring-1 ring-inset ring-white/15">
              {initials(profile.name)}
            </span>
            {!collapsed && (
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-bold leading-tight">{profile.name}</p>
                <p className="truncate text-[11px] font-medium text-white/35">{profile.email}</p>
              </div>
            )}
          </div>
        )}

        <div className={`flex gap-1 ${collapsed ? "flex-col items-center" : "items-center"}`}>
          <button
            onClick={onSignOut}
            title={collapsed ? "Sign out" : undefined}
            className={`flex items-center rounded-xl text-sm font-semibold text-nav-idle transition-colors hover:bg-danger/15 hover:text-[#F87171] ${
              collapsed ? "h-10 w-10 justify-center" : "flex-1 gap-3 px-3 py-2.5"
            }`}
          >
            <LogOut size={18} strokeWidth={2.1} />
            {!collapsed && <span>Sign out</span>}
          </button>
          {!isDrawer && (
            <button
              onClick={onToggle}
              aria-label={collapsed ? "Expand sidebar" : "Minimize sidebar"}
              title={collapsed ? "Expand" : "Minimize"}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-white/40 transition-colors hover:bg-white/[0.08] hover:text-white"
            >
              {collapsed ? (
                <PanelLeftOpen size={18} strokeWidth={2.1} />
              ) : (
                <PanelLeftClose size={18} strokeWidth={2.1} />
              )}
            </button>
          )}
        </div>
      </div>
    </>
  );
}

function NavGroup({
  label,
  items,
  pathname,
  collapsed,
  divided,
  className = "",
}: {
  label: string;
  items: NavItem[];
  pathname: string;
  collapsed: boolean;
  divided: boolean;
  className?: string;
}) {
  return (
    <div className={className}>
      {collapsed ? (
        divided && <div className="mx-auto mb-3 h-px w-8 bg-white/10" />
      ) : (
        <p className="mb-2 px-3 text-[10px] font-bold uppercase tracking-[0.14em] text-white/30">
          {label}
        </p>
      )}
      <div className="flex flex-col gap-1">
        {items.map((item) => {
          const active = pathname === item.href;
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              title={collapsed ? item.label : undefined}
              aria-current={active ? "page" : undefined}
              className={`group relative flex items-center overflow-hidden rounded-xl text-sm font-semibold transition-colors ${
                collapsed ? "justify-center px-0 py-3" : "gap-3 px-3 py-2.5"
              } ${
                active
                  ? "bg-nav-active text-white ring-1 ring-inset ring-white/10"
                  : "text-nav-idle hover:bg-white/[0.06] hover:text-white"
              }`}
            >
              {active && (
                <span className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-[#3B82F6]" />
              )}
              <Icon
                size={18}
                strokeWidth={2.1}
                className={
                  active
                    ? "text-[#60A5FA]"
                    : "text-nav-idle transition-colors group-hover:text-white"
                }
              />
              {!collapsed && <span className="truncate">{item.label}</span>}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
