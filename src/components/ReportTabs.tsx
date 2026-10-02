"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCan } from "@/lib/firestore/permissions";

const REPORTS = [
  { href: "/report", label: "Sales", customer: false },
  { href: "/report/customers", label: "Customers", customer: true },
  { href: "/report/customer", label: "One customer", customer: true },
];

/** Switches between the reports under Report — same pill style as the range picker. */
export default function ReportTabs() {
  const pathname = usePathname();
  const { can } = useCan();
  const tabs = REPORTS.filter((r) => !r.customer || can("customerReports"));
  if (tabs.length < 2) return null;
  return (
    <div className="mb-3 flex gap-1.5 rounded-xl bg-[#e9edf4] p-1">
      {tabs.map((r) => (
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
