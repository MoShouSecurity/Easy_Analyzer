import { useEffect, useRef, useState } from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { Check, Copy, LoaderCircle, Search, Terminal, X } from "lucide-react";
import {
  commandCategories,
  responseCommands,
  type CommandPlatform,
  type ResponseCommand,
} from "../lib/commands";
import { Button } from "./ui/button";
import { Select } from "./ui/select";
import { Tabs } from "./ui/tabs";

export function CommandsView() {
  const [platform, setPlatform] = useState<CommandPlatform>("windows");
  const [category, setCategory] = useState("");
  const [query, setQuery] = useState("");
  const [copying, setCopying] = useState<string | null>(null);
  const [result, setResult] = useState<{
    id: string;
    error: string | null;
  } | null>(null);
  const copyRevision = useRef(0);
  useEffect(
    () => () => {
      copyRevision.current++;
    },
    [],
  );
  const clearCopy = () => {
    copyRevision.current++;
    setCopying(null);
    setResult(null);
  };
  const copy = async (item: ResponseCommand) => {
    const revision = ++copyRevision.current;
    setCopying(item.id);
    setResult(null);
    try {
      await writeText(item.command);
      if (revision === copyRevision.current)
        setResult({ id: item.id, error: null });
    } catch (error) {
      if (revision === copyRevision.current)
        setResult({ id: item.id, error: String(error) });
    } finally {
      if (revision === copyRevision.current) setCopying(null);
    }
  };
  const term = query.trim().toLocaleLowerCase();
  const items = responseCommands.filter(
    (item) =>
      item.platform === platform &&
      (!category || item.category === category) &&
      (!term ||
        [item.title, item.description, item.command].some((value) =>
          value.toLocaleLowerCase().includes(term),
        )),
  );
  return (
    <section className="commands-view" aria-label="应急响应命令库">
      <Tabs
        value={platform}
        onChange={(value) => {
          setPlatform(value as CommandPlatform);
          clearCopy();
        }}
        items={[
          { value: "windows", label: "Windows" },
          { value: "linux", label: "Linux" },
        ]}
      >
        <TabsPrimitive.Content value={platform} className="commands-content">
          <div className="commands-controls">
            <Select
              value={category}
              label="命令分类"
              options={[{ value: "", label: "全部分类" }, ...commandCategories]}
              onChange={(value) => {
                setCategory(value);
                clearCopy();
              }}
            />
            <div className="search-input commands-search">
              <Search size={15} aria-hidden="true" />
              <input
                aria-label="搜索应急响应命令"
                placeholder="搜索命令名称、用途或命令文本…"
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  clearCopy();
                }}
              />
              {query && (
                <button
                  aria-label="清除命令搜索"
                  onClick={() => {
                    setQuery("");
                    clearCopy();
                  }}
                >
                  <X size={14} />
                </button>
              )}
            </div>
            <span className="commands-count" aria-live="polite">
              {items.length} 条命令
            </span>
          </div>
          <p className="commands-environment">
            {platform === "windows"
              ? "适用于 Windows 10 / Server 2016 及以上；PowerShell 命令默认使用 64 位 Windows PowerShell 5.1。"
              : "适用于 Linux Bash；工具、日志路径及 systemd 要求见各命令说明。"}
          </p>
          <div className="commands-list">
            {items.length ? (
              items.map((item) => {
                const feedback = result?.id === item.id ? result : null;
                const copied = !!feedback && feedback.error === null;
                return (
                  <article
                    className="command-card"
                    key={item.id}
                    aria-labelledby={`${item.id}-title`}
                  >
                    <div className="command-heading">
                      <div>
                        <span className="command-category">
                          {
                            commandCategories.find(
                              (c) => c.value === item.category,
                            )?.label
                          }
                        </span>
                        <h2 id={`${item.id}-title`}>{item.title}</h2>
                      </div>
                      <Button
                        variant="secondary"
                        size="sm"
                        aria-label={`复制 ${item.title}`}
                        disabled={copying === item.id}
                        onClick={() => void copy(item)}
                      >
                        {copying === item.id ? (
                          <LoaderCircle size={14} className="spin" />
                        ) : copied ? (
                          <Check size={14} />
                        ) : (
                          <Copy size={14} />
                        )}
                        {copying === item.id
                          ? "复制中"
                          : copied
                            ? "已复制"
                            : "复制"}
                      </Button>
                    </div>
                    <p className="command-description">{item.description}</p>
                    <div className="command-meta">
                      <span>
                        <Terminal size={12} />
                        {item.shell}
                      </span>
                      <span>权限：{item.permission}</span>
                    </div>
                    <pre
                      className="command-code"
                      tabIndex={0}
                      aria-label={`${item.title}的命令文本`}
                    >
                      <code>{item.command}</code>
                    </pre>
                    <p className="command-notes">{item.notes}</p>
                    {feedback &&
                      (feedback.error === null ? (
                        <span className="command-feedback" role="status">
                          已复制完整命令
                        </span>
                      ) : (
                        <p className="command-copy-error" role="alert">
                          复制失败：{feedback.error}
                          。可选择上方命令文本手动复制。
                        </p>
                      ))}
                  </article>
                );
              })
            ) : (
              <div className="commands-empty">
                没有匹配的命令，请调整分类或搜索内容。
              </div>
            )}
          </div>
        </TabsPrimitive.Content>
      </Tabs>
    </section>
  );
}
