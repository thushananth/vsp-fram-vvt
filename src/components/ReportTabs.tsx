"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const REPORTS = [
  { href: "/report", label: "Sales" },
  { href: "/report/customers", label: "Customers" },
  { href: "/report/customer", label: "One customer" },
];

/** Switches between the reports under Report — same pill style as the range picker. */
export default function ReportTabs() {
  const pathname = usePathname();
  return (
    <div className="mb-3 flex gap-1.5 rounded-xl bg-[#e9edf4] p-1">
      {REPORTS.map((r) => (
        <Link
          key={r.href}
          href={r.href}
          className={`flex min-h-[40px] flex-1 items-center justify-center rounded-lg px-2 text-[13px] font-bold ${
            pathname === r.href ? "bg-white shadow-sm" : "text-muted"
          }`}
        >
          {r.label}
        </Link>
      ))}
    </div>
  );
}
