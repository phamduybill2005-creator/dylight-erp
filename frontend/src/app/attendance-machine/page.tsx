"use client";

// Trang "Máy chấm công" — cổng tích hợp hệ thống chấm công khuôn mặt (Yunatt) vào ERP:
//  - Mở thẳng cổng Yunatt từ trong web công ty.
//  - ĐỒNG BỘ TỰ ĐỘNG: backend đăng nhập Yunatt (Playwright) mỗi ngày 20:00, kéo lượt
//    quẹt về bảng Attendance (hiện ở tổng hợp của sếp & cá nhân từng người). Có nút
//    "Đồng bộ ngay" và bảng ghép nhân viên Yunatt ↔ ERP.
//  - Lối tắt nhập tay từ file CSV (dự phòng).

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  FingerPrintIcon,
  ArrowTopRightOnSquareIcon,
  ArrowUpTrayIcon,
  InformationCircleIcon,
  ArrowPathIcon,
  LinkIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
} from "@heroicons/react/24/outline";
import AppShell from "@/components/app-shell";
import { api } from "@/lib/api";
import { roleTier } from "@/lib/roles";
import type { User, YunattSyncResult, YunattPerson, YunattSyncStatus } from "@/lib/types";

const YUNATT_URL = "https://global.yunatt.com";

// "2026-06-27T20:00:13" -> "20:00 27/06/2026"
function fmtDateTime(iso?: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString("vi-VN", {
    hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit", year: "numeric",
  });
}

