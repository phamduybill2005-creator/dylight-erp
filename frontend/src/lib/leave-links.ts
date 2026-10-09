/** Only select a record. Query parameters never authorize or decide a leave. */
export function linkedLeaveId(search: string): number | null {
  const ids = new URLSearchParams(search).getAll("request_id");
  if (ids.length !== 1 || !/^[1-9]\d*$/.test(ids[0])) return null;
  const id = Number(ids[0]);
  return Number.isSafeInteger(id) ? id : null;
}

export function leaveLoginPath(pathname: string, search: string): string {
  const id = pathname === "/leave" ? linkedLeaveId(search) : null;
  return id === null ? "/login" : `/login?next=${encodeURIComponent(`/leave?request_id=${id}`)}`;
}

export function leaveLoginReturnPath(search: string): string {
  const values = new URLSearchParams(search).getAll("next");
  if (values.length !== 1 || !/^\/leave\?request_id=[1-9]\d*$/.test(values[0])) return "/";
  const id = linkedLeaveId(values[0].slice("/leave".length));
  return id === null ? "/" : `/leave?request_id=${id}`;
}

export function canDecideLinkedLeave(role: string, status: string): boolean {
  return status === "PENDING" && ["ADMIN", "DIRECTOR", "MANAGER"].includes(role);
}
