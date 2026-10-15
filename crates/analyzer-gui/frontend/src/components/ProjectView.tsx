import { useState, useEffect, useRef } from "react";
import { LoaderCircle, Pencil } from "lucide-react";
import { api } from "../lib/api";
import type { ProjectEntry, ProjectInfo, ProjectStatus } from "../types";
import { Button } from "./ui/button";
import { Pagination } from "./Pagination";
import { Dialog } from "./ui/dialog";
export function localTimestamp() {
  const now = new Date();
  const offset = -now.getTimezoneOffset();
  const sign = offset >= 0 ? "+" : "-";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}${sign}${pad(Math.floor(Math.abs(offset) / 60))}:${pad(Math.abs(offset) % 60)}`;
}
export function newProject(): ProjectInfo {
  const time = localTimestamp();
  return {
    id: crypto.randomUUID(),
    name: "",
    client: "",
    response_start: time,
    response_end: null,
    location: "",
    responders: "",
    description: "",
    created_at: time,
    updated_at: time,
  };
}
export function ProjectEditor({
  info,
  mode = "create",
  busy,
  onClose,
  onSave,
}: {
  info: ProjectInfo;
  mode?: "create" | "edit";
  busy: boolean;
  onClose: () => void;
  onSave: (v: ProjectInfo) => Promise<void>;
}) {
  const [value, setValue] = useState(info);
  const [nameEdited, setNameEdited] = useState(Boolean(info.name.trim()));
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const pending = useRef(false);
  const locked = busy || submitting;
  const validTime = (text: string) =>
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/i.test(
      text,
    ) && !Number.isNaN(Date.parse(text));
  const fields: [keyof ProjectInfo, string, boolean][] = [
    ["client", "客户单位", true],
    ["name", "项目名称", false],
    ["response_start", "响应开始时间（含时区）", true],
    ["response_end", "响应结束时间（含时区）", false],
    ["location", "响应地点", false],
    ["responders", "服务人员", false],
  ];
  const submit = async () => {
    if (busy || pending.current) return;
    const name = value.name.trim() || value.client.trim();
    const start = value.response_start.trim();
    const end = value.response_end?.trim() || null;
    if (!value.client.trim()) {
      setError("请填写客户单位");
      return;
    }
    if (!validTime(start)) {
      setError("响应开始时间必须包含日期、时间和时区");
      return;
    }
    if (end && !validTime(end)) {
      setError("响应结束时间必须包含日期、时间和时区");
      return;
    }
    if (end && Date.parse(end) < Date.parse(start)) {
      setError("响应结束时间不能早于开始时间");
      return;
    }
    setError("");
    pending.current = true;
    setSubmitting(true);
    try {
      await onSave({
        ...value,
        name,
        client: value.client.trim(),
        response_start: start,
        response_end: end,
      });
    } catch (e) {
      setError(String(e));
    } finally {
      pending.current = false;
      setSubmitting(false);
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(v) => {
        if (!v && !locked) onClose();
      }}
      title={mode === "edit" ? "编辑项目资料" : "新建应急响应项目"}
      className="project-editor-dialog"
      description={
        mode === "edit"
          ? "修改项目资料，应用后点击顶部“保存”写入项目文件。"
          : "同一次响应可以持续多天，并追加多次证据。"
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        className="project-form"
      >
        {fields.map(([key, label, required]) => (
          <label key={key}>
            {label}
            {required ? " *" : ""}
            <input
              disabled={locked}
              required={required}
              value={value[key] ?? ""}
              placeholder={
                key === "name"
                  ? "默认使用客户单位，可修改"
                  : key.includes("response_")
                    ? "2026-10-05T09:00:00+08:00"
                    : ""
              }
              onChange={(e) => {
                const next = e.target.value;
                if (key === "name") setNameEdited(Boolean(next.trim()));
                setValue((v) => ({
                  ...v,
                  [key]: next || (key === "response_end" ? null : ""),
                  ...(key === "client" && !nameEdited ? { name: next } : {}),
                }));
              }}
            />
          </label>
        ))}
        <label className="full">
          项目说明
          <textarea
            disabled={locked}
            value={value.description}
            onChange={(e) =>
              setValue((v) => ({ ...v, description: e.target.value }))
            }
          />
        </label>
        {error && (
          <p role="alert" className="error-text full">
            {error}
          </p>
        )}
        <div className="dialog-actions full">
          <Button
            variant="ghost"
            type="button"
            onClick={onClose}
            disabled={locked}
          >
            取消
          </Button>
          <Button type="submit" disabled={locked}>
            {submitting && <LoaderCircle size={14} className="spin" />}
            {submitting
              ? "正在应用…"
              : mode === "edit"
                ? "应用修改"
                : "确认项目资料"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
export function ProjectHome({
  busy,
  current = null,
  onEdit,
  onNew,
  onOpen,
  onPick,
  onError,
}: {
  busy: boolean;
  current?: ProjectStatus | null;
  onEdit?: () => void;
  onNew: () => void;
  onOpen: (path: string) => void;
  onPick: () => void;
  onError: (e: string) => void;
}) {
  const projectScroll = useRef<HTMLDivElement>(null);
  const browserPanel = useRef<HTMLElement>(null);
  const shownPage = useRef("0:50");
  const [text, setText] = useState("");
  const [client, setClient] = useState("");
  const [from, setFrom] = useState("");
  const [until, setUntil] = useState("");
  const [rows, setRows] = useState<ProjectEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [offset, setOffset] = useState(0);
  const [shownOffset, setShownOffset] = useState(0);
  const [limit, setLimit] = useState(50);
  const [total, setTotal] = useState(0);
  const [refresh, setRefresh] = useState(0);
  const [removal, setRemoval] = useState<ProjectEntry | null>(null);
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState("");
  const lastSearch = useRef(JSON.stringify(["", "", "", ""]));
  useEffect(() => {
    let stale = false;
    const key = JSON.stringify([text, client, from, until]);
    const delay = key === lastSearch.current ? 0 : 200;
    setLoading(true);
    const timeout = setTimeout(() => {
      lastSearch.current = key;
      api
        .projectsPage(
          { text, client, from: from || null, until: until || null },
          offset,
          limit,
        )
        .then((v) => {
          if (!stale) {
            setRows(v?.items ?? []);
            setTotal(v?.total ?? 0);
            setShownOffset(v?.offset ?? 0);
            const pageKey = `${v?.offset ?? 0}:${limit}`;
            if (pageKey !== shownPage.current) {
              shownPage.current = pageKey;
              requestAnimationFrame(() => {
                const root = projectScroll.current;
                const panel = browserPanel.current;
                if (root && panel)
                  root.scrollTop +=
                    panel.getBoundingClientRect().top -
                    root.getBoundingClientRect().top;
              });
            }
            if (v && v.offset !== offset) setOffset(v.offset);
          }
        })
        .catch((e) => {
          if (!stale) onError(String(e));
        })
        .finally(() => {
          if (!stale) setLoading(false);
        });
    }, delay);
    return () => {
      stale = true;
      clearTimeout(timeout);
    };
  }, [
    offset,
    limit,
    text,
    client,
    from,
    until,
    refresh,
    current?.info.id,
    current?.path,
    current?.dirty,
  ]);
  const remove = async () => {
    if (!removal || busy || removing) return;
    setRemoving(true);
    setRemoveError("");
    try {
      await api.removeProject(removal.info.id, removal.path);
      setRows((v) => v.filter((row) => row.info.id !== removal.info.id));
      setRemoval(null);
      setRefresh((v) => v + 1);
    } catch (e) {
      setRemoveError(String(e));
      setRefresh((v) => v + 1);
    } finally {
      setRemoving(false);
    }
  };
  return (
    <div className="project-page" ref={projectScroll}>
      {current && (
        <section
          className="project-current"
          aria-labelledby="project-current-title"
        >
          <div className="project-current-heading">
            <div>
              <h3 id="project-current-title">当前项目资料</h3>
              <p>{current.dirty ? "有未保存的修改" : "已保存"}</p>
            </div>
            <Button
              variant="secondary"
              disabled={busy || removing || !onEdit}
              onClick={onEdit}
            >
              <Pencil size={14} />
              编辑项目资料
            </Button>
          </div>
          <dl className="project-current-fields">
            {(
              [
                ["项目名称", current.info.name],
                ["客户单位", current.info.client],
                ["响应开始时间", current.info.response_start],
                ["响应结束时间", current.info.response_end],
                ["响应地点", current.info.location],
                ["服务人员", current.info.responders],
                ["项目说明", current.info.description],
              ] as const
            ).map(([label, text]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{text || "未填写"}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}
      <section className="project-start" aria-labelledby="project-start-title">
        <div>
          <h3 id="project-start-title">新建或续办应急响应</h3>
          <p>点击“新建项目”填写客户单位、响应时间等资料。</p>
        </div>
        <div className="project-actions">
          <Button disabled={busy || removing} onClick={onNew}>
            新建项目
          </Button>
          <Button
            variant="secondary"
            disabled={busy || removing}
            onClick={onPick}
          >
            打开项目文件
          </Button>
        </div>
      </section>
      <section
        ref={browserPanel}
        className="project-browser"
        aria-labelledby="project-list-title"
      >
        <div className="project-list-heading">
          <h3 id="project-list-title">已有项目</h3>
          <p>按最近打开排序 · {loading ? "正在查询…" : `${total} 个项目`}</p>
        </div>
        <details className="project-filters">
          <summary>筛选已有项目</summary>
          <p>以下条件用于查找项目列表。</p>
          <div className="project-search">
            <label>
              搜索项目名称或客户单位
              <input
                aria-label="项目搜索"
                placeholder="输入关键词查找已有项目"
                value={text}
                onChange={(e) => {
                  setText(e.target.value);
                  setOffset(0);
                }}
              />
            </label>
            <label>
              按客户单位筛选
              <input
                value={client}
                placeholder="全部客户单位"
                onChange={(e) => {
                  setClient(e.target.value);
                  setOffset(0);
                }}
              />
            </label>
            <label>
              响应开始日期不早于
              <input
                type="date"
                value={from}
                onChange={(e) => {
                  setFrom(e.target.value);
                  setOffset(0);
                }}
              />
            </label>
            <label>
              响应开始日期不晚于
              <input
                type="date"
                value={until}
                onChange={(e) => {
                  setUntil(e.target.value);
                  setOffset(0);
                }}
              />
            </label>
          </div>
        </details>
        <div className="project-list">
          {rows.map((row) => (
            <article key={row.info.id}>
              <div>
                <h3>{row.info.name}</h3>
                <p>
                  {row.info.client} · {row.info.response_start}
                </p>
                <small>{row.path}</small>
                {row.missing && (
                  <p className="error-text">
                    项目文件缺失，请重新打开移动后的文件
                  </p>
                )}
              </div>
              <div className="project-entry-actions">
                <Button
                  variant="secondary"
                  disabled={busy || removing || row.missing}
                  onClick={() => onOpen(row.path)}
                >
                  继续项目
                </Button>
                <Button
                  variant="ghost"
                  className="project-remove"
                  disabled={busy || removing}
                  aria-label={`从列表移除 ${row.info.name}`}
                  onClick={() => {
                    setRemoveError("");
                    setRemoval(row);
                  }}
                >
                  移除
                </Button>
              </div>
            </article>
          ))}
          {!rows.length && !loading && (
            <p>
              {text.trim() || client.trim() || from || until
                ? "没有符合筛选条件的项目，请调整筛选条件。"
                : "项目列表为空。点击上方“新建项目”开始响应，或打开已有 .eair 文件。"}
            </p>
          )}
        </div>
        <Pagination
          label="项目"
          offset={shownOffset}
          total={total}
          limit={limit}
          loading={loading || busy || removing}
          onPage={(value) => {
            if (value === offset) setRefresh((v) => v + 1);
            else setOffset(value);
          }}
          onSize={(v) => {
            setLimit(v);
            setOffset(0);
          }}
        />
      </section>
      <Dialog
        open={removal !== null}
        onOpenChange={(v) => {
          if (!v && !removing) setRemoval(null);
        }}
        title="从列表移除项目"
        description="只移除本机项目列表记录，保留 .eair 文件、证据和 IOC。重新打开或保存项目后，会再次显示在列表中。"
      >
        {removal && (
          <div className="project-removal-details">
            <p>
              {removal.info.name} · {removal.info.client}
            </p>
            <small>{removal.path}</small>
          </div>
        )}
        {removeError && (
          <p role="alert" className="error-text">
            {removeError}
          </p>
        )}
        <div className="dialog-actions">
          <Button
            variant="ghost"
            disabled={removing}
            onClick={() => setRemoval(null)}
          >
            取消
          </Button>
          <Button
            variant="danger"
            disabled={busy || removing}
            onClick={() => void remove()}
          >
            {removing ? "正在移除…" : "确认移除"}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
