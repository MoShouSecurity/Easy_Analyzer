import { useState, useRef } from "react";
import { Plus, X, LoaderCircle } from "lucide-react";
import { Dialog } from "./ui/dialog";
import { Select } from "./ui/select";
import { Button } from "./ui/button";
import { localTimeInput, queryTime, validateLogQuery } from "../lib/log-query";
import { defaultLogQuery, type LogQuery as Query } from "../types";

export function LogQueryFields({
  value,
  onChange,
  disabled = false,
}: {
  value: Query;
  onChange: (v: Query) => void;
  disabled?: boolean;
}) {
  const change = (patch: Partial<Query>) => onChange({ ...value, ...patch });
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return (
    <div className="log-query-fields">
      <div className="log-query-grid">
        {(
          [
            ["time_from", "开始时间（本地）"],
            ["time_until", "结束时间（本地）"],
          ] as const
        ).map(([key, label]) => (
          <label key={key} className="form-field">
            {label}
            <input
              className="input"
              type="datetime-local"
              step="1"
              aria-label={label}
              value={localTimeInput(value[key])}
              disabled={disabled}
              onInput={(e) =>
                change({ [key]: queryTime(e.currentTarget.value) })
              }
              onChange={(e) => change({ [key]: queryTime(e.target.value) })}
            />
          </label>
        ))}
        {(
          [
            ["log_level", "日志级别", "例如：ERROR, WARN, SEVERE"],
            ["client_ip", "客户端 IP", "完整地址，例如：192.0.2.10"],
            ["http_status", "HTTP 状态码", "例如：403, 404, 500"],
            ["method", "请求方法", "例如：GET, POST"],
            ["uri", "请求路径", "包含，例如：/api/ 或 .jsp"],
            ["logger", "日志类 / Logger", "包含，例如：org.apache.catalina"],
            ["host", "主机 / 计算机", "包含主机名称"],
          ] as const
        ).map(([key, label, placeholder]) => (
          <label key={key} className="form-field">
            {label}
            <input
              className="input"
              aria-label={label}
              value={value[key]}
              disabled={disabled}
              placeholder={placeholder}
              onChange={(e) => change({ [key]: e.target.value })}
            />
          </label>
        ))}
        <label className="form-field">
          无时区日志的时区
          <Select
            label="无时区日志的时区"
            value={value.time_offset === null ? "" : String(value.time_offset)}
            disabled={disabled}
            onChange={(v) =>
              change({ time_offset: v === "" ? null : Number(v) })
            }
            options={[
              { value: "", label: "未指定（时间未知）" },
              ...Array.from(
                new Set([
                  0,
                  -new Date().getTimezoneOffset(),
                  ...(value.time_offset === null ? [] : [value.time_offset]),
                  ...Array.from({ length: 113 }, (_, i) => (i - 56) * 15),
                ]),
              )
                .sort((a, b) => a - b)
                .map((minutes) => ({
                  value: String(minutes),
                  label: `UTC${minutes < 0 ? "-" : "+"}${String(Math.floor(Math.abs(minutes) / 60)).padStart(2, "0")}:${String(Math.abs(minutes) % 60).padStart(2, "0")}${minutes === -new Date().getTimezoneOffset() ? "（本机）" : ""}`,
                })),
            ]}
          />
        </label>
      </div>
      <p className="log-query-hint">
        查询边界使用本机时区 {timezone}，包含起止时刻。Nginx/Tomcat
        等日志未注明时区时，请按证据来源选择时区；原始时间不变，缺少年份的时间仍为未知。日志级别、状态码、请求方法可用逗号分隔，列表内匹配任一值，各条件同时满足。客户端
        IP 等于匹配，路径、Logger、主机包含匹配。
      </p>
      <details className="log-query-windows">
        <summary>Windows 事件专用条件</summary>
        <div className="log-query-grid">
          <label className="form-field">
            Windows 事件 ID
            <input
              className="input"
              aria-label="Windows 事件 ID"
              value={value.event_ids}
              disabled={disabled}
              placeholder="例如：4624, 4625, 4688"
              onChange={(e) => change({ event_ids: e.target.value })}
            />
          </label>
          <label className="form-field">
            Windows 事件级别
            <Select
              label="Windows 事件级别"
              value={value.level || ""}
              disabled={disabled}
              onChange={(v) => change({ level: v || null })}
              options={[
                { value: "", label: "全部级别" },
                ...[
                  "未指定 / 审核事件 (0)",
                  "严重 (1)",
                  "错误 (2)",
                  "警告 (3)",
                  "信息 (4)",
                  "详细 (5)",
                ].map((label, i) => ({ value: String(i), label })),
              ]}
            />
          </label>
          {(
            [
              [
                "provider",
                "事件提供程序",
                "例如：Microsoft-Windows-Security-Auditing",
              ],
              ["channel", "日志通道", "例如：Security / System"],
            ] as const
          ).map(([key, label, placeholder]) => (
            <label key={key} className="form-field">
              {label}
              <input
                className="input"
                aria-label={label}
                value={value[key]}
                disabled={disabled}
                placeholder={placeholder}
                onChange={(e) => change({ [key]: e.target.value })}
              />
            </label>
          ))}
        </div>
      </details>
      <div className="log-query-custom-heading">
        <strong>自定义字段条件</strong>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={disabled || value.fields.length >= 16}
          onClick={() =>
            change({
              fields: [
                ...value.fields,
                { field: "", value: "", mode: "contains" },
              ],
            })
          }
        >
          <Plus size={14} />
          添加条件
        </Button>
      </div>
      <p className="log-query-hint">
        可查询 thread、duration、user、action
        等详情中的字段名，也支持原始字段路径。字段名和值均不区分大小写，多个条件同时满足。
      </p>
      {value.fields.map((field, index) => (
        <div className="log-query-custom-row" key={index}>
          <input
            className="input"
            aria-label={`查询字段 ${index + 1}`}
            placeholder="字段名"
            value={field.field}
            disabled={disabled}
            onChange={(e) =>
              change({
                fields: value.fields.map((f, i) =>
                  i === index ? { ...f, field: e.target.value } : f,
                ),
              })
            }
          />
          <Select
            label={`字段匹配方式 ${index + 1}`}
            value={field.mode}
            disabled={disabled}
            options={[
              { value: "contains", label: "包含" },
              { value: "equals", label: "等于" },
            ]}
            onChange={(mode) =>
              change({
                fields: value.fields.map((f, i) =>
                  i === index
                    ? { ...f, mode: mode as "contains" | "equals" }
                    : f,
                ),
              })
            }
          />
          <input
            className="input"
            aria-label={`查询字段值 ${index + 1}`}
            placeholder="字段值"
            value={field.value}
            disabled={disabled}
            onChange={(e) =>
              change({
                fields: value.fields.map((f, i) =>
                  i === index ? { ...f, value: e.target.value } : f,
                ),
              })
            }
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={`移除字段条件 ${index + 1}`}
            disabled={disabled}
            onClick={() =>
              change({ fields: value.fields.filter((_, i) => i !== index) })
            }
          >
            <X size={14} />
          </Button>
        </div>
      ))}
    </div>
  );
}
export function LogQueryDialog({
  initial,
  busy,
  onApply,
  onClose,
}: {
  initial: Query;
  busy: boolean;
  onApply: (v: Query) => Promise<void>;
  onClose: () => void;
}) {
  const [value, setValue] = useState(() => structuredClone(initial));
  const [error, setError] = useState("");
  const [composing, setComposing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const pending = useRef(false);
  const locked = busy || submitting;
  return (
    <Dialog
      open
      title="日志多维查询"
      description="在完整日志集合中组合查询，不受当前页限制。"
      className="log-query-dialog"
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <form
        onCompositionStart={() => setComposing(true)}
        onCompositionEnd={() => setComposing(false)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (composing || e.nativeEvent.isComposing))
            e.preventDefault();
        }}
        onSubmit={async (e) => {
          e.preventDefault();
          if (locked || composing || pending.current) return;
          setError("");
          try {
            validateLogQuery(value);
            pending.current = true;
            setSubmitting(true);
            await onApply(value);
          } catch (e) {
            setError(String(e));
          } finally {
            pending.current = false;
            setSubmitting(false);
          }
        }}
      >
        <div className="log-query-body">
          <LogQueryFields value={value} onChange={setValue} disabled={locked} />
        </div>
        {error && (
          <div role="alert" className="warning-note">
            {error}。保留上一次有效查询。
          </div>
        )}
        <div className="dialog-actions">
          <Button
            type="button"
            variant="ghost"
            disabled={locked}
            onClick={() => setValue(defaultLogQuery())}
          >
            清空条件
          </Button>
          <Button type="button" variant="ghost" onClick={onClose}>
            {locked ? "取消查询" : "取消"}
          </Button>
          <Button type="submit" disabled={locked}>
            {locked && <LoaderCircle size={14} className="spin" />}
            {locked ? "正在查询…" : "应用查询"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
