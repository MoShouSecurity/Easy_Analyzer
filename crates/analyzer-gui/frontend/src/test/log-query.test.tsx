import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { LogQueryDialog } from "../components/LogQuery";
import { defaultLogQuery } from "../types";
import { localTimeInput, queryTime, displayLogTime } from "../lib/log-query";
afterEach(cleanup);
it("submits combined dimensions with timezone-bearing bounds", async () => {
  const apply = vi.fn().mockResolvedValue(undefined);
  render(
    <LogQueryDialog
      initial={defaultLogQuery()}
      busy={false}
      onApply={apply}
      onClose={() => {}}
    />,
  );
  fireEvent.change(screen.getByLabelText("开始时间（本地）"), {
    target: { value: "2026-10-14T09:00:00" },
  });
  fireEvent.change(screen.getByLabelText("结束时间（本地）"), {
    target: { value: "2026-10-14T18:00:00" },
  });
  fireEvent.change(screen.getByLabelText("Windows 事件 ID"), {
    target: { value: "4624,4625" },
  });
  fireEvent.change(screen.getByLabelText("日志通道"), {
    target: { value: "Security" },
  });
  fireEvent.click(screen.getByRole("button", { name: "添加条件" }));
  fireEvent.change(screen.getByLabelText("查询字段 1"), {
    target: { value: "user" },
  });
  fireEvent.change(screen.getByLabelText("查询字段值 1"), {
    target: { value: "用户甲" },
  });
  fireEvent.click(screen.getByRole("button", { name: "应用查询" }));
  await waitFor(() =>
    expect(apply).toHaveBeenCalledWith(
      expect.objectContaining({
        time_from: queryTime("2026-10-14T09:00:00"),
        time_until: queryTime("2026-10-14T18:00:00"),
        event_ids: "4624,4625",
        channel: "Security",
        fields: [{ field: "user", value: "用户甲", mode: "contains" }],
      }),
    ),
  );
});
it("rejects reversed time ranges and leaves the last query unchanged", async () => {
  const apply = vi.fn();
  render(
    <LogQueryDialog
      initial={defaultLogQuery()}
      busy={false}
      onApply={apply}
      onClose={() => {}}
    />,
  );
  fireEvent.change(screen.getByLabelText("开始时间（本地）"), {
    target: { value: "2026-10-14T18:00:00" },
  });
  fireEvent.change(screen.getByLabelText("结束时间（本地）"), {
    target: { value: "2026-10-14T09:00:00" },
  });
  fireEvent.click(screen.getByRole("button", { name: "应用查询" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "查询结束时间不能早于开始时间",
  );
  expect(apply).not.toHaveBeenCalled();
});
it("retains a failed query draft and does not submit during Chinese composition", async () => {
  const apply = vi.fn().mockRejectedValue("合成查询错误");
  render(
    <LogQueryDialog
      initial={defaultLogQuery()}
      busy={false}
      onApply={apply}
      onClose={() => {}}
    />,
  );
  const field = screen.getByLabelText("事件提供程序");
  fireEvent.change(field, { target: { value: "Security" } });
  fireEvent.compositionStart(field);
  fireEvent.submit(field.closest("form")!);
  expect(apply).not.toHaveBeenCalled();
  fireEvent.compositionEnd(field);
  fireEvent.click(screen.getByRole("button", { name: "应用查询" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "保留上一次有效查询",
  );
  expect(field).toHaveValue("Security");
});
it("converts local bounds consistently and keeps timezone-less evidence unknown", () => {
  expect(localTimeInput(queryTime("2026-10-14T09:00:00"))).toBe(
    "2026-10-14T09:00:00",
  );
  expect(displayLogTime("2026-10-14 00:00:00 UTC")).toBe(
    displayLogTime("2026-10-14T00:00:00Z"),
  );
  expect(displayLogTime("2026-10-14 09:00:00")).toBe("未知");
  expect(displayLogTime(null)).toBe("未知");
});

it("submits middleware dimensions and an explicit source timezone", async () => {
  const apply = vi.fn().mockResolvedValue(undefined);
  render(
    <LogQueryDialog
      initial={{ ...defaultLogQuery(), time_offset: 400 }}
      busy={false}
      onApply={apply}
      onClose={() => {}}
    />,
  );
  expect(
    screen.getByRole("combobox", { name: "无时区日志的时区" }),
  ).toHaveTextContent("UTC+06:40");
  for (const [label, value] of [
    ["日志级别", "ERROR, SEVERE"],
    ["客户端 IP", "192.0.2.10"],
    ["HTTP 状态码", "500,403"],
    ["请求方法", "POST"],
    ["请求路径", "/api/"],
    ["日志类 / Logger", "org.apache.catalina"],
  ]) {
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  }
  fireEvent.input(screen.getByLabelText("开始时间（本地）"), {
    target: { value: "2026-10-14T09:00:00" },
  });
  fireEvent.click(screen.getByRole("button", { name: "应用查询" }));
  await waitFor(() =>
    expect(apply).toHaveBeenCalledWith(
      expect.objectContaining({
        log_level: "ERROR, SEVERE",
        client_ip: "192.0.2.10",
        http_status: "500,403",
        method: "POST",
        uri: "/api/",
        logger: "org.apache.catalina",
        time_offset: 400,
        time_from: queryTime("2026-10-14T09:00:00"),
      }),
    ),
  );
});
it("rejects invalid HTTP codes without applying", async () => {
  const apply = vi.fn();
  render(
    <LogQueryDialog
      initial={defaultLogQuery()}
      busy={false}
      onApply={apply}
      onClose={() => {}}
    />,
  );
  fireEvent.change(screen.getByLabelText("HTTP 状态码"), {
    target: { value: "999" },
  });
  fireEvent.click(screen.getByRole("button", { name: "应用查询" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "HTTP 状态码必须为 100 到 599",
  );
  expect(apply).not.toHaveBeenCalled();
});