export default function AttendanceMachinePage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);

  // Đồng bộ Yunatt
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<YunattSyncResult | null>(null);
  const [syncMsg, setSyncMsg] = useState("");
  const [status, setStatus] = useState<YunattSyncStatus | null>(null);

  // Ghép nhân viên Yunatt ↔ ERP
  const [persons, setPersons] = useState<YunattPerson[] | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [loadingPersons, setLoadingPersons] = useState(false);
  const [mapMsg, setMapMsg] = useState("");

  useEffect(() => {
    api.me()
      .then((u) => {
        setUser(u);
        // Quản lý trở lên: tải trạng thái lần đồng bộ gần nhất (theo dõi job 20:00).
        if (roleTier(u.role) !== "STAFF") {
          api.yunattStatus().then(setStatus).catch(() => {});
        }
      })
      .catch(() => router.push("/login"));
  }, [router]);

  async function doSync() {
    setSyncing(true);
    setSyncMsg("");
    try {
      const res = await api.syncYunatt();
      setSyncResult(res);
      api.yunattStatus().then(setStatus).catch(() => {});
      setSyncMsg(
        `✓ Đã đồng bộ ${res.days_updated} ngày công (khớp ${res.matched}/${res.rows} lượt quẹt, tháng ${res.months.join(", ")}).` +
          (res.days_no_checkout ? ` · ${res.days_no_checkout} ngày chỉ có 1 mốc.` : "") +
          (res.unmatched.length ? ` · ${res.unmatched.length} người CHƯA map — xem bên dưới.` : "")
      );
    } catch (e: unknown) {
      setSyncMsg(e instanceof Error ? e.message : "Đồng bộ thất bại.");
      api.yunattStatus().then(setStatus).catch(() => {});  // lỗi đã được ghi nhật ký ở server
    } finally {
      setSyncing(false);
    }
  }

  async function loadPersons() {
    setLoadingPersons(true);
    setMapMsg("");
    try {
      const [ps, us] = await Promise.all([api.yunattPersons(), api.users()]);
      setPersons(ps);
      setUsers(us);
    } catch (e: unknown) {
      setMapMsg(e instanceof Error ? e.message : "Không tải được danh sách từ Yunatt.");
    } finally {
      setLoadingPersons(false);
    }
  }

  async function mapPerson(staffNumber: string, userId: number) {
    setMapMsg("");
    try {
      await api.updateUser(userId, { yunatt_code: staffNumber });
      const u = users.find((x) => x.id === userId) || null;
      setPersons((prev) =>
        prev
          ? prev.map((p) =>
              p.staff_number === staffNumber
                ? { ...p, user_id: userId, user_name: u?.full_name ?? null }
                : p
            )
          : prev
      );
      setMapMsg("✓ Đã lưu ghép nhân viên. Lần đồng bộ tới sẽ tự khớp người này.");
    } catch (e: unknown) {
      setMapMsg(e instanceof Error ? e.message : "Lưu ghép thất bại.");
    }
  }

  if (!user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-paper">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-steel border-t-amber" />
      </div>
    );
  }

  const tier = roleTier(user.role);
  const isStaff = tier === "STAFF";
  const isDirector = tier === "DIRECTOR";

  return (
    <AppShell>
      <header className="flex items-center gap-2 rounded-xl2 bg-ink p-4 text-white shadow-card lg:p-6">
        <FingerPrintIcon className="h-5 w-5 text-amber lg:h-6 lg:w-6" />
        <h1 className="text-base font-bold lg:text-xl">Máy chấm công</h1>
      </header>

      {/* Cổng tới hệ thống Yunatt */}
      <section className="mt-4 rounded-xl2 bg-white p-5 shadow-card lg:p-6">
        <div className="flex items-start gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl2 bg-steel/10 text-steel">
            <FingerPrintIcon className="h-6 w-6" />
          </span>
          <div className="min-w-0">
            <h2 className="text-sm font-bold text-ink lg:text-base">Hệ thống chấm công khuôn mặt (Yunatt)</h2>
            <p className="mt-1 text-xs text-muted">
              Thiết bị <b className="text-ink">DOSCO</b> · nhận diện khuôn mặt AI. Quản lý nhân viên, khuôn mặt và xem
              dữ liệu quẹt trên cổng Yunatt. <span className="text-muted">(Đăng nhập riêng bằng tài khoản Yunatt.)</span>
            </p>
          </div>
        </div>
        <a
          href={YUNATT_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-4 inline-flex items-center gap-2 rounded-xl2 bg-ink px-4 py-2.5 text-sm font-semibold text-white hover:bg-steel"
        >
          <ArrowTopRightOnSquareIcon className="h-5 w-5" /> Mở hệ thống chấm công Yunatt
        </a>
      </section>

      {/* ĐỒNG BỘ TỰ ĐỘNG (Quản lý trở lên) */}
      {!isStaff && (
        <section className="mt-4 rounded-xl2 bg-white p-5 shadow-card lg:p-6">
          <div className="flex items-start gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl2 bg-ok/15 text-ok">
              <ArrowPathIcon className="h-6 w-6" />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="text-sm font-bold text-ink lg:text-base">Đồng bộ tự động (Yunatt → ERP)</h2>
              <p className="mt-1 text-xs text-muted">
                Hệ thống <b className="text-ink">tự lấy chấm công mỗi ngày lúc 20:00</b> và ghi vào ERP — hiện ở tổng hợp
                của Ban Giám đốc và trang cá nhân của từng nhân viên. Bấm nút dưới để đồng bộ ngay (lấy tháng này + tháng trước).
              </p>
            </div>
          </div>
          <button
            onClick={doSync}
            disabled={syncing}
            className="mt-4 inline-flex items-center gap-2 rounded-xl2 bg-ok px-4 py-2.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
          >
            <ArrowPathIcon className={`h-5 w-5 ${syncing ? "animate-spin" : ""}`} />
            {syncing ? "Đang đồng bộ… (có thể mất ~30 giây)" : "Đồng bộ ngay"}
          </button>

          {/* Trạng thái lần đồng bộ GẦN NHẤT — cho biết job 20:00 có chạy/đúng không */}
          {status ? (
            <div
              className={`mt-3 rounded-lg border p-3 text-[11px] ${
                status.ok ? "border-ok/40 bg-ok/5" : "border-bad/40 bg-bad/5"
              }`}
            >
              <p className="flex items-center gap-1.5 font-semibold text-ink">
                {status.ok ? (
                  <CheckCircleIcon className="h-4 w-4 shrink-0 text-ok" />
                ) : (
                  <ExclamationTriangleIcon className="h-4 w-4 shrink-0 text-bad" />
                )}
                Lần đồng bộ gần nhất: {fmtDateTime(status.ran_at)}
                <span className="font-normal text-muted">
                  ({status.trigger === "auto" ? "tự động 20:00" : "bấm tay"})
                </span>
              </p>
              {status.ok ? (
                <p className="mt-1 text-muted">
                  ✓ {status.days_updated} ngày công · khớp {status.matched}/{status.rows} lượt quẹt
                  {status.months ? ` · tháng ${status.months}` : ""}
                  {status.unmatched_count
                    ? ` · ${status.unmatched_count} người chưa ghép`
                    : ""}
                </p>
              ) : (
                <p className="mt-1 text-bad">✗ Lỗi: {status.message || "không rõ nguyên nhân"}</p>
              )}
            </div>
          ) : (
            <p className="mt-3 text-[11px] text-muted">Chưa có lần đồng bộ nào được ghi nhận.</p>
          )}

          {syncMsg && (
            <p className="mt-3 flex items-start gap-1.5 text-[12px] font-medium text-ink">
              {syncResult ? (
                <CheckCircleIcon className="mt-0.5 h-4 w-4 shrink-0 text-ok" />
              ) : (
                <ExclamationTriangleIcon className="mt-0.5 h-4 w-4 shrink-0 text-bad" />
              )}
              <span>{syncMsg}</span>
            </p>
          )}

          {syncResult && syncResult.unmatched.length > 0 && (
            <div className="mt-3 rounded-lg border border-amber/40 bg-amber/10 p-3 text-[11px] text-ink">
              <p className="font-semibold text-amber-deep">
                {syncResult.unmatched.length} người trên Yunatt chưa ghép với nhân viên ERP (dữ liệu của họ bị bỏ qua):
              </p>
              <p className="mt-1 text-muted">
                {syncResult.unmatched.map((u) => `${u.staff_number}${u.staff_name ? ` (${u.staff_name})` : ""}`).join(", ")}
              </p>
              {isDirector && <p className="mt-1 text-steel">→ Dùng bảng &quot;Ghép nhân viên&quot; bên dưới để map, rồi đồng bộ lại.</p>}
            </div>
          )}
        </section>
      )}

      {/* GHÉP NHÂN VIÊN Yunatt ↔ ERP (chỉ Giám đốc/Quản trị — vì cần quyền sửa hồ sơ) */}
      {isDirector && (
        <section className="mt-4 rounded-xl2 bg-white p-5 shadow-card lg:p-6">
          <div className="flex items-start gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl2 bg-steel/10 text-steel">
              <LinkIcon className="h-6 w-6" />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="text-sm font-bold text-ink lg:text-base">Ghép nhân viên Yunatt ↔ ERP</h2>
              <p className="mt-1 text-xs text-muted">
                Máy Yunatt nhận diện theo <b className="text-ink">mã nhân viên</b> (vd 01, 02…). Ghép mỗi mã với đúng người
                trong ERP để đồng bộ tự khớp. Chỉ cần làm <b className="text-ink">một lần</b>.
              </p>
            </div>
          </div>
          <button
            onClick={loadPersons}
            disabled={loadingPersons}
            className="mt-4 inline-flex items-center gap-2 rounded-xl2 border border-line px-4 py-2 text-xs font-semibold text-ink hover:bg-paper disabled:opacity-50"
          >
            <ArrowPathIcon className={`h-4 w-4 ${loadingPersons ? "animate-spin" : ""}`} />
            {loadingPersons ? "Đang tải từ Yunatt…" : persons ? "Tải lại danh sách" : "Tải danh sách người từ Yunatt"}
          </button>

          {mapMsg && <p className="mt-2 text-[11px] font-medium text-ink">{mapMsg}</p>}

          {persons && persons.length > 0 && (
            <div className="mt-3 overflow-hidden rounded-lg border border-line">
              <table className="w-full text-left text-xs">
                <thead className="bg-paper text-[11px] text-muted">
                  <tr>
                    <th className="px-3 py-2 font-semibold">Mã Yunatt</th>
                    <th className="px-3 py-2 font-semibold">Tên trên máy</th>
                    <th className="px-3 py-2 font-semibold">Nhân viên ERP</th>
                  </tr>
                </thead>
                <tbody>
                  {persons.map((p) => (
                    <tr key={p.staff_number} className="border-t border-line">
                      <td className="px-3 py-2 font-mono font-semibold text-ink">{p.staff_number}</td>
                      <td className="px-3 py-2 text-muted">{p.staff_name || "—"}</td>
                      <td className="px-3 py-2">
                        <select
                          value={p.user_id ?? ""}
                          onChange={(e) => e.target.value && mapPerson(p.staff_number, Number(e.target.value))}
                          className={`w-full rounded-lg border px-2 py-1.5 text-xs outline-none focus:border-steel ${
                            p.user_id ? "border-ok/50 bg-ok/5" : "border-line bg-white"
                          }`}
                        >
                          <option value="">— Chưa ghép —</option>
                          {users.map((u) => (
                            <option key={u.id} value={u.id}>
                              {u.full_name}
                            </option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {persons && persons.length === 0 && (
            <p className="mt-3 text-[11px] text-muted">Không lấy được người nào từ Yunatt (kiểm tra cấu hình đăng nhập).</p>
          )}
        </section>
      )}

      {/* Nhập tay từ file (dự phòng) */}
      {!isStaff && (
        <section className="mt-4 rounded-xl2 bg-white p-5 shadow-card lg:p-6">
          <div className="flex items-start gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl2 bg-amber/15 text-amber-deep">
              <ArrowUpTrayIcon className="h-6 w-6" />
            </span>
            <div className="min-w-0">
              <h2 className="text-sm font-bold text-ink lg:text-base">Nhập tay từ file (dự phòng)</h2>
              <p className="mt-1 text-xs text-muted">
                Khi cần nhập thủ công: trên Yunatt vào <b className="text-ink">Quản lý điểm danh</b> → xuất Excel/CSV → tải lên ERP.
                Hệ thống tự ghép theo CCCD/mã nhân viên và tính ngày công, giờ làm.
              </p>
            </div>
          </div>
          <Link
            href="/attendance"
            className="mt-4 inline-flex items-center gap-2 rounded-xl2 bg-amber px-4 py-2.5 text-sm font-semibold text-ink hover:opacity-90"
          >
            <ArrowUpTrayIcon className="h-5 w-5" /> Nhập chấm công từ file
          </Link>
        </section>
      )}

      {/* Ghi chú */}
      {!isStaff && (
        <section className="mt-4 flex items-start gap-2 rounded-xl2 border border-line bg-white p-4 text-[11px] text-muted shadow-card">
          <InformationCircleIcon className="h-4 w-4 shrink-0 text-steel" />
          <p>
            Đồng bộ tự động cần backend chạy liên tục trên server (vd <b className="text-ink">erp.dosco.vn</b>) và đã bật
            cấu hình Yunatt. Nếu &quot;Đồng bộ ngay&quot; báo lỗi, kiểm tra tài khoản/mật khẩu Yunatt trong cấu hình server.
          </p>
        </section>
      )}
    </AppShell>
  );
}
