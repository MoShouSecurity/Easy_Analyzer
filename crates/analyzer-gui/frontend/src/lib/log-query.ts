import type { LogQuery, RecordSummary } from "../types";

export function logTypeLabel(category: string): string {
  return (
    (
      {
        windows_event: "Windows 事件",
        auth_text: "系统 / 认证文本",
        web_access: "Web 访问",
        web_error: "Web 错误",
        application_log: "应用 / 中间件日志",
        utmp: "当前登录",
        wtmp: "登录历史",
        btmp: "失败登录",
      } as Record<string, string>
    )[category] || category
  );
}
export function logEventId(record: RecordSummary): string {
  if (record.data.kind !== "log") return "—";
  const fields = record.data.fields.fields;
  return (
    fields.event_id ||
    Object.entries(fields).find(([key]) =>
      /(?:^|\.)EventID(?:\.#text)?$/i.test(key),
    )?.[1] ||
    "—"
  );
}

export function logDetail(record: RecordSummary): string {
  if (record.data.kind !== "log") return "—";
  const fields = record.data.fields.fields;
  return (
    fields.level ||
    (fields.status ? `HTTP ${fields.status}` : logEventId(record))
  );
}
export function localTimeInput(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}
export function queryTime(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
export function displayLogTime(value: string | null): string {
  if (!value) return "未知";
  const normalized = value.replace(/ UTC$/, "Z").replace(" ", "T");
  if (!/(?:Z|[+-]\d{2}:\d{2})$/i.test(normalized)) return "未知";
  const local = localTimeInput(normalized);
  return local ? local.replace("T", " ") : "未知";
}
export function displayRecordLogTime(record: RecordSummary): string {
  const time = displayLogTime(record.timestamp);
  if (time !== "未知" || record.data.kind !== "log") return time;
  const raw =
    record.timestamp ||
    record.data.fields.fields.time ||
    record.data.fields.fields.timestamp;
  return raw ? `${raw}（原始）` : time;
}
export function logQueryCount(query: LogQuery): number {
  return (
    [
      query.time_offset === null ? null : String(query.time_offset),
      query.log_level,
      query.client_ip,
      query.http_status,
      query.method,
      query.uri,
      query.logger,
      query.time_from,
      query.time_until,
      query.event_ids,
      query.level,
      query.provider,
      query.channel,
      query.host,
    ].filter((v) => v?.trim()).length + query.fields.length
  );
}
export function validateLogQuery(query: LogQuery): void {
  if (
    [query.log_level, query.method, query.http_status].some(
      (v) => v.trim() && !v.split(/[,，;\s]+/).filter(Boolean).length,
    )
  )
    throw new Error("列表条件至少包含一个有效值");
  if (
    query.http_status.trim() &&
    query.http_status
      .split(/[,，;\s]+/)
      .filter(Boolean)
      .some((v) => !/^\d{3}$/.test(v) || Number(v) < 100 || Number(v) > 599)
  )
    throw new Error("HTTP 状态码必须为 100 到 599 的整数，多个值用逗号分隔");
  if (
    query.event_ids.trim() &&
    query.event_ids.split(/[,，;\s]+/).filter(Boolean).length === 0
  )
    throw new Error("请至少填写一个有效事件 ID");
  if (
    query.time_from &&
    query.time_until &&
    new Date(query.time_until) < new Date(query.time_from)
  )
    throw new Error("查询结束时间不能早于开始时间");
  if (
    query.event_ids.trim() &&
    query.event_ids
      .split(/[,，;\s]+/)
      .filter(Boolean)
      .some((v) => !/^\d+$/.test(v) || Number(v) > 65535)
  )
    throw new Error("事件 ID 必须为 0 到 65535 的整数，多个 ID 用逗号分隔");
  if (query.fields.some((f) => !f.field.trim() || !f.value.trim()))
    throw new Error("自定义条件须同时填写字段名和字段值");
}
